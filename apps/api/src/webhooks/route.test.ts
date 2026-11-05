import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testConfig } from "../test/helpers.js";
import type { WebhookEventEnvelope } from "./processor.js";
import type { StoredEvent, WebhookStore } from "./store.js";
import {
  buildVerifyBody,
  transmissionFields,
  type TransmissionFields,
  type WebhookVerifier,
} from "./verify.js";

const HEADERS = {
  "content-type": "application/json",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-sig": "sig==",
  "paypal-transmission-time": "2026-11-05T13:00:00Z",
};

// Deliberately odd whitespace and key order: verification must see these exact bytes.
const RAW =
  '{ "id":"WH-1",  "event_type" : "PAYMENT.CAPTURE.COMPLETED",\n "resource":{"id":"CAP1","custom_id":"deal_1"} }';

class MemStore implements WebhookStore {
  rows = new Map<string, StoredEvent & { processed: boolean; attempts: number }>();
  async insertIfNew(e: StoredEvent) {
    if (this.rows.has(e.eventId)) return false;
    this.rows.set(e.eventId, { ...e, processed: false, attempts: 0 });
    return true;
  }
  async markProcessed(id: string) {
    this.rows.get(id)!.processed = true;
  }
  async recordAttempt(id: string) {
    this.rows.get(id)!.attempts++;
  }
}

function setup(verifier?: WebhookVerifier) {
  const store = new MemStore();
  const processed: WebhookEventEnvelope[] = [];
  const seen: { fields: TransmissionFields; raw: string }[] = [];
  const v: WebhookVerifier =
    verifier ??
    ({
      async verify(fields, raw) {
        seen.push({ fields, raw });
        return true;
      },
    } satisfies WebhookVerifier);
  const appP = buildApp({
    config: testConfig(),
    logger: false,
    deps: {
      healthChecks: {},
      webhooks: {
        verifier: verifier === null ? undefined : v,
        store,
        processor: { process: async (e) => void processed.push(e) },
        defer: (fn) => fn(),
      },
    },
  });
  return { appP, store, processed, seen };
}

describe("POST /webhooks/paypal", () => {
  it("verifies with the exact raw bytes, stores, replies 200, then processes", async () => {
    const { appP, store, processed, seen } = setup();
    const res = await (
      await appP
    ).inject({ method: "POST", url: "/webhooks/paypal", headers: HEADERS, payload: RAW });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect(seen[0]!.raw).toBe(RAW);
    expect(seen[0]!.fields).toMatchObject({ transmission_id: "tx-1", auth_algo: "SHA256withRSA" });
    expect(store.rows.get("WH-1")).toMatchObject({
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceId: "CAP1",
    });
    expect(processed.map((e) => e.id)).toEqual(["WH-1"]);
  });

  it("deduplicates by event id: a second delivery is 200 and not reprocessed", async () => {
    const { appP, processed } = setup();
    const app = await appP;
    await app.inject({ method: "POST", url: "/webhooks/paypal", headers: HEADERS, payload: RAW });
    const dup = await app.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: { ...HEADERS, "paypal-transmission-id": "tx-2" },
      payload: RAW,
    });
    expect(dup.statusCode).toBe(200);
    expect(dup.json()).toEqual({ received: true, duplicate: true });
    expect(processed).toHaveLength(1);
  });

  it("returns 400 and stores nothing when the signature fails", async () => {
    const { appP, store, processed } = setup({ verify: async () => false });
    const res = await (
      await appP
    ).inject({ method: "POST", url: "/webhooks/paypal", headers: HEADERS, payload: RAW });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().detail).toBe("Signature verification failed");
    expect(store.rows.size).toBe(0);
    expect(processed).toHaveLength(0);
  });

  it("returns 400 without calling PayPal when transmission headers are missing", async () => {
    let called = false;
    const { appP, store } = setup({
      verify: async () => {
        called = true;
        return true;
      },
    });
    const { "paypal-transmission-sig": _sig, ...partial } = HEADERS;
    const res = await (
      await appP
    ).inject({ method: "POST", url: "/webhooks/paypal", headers: partial, payload: RAW });
    expect(res.statusCode).toBe(400);
    expect(called).toBe(false);
    expect(store.rows.size).toBe(0);
  });

  it("returns 400 for a non-JSON body", async () => {
    const { appP } = setup();
    const res = await (
      await appP
    ).inject({ method: "POST", url: "/webhooks/paypal", headers: HEADERS, payload: "not json" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 and processes nothing when PayPal verification is unreachable", async () => {
    const { appP, store } = setup({
      verify: async () => {
        throw new Error("ECONNRESET");
      },
    });
    const res = await (
      await appP
    ).inject({ method: "POST", url: "/webhooks/paypal", headers: HEADERS, payload: RAW });
    expect(res.statusCode).toBe(503);
    expect(store.rows.size).toBe(0);
  });

  it("returns 503 when no webhook id is configured", async () => {
    const { appP, store } = setup(null as unknown as undefined);
    const res = await (
      await appP
    ).inject({ method: "POST", url: "/webhooks/paypal", headers: HEADERS, payload: RAW });
    expect(res.statusCode).toBe(503);
    expect(store.rows.size).toBe(0);
  });
});

describe("buildVerifyBody", () => {
  it("splices the raw event bytes unchanged into valid JSON", () => {
    const fields = transmissionFields(HEADERS)!;
    const body = buildVerifyBody(fields, "WH-ID-1", RAW);
    expect(body.endsWith(`"webhook_event":${RAW}}`)).toBe(true);
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: HEADERS["paypal-cert-url"],
      transmission_id: "tx-1",
      transmission_sig: "sig==",
      transmission_time: "2026-11-05T13:00:00Z",
      webhook_id: "WH-ID-1",
      webhook_event: { id: "WH-1" },
    });
  });

  it("escapes header values so they cannot break out of the JSON", () => {
    const fields = transmissionFields({
      ...HEADERS,
      "paypal-transmission-sig": 'x","webhook_id":"evil',
    })!;
    expect(JSON.parse(buildVerifyBody(fields, "WH-ID-1", RAW)).webhook_id).toBe("WH-ID-1");
  });
});
