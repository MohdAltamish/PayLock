import { describe, expect, it } from "vitest";
import { isDuplicatePayoutBatch, PayPalAdapter, payoutBatchId } from "./adapter.js";
import {
  ApprovalError,
  FrozenError,
  type ApprovalRequest,
  type SettlementApproval,
} from "./approval.js";
import { PayPalError } from "./errors.js";
import type { PayPalHttp, PayPalRequest } from "./http.js";

type Handler = (req: PayPalRequest) => { status?: number; data?: unknown } | Promise<never>;

function setup(handler: Handler, frozen = false) {
  const requests: PayPalRequest[] = [];
  const http = {
    async request(req: PayPalRequest) {
      requests.push(req);
      const r = await handler(req);
      return { status: r.status ?? 200, data: r.data, debugId: "dbg", attempts: 1 };
    },
  } as unknown as PayPalHttp;
  let isFrozen = frozen;
  const adapter = new PayPalAdapter(http, { isFrozen: () => isFrozen });
  return { adapter, requests, freeze: (v: boolean) => (isFrozen = v) };
}

class RecordingApproval implements SettlementApproval {
  readonly id = "pd_1";
  seen: ApprovalRequest[] = [];
  constructor(private readonly allow = true) {}
  async assertApproves(req: ApprovalRequest) {
    this.seen.push(req);
    if (!this.allow) throw new ApprovalError("not approved");
  }
}

const order = (extra: object = {}) => ({
  id: "ORDER1",
  status: "CREATED",
  links: [{ href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1", rel: "payer-action" }],
  ...extra,
});
const auth = {
  id: "AUTH1",
  status: "CREATED",
  amount: { currency_code: "USD", value: "300.00" },
  expiration_time: "2026-12-04T00:00:00Z",
};

describe("createOrder", () => {
  it("sends intent AUTHORIZE, custom_id, explicit USD string amount, no invoice_id", async () => {
    const { adapter, requests } = setup(() => ({ status: 201, data: order() }));
    const res = await adapter.createOrder({
      dealId: "deal_1",
      amount: "300.00",
      description: "Bakery landing page",
      requestId: "rid",
      returnUrl: "https://app.example/return",
      cancelUrl: "https://app.example/cancel",
    });
    const r = requests[0]!;
    expect(r).toMatchObject({
      method: "POST",
      path: "/v2/checkout/orders",
      requestId: "rid",
      representation: true,
    });
    const body = r.body as any;
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.purchase_units[0]).toEqual({
      custom_id: "deal_1",
      description: "Bakery landing page",
      amount: { currency_code: "USD", value: "300.00" },
    });
    expect(JSON.stringify(body)).not.toContain("invoice_id");
    expect(body.payment_source.paypal.experience_context).toMatchObject({
      shipping_preference: "NO_SHIPPING",
      return_url: "https://app.example/return",
    });
    expect(res.approveUrl).toContain("token=ORDER1");
  });

  it("rejects non-money amounts before calling PayPal", async () => {
    const { adapter, requests } = setup(() => ({ data: order() }));
    for (const amount of ["300", "300.5", "-1.00"]) {
      await expect(
        adapter.createOrder({
          dealId: "d",
          amount,
          description: "x",
          requestId: "r",
          returnUrl: "https://a",
          cancelUrl: "https://a",
        }),
      ).rejects.toThrow();
    }
    expect(requests).toHaveLength(0);
  });

  it("is blocked by PAYLOCK_FREEZE", async () => {
    const { adapter, requests } = setup(() => ({ data: order() }), true);
    await expect(
      adapter.createOrder({
        dealId: "d",
        amount: "1.00",
        description: "x",
        requestId: "r",
        returnUrl: "https://a",
        cancelUrl: "https://a",
      }),
    ).rejects.toBeInstanceOf(FrozenError);
    expect(requests).toHaveLength(0);
  });

  it("sends a sandbox mock header only when asked", async () => {
    const { adapter, requests } = setup(() => ({ data: order() }));
    await adapter.createOrder({
      dealId: "d",
      amount: "1.00",
      description: "x",
      requestId: "r",
      returnUrl: "https://a",
      cancelUrl: "https://a",
      mock: { mockApplicationCode: "INSTRUMENT_DECLINED" },
    });
    expect(requests[0]!.headers).toEqual({
      "PayPal-Mock-Response": '{"mock_application_codes":"INSTRUMENT_DECLINED"}',
    });
  });
});

describe("authorizeOrder", () => {
  it("returns the authorization from the order", async () => {
    const { adapter, requests } = setup(() => ({
      status: 201,
      data: order({
        status: "COMPLETED",
        purchase_units: [{ payments: { authorizations: [auth] } }],
      }),
    }));
    const { authorization } = await adapter.authorizeOrder("ORDER1", "rid");
    expect(authorization).toMatchObject({
      id: "AUTH1",
      status: "CREATED",
      expiration_time: "2026-12-04T00:00:00Z",
    });
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v2/checkout/orders/ORDER1/authorize",
      requestId: "rid",
      body: {},
    });
  });

  it("recovers on ORDER_ALREADY_AUTHORIZED by reading the order", async () => {
    const { adapter, requests } = setup((req) => {
      if (req.method === "POST") {
        return Promise.reject(
          new PayPalError(422, "UNPROCESSABLE_ENTITY", "x", "d", [
            { issue: "ORDER_ALREADY_AUTHORIZED" },
          ]),
        );
      }
      return {
        data: order({
          status: "COMPLETED",
          purchase_units: [{ payments: { authorizations: [auth] } }],
        }),
      };
    });
    const { authorization } = await adapter.authorizeOrder("ORDER1", "rid");
    expect(authorization.id).toBe("AUTH1");
    expect(requests.map((r) => r.method)).toEqual(["POST", "GET"]);
  });

  it("propagates other errors such as INSTRUMENT_DECLINED", async () => {
    const { adapter } = setup(() =>
      Promise.reject(
        new PayPalError(422, "UNPROCESSABLE_ENTITY", "x", "d", [{ issue: "INSTRUMENT_DECLINED" }]),
      ),
    );
    await expect(adapter.authorizeOrder("ORDER1", "rid")).rejects.toMatchObject({
      issue: "INSTRUMENT_DECLINED",
    });
  });
});

describe("captureAuthorization", () => {
  const input = {
    dealId: "deal_1",
    authorizationId: "AUTH1",
    amount: "70.00",
    finalCapture: true,
    requestId: "rid",
  };
  const captured = { id: "CAP1", status: "COMPLETED", final_capture: true };

  it("requires and consults a SettlementApproval before calling PayPal", async () => {
    const { adapter, requests } = setup(() => ({ status: 201, data: captured }));
    const approval = new RecordingApproval();
    const cap = await adapter.captureAuthorization(approval, input);
    expect(cap.id).toBe("CAP1");
    expect(approval.seen).toEqual([{ dealId: "deal_1", action: "capture", amount: "70.00" }]);
    expect(requests[0]).toMatchObject({
      path: "/v2/payments/authorizations/AUTH1/capture",
      requestId: "rid",
    });
    expect(requests[0]!.body).toEqual({
      amount: { currency_code: "USD", value: "70.00" },
      final_capture: true,
    });
  });

  it("sends final_capture explicitly even when false", async () => {
    const { adapter, requests } = setup(() => ({ status: 201, data: captured }));
    await adapter.captureAuthorization(new RecordingApproval(), { ...input, finalCapture: false });
    expect((requests[0]!.body as any).final_capture).toBe(false);
  });

  it("does not call PayPal when the approval refuses", async () => {
    const { adapter, requests } = setup(() => ({ data: captured }));
    await expect(
      adapter.captureAuthorization(new RecordingApproval(false), input),
    ).rejects.toBeInstanceOf(ApprovalError);
    expect(requests).toHaveLength(0);
  });

  it("does not call PayPal without an approval", async () => {
    const { adapter, requests } = setup(() => ({ data: captured }));
    await expect(
      adapter.captureAuthorization(undefined as unknown as SettlementApproval, input),
    ).rejects.toBeInstanceOf(ApprovalError);
    expect(requests).toHaveLength(0);
  });

  it("is blocked by PAYLOCK_FREEZE before the approval is consulted", async () => {
    const { adapter, requests } = setup(() => ({ data: captured }), true);
    const approval = new RecordingApproval();
    await expect(adapter.captureAuthorization(approval, input)).rejects.toBeInstanceOf(FrozenError);
    expect(approval.seen).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});

describe("getCapture", () => {
  it("GETs the capture and parses status and amount (C7 re-check)", async () => {
    const { adapter, requests } = setup(() => ({
      data: { id: "CAP1", status: "PENDING", amount: { currency_code: "USD", value: "3.00" } },
    }));
    const cap = await adapter.getCapture("CAP1");
    expect(requests[0]).toMatchObject({ method: "GET", path: "/v2/payments/captures/CAP1" });
    expect(requests[0]!.requestId).toBeUndefined();
    expect(cap).toMatchObject({ status: "PENDING", amount: { value: "3.00" } });
  });
  it("is allowed during a freeze (read only)", async () => {
    const { adapter } = setup(() => ({ data: { id: "CAP1", status: "COMPLETED" } }), true);
    await expect(adapter.getCapture("CAP1")).resolves.toMatchObject({ status: "COMPLETED" });
  });
});

describe("voidAuthorization", () => {
  it("is allowed during PAYLOCK_FREEZE and handles 204", async () => {
    const { adapter, requests } = setup(() => ({ status: 204, data: undefined }), true);
    expect(await adapter.voidAuthorization("AUTH1", "rid")).toBeUndefined();
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v2/payments/authorizations/AUTH1/void",
      requestId: "rid",
    });
  });

  it("parses a 200 representation", async () => {
    const { adapter } = setup(() => ({ status: 200, data: { ...auth, status: "VOIDED" } }));
    expect((await adapter.voidAuthorization("AUTH1", "rid"))?.status).toBe("VOIDED");
  });
});

describe("createPayout", () => {
  const input = {
    dealId: "deal_1",
    attempt: 2,
    receiverEmail: "seller@example.com",
    amount: "300.00",
    requestId: "rid",
  };

  it("uses a per-attempt sender_batch_id and sender_item_id = dealId", async () => {
    const { adapter, requests } = setup(() => ({
      status: 201,
      data: { batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } },
    }));
    const approval = new RecordingApproval();
    const batch = await adapter.createPayout(approval, input);
    expect(batch.batch_header.payout_batch_id).toBe("B1");
    const body = requests[0]!.body as any;
    expect(body.sender_batch_header.sender_batch_id).toBe("paylock-deal_1-2");
    expect(body.items).toEqual([
      {
        recipient_type: "EMAIL",
        receiver: "seller@example.com",
        amount: { value: "300.00", currency: "USD" },
        sender_item_id: "deal_1",
      },
    ]);
    expect(approval.seen[0]).toEqual({ dealId: "deal_1", action: "payout", amount: "300.00" });
  });

  it("requires approval and is blocked by freeze", async () => {
    const a = setup(() => ({ data: {} }));
    await expect(
      a.adapter.createPayout(new RecordingApproval(false), input),
    ).rejects.toBeInstanceOf(ApprovalError);
    expect(a.requests).toHaveLength(0);
    const b = setup(() => ({ data: {} }), true);
    await expect(b.adapter.createPayout(new RecordingApproval(), input)).rejects.toBeInstanceOf(
      FrozenError,
    );
  });

  it("payoutBatchId changes per attempt", () => {
    expect(payoutBatchId("d", 1)).not.toBe(payoutBatchId("d", 2));
  });

  it("isDuplicatePayoutBatch matches the shape observed in sandbox", () => {
    const dup = new PayPalError(400, "USER_BUSINESS_ERROR", "User business error.", "d", [
      {
        field: "SENDER_BATCH_ID",
        location: "body",
        issue: "Batch with given sender_batch_id already exists",
      },
    ]);
    expect(isDuplicatePayoutBatch(dup)).toBe(true);
    expect(
      isDuplicatePayoutBatch(
        new PayPalError(400, "USER_BUSINESS_ERROR", "x", "d", [{ field: "RECEIVER" }]),
      ),
    ).toBe(false);
    expect(
      isDuplicatePayoutBatch(
        new PayPalError(500, "INTERNAL", "x", "d", [{ field: "SENDER_BATCH_ID" }]),
      ),
    ).toBe(false);
    expect(isDuplicatePayoutBatch(new Error("x"))).toBe(false);
  });
});

describe("refundCapture", () => {
  it("requires approval", async () => {
    const { adapter, requests } = setup(() => ({
      status: 201,
      data: { id: "R1", status: "COMPLETED" },
    }));
    await expect(
      adapter.refundCapture(new RecordingApproval(false), {
        dealId: "d",
        captureId: "CAP1",
        amount: "1.00",
        requestId: "r",
      }),
    ).rejects.toBeInstanceOf(ApprovalError);
    expect(requests).toHaveLength(0);
    const r = await adapter.refundCapture(new RecordingApproval(), {
      dealId: "d",
      captureId: "CAP1",
      amount: "1.00",
      requestId: "r",
    });
    expect(r.status).toBe("COMPLETED");
    expect(requests[0]).toMatchObject({
      path: "/v2/payments/captures/CAP1/refund",
      body: { amount: { currency_code: "USD", value: "1.00" } },
    });
  });
});

describe("resource ids", () => {
  it("reject path injection", async () => {
    const { adapter, requests } = setup(() => ({ data: order() }));
    await expect(adapter.getOrder("../../v1/oauth2/token")).rejects.toThrow(
      /Invalid PayPal resource id/,
    );
    await expect(adapter.getAuthorization("A/B")).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});

describe("response parsing", () => {
  it("fails loudly on an unexpected shape", async () => {
    const { adapter } = setup(() => ({ data: { id: "X", status: "SOMETHING_NEW" } }));
    await expect(adapter.getAuthorization("AUTH1")).rejects.toMatchObject({
      paypalName: "UNEXPECTED_RESPONSE",
    });
  });
});
