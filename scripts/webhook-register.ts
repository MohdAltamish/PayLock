/**
 * Register (or update) the PayPal webhook for a public HTTPS base URL.
 * Usage: npm run webhook:register -- https://<host> [--write-env]
 *
 * 1. Lists valid event names (GET /v1/notifications/webhooks-event-types) and
 *    drops any of ours that PayPal does not recognize, printing them.
 * 2. Reuses a webhook with the same URL (PATCH event types), or, for a new
 *    ngrok URL, PATCHes the existing ngrok webhook instead of creating another
 *    (an app can have at most 10). Otherwise creates one.
 * 3. Prints the webhook id; --write-env sets PAYPAL_WEBHOOK_ID in .env.
 *
 * Webhook management has no MCP tool; this is plain REST (webhook-sandbox.md).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scriptClient } from "./lib/paypal-client.js";

export const EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "CUSTOMER.DISPUTE.CREATED",
];

interface Webhook {
  id: string;
  url: string;
  event_types: { name: string }[];
}

const base = process.argv[2];
const writeEnv = process.argv.includes("--write-env");
if (!base) {
  console.error("Usage: npm run webhook:register -- https://<public-host> [--write-env]");
  process.exit(2);
}
const parsed = new URL(base);
if (parsed.protocol !== "https:" || /^(localhost|127\.|0\.0\.0\.0)/.test(parsed.hostname)) {
  console.error("PayPal requires a public HTTPS URL (not localhost).");
  process.exit(2);
}
const target = new URL("/webhooks/paypal", parsed).toString();
const isNgrok = (u: string) => /\.ngrok(-free)?\.(app|dev|io)$/.test(new URL(u).hostname);

const { http } = scriptClient();

const types = await http.request<{ event_types: { name: string }[] }>({
  method: "GET",
  path: "/v1/notifications/webhooks-event-types",
});
const valid = new Set(types.data.event_types.map((t) => t.name));
const unknown = EVENT_TYPES.filter((n) => !valid.has(n));
const events = EVENT_TYPES.filter((n) => valid.has(n));
console.log(
  `Event types: ${events.length} valid${unknown.length ? `; NOT RECOGNIZED by PayPal: ${unknown.join(", ")}` : ""}`,
);

const list = await http.request<{ webhooks: Webhook[] }>({
  method: "GET",
  path: "/v1/notifications/webhooks",
});
const hooks = list.data.webhooks ?? [];
console.log(`Existing webhooks on this app: ${hooks.length}`);
for (const h of hooks) console.log(`  ${h.id}  ${h.url}  (${h.event_types.length} events)`);

const eventBody = events.map((name) => ({ name }));
const same = hooks.find((h) => h.url === target);
const ngrokHook = isNgrok(target) ? hooks.find((h) => isNgrok(h.url)) : undefined;

const sameEvents = (h: Webhook) =>
  h.event_types.length === events.length &&
  events.every((n) => h.event_types.some((e) => e.name === n));

let id: string;
if (same && sameEvents(same)) {
  // PATCH with identical values is rejected with 400 WEBHOOK_PATCH_REQUEST_NO_CHANGE.
  id = same.id;
  console.log(`Reused ${id}: same URL and event types, nothing to change.`);
} else if (same) {
  await http.request({
    method: "PATCH",
    path: `/v1/notifications/webhooks/${same.id}`,
    body: [{ op: "replace", path: "/event_types", value: eventBody }],
  });
  id = same.id;
  console.log(`Reused ${id} (same URL); event types updated.`);
} else if (ngrokHook) {
  await http.request({
    method: "PATCH",
    path: `/v1/notifications/webhooks/${ngrokHook.id}`,
    body: [
      { op: "replace", path: "/url", value: target },
      { op: "replace", path: "/event_types", value: eventBody },
    ],
  });
  id = ngrokHook.id;
  console.log(`Updated ${id}: ${ngrokHook.url} -> ${target}`);
} else {
  const created = await http.request<Webhook>({
    method: "POST",
    path: "/v1/notifications/webhooks",
    requestId: createHash("sha256").update(`webhook-create:${target}`).digest("hex"),
    body: { url: target, event_types: eventBody },
  });
  id = created.data.id;
  console.log(`Created ${id} for ${target}`);
}

console.log(`\nPAYPAL_WEBHOOK_ID=${id}`);
if (writeEnv) {
  const envPath = path.resolve(import.meta.dirname, "../.env");
  const lines = readFileSync(envPath, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith("PAYPAL_WEBHOOK_ID="));
  if (i >= 0) lines[i] = `PAYPAL_WEBHOOK_ID=${id}`;
  else lines.push(`PAYPAL_WEBHOOK_ID=${id}`);
  writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
  console.log("Wrote PAYPAL_WEBHOOK_ID to .env. Restart the API.");
}
