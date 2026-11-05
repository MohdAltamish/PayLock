import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted, Decimal and Date values as strings,
 * undefined dropped. Used for AuditLog.payloadHash so equal payloads always
 * hash the same.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function payloadHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** JSON-safe copy (Decimal -> string, Date -> ISO string, keys sorted). */
export function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const maybeDecimal = value as { toFixed?: unknown; d?: unknown; s?: unknown; e?: unknown };
    if (typeof maybeDecimal.toFixed === "function" && "d" in maybeDecimal && "e" in maybeDecimal) {
      return String(value);
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = normalize(v);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}
