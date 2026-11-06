import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Invariant 11: UI copy describes risk signals and money states, never people.
 * The forbidden word is built from parts so this file does not match itself.
 */
const FORBIDDEN = new RegExp(["scam", "mer"].join(""), "i");
const WEB = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".next", "test-results", "playwright-report"]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(ts|tsx|css|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("invariant 11: UI copy", () => {
  const all = files(WEB);
  const rel = all.map((f) => path.relative(WEB, f).split(path.sep).join("/"));

  it("scans the web app sources", () => {
    expect(rel).toContain("lib/copy.ts");
    expect(rel).toContain("app/globals.css");
  });

  it("never uses the forbidden word", () => {
    const offenders = all
      .filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(WEB, f));
    expect(offenders).toEqual([]);
  });
});
