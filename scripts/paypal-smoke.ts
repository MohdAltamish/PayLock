/**
 * PayPal sandbox smoke tests. Usage: npm run smoke -- <flow>
 *
 * Flows available now: token
 * Added in Task 4: capture, void, partial, payout, idempotency, honor, card-authorize, decline
 *
 * Never prints tokens or secrets.
 */
import { PayPalError } from "../apps/api/src/paypal/errors.js";
import { scriptClient } from "./lib/paypal-client.js";

const REQUIRED_SCOPES: Record<string, string> = {
  payouts: "https://uri.paypal.com/payments/payouts",
  reporting: "https://uri.paypal.com/services/reporting/search/read",
  "auth/capture": "https://uri.paypal.com/services/payments/payment/authcapture",
  refund: "https://uri.paypal.com/services/payments/refund",
  webhooks: "https://uri.paypal.com/services/applications/webhooks",
};

async function token() {
  const { tokens, config } = scriptClient();
  const t = await tokens.getAccessToken();
  const expiresIn = Math.round((t.expiresAt - Date.now()) / 1000);
  console.log(`token ok (${config.paypal.env}), expires_in ~${expiresIn}s`);
  let missing = 0;
  for (const [name, scope] of Object.entries(REQUIRED_SCOPES)) {
    const ok = t.scopes.includes(scope);
    if (!ok) missing++;
    console.log(`  scope ${name}: ${ok ? "present" : "MISSING"}`);
  }
  // Second call must come from cache.
  const again = await tokens.getAccessToken();
  console.log(`  cache: ${again === t ? "hit" : "MISS"}`);
  if (missing) process.exitCode = 1;
}

const flows: Record<string, () => Promise<void>> = { token };

const name = process.argv[2] ?? "";
const flow = flows[name];
if (!flow) {
  console.error(`Unknown flow "${name}". Available: ${Object.keys(flows).join(", ")}`);
  process.exit(2);
}
flow().catch((err) => {
  if (err instanceof PayPalError) {
    console.error("PayPal error:", err.toLog());
    console.error(
      "Next: run /paypal:explain-error",
      err.issue,
      "and log the fix in docs/pitfalls.md",
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
