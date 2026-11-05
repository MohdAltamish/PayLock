import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dbAvailable, resetDb, testDb } from "../test/db.js";
import { dealTo, harness, type Harness } from "../test/harness.js";

async function readEvents(
  res: Response,
  count: number,
  timeoutMs = 2000,
): Promise<Array<{ id: string; data: any }>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const out: Array<{ id: string; data: any }> = [];
  const deadline = Date.now() + timeoutMs;
  while (out.length < count && Date.now() < deadline) {
    const r = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((ok) =>
        setTimeout(() => ok({ done: true, value: undefined }), deadline - Date.now()),
      ),
    ]);
    if (r.done) break;
    buf += dec.decode(r.value);
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const id = /^id: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (id && data) out.push({ id, data: JSON.parse(data) });
    }
  }
  await reader.cancel();
  return out;
}

describe.skipIf(!dbAvailable())("GET /deals/:id/events (SSE)", () => {
  const db = testDb();
  let h: Harness;
  let base: string;
  beforeEach(async () => {
    await resetDb(db);
    h = await harness(db);
    base = await h.app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterEach(async () => h.app.close());

  it("replays the timeline, streams new events within 2s, and resumes after Last-Event-ID", async () => {
    const id = await dealTo(h, "CONTRACTED");
    const res = await fetch(`${base}/deals/${id}/events`, { headers: { cookie: h.buyer.cookie } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const started = Date.now();
    setTimeout(() => void h.as("buyer", "POST", `/deals/${id}/guard`), 50);
    const events = await readEvents(res, 2);
    expect(events.map((e) => e.data.type)).toEqual(["contract.created", "risk.assessed"]);
    expect(Date.now() - started).toBeLessThan(2000);

    const resumed = await fetch(`${base}/deals/${id}/events`, {
      headers: { cookie: h.buyer.cookie, "last-event-id": events[0]!.id },
    });
    const rest = await readEvents(resumed, 1, 500);
    expect(rest.map((e) => e.data.type)).toEqual(["risk.assessed"]);
  });

  it("is 401 without a session", async () => {
    const id = await dealTo(h, "CONTRACTED");
    const res = await fetch(`${base}/deals/${id}/events`);
    expect(res.status).toBe(401);
  });
});
