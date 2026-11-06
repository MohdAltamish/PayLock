import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fetchUrl, type FetchUrlOptions } from "./fetch-url.js";

const run = promisify(execFile);

/** read_file: deliverable text content, 200KB cap. */
export function readFile(
  content: string,
  maxBytes = 200 * 1024,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(content, "utf8");
  if (buf.length <= maxBytes) return { text: content, truncated: false };
  return { text: buf.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

/** estimate_market_price: heuristic USD ranges by category (for TOO_GOOD_PRICING). */
const MARKET: Array<{ re: RegExp; low: string; high: string; category: string }> = [
  {
    re: /landing page|website|web ?site|web page|homepage/i,
    low: "150.00",
    high: "2500.00",
    category: "website",
  },
  { re: /logo|brand/i, low: "50.00", high: "800.00", category: "logo" },
  { re: /app|mobile application|ios|android/i, low: "1500.00", high: "20000.00", category: "app" },
  { re: /article|blog|copy|write|content/i, low: "30.00", high: "500.00", category: "writing" },
  { re: /translat/i, low: "20.00", high: "400.00", category: "translation" },
  { re: /video|edit/i, low: "50.00", high: "1500.00", category: "video" },
];
export function estimateMarketPrice(scope: string): {
  low: string;
  high: string;
  currency: "USD";
  category: string;
} {
  const m = MARKET.find((x) => x.re.test(scope));
  return m
    ? { low: m.low, high: m.high, currency: "USD", category: m.category }
    : { low: "20.00", high: "5000.00", currency: "USD", category: "general" };
}

/** inspect_repo: GitHub/GitLab metadata via their REST APIs; those hosts only. */
export interface RepoInfo {
  host: "github" | "gitlab";
  files: string[];
  readme: string | null;
  hasTests: boolean;
  license: string | null;
}
export async function inspectRepo(repoUrl: string, f: typeof fetch = fetch): Promise<RepoInfo> {
  const u = new URL(repoUrl);
  const [owner, repo] = u.pathname.replace(/^\/|\.git$|\/$/g, "").split("/");
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
    throw new Error("not a repo URL");
  const get = async (url: string) => {
    const r = await f(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`repo API ${r.status}`);
    return r.json() as Promise<unknown>;
  };
  if (u.hostname === "github.com") {
    const meta = (await get(`https://api.github.com/repos/${owner}/${repo}`)) as {
      license?: { spdx_id?: string };
    };
    const tree = (await get(`https://api.github.com/repos/${owner}/${repo}/contents/`)) as Array<{
      name: string;
    }>;
    const files = tree.map((t) => t.name).slice(0, 200);
    let readme: string | null = null;
    try {
      const r = (await get(`https://api.github.com/repos/${owner}/${repo}/readme`)) as {
        content?: string;
      };
      readme = r.content ? Buffer.from(r.content, "base64").toString("utf8").slice(0, 8000) : null;
    } catch {
      readme = null;
    }
    return {
      host: "github",
      files,
      readme,
      hasTests: files.some((n) => /test|spec/i.test(n)),
      license: meta.license?.spdx_id ?? null,
    };
  }
  if (u.hostname === "gitlab.com") {
    const id = encodeURIComponent(`${owner}/${repo}`);
    const tree = (await get(
      `https://gitlab.com/api/v4/projects/${id}/repository/tree?per_page=100`,
    )) as Array<{ name: string }>;
    const files = tree.map((t) => t.name);
    return {
      host: "gitlab",
      files,
      readme: null,
      hasTests: files.some((n) => /test|spec/i.test(n)),
      license: null,
    };
  }
  throw new Error("inspect_repo supports github.com and gitlab.com only");
}

/**
 * run_checks: LOCAL ONLY (ADR-010). Clones the repo (github/gitlab, depth 1),
 * then runs an allowlisted command in an ephemeral container with
 * --network none, a read-only mount, and a 60s cap.
 */
export const RUN_CHECKS_COMMANDS = ["npm test", "pytest", "go test ./..."] as const;
export async function runChecks(
  repoUrl: string,
  command: (typeof RUN_CHECKS_COMMANDS)[number],
  enabled: boolean,
): Promise<{ exitCode: number; stdoutTail: string }> {
  if (!enabled) throw new Error("run_checks is disabled on this host");
  if (!RUN_CHECKS_COMMANDS.includes(command)) throw new Error("command not allowlisted");
  const u = new URL(repoUrl);
  if (u.protocol !== "https:" || !["github.com", "gitlab.com"].includes(u.hostname))
    throw new Error("repo host not allowed");
  const dir = await mkdtemp(path.join(tmpdir(), "paylock-check-"));
  try {
    await run("git", ["clone", "--depth", "1", "--", u.toString(), path.join(dir, "repo")], {
      timeout: 30_000,
    });
    const image =
      command === "pytest"
        ? "python:3.12-slim"
        : command.startsWith("go")
          ? "golang:1.22"
          : "node:20-slim";
    const r = await run(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "-v",
        `${dir}/repo:/repo:ro`,
        image,
        "sh",
        "-c",
        `cp -r /repo /w && cd /w && ${command}`,
      ],
      { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
    ).then(
      (x) => ({ exitCode: 0, out: x.stdout + x.stderr }),
      (e: { code?: number; stdout?: string; stderr?: string }) => ({
        exitCode: typeof e.code === "number" ? e.code : 1,
        out: `${e.stdout ?? ""}${e.stderr ?? ""}`,
      }),
    );
    return { exitCode: r.exitCode, stdoutTail: r.out.slice(-4000) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------- registry ----------

export type SkillClass = "read" | "write" | "util";
export interface SkillDef {
  name: string;
  class: SkillClass;
}

/** SKILLS.md catalog classes. Agents only ever receive `read` skills (invariant 4). */
export const SKILL_CATALOG: SkillDef[] = [
  { name: "get_counterparty_profile", class: "read" },
  { name: "get_deal_velocity", class: "read" },
  { name: "get_paypal_verification", class: "read" },
  { name: "estimate_market_price", class: "read" },
  { name: "fetch_url", class: "read" },
  { name: "inspect_repo", class: "read" },
  { name: "run_checks", class: "read" },
  { name: "read_file", class: "read" },
  { name: "paypal_create_order", class: "write" },
  { name: "paypal_authorize", class: "write" },
  { name: "paypal_capture", class: "write" },
  { name: "paypal_void", class: "write" },
  { name: "paypal_payout", class: "write" },
  { name: "paypal_refund", class: "write" },
  { name: "paypal_verify_webhook", class: "read" },
  { name: "redact_pii", class: "util" },
  { name: "restore_pii", class: "util" },
  { name: "write_audit", class: "util" },
];

export interface ReadSkills {
  fetch_url(url: string): ReturnType<typeof fetchUrl>;
  read_file(content: string): ReturnType<typeof readFile>;
  estimate_market_price(scope: string): ReturnType<typeof estimateMarketPrice>;
  inspect_repo(repoUrl: string): Promise<RepoInfo>;
  run_checks(
    repoUrl: string,
    command: (typeof RUN_CHECKS_COMMANDS)[number],
  ): ReturnType<typeof runChecks>;
}

/**
 * The only skill set handed to agents. It has no write skill, and it is
 * frozen so nothing can be added at runtime.
 */
export function readSkills(o: {
  fetch?: FetchUrlOptions;
  runChecksEnabled: boolean;
  fetchImpl?: typeof fetch;
}): Readonly<ReadSkills> {
  const s: ReadSkills = {
    fetch_url: (url) => fetchUrl(url, o.fetch),
    read_file: (c) => readFile(c),
    estimate_market_price: (scope) => estimateMarketPrice(scope),
    inspect_repo: (u) => inspectRepo(u, o.fetchImpl),
    run_checks: (u, c) => runChecks(u, c, o.runChecksEnabled),
  };
  for (const name of Object.keys(s)) {
    const def = SKILL_CATALOG.find((d) => d.name === name);
    if (def?.class !== "read") throw new Error(`${name} is not a read skill`);
  }
  return Object.freeze(s);
}
