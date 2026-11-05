/* eslint-disable @typescript-eslint/no-explicit-any -- test double for PayPal JSON bodies */
import { randomBytes } from "node:crypto";
import { parsePayPalError, PayPalError } from "../paypal/errors.js";
import type { PayPalHttp, PayPalRequest, PayPalResponse } from "../paypal/http.js";

/**
 * In-memory PayPal sandbox for "mocked PayPal" integration tests. It sits
 * behind the real PayPalAdapter (replacing only PayPalHttp), so approvals,
 * freeze checks, request ids and response parsing are the production code.
 * Behaviour follows what the real sandbox did in Phase 1 (pitfalls.md):
 * - same PayPal-Request-Id returns the stored response (C7);
 * - a reused sender_batch_id is 400 USER_BUSINESS_ERROR on SENDER_BATCH_ID (C8);
 * - a second capture after final_capture is 422 AUTHORIZATION_ALREADY_CAPTURED (C6);
 * - card AUTHORIZE orders come back COMPLETED with the authorization inside (C13).
 */

interface Auth {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  custom_id: string;
  create_time: string;
  expiration_time: string;
}
interface Cap {
  id: string;
  authId: string;
  status: string;
  amount: string;
}
interface Ord {
  id: string;
  status: string;
  amount: string;
  currency: string;
  custom_id: string;
  card: boolean;
  authId?: string;
  accountStatus?: string;
}
interface Batch {
  id: string;
  senderBatchId: string;
  senderItemId: string;
  amount: string;
  status: string;
  itemStatus: string;
  itemErrors?: string;
}

type Fault = {
  match: RegExp;
  method?: string;
  kind: "network" | "lost-response" | { status: number; body: unknown };
};

const id = (p: string) => `${p}${randomBytes(6).toString("hex").toUpperCase()}`;

export class PayPalSim {
  orders = new Map<string, Ord>();
  auths = new Map<string, Auth>();
  captures = new Map<string, Cap>();
  batches = new Map<string, Batch>();
  refunds = new Map<string, { id: string; captureId: string; status: string }>();
  usedSenderBatchIds = new Set<string>();
  requests: PayPalRequest[] = [];
  private replay = new Map<string, PayPalResponse>();
  private faults: Fault[] = [];

  /** Next capture status returned by capture (then GET returns `captureStatusOnGet` if set). */
  nextCaptureStatus = "COMPLETED";
  nextAuthStatus = "CREATED";
  /** Payout item status reported on GET batch. */
  payoutItemStatus = "SUCCESS";
  /** Override the amount GET capture reports (C7 mismatch tests). */
  captureGetAmount: string | undefined;
  /** Override the amount the authorization reports (mismatch tests). */
  authAmount: string | undefined;

  readonly http = { request: (r: PayPalRequest) => this.request(r) } as unknown as PayPalHttp;

  /** Fail the next matching request. lost-response: PayPal applies it, the caller sees a network error. */
  fail(match: RegExp, kind: Fault["kind"], method = "POST") {
    this.faults.push({ match, method, kind });
  }

  /** The buyer approves in the popup. */
  approve(orderId: string, accountStatus = "VERIFIED") {
    const o = this.orders.get(orderId)!;
    o.status = "APPROVED";
    o.accountStatus = accountStatus;
  }

  calls(method: string, re: RegExp) {
    return this.requests.filter((r) => r.method === method && re.test(r.path));
  }

  /** Runs before each request is handled (e.g. to race a competing deal). */
  beforeHandle: ((r: PayPalRequest) => Promise<void> | void) | undefined;

  async request(r: PayPalRequest): Promise<PayPalResponse> {
    this.requests.push(r);
    await this.beforeHandle?.(r);
    const fault = this.faults.find(
      (f) => f.match.test(r.path) && (!f.method || f.method === r.method),
    );
    if (fault) this.faults.splice(this.faults.indexOf(fault), 1);
    if (fault?.kind === "network")
      throw new PayPalError(0, "NETWORK_ERROR", "socket hang up", undefined, [], 4);
    if (fault && typeof fault.kind === "object")
      throw parsePayPalError(fault.kind.status, fault.kind.body, "dbg-sim");
    if (r.method === "POST" && r.requestId) {
      const prev = this.replay.get(r.requestId);
      if (prev) {
        if (fault?.kind === "lost-response")
          throw new PayPalError(0, "NETWORK_ERROR", "timeout", undefined, [], 4);
        return prev;
      }
    }
    const res = this.handle(r);
    if (r.method === "POST" && r.requestId && res.status < 400) this.replay.set(r.requestId, res);
    if (fault?.kind === "lost-response")
      throw new PayPalError(0, "NETWORK_ERROR", "timeout", undefined, [], 4);
    return res;
  }

  private handle(r: PayPalRequest): PayPalResponse {
    const ok = (data: unknown, status = 200): PayPalResponse => ({
      status,
      data,
      debugId: "dbg-sim",
      attempts: 1,
    });
    const err = (status: number, name: string, issue?: string, field?: string): never => {
      throw parsePayPalError(
        status,
        { name, message: issue ?? name, details: issue ? [{ issue, field }] : [] },
        "dbg-sim",
      );
    };
    const body = (r.body ?? {}) as any;
    let m: RegExpExecArray | null;

    if (r.method === "POST" && r.path === "/v2/checkout/orders") {
      const mock = r.headers?.["PayPal-Mock-Response"];
      if (mock) err(422, "UNPROCESSABLE_ENTITY", JSON.parse(mock).mock_application_codes);
      const pu = body.purchase_units[0];
      const o: Ord = {
        id: id("O"),
        status: body.payment_source?.card ? "COMPLETED" : "PAYER_ACTION_REQUIRED",
        amount: pu.amount.value,
        currency: pu.amount.currency_code,
        custom_id: pu.custom_id,
        card: !!body.payment_source?.card,
      };
      this.orders.set(o.id, o);
      if (o.card) this.newAuth(o);
      return ok(this.orderView(o), 201);
    }
    if ((m = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(r.path)) && r.method === "GET") {
      const o = this.orders.get(m[1]!) ?? err(404, "RESOURCE_NOT_FOUND");
      return ok(this.orderView(o));
    }
    if ((m = /^\/v2\/checkout\/orders\/([^/]+)\/authorize$/.exec(r.path))) {
      const o = this.orders.get(m[1]!) ?? err(404, "RESOURCE_NOT_FOUND");
      if (o.authId) err(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_AUTHORIZED");
      if (o.status !== "APPROVED") err(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED");
      this.newAuth(o);
      return ok(this.orderView(o), 201);
    }
    if ((m = /^\/v2\/payments\/authorizations\/([^/]+)$/.exec(r.path))) {
      const a = this.auths.get(m[1]!) ?? err(404, "RESOURCE_NOT_FOUND");
      return ok(this.authView(a));
    }
    if ((m = /^\/v2\/payments\/authorizations\/([^/]+)\/capture$/.exec(r.path))) {
      const a = this.auths.get(m[1]!) ?? err(404, "RESOURCE_NOT_FOUND");
      if (a.status === "CAPTURED")
        err(422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_ALREADY_CAPTURED");
      if (a.status !== "CREATED") err(422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_VOIDED");
      if (body.final_capture !== true)
        err(400, "INVALID_REQUEST", "FINAL_CAPTURE_EXPECTED_IN_TESTS");
      const c: Cap = {
        id: id("C"),
        authId: a.id,
        status: this.nextCaptureStatus,
        amount: body.amount.value,
      };
      this.captures.set(c.id, c);
      a.status = "CAPTURED";
      return ok(this.capView(c, c.amount), 201);
    }
    if ((m = /^\/v2\/payments\/captures\/([^/]+)$/.exec(r.path))) {
      const c = this.captures.get(m[1]!) ?? err(404, "RESOURCE_NOT_FOUND");
      return ok(this.capView(c, this.captureGetAmount ?? c.amount));
    }
    if ((m = /^\/v2\/payments\/authorizations\/([^/]+)\/void$/.exec(r.path))) {
      const a = this.auths.get(m[1]!) ?? err(404, "RESOURCE_NOT_FOUND");
      if (a.status === "VOIDED") err(422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_ALREADY_VOIDED");
      if (a.status !== "CREATED")
        err(422, "UNPROCESSABLE_ENTITY", "AUTHORIZATION_ALREADY_CAPTURED");
      a.status = "VOIDED";
      return ok(undefined, 204);
    }
    if ((m = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(r.path))) {
      const c = this.captures.get(m[1]!) ?? err(404, "RESOURCE_NOT_FOUND");
      if (c.status !== "COMPLETED") err(422, "UNPROCESSABLE_ENTITY", "CAPTURE_FULLY_REFUNDED");
      c.status = "REFUNDED";
      const rf = { id: id("R"), captureId: c.id, status: "COMPLETED" };
      this.refunds.set(rf.id, rf);
      return ok({ id: rf.id, status: rf.status, amount: body.amount }, 201);
    }
    if (r.method === "POST" && r.path === "/v1/payments/payouts") {
      const sbid = body.sender_batch_header.sender_batch_id;
      if (this.usedSenderBatchIds.has(sbid))
        err(
          400,
          "USER_BUSINESS_ERROR",
          "Batch with given sender_batch_id already exists",
          "SENDER_BATCH_ID",
        );
      this.usedSenderBatchIds.add(sbid);
      const item = body.items[0];
      const b: Batch = {
        id: id("B"),
        senderBatchId: sbid,
        senderItemId: item.sender_item_id,
        amount: item.amount.value,
        status: "PENDING",
        itemStatus: "PENDING",
      };
      this.batches.set(b.id, b);
      return ok(
        {
          batch_header: {
            payout_batch_id: b.id,
            batch_status: "PENDING",
            sender_batch_header: { sender_batch_id: sbid },
          },
        },
        201,
      );
    }
    if ((m = /^\/v1\/payments\/payouts\/([^/]+)$/.exec(r.path))) {
      const b = this.batches.get(m[1]!) ?? err(404, "RESOURCE_NOT_FOUND");
      if (b.itemStatus === "PENDING") b.itemStatus = this.payoutItemStatus;
      b.status =
        b.itemStatus === "SUCCESS"
          ? "SUCCESS"
          : b.itemStatus === "PENDING"
            ? "PROCESSING"
            : "SUCCESS";
      return ok(this.batchView(b));
    }
    throw new Error(`PayPalSim: unhandled ${r.method} ${r.path}`);
  }

  private newAuth(o: Ord) {
    const now = new Date();
    const a: Auth = {
      id: id("A"),
      orderId: o.id,
      status: this.nextAuthStatus,
      amount: this.authAmount ?? o.amount,
      custom_id: o.custom_id,
      create_time: now.toISOString(),
      expiration_time: new Date(now.getTime() + 29 * 86_400_000).toISOString(),
    };
    this.auths.set(a.id, a);
    o.authId = a.id;
    o.status = "COMPLETED";
  }

  private authView(a: Auth) {
    return {
      id: a.id,
      status: a.status,
      amount: { currency_code: "USD", value: a.amount },
      custom_id: a.custom_id,
      create_time: a.create_time,
      expiration_time: a.expiration_time,
    };
  }

  private capView(c: Cap, amount: string) {
    return {
      id: c.id,
      status: c.status,
      ...(c.status === "PENDING" ? { status_details: { reason: "PENDING_REVIEW" } } : {}),
      amount: { currency_code: "USD", value: amount },
      final_capture: true,
      seller_receivable_breakdown: {
        gross_amount: { currency_code: "USD", value: amount },
        paypal_fee: { currency_code: "USD", value: "0.84" },
      },
    };
  }

  batchView(b: Batch) {
    return {
      batch_header: {
        payout_batch_id: b.id,
        batch_status: b.status,
        sender_batch_header: { sender_batch_id: b.senderBatchId },
      },
      items: [
        {
          payout_item_id: `I${b.id}`,
          transaction_status: b.itemStatus,
          payout_item: {
            sender_item_id: b.senderItemId,
            amount: { currency: "USD", value: b.amount },
          },
          ...(b.itemErrors ? { errors: { name: b.itemErrors } } : {}),
        },
      ],
    };
  }

  orderView(o: Ord) {
    const a = o.authId ? this.auths.get(o.authId) : undefined;
    const caps = [...this.captures.values()].filter((c) => c.authId === o.authId);
    return {
      id: o.id,
      status: o.status,
      intent: "AUTHORIZE",
      links: o.card
        ? []
        : [
            {
              href: `https://www.sandbox.paypal.com/checkoutnow?token=${o.id}`,
              rel: "payer-action",
            },
          ],
      ...(o.accountStatus
        ? { payment_source: { paypal: { account_status: o.accountStatus } } }
        : {}),
      purchase_units: [
        {
          custom_id: o.custom_id,
          amount: { currency_code: o.currency, value: o.amount },
          payments: a
            ? {
                authorizations: [this.authView(a)],
                captures: caps.map((c) => this.capView(c, c.amount)),
              }
            : undefined,
        },
      ],
    };
  }
}
