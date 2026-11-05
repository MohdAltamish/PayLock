import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static checks for invariant 1 and decision A. They scan source files, so a
 * new code path that bypasses settlement fails CI even before it has tests.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "AI-Toolkit", ".git"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = ["apps", "packages", "scripts"].flatMap((d) => sourceFiles(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const isTest = (f: string) => /\.test\.tsx?$/.test(f);

describe("invariant 1: money-moving adapter calls", () => {
  const MONEY_CALL = /\.(captureAuthorization|createPayout|refundCapture)\s*\(/;

  it("are only made from apps/api/src/settlement/ or scripts/", () => {
    const offenders = files
      .filter((f) => !isTest(f))
      .map(rel)
      .filter((f) => f !== "apps/api/src/paypal/adapter.ts")
      .filter((f) => !f.startsWith("apps/api/src/settlement/") && !f.startsWith("scripts/"))
      .filter((f) => MONEY_CALL.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

const IMPORTS_SMOKE = /(from\s+|import\s*\(\s*)["'][^"']*smoke-approval(\.js|\.ts)?["']/;

describe("decision A: SmokeApproval", () => {
  it("is imported only from scripts/", () => {
    const offenders = files
      .map(rel)
      .filter((f) => !f.startsWith("scripts/"))
      .filter((f) => IMPORTS_SMOKE.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("detects static and dynamic imports", () => {
    expect(
      IMPORTS_SMOKE.test('import { SmokeApproval } from "../../scripts/lib/smoke-approval.js";'),
    ).toBe(true);
    expect(IMPORTS_SMOKE.test('const m = await import("../scripts/lib/smoke-approval")')).toBe(
      true,
    );
    expect(IMPORTS_SMOKE.test("// CLI scripts use SmokeApproval")).toBe(false);
  });
});

describe("the static checks themselves", () => {
  it("see the files they are meant to scan", () => {
    expect(files.map(rel)).toContain("apps/api/src/paypal/adapter.ts");
    expect(files.map(rel)).toContain("scripts/lib/smoke-approval.ts");
  });
});
