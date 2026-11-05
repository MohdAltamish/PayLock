/**
 * PayPal sandbox smoke tests. Usage: npm run smoke -- <flow>
 *
 *   token           mint a token, check scopes and cache
 *   balance         platform balance pre-check (GET /v1/reporting/balances)
 *   card-authorize  C13: AUTHORIZE order funded by a sandbox card (no buyer popup), then void
 *   honor           C5: record authorization create_time / expiration_time, then void
 *   idempotency     C7: replay a capture with the same PayPal-Request-Id; then same id, different body
 *   decline         C11: sandbox negative test (PayPal-Mock-Response INSTRUMENT_DECLINED)
 *   payout          balance pre-check, then 1.00 USD to the sandbox seller; C8 duplicate re-send
 *   capture         buyer-approved order: authorize, capture in full   (needs sandbox buyer login)
 *   void            buyer-approved order: authorize, void               (needs sandbox buyer login)
 *   partial         C6: buyer-approved 100.00, capture 70.00 final_capture=true, check remainder
 *
 * Money-moving calls use SmokeApproval (scripts only). Never prints tokens,
 * secrets or card numbers. On a PayPal error: run /paypal:explain-error.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { parseMoney } from "../packages/schemas/src/money.js";
import { PayPalAdapter } from "../apps/api/src/paypal/adapter.js";
import { PayPalError } from "../apps/api/src/paypal/errors.js";
import { idempotencyKey } from "../apps/api/src/paypal/idempotency.js";
import type { Authorization, Order } from "../apps/api/src/paypal/types.js";
import { scriptClient } from "./lib/paypal-client.js";
import { SmokeApproval } from "./lib/smoke-approval.js";

const { config, tokens, http } = scriptClient();
const adapter = new PayPalAdapter(http, { isFrozen: () => config.freeze });
const approval = new SmokeApproval();

const RETURN_URL = "https://paylock.dev/smoke/return";
const CANCEL_URL = "https://paylock.dev/smoke/cancel";
// Standard sandbox Visa test number (also used in the toolkit's webhook-sandbox guide).
const TEST_CARD = {
  number: "4111111111111111",
  expiry: "2030-12",
  name: "Paylock Smoke",
  security_code: "123",
};

const REQUIRED_SCOPES: Record<string, string> = {
  payouts: "https://uri.paypal.com/payments/payouts",
  reporting: "https://uri.paypal.com/services/reporting/search/read",
  "auth/capture": "https://uri.paypal.com/services/payments/payment/authcapture",
  refund: "https://uri.paypal.com/services/payments/refund",
  webhooks: "https://uri.paypal.com/services/applications/webhooks",
};

const newDealId = () => `smoke${Date.now().toString(36)}`;
const key = (dealId: string, step: string, attempt = 1) =>
  idempotencyKey(dealId, `smoke-${step}`, attempt);
const line = (label: string, value: unknown) =>
  console.log(`  ${label.padEnd(24)} ${value ?? "-"}`);

// ---------------- helpers ----------------

function payee(order: Order) {
  return order.purchase_units?.[0]?.payee?.email_address;
}

async function walletOrder(dealId: string, amount: string) {
  const { order, approveUrl } = await adapter.createOrder({
    dealId,
    amount,
    description: `Paylock smoke ${dealId}`,
    requestId: key(dealId, "order"),
    returnUrl: RETURN_URL,
    cancelUrl: CANCEL_URL,
  });
  const rel = order.links?.find((l) => l.href === approveUrl)?.rel;
  line("order", `${order.id} (${order.status})`);
  line("approve link rel", rel);
  line("payee email", payee(order));
  console.log(
    `\n  Approve as the sandbox buyer (${process.env.PAYPAL_SANDBOX_BUYER_EMAIL ?? "buyer account"}):\n  ${approveUrl}\n`,
  );
  console.log(
    "  The page redirects to paylock.dev/smoke/return afterwards; that page may not exist. That is expected.\n",
  );
  return waitForApproval(order.id);
}

async function waitForApproval(orderId: string, timeoutMs = 15 * 60_000): Promise<Order> {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    const o = await adapter.getOrder(orderId);
    if (o.status !== last) {
      line("order status", o.status);
      last = o.status;
    }
    if (o.status === "APPROVED") {
      line("payer account_status", o.payment_source?.paypal?.account_status);
      return o;
    }
    if (o.status === "VOIDED" || o.status === "COMPLETED")
      throw new Error(`Order ended as ${o.status} before approval`);
    await sleep(5000);
  }
  throw new Error("Timed out waiting for buyer approval");
}

async function authorize(dealId: string, orderId: string): Promise<Authorization> {
  const { authorization } = await adapter.authorizeOrder(orderId, key(dealId, "authorize"));
  printAuth(authorization);
  if (authorization.status !== "CREATED")
    throw new Error(`Authorization status ${authorization.status}`);
  return authorization;
}

function printAuth(a: Authorization) {
  line(
    "authorization",
    `${a.id} (${a.status}${a.status_details?.reason ? `: ${a.status_details.reason}` : ""})`,
  );
  line("amount", a.amount ? `${a.amount.value} ${a.amount.currency_code}` : undefined);
  line("create_time", a.create_time);
  line("expiration_time", a.expiration_time);
}

/** C13: AUTHORIZE order funded by a sandbox card. Returns the authorization however PayPal delivers it. */
async function cardAuthorization(dealId: string, amount: string): Promise<Authorization> {
  const { order } = await adapter.createOrder({
    dealId,
    amount,
    description: `Paylock smoke ${dealId}`,
    requestId: key(dealId, "order"),
    returnUrl: RETURN_URL,
    cancelUrl: CANCEL_URL,
    card: TEST_CARD,
  });
  line("card order", `${order.id} (${order.status})`);
  line("payee email", payee(order));
  const existing = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (existing) {
    line("authorized at create", "yes");
    printAuth(existing);
    return existing;
  }
  line("authorized at create", "no; calling /authorize");
  return authorize(dealId, order.id);
}

async function voidQuietly(dealId: string, authId: string) {
  await adapter.voidAuthorization(authId, key(dealId, "void"));
  const after = await adapter.getAuthorization(authId);
  line("after void", after.status);
}

async function expectPayPalError(label: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    line(label, `SUCCEEDED (unexpected): ${JSON.stringify(r).slice(0, 120)}`);
  } catch (err) {
    if (!(err instanceof PayPalError)) throw err;
    line(
      label,
      `rejected: ${err.status} ${err.paypalName} / ${err.issue} (debug_id ${err.debugId})`,
    );
  }
}

// ---------------- flows ----------------

async function token() {
  const t = await tokens.getAccessToken();
  console.log(
    `token ok (${config.paypal.env}), expires_in ~${Math.round((t.expiresAt - Date.now()) / 1000)}s`,
  );
  let missing = 0;
  for (const [name, scope] of Object.entries(REQUIRED_SCOPES)) {
    const ok = t.scopes.includes(scope);
    if (!ok) missing++;
    line(`scope ${name}`, ok ? "present" : "MISSING");
  }
  line("cache", (await tokens.getAccessToken()) === t ? "hit" : "MISS");
  if (missing) process.exitCode = 1;
}

/** Decision G pre-check. A 403 stops here with instructions; never skipped. */
async function balance(minimum = "0.00"): Promise<string> {
  try {
    const b = await adapter.getBalances("USD");
    const usd = b.balances.find((x) => x.currency === "USD");
    const available = usd?.available_balance?.value ?? "0.00";
    line("USD available", available);
    line("USD total", usd?.total_balance?.value);
    if (parseMoney(normalize(available)).lt(parseMoney(minimum))) {
      throw new Error(
        `Platform balance ${available} USD is below the required ${minimum} USD. Add funds to the sandbox business account.`,
      );
    }
    return available;
  } catch (err) {
    if (err instanceof PayPalError && err.status === 403) {
      console.error(
        "\n  Balance check returned 403 NOT_AUTHORIZED (debug_id " +
          err.debugId +
          ").\n" +
          "  Enable Transaction Search: Developer Dashboard > Apps & Credentials > Sandbox > your app > Features,\n" +
          "  save, then mint a new token. Stopping; the check is never skipped.\n",
      );
    }
    throw err;
  }
}

function normalize(v: string): string {
  // Reporting returns values like "5000.00" or "5000"; money helpers need two decimals.
  return /^\d+$/.test(v) ? `${v}.00` : /^\d+\.\d$/.test(v) ? `${v}0` : v;
}

async function cardAuthorize() {
  const dealId = newDealId();
  const a = await cardAuthorization(dealId, "2.00");
  await voidQuietly(dealId, a.id);
}

async function honor() {
  const dealId = newDealId();
  const a = await cardAuthorization(dealId, "2.00");
  if (a.create_time && a.expiration_time) {
    const hours = (Date.parse(a.expiration_time) - Date.parse(a.create_time)) / 3_600_000;
    line("validity", `${hours.toFixed(1)} hours (${(hours / 24).toFixed(2)} days)`);
  }
  await voidQuietly(dealId, a.id);
}

async function idempotency() {
  const dealId = newDealId();
  const a = await cardAuthorization(dealId, "3.00");
  const rid = key(dealId, "capture");
  const first = await adapter.captureAuthorization(approval, {
    dealId,
    authorizationId: a.id,
    amount: "3.00",
    finalCapture: true,
    requestId: rid,
  });
  line("capture #1", `${first.id} (${first.status})`);
  const replay = await adapter.captureAuthorization(approval, {
    dealId,
    authorizationId: a.id,
    amount: "3.00",
    finalCapture: true,
    requestId: rid,
  });
  line(
    "replay same key",
    `${replay.id} (${replay.status}) ${replay.id === first.id ? "SAME capture id" : "DIFFERENT capture id"}`,
  );
  await expectPayPalError("same key, other body", () =>
    adapter.captureAuthorization(approval, {
      dealId,
      authorizationId: a.id,
      amount: "1.00",
      finalCapture: true,
      requestId: rid,
    }),
  );
  await expectPayPalError("new key after final", () =>
    adapter.captureAuthorization(approval, {
      dealId,
      authorizationId: a.id,
      amount: "1.00",
      finalCapture: true,
      requestId: key(dealId, "capture", 2),
    }),
  );
}

async function decline() {
  const dealId = newDealId();
  await expectPayPalError("create w/ mock decline", () =>
    adapter.createOrder({
      dealId,
      amount: "2.00",
      description: `Paylock smoke ${dealId}`,
      requestId: key(dealId, "order"),
      returnUrl: RETURN_URL,
      cancelUrl: CANCEL_URL,
      card: TEST_CARD,
      mock: { mockApplicationCode: "INSTRUMENT_DECLINED" },
    }),
  );
}

async function payout() {
  const amount = "1.00";
  const receiver = process.env.PAYPAL_SANDBOX_SELLER_EMAIL;
  if (!receiver) throw new Error("PAYPAL_SANDBOX_SELLER_EMAIL is not set");
  console.log("Balance pre-check:");
  await balance(amount);

  const dealId = newDealId();
  const batch = await adapter.createPayout(approval, {
    dealId,
    attempt: 1,
    receiverEmail: receiver,
    amount,
    requestId: key(dealId, "payout"),
  });
  line(
    "payout batch",
    `${batch.batch_header.payout_batch_id} (${batch.batch_header.batch_status})`,
  );
  line("sender_batch_id", batch.batch_header.sender_batch_header?.sender_batch_id);

  // C8: a re-send with the same sender_batch_id must not pay twice, whatever the request id.
  // Observed: PayPal rejects both with 400 USER_BUSINESS_ERROR (details[].field
  // SENDER_BATCH_ID) and returns no link to the original batch. See docs/pitfalls.md.
  for (const [label, attempt] of [
    ["dup, new request id", 2],
    ["dup, same request id", 1],
  ] as const) {
    await expectPayPalError(label, () =>
      adapter.createPayout(approval, {
        dealId,
        attempt: 1,
        receiverEmail: receiver,
        amount,
        requestId: key(dealId, "payout", attempt),
      }),
    );
  }

  const until = Date.now() + 2 * 60_000;
  while (Date.now() < until) {
    const b = await adapter.getPayoutBatch(batch.batch_header.payout_batch_id);
    const item = b.items?.[0];
    line(
      "poll",
      `batch ${b.batch_header.batch_status}, item ${item?.transaction_status ?? "-"}${item?.errors?.name ? ` (${item.errors.name})` : ""}`,
    );
    if (item?.transaction_status && item.transaction_status !== "PENDING") {
      line("item sender_item_id", item.payout_item?.sender_item_id);
      return;
    }
    await sleep(5000);
  }
  console.log("  Item still PENDING after 2 minutes; check the batch later.");
}

async function capture() {
  const dealId = newDealId();
  const order = await walletOrder(dealId, "10.00");
  const a = await authorize(dealId, order.id);
  const c = await adapter.captureAuthorization(approval, {
    dealId,
    authorizationId: a.id,
    amount: "10.00",
    finalCapture: true,
    requestId: key(dealId, "capture"),
  });
  line("capture", `${c.id} (${c.status}) final_capture=${c.final_capture}`);
  line("paypal fee", c.seller_receivable_breakdown?.paypal_fee?.value);
  line("net", c.seller_receivable_breakdown?.net_amount?.value);
}

async function voidFlow() {
  const dealId = newDealId();
  const order = await walletOrder(dealId, "5.00");
  const a = await authorize(dealId, order.id);
  await voidQuietly(dealId, a.id);
}

async function partial() {
  const dealId = newDealId();
  const order = await walletOrder(dealId, "100.00");
  const a = await authorize(dealId, order.id);
  const c = await adapter.captureAuthorization(approval, {
    dealId,
    authorizationId: a.id,
    amount: "70.00",
    finalCapture: true,
    requestId: key(dealId, "capture"),
  });
  line("capture 70.00", `${c.id} (${c.status}) final_capture=${c.final_capture}`);
  const after = await adapter.getAuthorization(a.id);
  line("authorization after", after.status);
  await expectPayPalError("2nd capture 10.00", () =>
    adapter.captureAuthorization(approval, {
      dealId,
      authorizationId: a.id,
      amount: "10.00",
      finalCapture: true,
      requestId: key(dealId, "capture", 2),
    }),
  );
  console.log(
    "\n  Check the buyer's sandbox activity: only 70.00 should be charged; the 30.00 hold should be released.",
  );
}

const flows: Record<string, () => Promise<unknown>> = {
  token,
  balance: () => balance(),
  "card-authorize": cardAuthorize,
  honor,
  idempotency,
  decline,
  payout,
  capture,
  void: voidFlow,
  partial,
};

const name = process.argv[2] ?? "";
const flow = flows[name];
if (!flow) {
  console.error(`Unknown flow "${name}". Available: ${Object.keys(flows).join(", ")}`);
  process.exit(2);
}
console.log(`smoke ${name}`);
flow().catch((err) => {
  if (err instanceof PayPalError) {
    console.error("\nPayPal error:", err.toLog());
    console.error(`Next: /paypal:explain-error ${err.issue}, then log the fix in docs/pitfalls.md`);
  } else {
    console.error("\n" + (err as Error).message);
  }
  process.exit(1);
});
