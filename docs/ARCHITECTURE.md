# Paylock: Architecture

## 1. Overview

Paylock is a modular monolith: one deployable API service, one web frontend, one Postgres database. Agents are in-process modules, not separate services, to keep the hackathon deployment simple while preserving clear boundaries for later extraction.

```
+------------------+        +----------------------------+        +------------------+
|  Next.js Web UI  | <----> |  Fastify API (Node 20)     | <----> |  PostgreSQL 16   |
|  (Render web     | /api/* |                            | Prisma |                  |
|   service)       | proxy  |  +----------------------+  |        +------------------+
+------------------+  /SSE  |  | Deal Service         |  |
                            |  | State Machine        |  |        +------------------+
+------------------+        |  | Policy Engine        |  | <----> |  LLM Provider    |
|  Buyer / Seller  | <----> |  | Settlement           |  |  HTTPS |  (JSON schema)   |
|  Agents (API)    |        |  | Audit Logger         |  |        +------------------+
+------------------+        |  +----------------------+  |
                            |  | Agent Orchestrator   |  |        +------------------+
+------------------+        |  |  Negotiator          |  | -----> |  PayPal MCP      |
|  PayPal Sandbox  | <----> |  |  Guardian            |  |  SSE   |  server (read-   |
|  Orders/Payments/|  REST  |  |  Verifier            |  |        |  only, optional) |
|  Payouts/Webhooks| -----> |  +----------------------+  |        +------------------+
+------------------+ events |  | PayPal Adapter       |  |
                            |  | Webhook Handler      |  |
                            |  | Reconciler/Sweeper   |  |
                            |  | PII Redactor         |  |
                            |  +----------------------+  |
                            +----------------------------+
```

## 2. Components

### 2.1 Web UI (Next.js 14, TypeScript)
- App Router, server components for data fetching, client components for the deal wizard and live timeline.
- Talks only to the Paylock API, through Next.js rewrites on `/api/*` so cookies stay first-party (decision J). `compress: false`; SSE responses send `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`.
- Never calls PayPal directly except loading the **PayPal JS SDK v6** for buyer approval: `https://www.sandbox.paypal.com/web-sdk/v6/core` (async), `createInstance({ clientId, components: ["paypal-payments"] })`, `findEligibleMethods()`, a `<paypal-button>` web component, and `createPayPalOneTimePaymentSession`. The `clientId` comes from `GET /api/config/paypal` at runtime; no PayPal env var is in the bundle.
- Live updates via Server-Sent Events from `/deals/:id/events`, with 2s polling as the fallback.

### 2.2 API (Fastify)
- **Deal Service**: CRUD and orchestration entry point.
- **State Machine**: single source of truth for deal transitions. Every transition is a pure function `(state, event, context) -> newState | Error`.
- **Policy Engine**: evaluates spend caps, approval thresholds, risk gating and the freeze switch. Server-side only; the UI never decides. Persists a `PolicyDecision` for every money action.
- **Agent Orchestrator**: calls read-only skills, fences their results into prompts, invokes agents, validates outputs against Zod schemas, persists decisions, emits events (decision H).
- **Settlement**: deterministic code (no LLM) that turns a stored Decision into capture plus payout, or void, using the two-transaction pattern (ADR-011).
- **PayPal Adapter**: thin typed wrapper over Orders v2, Payments v2 (authorizations, captures, refunds), Payouts v1, Reporting balances and webhook verification, using plain `fetch`. All writes carry a `PayPal-Request-Id` derived from `dealId:action:attempt`. Capture, payout and refund require a `SettlementApproval`.
- **Webhook Handler**: verifies the signature from the raw body, deduplicates by event id, appends events, wakes the reconciler. Never regresses state.
- **Reconciler / Sweeper**: resumes pending payment records, polls payouts, times out funding, voids expired or overdue authorizations, retries unprocessed webhooks.
- **Audit Logger**: append-only writes; every row has actor (human | agent | paypal | system), action, before/after state, payload hash.
- **PII Redactor**: replaces emails, names, phone numbers, addresses, PayPal ids with stable tokens before any LLM call; reverses on output.

### 2.3 Agents (in-process)
See AI_AGENTS.md. Each agent exposes `run(input): Promise<ValidatedOutput>` and declares its tool set from SKILLS.md.

### 2.4 Data (Postgres + Prisma)
See DESIGN.md for schema.

### 2.5 External
- **PayPal sandbox REST**: Orders v2 (`intent=AUTHORIZE`), Payments v2 (authorize, capture, void, refund), Payouts v1, Webhooks v1. This is the **system of record for all money movement**, called only by the PayPal Adapter.
- **LLM provider**: abstracted behind `LlmClient`; temperature 0 to 0.2; JSON schema enforced.
- **PayPal MCP server (optional, read-only at runtime)**: used for Guardian enrichment and agent-side reconciliation only if the tool list (`docs/mcp-tools.txt`) shows the dispute and reporting tools working in the sandbox. Never used for any write, including `create_order` and `pay_order`. Transports documented by PayPal: SSE at `https://mcp.sandbox.paypal.com/sse` and Streamable HTTP at `/http`, with a Bearer token. **Observed 2026-11-05 (C1, C4):** SSE with the app's own client-credentials token connects and lists 46 tools (server "PayPal MCP Agent 1.0.0"); Streamable HTTP at `/http` returned 404. Every tool call tried (`list_disputes`, `list_transactions`, `list_products`, `get_order`) returned `PAYPAL_API_SETUP_ERROR: Unsupported cache mode: default` in the response body, so MCP enrichment is **disabled** for now and re-checked at the start of Phase 3 with `npm run mcp:list-tools`. It is item 3 on the cut list either way.

### 2.6 Development tooling: PayPal AI Toolkit (build time only)
The [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit) (Apache-2.0) is a coding-assistant plugin (Claude Code, Codex, Cursor, IBM Bob). It is **not a runtime dependency**, is not deployed, and is not copied into this repo.
- `paypal-best-practices` and `paypal-routing` skills: guide PayPal API usage while coding.
- `PreToolUse` hook: an informational reminder (it never blocks) to consult the best-practices skill and the right SDK reference before edits that touch PayPal code. We treat it as mandatory.
- Commands: `/paypal:setup`, `/paypal:sandbox`, `/paypal:test-accounts`, `/paypal:explain-error`, `/paypal:doctor`.
- Its sandbox access token is for the coding assistant only. The app obtains its own tokens (client-credentials grant) and caches them until 60s before `expires_in`.

## 3. Key architectural decisions (ADRs)

### ADR-001: Authorize/capture instead of true escrow
PayPal has no native escrow for this use case. Authorize-then-capture holds funds and lets us void on failure. UI copy: "funds reserved".

Documented lifecycle (RulesHub authorize-order mapping): a 3-day honor period (guaranteed hold), and the authorization expires after 29 days; capture after the honor period may still be attempted but funds are not guaranteed.

**Sandbox observation (2026-11-05, C5):** three sandbox authorizations (card-funded, US business account) all had `expiration_time` exactly 29 days (696 hours) after `create_time`, e.g. created `2026-11-05T13:00:29Z`, expires `2026-12-04T13:00:29Z`. The 3-day honor period is a funds guarantee that the API does not expose, so it cannot be observed directly. **The guaranteed honor period (3 days) is much shorter than the 29-day `expiration_time`:** between day 3 and day 29 a capture may still be attempted but PayPal no longer guarantees the funds, so it can fail. That gap is the reason for the 72-hour cap. Decision: `AUTH_SAFE_WINDOW_HOURS = 72`. Contract deadlines are capped to 72 hours after authorization so capture happens inside the honor period; the stored `expiration_time` drives the "reservation expired" path. Reauthorization is out of scope.

**Partial capture (C6, 2026-11-05):** buyer-approved 100.00 authorization (`2S593351MY931625E`), one capture of 70.00 with `final_capture: true` (`1TK33286D72438808`). Afterwards the authorization status is `CAPTURED` (not `PARTIALLY_CAPTURED`), and a second capture is rejected with `422 AUTHORIZATION_ALREADY_CAPTURED`. So the final capture closes the authorization, the 30.00 remainder can no longer be captured, and no void is needed. Whether the buyer's 30.00 hold shows as released is visible only in the buyer's sandbox account activity (owner check).

**Buyer-approved orders (C12):** the create-order response links the buyer to `rel: payer-action` (not `approve`), with order status `PAYER_ACTION_REQUIRED`; after approval the status is `APPROVED`. The adapter accepts either link name.

### ADR-002: Modular monolith
One service, clear module boundaries. Faster to build, deploy, and demo. Agents can be extracted later.

### ADR-003: Server-side policy enforcement
All gating (risk level, spend caps, freeze) is enforced in the API. The UI only reflects decisions. Prevents a compromised client or agent from bypassing controls.

### ADR-004: Structured outputs with schema validation
Every agent returns JSON validated by Zod. Invalid output triggers one retry, then a rule-based fallback (Guardian) or a "needs human review" state (Verifier). Protects the demo from LLM variance.

### ADR-005: Hybrid risk scoring
Guardian combines deterministic signals (account age, payout email change, velocity) with an LLM rubric over message content. Deterministic signals are weighted higher and are explainable; the LLM adds pattern recognition for social engineering.

### ADR-006: Event-sourced timeline, state-stored deals
Deals store current state for fast reads; `deal_events` stores every transition for the timeline and audit. Not full event sourcing, but gives replayability of the UI.

### ADR-007: PII never reaches the LLM in clear text
Redaction is a middleware on the LLM client, not optional per agent. Reduces privacy risk and makes the privacy story demonstrable.

### ADR-008: MCP for read and enrichment, REST adapter for money movement
The documented MCP tool areas are orders, invoices, subscriptions, disputes, catalog, shipment and reporting. Authorize, void and Payouts are not listed, and webhooks have no MCP tool by design. Money-moving calls therefore go through the REST adapter, which also gives us idempotency keys, retries and policy checks that an LLM-driven tool call would bypass. MCP is limited to read-only enrichment (dispute history, transaction reporting). Even MCP tools that can write (`create_order`, `pay_order`) are never called.

### ADR-009: Synchronous confirmation, webhook reconciliation
Sandbox webhooks take roughly 10 to 75+ seconds to arrive. Money states therefore move on the synchronous PayPal response: a terminal status from authorize, capture or void transitions the deal. Payouts move on the batch result from polling `GET /v1/payments/payouts/{id}` or the item webhook, whichever comes first. Webhooks still run as a confirmation and audit trail: they append "PayPal confirmed" events and wake the reconciler, which reads PayPal and applies forward-only transitions. Trade-off: two confirmation paths to keep consistent; in exchange the demo stays under the PRD's 2-second UI target and behaves the same on every run. The UI shows "Confirming with PayPal…" until a payout is confirmed.

### ADR-010: Verifier limits on the hosted app
Render web services cannot run Docker containers. On the hosted app, `fetch_url` does plain HTTP with meta-viewport checks and LLM judgment; there is no real viewport rendering. `run_checks` (sandboxed tests in a no-network container) runs only locally. Criteria that need it go to LLM judgment or NEEDS_REVIEW on the hosted app. The README states this.

### ADR-011: Two-transaction settlement
A PayPal call cannot run inside a DB transaction. Each money step writes the `PolicyDecision`, a pending `PaymentRecord` with its idempotency key, the transition, a `DealEvent` and an `AuditLog` row in transaction 1; calls the adapter, which re-checks the `PolicyDecision`; then records the result in transaction 2. A crash between the two leaves a pending record that the sweeper resumes with the same idempotency key, so PayPal deduplicates the retry. See DESIGN.md section 9.

## 4. Request flows

### 4.1 Create and lock a deal
1. Buyer submits NL description. API calls Negotiator; stores `Contract`.
2. API calls Guardian with contract, counterparty profile, messages. Stores `RiskAssessment`.
3. Policy Engine evaluates: risk level, caps, threshold. Returns `allow | require_approval | block`.
4. If allowed or approved, `/fund` creates the PayPal order (AUTHORIZE, `custom_id = dealId`) and records a `PolicyDecision(fund)`. Returns `orderId` and approve link.
5. Buyer approves in the v6 PayPal session. `onApprove` calls `/deals/:id/authorize`, which ignores any client orderId, GETs the stored order and checks status `APPROVED`, amount, currency and `custom_id`, authorizes, checks the authorization amount and the daily cap, stores `authorization_id` and `expiration_time`. State: LOCKED. A decline or mismatch voids any authorization created and moves to CANCELLED with the reason. `CHECKOUT.ORDER.APPROVED` and `PAYMENT.AUTHORIZATION.CREATED` webhooks confirm on the timeline.

### 4.2 Deliver, verify, release
1. Seller submits deliverable. State: DELIVERED.
2. API calls Verifier with deliverable and criteria. Stores `Decision`.
3. Pass: capture full amount with `final_capture: true`, then payout to the seller. State: RELEASED.
4. Partial: one capture of the proportional amount with `final_capture: true` (no void; the remainder is released by PayPal), then payout of the captured amount. State: RELEASED_PARTIAL.
5. Fail: void authorization. State: VOIDED.
6. Overridden deals and low-confidence decisions go to NEEDS_REVIEW instead of releasing.
7. Capture, payout or void failure after retries: SETTLEMENT_ERROR with a timeline alert and a manual retry.
8. Webhooks confirm captures and payouts on the timeline.

### 4.3 Webhook handling
1. Verify the signature via `POST /v1/notifications/verify-webhook-signature`, passing the raw body unchanged. On failure return 400, log, store nothing.
2. Insert `webhook_events.event_id`; on a duplicate return 200 and stop.
3. Return 200; process asynchronously: map to a deal, append a `deal_event`, wake the reconciler.
4. The reconciler reads PayPal and applies forward-only transitions.

Simulator events (Dashboard or `simulate-event`) carry a fixed `webhook_id` and never verify; test with real sandbox transactions or `webhooks-events/{id}/resend`.

## 5. Deployment (Render)
- API: Render web service (Starter, paid) built from the repo root so npm workspaces resolve. Health check `/healthz`. Migrations run before start.
- Web: Next.js web service (App Router needs a server, not a static site). Free tier, re-evaluated before judging.
- Postgres: managed. Free Postgres expires 30 days after creation; judging may run for weeks after Nov 13, so either use paid Postgres before submission or follow the documented re-create and re-seed procedure (INSTRUCTIONS section 8).
- Env vars: see INSTRUCTIONS.md. Webhook URL: `https://<api>.onrender.com/webhooks/paypal`.

## 6. Observability
- Pino JSON logs; `deal_id`, `request_id`, `paypal_request_id`, `debug_id` (on errors) on every line. Secrets, tokens and emails redacted.
- `/healthz` checks DB and PayPal token fetch.
- Agent calls log model, latency, token usage, schema validation result.

## 7. Scalability notes (post-hackathon)
- Move agent runs to a queue (BullMQ) for concurrency.
- Extract Guardian to its own service with a feature store.
- Replace polling/SSE with WebSockets if multi-region.
