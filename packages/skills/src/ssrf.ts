import { isIP } from "node:net";

/**
 * SSRF guard for fetch_url (SKILLS.md safety rules). Blocks private,
 * loopback, link-local, CGNAT, multicast, reserved and cloud-metadata ranges
 * for IPv4 and IPv6, including IPv4-mapped IPv6. The caller connects to the
 * address that was checked (no second DNS lookup), so DNS rebinding cannot
 * swap it.
 */
const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, includes 169.254.169.254 metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number.parseInt(o, 10), 0) >>> 0;
}

function inV4(ip: string, [base, bits]: [string, number]): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

/** Expand an IPv6 address to 8 groups of 16-bit numbers. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0]!;
  // Embedded IPv4 tail (e.g. ::ffff:10.0.0.1).
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = v4ToInt(v4[1]!);
    s = s.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (s.includes("::")) {
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    return [...h, ...Array(fill).fill("0"), ...t].map((g) => Number.parseInt(g || "0", 16));
  }
  if (h.length !== 8) return null;
  return h.map((g) => Number.parseInt(g, 16));
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return V4_BLOCKED.some((r) => inV4(ip, r));
  if (kind !== 6) return true;
  const g = v6Groups(ip);
  if (!g || g.some((x) => Number.isNaN(x))) return true;
  const allZeroPrefix = g.slice(0, 5).every((x) => x === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): check the IPv4 part.
  if (allZeroPrefix && (g[5] === 0xffff || g[5] === 0)) {
    if (g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
    const v4 = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
    return isBlockedAddress(v4);
  }
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (first === 0x0064 && g[1] === 0xff9b) return true; // NAT64 can reach IPv4 internals
  if (first === 0xfd00 && g[1] === 0x0ec2) return true; // AWS IMDS IPv6 (within fc00::/7 anyway)
  return false;
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}
