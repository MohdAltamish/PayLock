import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { htmlFacts, type HtmlFacts } from "./html.js";
import { isBlockedAddress, SsrfError } from "./ssrf.js";

/**
 * fetch_url (read skill, SKILLS.md). Plain HTTP GET with:
 * - http/https only, ports 80 and 443 only;
 * - DNS resolved once and the connection pinned to the checked address
 *   (custom `lookup`), so DNS rebinding cannot swap it;
 * - private, loopback, link-local and metadata ranges blocked (IPv4 and IPv6);
 * - max 3 redirects, each re-checked; 5MB cap; 10s total timeout.
 * `allowHosts` (FETCH_URL_DEV_ALLOW_HOSTS, never in production) lets named
 * hosts reach loopback on any port, for local demo deliverables (decision I).
 * No viewport rendering (ADR-010).
 */
export interface FetchUrlOptions {
  allowHosts?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolve?: (host: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface FetchUrlResult extends HtmlFacts {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  bytes: number;
  truncated: boolean;
  redirects: number;
}

const LOOPBACK = (ip: string) => ip === "::1" || ip.startsWith("127.") || ip === "::ffff:127.0.0.1";

export async function fetchUrl(input: string, o: FetchUrlOptions = {}): Promise<FetchUrlResult> {
  const timeoutMs = o.timeoutMs ?? 10_000;
  const maxBytes = o.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = o.maxRedirects ?? 3;
  const allow = new Set((o.allowHosts ?? []).map((h) => h.toLowerCase()));
  const resolve = o.resolve ?? ((h: string) => dnsLookup(h, { all: true, verbatim: true }));
  const deadline = Date.now() + timeoutMs;

  let url = parse(input);
  for (let redirects = 0; ; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const allowed = allow.has(host);
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!allowed && port !== 80 && port !== 443) throw new SsrfError(`port ${port} is not allowed`);
    const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
    if (!addrs.length) throw new SsrfError(`could not resolve ${host}`);
    for (const a of addrs) {
      const ok = allowed
        ? LOOPBACK(a.address) || !isBlockedAddress(a.address)
        : !isBlockedAddress(a.address);
      if (!ok) throw new SsrfError(`${host} resolves to a blocked address`);
    }
    const pinned = addrs[0]!;
    const res = await get(url, pinned, deadline, maxBytes);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.location) {
      if (redirects >= maxRedirects) throw new SsrfError("too many redirects");
      url = parse(new URL(res.location, url).toString());
      continue;
    }
    const isHtml = /html|xml|text\/plain/i.test(res.contentType ?? "") || !res.contentType;
    const facts = htmlFacts(isHtml ? res.body : "");
    return {
      ...facts,
      url: input,
      finalUrl: url.toString(),
      status: res.status,
      contentType: res.contentType,
      bytes: res.bytes,
      truncated: res.truncated,
      redirects,
    };
  }
}

function parse(u: string): URL {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    throw new SsrfError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new SsrfError(`scheme ${url.protocol} is not allowed`);
  if (url.username || url.password) throw new SsrfError("credentials in URLs are not allowed");
  return url;
}

function get(
  url: URL,
  pinned: { address: string; family: number },
  deadline: number,
  maxBytes: number,
): Promise<{
  status: number;
  location?: string;
  contentType: string | null;
  body: string;
  bytes: number;
  truncated: boolean;
}> {
  const lookup: LookupFunction = (_h, opts, cb) => {
    if ((opts as { all?: boolean }).all)
      (cb as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [pinned]);
    else cb(null, pinned.address, pinned.family);
  };
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SsrfError("timeout"));
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup,
        headers: { "user-agent": "PaylockVerifier/1.0", accept: "text/html,*/*;q=0.5" },
        timeout: remaining,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          if (truncated) return;
          if (bytes + c.length > maxBytes) {
            chunks.push(c.subarray(0, maxBytes - bytes));
            bytes = maxBytes;
            truncated = true;
            res.destroy();
            finish();
            return;
          }
          chunks.push(c);
          bytes += c.length;
        });
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const ct = res.headers["content-type"];
          resolve({
            status: res.statusCode ?? 0,
            location: typeof res.headers.location === "string" ? res.headers.location : undefined,
            contentType: typeof ct === "string" ? ct : null,
            body: Buffer.concat(chunks).toString("utf8"),
            bytes,
            truncated,
          });
        };
        res.on("end", finish);
        res.on("error", (e) => (done ? undefined : reject(e)));
      },
    );
    const timer = setTimeout(() => req.destroy(new SsrfError("timeout")), remaining);
    req.on("timeout", () => req.destroy(new SsrfError("timeout")));
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end();
  });
}
