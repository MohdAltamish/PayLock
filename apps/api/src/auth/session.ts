import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Demo sessions (no NextAuth): a signed, httpOnly, SameSite=Lax cookie that
 * carries only the user id and issue time. HMAC-SHA256 with SESSION_SECRET.
 */
export const SESSION_COOKIE = "paylock_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface SessionPayload {
  uid: string;
  iat: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(p: SessionPayload, secret: string): string {
  const body = b64(JSON.stringify(p));
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!token || token.length > 512) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof p.uid !== "string" || typeof p.iat !== "number") return null;
    if (p.iat > nowSeconds + 60 || nowSeconds - p.iat > SESSION_TTL_SECONDS) return null;
    return p;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
    .concat(secure ? ["Secure"] : [])
    .join("; ");
}

// ---------- API keys (agents) ----------

export const API_KEY_SCOPES = ["deals:write", "deliverables:write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** A new key: shown once; only its sha256 is stored. */
export function newApiKey(): { key: string; hash: string } {
  const key = `plk_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
