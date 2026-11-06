import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  htmlFacts,
  readFile,
  estimateMarketPrice,
  type FetchUrlResult,
  type ReadSkills,
} from "@paylock/skills";
import { LlmAgents } from "../agents/index.js";
import type { CounterpartyProfile, GuardInput } from "../agents/types.js";
import { DEMO_PRESETS } from "@paylock/schemas";
import { PERSONAS } from "../demo/personas.js";
import { createLlm } from "../llm/client.js";

/**
 * Agent eval (Task 16, AI_AGENTS.md section 6) plus the demo paths.
 *
 *   npm run eval          replay fixtures only (no network, CI)
 *   npm run eval:record   live LLM, records every reply as a fixture
 *
 * Pass criteria: 10/10 schema-valid and at least 9/10 outcome-correct. Demo
 * paths (happy, scam, off-platform, fail) are run through the same agents so
 * their fixtures exist and the hosted demo never needs a live LLM call.
 */
const ROOT = path.resolve(import.meta.dirname, "../../../..");
const FIX = path.join(ROOT, "fixtures");
const record = process.argv.includes("--record");
/**
 * --group scam|bad|honest|demo runs one group only (recording is done group by
 * group to fit the free daily quota). No --group runs everything.
 */
const GROUPS = { scam: "risky", bad: "bad", honest: "honest", demo: null } as const;
type Group = keyof typeof GROUPS;
const groupArg = process.argv.indexOf("--group");
const group = groupArg > 0 ? (process.argv[groupArg + 1] as Group) : undefined;
if (group !== undefined && !(group in GROUPS)) {
  console.error(`--group must be one of: ${Object.keys(GROUPS).join(", ")}`);
  process.exit(2);
}
const DEMO_APP_URL = process.env.APP_URL ?? "http://localhost:3000";

type Seller = CounterpartyProfile;
interface Case {
  id: string;
  kind: "honest" | "risky" | "bad";
  request: string;
  seller: string;
  messages: string[];
  deliverable?: { kind: "url" | "text"; content: string };
}

/** fetch_url double: fixture HTML for deliverables.paylock.test and the app's /demo/deliverables path. */
function fixtureFetch(url: string): Promise<FetchUrlResult> {
  const u = new URL(url);
  const slug =
    u.hostname === "deliverables.paylock.test"
      ? u.pathname.slice(1)
      : (/^\/demo\/deliverables\/([a-z-]+)$/.exec(u.pathname)?.[1] ?? "");
  const f = path.join(FIX, "deliverables", `${slug}.html`);
  const found = /^[a-z-]+$/.test(slug) && existsSync(f);
  const html = found ? readFileSync(f, "utf8") : "";
  return Promise.resolve({
    ...htmlFacts(html),
    url,
    finalUrl: url,
    status: found ? 200 : 404,
    contentType: "text/html; charset=utf-8",
    bytes: html.length,
    truncated: false,
    redirects: 0,
  });
}

const skills = {
  fetch_url: fixtureFetch,
  read_file: readFile,
  estimate_market_price: estimateMarketPrice,
  inspect_repo: async () => {
    throw new Error("inspect_repo is not used in the eval");
  },
  run_checks: async () => {
    throw new Error("run_checks is not used in the eval");
  },
} as unknown as Readonly<ReadSkills>;

function personaSeller(key: string): Seller {
  const p = PERSONAS.find((x) => x.key === key)!;
  return {
    accountAgeDays: p.accountAgeDays,
    completedDeals: p.completedDeals,
    failedDeals: p.failedDeals,
    disputes: 0,
    reportsReceived: 0,
    payoutEmailChanges: p.payoutEmailChangedMinutesAgo === null ? 0 : 1,
    hoursSincePayoutEmailChange:
      p.payoutEmailChangedMinutesAgo === null ? null : p.payoutEmailChangedMinutesAgo / 60,
    paypalVerified: p.paypalVerified,
    contactDomain: "sellers.test",
    payoutDomain: "sellers.test",
  };
}

async function main() {
  const llm = createLlm({
    agentsMode: record ? "live" : "replay",
    llm: {
      provider: record ? "openai" : "replay",
      baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL,
      fallbackModels: (process.env.LLM_MODEL_FALLBACKS ?? "")
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean),
      jsonMode: (process.env.LLM_JSON_MODE as "json_schema" | "json_object") ?? "json_schema",
      timeoutMs: 60_000,
      record,
      replayDir: path.join(FIX, "replay"),
      replayFallback: false,
    },
  });
  if (record && (!process.env.LLM_API_KEY || !process.env.LLM_MODEL))
    throw new Error("LLM_API_KEY and LLM_MODEL are required to record");
  const agents = new LlmAgents(llm, skills, DEMO_APP_URL);

  const spec = JSON.parse(readFileSync(path.join(FIX, "eval", "cases.json"), "utf8")) as {
    sellers: Record<string, Seller>;
    cases: Case[];
  };

  const usedFixtures: string[] = [];
  const track = (m: Record<string, unknown> | undefined) => {
    const f = m?.fixtures;
    if (Array.isArray(f)) usedFixtures.push(...(f as string[]));
  };
  const runCase = async (c: Case, seller: Seller, msgAuthor: "seller" = "seller") => {
    const neg = await agents.negotiate({ request: c.request });
    const contract = neg.contract;
    const input: GuardInput = {
      dealId: c.id,
      amount: contract.price,
      approvalThreshold: "500.00",
      contract: { title: contract.title, scope: contract.scope, price: contract.price },
      seller,
      velocity10m: 1,
      nearThresholdDeals24h: 0,
      messages: c.messages.map((body) => ({ author: msgAuthor, body })),
    };
    const guard = await agents.guard(input);
    const verify = c.deliverable
      ? await agents.verify({
          dealId: c.id,
          contract: {
            title: contract.title,
            scope: contract.scope,
            criteria: contract.criteria,
            partialPayMin: contract.partialPayMin,
          },
          deliverable: { kind: c.deliverable.kind, content: c.deliverable.content, note: null },
        })
      : null;
    track(neg.modelMeta);
    track(guard.modelMeta);
    track(verify?.modelMeta);
    const schemaValid =
      neg.modelMeta.schemaValid !== false &&
      !guard.fallback &&
      (!verify || verify.decision !== null);
    return { neg, guard, verify, schemaValid };
  };

  let valid = 0;
  let correct = 0;
  const kind = group ? GROUPS[group] : undefined;
  const cases = group ? spec.cases.filter((c) => c.kind === kind) : spec.cases;
  const tally: Record<string, { n: number; valid: number; correct: number }> = {};
  console.log(
    `Paylock agent eval (${record ? "LIVE, recording" : "replay"}${group ? `, group ${group}` : ""})\n`,
  );
  for (const c of cases) {
    const r = await runCase(c, spec.sellers[c.seller]!);
    const level = r.guard.risk.level;
    const outcome = r.verify?.decision?.outcome ?? null;
    const ok =
      c.kind === "honest"
        ? level === "LOW" && outcome === "PASS"
        : c.kind === "risky"
          ? level === "HIGH"
          : outcome === "FAIL" || outcome === "PARTIAL";
    if (r.schemaValid) valid++;
    if (ok) correct++;
    const t = (tally[c.kind] ??= { n: 0, valid: 0, correct: 0 });
    t.n++;
    if (r.schemaValid) t.valid++;
    if (ok) t.correct++;
    console.log(
      `${ok ? "PASS" : "MISS"} ${r.schemaValid ? "schema-ok " : "SCHEMA-BAD"} ${c.id.padEnd(34)} risk ${level} ${r.guard.risk.score}` +
        (r.verify
          ? ` | ${outcome ?? "no decision"} ${r.verify.decision?.score ?? "-"}${r.verify.decision?.needsHumanReview ? " (review)" : ""}`
          : "") +
        ` | criteria ${r.neg.contract.criteria.map((x) => x.verifiable[0]).join("")}`,
    );
    if (!r.schemaValid)
      console.log(
        `     errors: neg=${String(r.neg.modelMeta.error ?? "-")} guard=${String(r.guard.modelMeta.error ?? "-")} verify=${String(r.verify?.modelMeta.error ?? "-")}`.slice(
          0,
          600,
        ),
      );
    if (!ok || !r.schemaValid) {
      console.log(
        `     signals: ${r.guard.risk.signals.map((s) => `${s.code}:${s.weight}`).join(", ")}`,
      );
      if (r.verify?.decision)
        for (const p of r.verify.decision.perCriterion)
          console.log(
            `     ${p.criterionId} met=${p.met} conf=${p.confidence} ${p.evidence.slice(0, 90)}`,
          );
    }
  }
  const n = cases.length;
  const label = { risky: "scam", bad: "bad", honest: "honest" } as Record<string, string>;
  if (n) {
    console.log("");
    for (const [k, t] of Object.entries(tally))
      console.log(
        `group ${label[k] ?? k}: schema-valid ${t.valid}/${t.n}, outcome-correct ${t.correct}/${t.n}`,
      );
    console.log(`all cases: schema-valid ${valid}/${n}, outcome-correct ${correct}/${n}`);
  }

  // Demo paths, as the app runs them (persona profile, opening message, deliverable on APP_URL).
  let demoOk = true;
  let demoRun = 0;
  let demoPass = 0;
  if (!group || group === "demo") console.log("\nDemo paths");
  for (const d of !group || group === "demo" ? DEMO_PRESETS : []) {
    const name = d.key;
    const persona = PERSONAS.find((p) => p.key === d.personaKey)!;
    const r = await runCase(
      {
        id: `demo-${name}`,
        kind: "honest",
        request: d.request,
        seller: d.personaKey,
        messages: persona.openingMessage ? [persona.openingMessage] : [],
        deliverable: d.deliverable
          ? { kind: "url", content: `${DEMO_APP_URL}/demo/deliverables/${d.deliverable}` }
          : undefined,
      },
      personaSeller(d.personaKey),
    );
    const level = r.guard.risk.level;
    const outcome = r.verify?.decision?.outcome ?? null;
    const want =
      name === "happy"
        ? level === "LOW" && outcome === "PASS"
        : name === "fail"
          ? level === "LOW" && outcome === "FAIL"
          : level === "HIGH";
    demoOk &&= want && r.schemaValid;
    demoRun++;
    if (want && r.schemaValid) demoPass++;
    console.log(
      `${want && r.schemaValid ? "PASS" : "MISS"} ${name.padEnd(12)} risk ${level} ${r.guard.risk.score} | ${outcome ?? "-"} | price ${r.neg.contract.price}`,
    );
  }

  // --prune: delete fixtures this run did not use, so stale prompts do not pile up.
  // Only after a run where every call succeeded; otherwise good fixtures would look unused.
  if (demoRun) console.log(`group demo: ${demoPass}/${demoRun} paths as expected`);
  const allValid = valid === n && demoOk;
  const prune = process.argv.includes("--prune");
  if (prune && group) console.log("not pruning: --prune needs a full run (no --group)");
  else if (prune && !allValid) console.log("not pruning: some calls failed");
  if (prune && !group && allValid) {
    const used = new Set(usedFixtures);
    let removed = 0;
    for (const dir of readdirSync(path.join(FIX, "replay"))) {
      for (const f of readdirSync(path.join(FIX, "replay", dir))) {
        if (!used.has(`${dir}/${f.replace(/\.json$/, "")}`)) {
          unlinkSync(path.join(FIX, "replay", dir, f));
          removed++;
        }
      }
    }
    console.log(`pruned ${removed} unused fixture(s); kept ${used.size}`);
  }

  // The pass threshold applies to the full run; a group run passes when every result is right.
  const pass = group
    ? valid === n && correct === n && demoOk
    : valid === n && correct >= n - 1 && demoOk;
  console.log(
    group
      ? `\n${pass ? "GROUP PASSED" : "GROUP FAILED"} (${group}: every result schema-valid and correct)`
      : `\n${pass ? "EVAL PASSED" : "EVAL FAILED"} (threshold: ${n}/${n} schema-valid, ${n - 1}/${n} correct, all demo paths)`,
  );
  process.exit(pass ? 0 : 1);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

describe("demo path fixtures (hosted demo stability)", () => {
  for (const d of DEMO_PRESETS) {
    it(`${d.key} uses a seeded persona and request so the fixture key is stable`, () => {
      const persona = PERSONAS.find((p) => p.key === d.personaKey)!;
      expect(persona).toBeDefined();
      // DEMO_PRESETS.request and PERSONAS.openingMessage are the exact text
      // the real agents receive; any change invalidates the fixtures.
      expect(d.request.length).toBeGreaterThan(10);
      if (persona.openingMessage) expect(persona.openingMessage.length).toBeGreaterThan(10);
    });
  }
});
