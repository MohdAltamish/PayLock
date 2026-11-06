import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchUrl } from "./fetch-url.js";
import { htmlFacts } from "./html.js";
import { estimateMarketPrice, readFile, readSkills, runChecks, SKILL_CATALOG } from "./skills.js";
import { isBlockedAddress, SsrfError } from "./ssrf.js";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (ip) => expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe("fetchUrl", () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      }
      if (req.url === "/redirect-ok") {
        res.writeHead(302, { location: "/page" });
        return res.end();
      }
      if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" });
        return res.end();
      }
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<p>" + "x".repeat(50_000) + "</p>");
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<html><head><title>Bakery</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
          "<body><h1>Menu</h1><form><input name=email><textarea></textarea></form><script>evil()</script></body></html>",
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const dev = { allowHosts: ["127.0.0.1"] };

  it("blocks loopback unless the host is allowlisted (decision I)", async () => {
    await expect(fetchUrl(`http://127.0.0.1:${port}/page`)).rejects.toBeInstanceOf(SsrfError);
    const r = await fetchUrl(`http://127.0.0.1:${port}/page`, dev);
    expect(r).toMatchObject({
      status: 200,
      title: "Bakery",
      hasForm: true,
      formFields: 2,
      headings: ["Menu"],
    });
    expect(r.metaViewport).toContain("width=device-width");
    expect(r.textExcerpt).not.toContain("evil");
  });

  it("re-checks every redirect hop", async () => {
    await expect(fetchUrl(`http://127.0.0.1:${port}/redirect-metadata`, dev)).rejects.toThrow(
      /blocked/,
    );
    expect((await fetchUrl(`http://127.0.0.1:${port}/redirect-ok`, dev)).redirects).toBe(1);
    await expect(fetchUrl(`http://127.0.0.1:${port}/loop`, dev)).rejects.toThrow(
      /too many redirects/,
    );
  });

  it("caps the body size", async () => {
    const r = await fetchUrl(`http://127.0.0.1:${port}/big`, { ...dev, maxBytes: 1000 });
    expect(r).toMatchObject({ truncated: true, bytes: 1000 });
  });

  it("refuses non-http schemes, credentials and odd ports", async () => {
    await expect(fetchUrl("file:///etc/passwd")).rejects.toThrow(/scheme/);
    await expect(fetchUrl("http://user:pw@example.com/")).rejects.toThrow(/credentials/);
    await expect(fetchUrl("http://example.com:8080/")).rejects.toThrow(/port/);
  });

  it("refuses a public name that resolves to a private address (pinned lookup)", async () => {
    await expect(
      fetchUrl("http://rebind.example/", {
        resolve: async () => [{ address: "10.0.0.5", family: 4 }],
      }),
    ).rejects.toThrow(/blocked/);
  });
});

describe("other skills and the registry", () => {
  it("htmlFacts without a viewport or form", () => {
    expect(htmlFacts("<title>x</title><p>hi</p>")).toMatchObject({
      metaViewport: null,
      hasForm: false,
    });
  });
  it("read_file caps at 200KB", () => {
    expect(readFile("a".repeat(300 * 1024)).truncated).toBe(true);
  });
  it("estimate_market_price returns money strings", () => {
    expect(estimateMarketPrice("bakery landing page")).toMatchObject({
      low: "150.00",
      currency: "USD",
    });
  });
  it("run_checks is refused when disabled (hosted app)", async () => {
    await expect(runChecks("https://github.com/a/b", "npm test", false)).rejects.toThrow(
      /disabled/,
    );
  });
  it("agents receive read skills only, frozen", () => {
    const s = readSkills({ runChecksEnabled: false });
    for (const name of Object.keys(s))
      expect(SKILL_CATALOG.find((d) => d.name === name)?.class).toBe("read");
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.keys(s).some((k) => k.startsWith("paypal_"))).toBe(false);
  });
});
