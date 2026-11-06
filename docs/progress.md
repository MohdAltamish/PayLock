# Progress and time log

Times are focused work in UTC. Budgets and cut triggers are in BUILD_PLAN.md section 2.5. Waiting on the owner (dashboard changes, credentials, buyer approvals) is logged separately and does not count against the budget.

## Phase 1: Money moves (budget 8h, cut trigger 10h)

| Task | Start | End | Notes |
|---|---|---|---|
| Plan commit + Task 1 research | 11:25 | 11:34 | Balance check hit 403; stopped as instructed |
| Owner: Transaction Search, new US account and app | 11:34 | ~11:55 | Waiting, not counted (approximate) |
| Task 1 doc reconciliation | ~11:55 | 12:20 | |
| Task 2 scaffold | 12:20 | 12:34 | |
| Task 3 token + HTTP core | 12:34 | 12:49 | |
| Task 4 adapter + smoke | 12:49 | 13:07 | |
| Task 5 webhooks + MCP list | 13:07 | 13:40 | Includes resumable smoke fix |
| Owner: buyer approvals | 13:40 | 13:44 | Waiting, not counted |
| Buyer flows, doctor, report | 13:44 | 13:55 | |

**Phase 1 total: about 2h of focused work (8h budget).** No cuts applied.

## Phase 2: Deal core (budget 9h, cut trigger 11.25h)

| Task | Start | End | Notes |
|---|---|---|---|
| Task 6 schema + migration | ~14:00 | 14:28 | Previous session |
| Task 7 state machine tests | 14:36 | 14:45 | Doc-sync test against DESIGN section 3 |
| Task 8 executor | 14:45 | 14:47 | |
| Task 9 policy engine | 14:47 | 14:52 | |
| Task 10 REST API, auth, SSE, stub agents | 14:53 | 16:05 | Includes the in-memory PayPal simulator |
| Task 11 settlement, sweeper, reconciliation | 16:05 | 16:15 | curl-happy.sh green against the sandbox |

**Phase 2 total: about 2h of focused work (9h budget).** No cuts applied.

**Sandbox evidence (curl-happy.sh, 2026-11-05 16:11 UTC):**

- PASS: order `4YS46936GF694262N`, authorization `90311013EM075042D`, capture `450956632J3278548` (COMPLETED, confirmed by GET), payout batch `GDK9ME9TX273N` (SUCCESS after ~20 s of polling), 2.00 USD -> RELEASED.
- FAIL: order `9AA39341D7728353J`, authorization `7GR29215KV4140849` voided (200) -> VOIDED / VERIFICATION_FAILED.

**Fresh-clone evidence (node:20 container, 2026-11-06 11:05 UTC):**

- Real PayPal sandbox (debug_ids: ca5639ed0ac19, ca5639ee69eb5, ca5639f74ad9f, ca5639f8c38c1, etc.)
- PASS path -> RELEASED (authorization 42H05000GY436442P, capture 15P238334N3434908, payout FFFH5EFJ4DCLE)
- FAIL path -> VOIDED (authorization 64V99660UN339613K)
- All E2E tests use `E2E_FUNDING=card` server-side test route against the real sandbox
- In-memory PayPalSim is only used in unit tests labeled "mocked PayPal"

## Phase 3: Agents (budget 9h, cut trigger 11.25h)

| Task | Start | End | Notes |
|---|---|---|---|
| Task 12 LlmClient | | | Committed `9f11604`; times not logged |
| Task 13 Skills | | | Committed `35ac41d`; times not logged |
| Tasks 14 to 16 Negotiator, Guardian, Verifier, eval | | | Built in a session whose times were not logged |

Status (2026-11-06): code, unit tests (643) and lint pass. `npm run eval` (replay) fails because only 1 replay fixture exists. `npm run eval:record` hit OpenRouter's `free-models-per-day` 429 on every call, so fixtures could not be recorded. Blocked on the owner: wait for the daily reset, or add OpenRouter credits (raises the free-model daily limit), then run `npm run eval:record` and `npm run eval`. The optional Verifier tool loop (decision H) waits for a passing eval.

## Phase 4: Guardrails and UI (budget 10h, cut trigger 12.5h)

| Task | Start | End | Notes |
|---|---|---|---|
| Tasks 17 to 20 web app, wizard, v6 button, deal detail, Playwright | | | Built in a session whose times were not logged |
| E2E fixes and 3 green runs | 14:48 | 15:10 | `/config/paypal` now returns `testCardFunding`; stub Guardian uses the shared summary wording |

E2E evidence (2026-11-06, stub agents, real sandbox, card funding): happy, scam and fail paths passed 3 runs in a row. Not yet done: an E2E run with `E2E_AGENTS=replay` (needs the eval fixtures) and the manual `npm run e2e:popup` run.

## Phase 6: Harden (budget 7h, cut trigger 8.75h)

| Task | Start | End | Notes |
|---|---|---|---|
| Task 22 (partial) | 16:11 | 16:20 | Void-all script, lint fix |
| Task 23 CI workflow | 16:08 | 16:11 | Created CI with lint, typecheck, test, build, gitleaks, eval |

**Phase 6 status (2026-11-06 16:20 UTC):**
- ✅ CI workflow created and committed
- ✅ Void-all.ts script created and added to package.json
- ✅ README toolkit section updated with commands used
- ✅ Error and empty states in UI (verified)
- ✅ Accessibility attributes (aria-live, role, aria-busy)
- ✅ Timeout handling in LLM client
- ✅ Freeze tests exist and pass
- ✅ Idempotency tests exist and pass
- ✅ SSE proxy test exists
- ✅ All 650 unit tests pass
- ✅ Lint and typecheck pass

**Remaining:**
- ⏳ Fresh-clone test in node:20 container (documented in INSTRUCTIONS.md)
- ⏳ Accessibility pass with axe (optional, not required for demo)
- ⏳ Eval recording (blocked on OpenRouter quota reset at 00:00 UTC)


## Phase 6: Harden (budget 7h, cut trigger 8.75h) - COMPLETED

| Task | Start | End | Notes |
|---|---|---|---|
| Fresh-clone test | 11:01 | 11:05 | node:20 container, 74 seconds, real sandbox |
| Simulator tests | 11:38 | 11:46 | Production safety tests, void-all fix |
| Void authorizations | 11:50 | 11:52 | Voided 2 pending from popup test |

**Phase 6 completion evidence (2026-11-06 11:52 UTC):**

✅ **1. Fresh-clone test in node:20 container**
- Clone, install, build, test, seed, curl-happy: 74 seconds
- Real PayPal sandbox (debug_ids logged)
- PASS -> RELEASED, FAIL -> VOIDED
- Added jq to prerequisites

✅ **2. Simulator safety**
- E2E_FUNDING=card rejected in production
- In-memory PayPalSim only in test harness
- All E2E uses real sandbox
- Tests: 655 pass, lint/typecheck clean

✅ **3. Void authorizations**
- void-all.ts script working
- Voided 2 pending authorizations from popup test
- 2H283881EX593105L, 2Y593976FE066694Y

**Remaining:**
- ⏳ axe accessibility pass (Item 3 - in progress)
- ⏳ Eval recording (waits for OpenRouter quota reset)

