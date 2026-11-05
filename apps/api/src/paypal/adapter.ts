import { Money, type Money as MoneyT } from "@paylock/schemas";
import type { z } from "zod";
import { ApprovalError, FrozenError, type SettlementApproval } from "./approval.js";
import { PayPalError } from "./errors.js";
import type { PayPalHttp } from "./http.js";
import {
  Authorization,
  Balances,
  Capture,
  Order,
  PayoutBatch,
  Refund,
  type Authorization as AuthorizationT,
} from "./types.js";

/**
 * The only module that talks to PayPal (invariant 2). Every write carries a
 * caller-supplied PayPal-Request-Id derived from sha256(dealId:action:attempt),
 * reused across HTTP retries by PayPalHttp.
 *
 * Money-moving calls (capture, payout, refund) require a SettlementApproval
 * and are blocked by PAYLOCK_FREEZE. Void is allowed during a freeze because it
 * returns funds to the buyer (decision C).
 *
 * APIs: Orders v2, Payments v2, Payouts v1, Reporting balances. Nothing from
 * /v1/payments/payment, NVP/SOAP, or @paypal/checkout-server-sdk.
 */

export interface AdapterOptions {
  isFrozen: () => boolean;
  brandName?: string;
}

export interface CreateOrderInput {
  dealId: string;
  amount: MoneyT;
  description: string;
  requestId: string;
  returnUrl: string;
  cancelUrl: string;
  /**
   * Sandbox/test only: a card payment source so an order can be funded without
   * a buyer popup (smoke scripts and the guarded E2E route). Never logged.
   */
  card?: { number: string; expiry: string; name: string; security_code: string };
  mock?: SandboxMock;
}

export interface CreatedOrder {
  order: Order;
  /** Buyer approval link (`approve` or `payer-action`); absent for card orders. */
  approveUrl?: string;
}

export interface CaptureInput {
  dealId: string;
  authorizationId: string;
  amount: MoneyT;
  /** Always sent explicitly: the OpenAPI default is false, RulesHub says true. */
  finalCapture: boolean;
  requestId: string;
}

export interface PayoutInput {
  dealId: string;
  /** Logical attempt; each re-send needs a new sender_batch_id (PayPal dedups for 30 days). */
  attempt: number;
  receiverEmail: string;
  amount: MoneyT;
  requestId: string;
  note?: string;
}

export interface RefundInput {
  dealId: string;
  captureId: string;
  amount: MoneyT;
  requestId: string;
}

const USD = "USD" as const;

/**
 * Sandbox negative testing (C11). PayPal-Mock-Response asks the sandbox to
 * simulate an error, e.g. { mock_application_codes: "INSTRUMENT_DECLINED" }.
 * The whole app is sandbox-only (config rejects any other PAYPAL_ENV).
 */
export interface SandboxMock {
  mockApplicationCode: string;
}

function mockHeaders(mock?: SandboxMock): Record<string, string> | undefined {
  if (!mock) return undefined;
  if (!/^[A-Z_]{3,64}$/.test(mock.mockApplicationCode))
    throw new Error("invalid mock application code");
  return {
    "PayPal-Mock-Response": JSON.stringify({ mock_application_codes: mock.mockApplicationCode }),
  };
}

export class PayPalAdapter {
  constructor(
    private readonly http: PayPalHttp,
    private readonly opts: AdapterOptions,
  ) {}

  // ---------- Orders v2 ----------

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    this.assertNotFrozen("create order");
    const amount = Money.parse(input.amount);
    const paymentSource = input.card
      ? {
          card: {
            ...input.card,
            experience_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl },
          },
        }
      : {
          paypal: {
            experience_context: {
              brand_name: this.opts.brandName ?? "Paylock",
              shipping_preference: "NO_SHIPPING",
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
            },
          },
        };
    const res = await this.http.request({
      method: "POST",
      path: "/v2/checkout/orders",
      requestId: input.requestId,
      representation: true,
      headers: mockHeaders(input.mock),
      body: {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            // No invoice_id (decision N): reusing one across attempts causes duplicate-invoice failures.
            custom_id: input.dealId,
            description: input.description.slice(0, 127),
            amount: { currency_code: USD, value: amount },
          },
        ],
        payment_source: paymentSource,
      },
    });
    const order = parse(Order, res.data, "create order");
    const approveUrl = order.links?.find(
      (l) => l.rel === "approve" || l.rel === "payer-action",
    )?.href;
    return { order, approveUrl };
  }

  async getOrder(orderId: string): Promise<Order> {
    const res = await this.http.request({
      method: "GET",
      path: `/v2/checkout/orders/${enc(orderId)}`,
    });
    return parse(Order, res.data, "get order");
  }

  /**
   * Authorize an approved order. On ORDER_ALREADY_AUTHORIZED, recovers the
   * existing authorization via GET instead of failing (explain-error.md).
   */
  async authorizeOrder(
    orderId: string,
    requestId: string,
    mock?: SandboxMock,
  ): Promise<{ order: Order; authorization: AuthorizationT }> {
    this.assertNotFrozen("authorize");
    let order: Order;
    try {
      const res = await this.http.request({
        method: "POST",
        path: `/v2/checkout/orders/${enc(orderId)}/authorize`,
        requestId,
        representation: true,
        headers: mockHeaders(mock),
        body: {},
      });
      order = parse(Order, res.data, "authorize order");
    } catch (err) {
      if (err instanceof PayPalError && err.hasIssue("ORDER_ALREADY_AUTHORIZED")) {
        order = await this.getOrder(orderId);
      } else {
        throw err;
      }
    }
    const authorization = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!authorization) {
      throw new PayPalError(
        200,
        "NO_AUTHORIZATION",
        `Order ${orderId} has no authorization`,
        undefined,
      );
    }
    return { order, authorization };
  }

  // ---------- Payments v2 ----------

  async getAuthorization(authorizationId: string): Promise<AuthorizationT> {
    const res = await this.http.request({
      method: "GET",
      path: `/v2/payments/authorizations/${enc(authorizationId)}`,
    });
    return parse(Authorization, res.data, "get authorization");
  }

  async captureAuthorization(approval: SettlementApproval, input: CaptureInput) {
    this.assertNotFrozen("capture");
    const amount = Money.parse(input.amount);
    await this.approve(approval, { dealId: input.dealId, action: "capture", amount });
    const res = await this.http.request({
      method: "POST",
      path: `/v2/payments/authorizations/${enc(input.authorizationId)}/capture`,
      requestId: input.requestId,
      representation: true,
      body: {
        amount: { currency_code: USD, value: amount },
        final_capture: input.finalCapture,
      },
    });
    return parse(Capture, res.data, "capture authorization");
  }

  /**
   * Read a capture. Settlement confirms every capture's amount and status with
   * this GET before recording it (C7: a reused key can echo a different amount),
   * and the sweeper polls it while a capture is PENDING.
   */
  async getCapture(captureId: string) {
    const res = await this.http.request({
      method: "GET",
      path: `/v2/payments/captures/${enc(captureId)}`,
    });
    return parse(Capture, res.data, "get capture");
  }

  /** Allowed during PAYLOCK_FREEZE. Returns the authorization when PayPal sends a body (200), else undefined (204). */
  async voidAuthorization(
    authorizationId: string,
    requestId: string,
  ): Promise<AuthorizationT | undefined> {
    const res = await this.http.request({
      method: "POST",
      path: `/v2/payments/authorizations/${enc(authorizationId)}/void`,
      requestId,
      representation: true,
    });
    return res.status === 204 || res.data === undefined
      ? undefined
      : parse(Authorization, res.data, "void authorization");
  }

  /** P2. Refund a capture (e.g. a payout failed after capture). */
  async refundCapture(approval: SettlementApproval, input: RefundInput) {
    this.assertNotFrozen("refund");
    const amount = Money.parse(input.amount);
    await this.approve(approval, { dealId: input.dealId, action: "refund", amount });
    const res = await this.http.request({
      method: "POST",
      path: `/v2/payments/captures/${enc(input.captureId)}/refund`,
      requestId: input.requestId,
      representation: true,
      body: { amount: { currency_code: USD, value: amount } },
    });
    return parse(Refund, res.data, "refund capture");
  }

  // ---------- Payouts v1 ----------

  async createPayout(approval: SettlementApproval, input: PayoutInput) {
    this.assertNotFrozen("payout");
    const amount = Money.parse(input.amount);
    if (!Number.isInteger(input.attempt) || input.attempt < 1)
      throw new Error("attempt must be >= 1");
    await this.approve(approval, { dealId: input.dealId, action: "payout", amount });
    const res = await this.http.request({
      method: "POST",
      path: "/v1/payments/payouts",
      requestId: input.requestId,
      body: {
        sender_batch_header: {
          sender_batch_id: payoutBatchId(input.dealId, input.attempt),
          email_subject: "You have a payout from Paylock",
          email_message: "Funds released for verified work.",
        },
        items: [
          {
            recipient_type: "EMAIL",
            receiver: input.receiverEmail,
            amount: { value: amount, currency: USD },
            sender_item_id: input.dealId, // stable across re-sends so they stay traceable
            ...(input.note ? { note: input.note } : {}),
          },
        ],
      },
    });
    return parse(PayoutBatch, res.data, "create payout");
  }

  async getPayoutBatch(payoutBatchId: string) {
    const res = await this.http.request({
      method: "GET",
      path: `/v1/payments/payouts/${enc(payoutBatchId)}`,
    });
    return parse(PayoutBatch, res.data, "get payout batch");
  }

  // ---------- Reporting ----------

  /** Requires Transaction Search on the app; 403 NOT_AUTHORIZED otherwise. */
  async getBalances(currency: "USD" = "USD") {
    const res = await this.http.request({
      method: "GET",
      path: "/v1/reporting/balances",
      query: { currency_code: currency },
    });
    return parse(Balances, res.data, "get balances");
  }

  // ---------- internals ----------

  private assertNotFrozen(action: string) {
    if (this.opts.isFrozen()) throw new FrozenError(action);
  }

  private async approve(
    approval: SettlementApproval | undefined,
    req: Parameters<SettlementApproval["assertApproves"]>[0],
  ) {
    if (!approval || typeof approval.assertApproves !== "function") {
      throw new ApprovalError(`${req.action} requires a SettlementApproval (invariant 1)`);
    }
    await approval.assertApproves(req);
  }
}

export function payoutBatchId(dealId: string, attempt: number): string {
  return `paylock-${dealId}-${attempt}`;
}

/**
 * True when PayPal refused a payout because the sender_batch_id was already
 * used (observed in sandbox: 400 USER_BUSINESS_ERROR, details[].field
 * SENDER_BATCH_ID). This happens even when the PayPal-Request-Id is the same,
 * and PayPal returns no link to the original batch. It means "this attempt was
 * already sent"; never treat it as a failure that justifies a re-send. Recover
 * the batch id from the payout webhook or a stored record instead (pitfalls.md).
 */
export function isDuplicatePayoutBatch(err: unknown): boolean {
  return (
    err instanceof PayPalError &&
    err.status === 400 &&
    err.details.some((d) => d.field?.toUpperCase() === "SENDER_BATCH_ID")
  );
}

function enc(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
    throw new Error(`Invalid PayPal resource id: ${JSON.stringify(id)}`);
  return encodeURIComponent(id);
}

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new PayPalError(
      200,
      "UNEXPECTED_RESPONSE",
      `Unexpected PayPal response for ${what}: ${r.error.issues[0]?.message}`,
      undefined,
    );
  }
  return r.data;
}
