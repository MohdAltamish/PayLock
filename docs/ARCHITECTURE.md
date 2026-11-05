# Paylock: Architecture

## 1. Overview

Paylock is a modular monolith: one deployable API service, one web frontend, one Postgres database. Agents are in-process modules, not separate services, to keep the hackathon deployment simple while preserving clear boundaries for later extraction.

```
+------------------+        +----------------------------+        +------------------+
|  Next.js Web UI  | <----> |  Fastify API (Node 20)     | <----> |  PostgreSQL 16   |
|  (Render static) |  REST  |                            | Prisma |                  |
+------------------+  /SSE  |  +----------------------+  |        +------------------+
                            |  | Deal Service         |  |
+------------------+        |  | State Machine        |  |        +------------------+
|  Buyer / Seller  | <----> |  | Policy Engine        |  | <----> |  LLM Provider    |
|  Agents (API)    |        |  | Audit Logger         |  |  HTTPS |  (tool calling)  |
+------------------+        |  +----------------------+  |        +------------------+
                            |  | Agent Orchestrator   |  |
+------------------+        |  |  Negotiator          |  |        +------------------+
|  PayPal Sandbox  | <----> |  |  Guardian            |  | <----> |  PayPal Agent    |
|  Orders/Payouts/ |  REST  |  |  Verifier            |  |  MCP   |  Toolkit (MCP)   |
|  Webhooks        | -----> |  +----------------------+  |        +------------------+
+------------------+ events |  | PayPal Adapter       |  |
                            |  | Webhook Handler      |  |
                            |  | PII Redactor         |  |
                            |  +----------------------+  |
                            +----------------------------+
```

## 2. Components

### 2.1 Web UI (Next.js 14, TypeScript)
- App Router, server components for data fetching, client components for the deal wizard and live timeline.
- Talks only to the Paylock API. Never calls PayPal directly except loading the PayPal JS SDK for buyer approval.
- Live updates via Server-Sent Events from `/deals/:id/events`.

### 2.2 API (Fastify)
- **Deal Service**: CRUD and orchestration entry point.
- **State Machine**: single source of truth for deal transitions. Every transition is a pure function `(state, event, context) -> newState | Error`.
- **Policy Engine**: evaluates spend caps, approval thresholds, and risk gating. Server-side only; the UI never decides.
- **Agent Orchestrator**: invokes agents, validates outputs against JSON schemas, persists decisions, emits events.
- **PayPal Adapter**: thin typed wrapper over Orders v2, Payments v2 (authorizations/captures), Payouts v1, and webhook verification. All writes carry a `PayPal-Request-Id` idempotency key derived from `deal_id + action + attempt`.
- **Webhook Handler**: verifies signature, deduplicates by event id, maps PayPal events to state machine events.
- **Audit Logger**: append-only writes; every row has actor (human | agent | paypal | system), action, before/after state, payload hash.
- **PII Redactor**: replaces emails, names, phone numbers, addresses, PayPal IDs with stable tokens before any LLM call; reverses on output.

### 2.3 Agents (in-process)
See AI_AGENTS.md. Each agent exposes `run(input): Promise<ValidatedOutput>` and declares its tool set from SKILLS.md.

### 2.4 Data (Postgres + Prisma)
See DESIGN.md for schema.

### 2.5 External
- **PayPal sandbox REST**: Orders v2 (`intent=AUTHORIZE`), Payments v2 (authorize/capture/void), Payouts v1, Webhooks v1. This is the **system of record for all money movement**, called only by the PayPal Adapter.
- **LLM provider**: abstracted behind `LlmClient`; temperature 0 to 0.2; JSON schema enforced.
- **PayPal sandbox MCP server (optional, read-only at runtime)**: used by Guardian enrichment and agent-side reconciliation only if the tool list (see INSTRUCTIONS.md, Day 1) shows disputes and reporting tools working in the sandbox. Never used for capture, void, or payout. Transport: SSE at `/sse` (CONFIRM against your MCP client library).

### 2.6 Development tooling: PayPal AI Toolkit (build time only)
The PayPal AI Toolkit is a coding-assistant plugin (Claude Code, Codex, Cursor, IBM Bob). It is **not a runtime dependency** and is not deployed.
- `paypal-best-practices` skill: guides PayPal API usage while coding.
- `PreToolUse` hook: forces a best-practices check before edits that touch PayPal SDK, API, or checkout code.
- Commands: `/paypal:setup`, `/paypal:sandbox`, `/paypal:test-accounts`, `/paypal:explain-error`, `/paypal:doctor`.
- Its sandbox access token is for the coding assistant only. The app obtains its own tokens (client-credentials grant) and caches them until shortly before `expires_in`.

## 3. Key architectural decisions (ADRs)

### ADR-001: Authorize/capture instead of true escrow
PayPal has no native escrow for this use case. Authorize-then-capture holds funds within PayPal's authorization honor period and lets us void on failure. Trade-off: hold duration is limited; deals longer than the honor period need reauthorization. Acceptable for hackathon; document in UI as "funds reserved".

### ADR-002: Modular monolith
One service, clear module boundaries. Faster to build, deploy, and demo. Agents can be extracted later.

### ADR-003: Server-side policy enforcement
All gating (risk level, spend caps) is enforced in the API. The UI only reflects decisions. Prevents a compromised client or agent from bypassing controls.

### ADR-004: Structured outputs with schema validation
Every agent returns JSON validated by Zod. Invalid output triggers one retry, then a rule-based fallback (Guardian) or a "needs human review" state (Verifier). Protects the demo from LLM variance.

### ADR-005: Hybrid risk scoring
Guardian combines deterministic signals (account age, payout email change, velocity) with an LLM rubric over message content. Deterministic signals are weighted higher and are explainable; the LLM adds pattern recognition for social engineering.

### ADR-006: Event-sourced timeline, state-stored deals
Deals store current state for fast reads; `deal_events` stores every transition for the timeline and audit. Not full event sourcing, but gives replayability of the UI.

### ADR-007: PII never reaches the LLM in clear text
Redaction is a middleware on the LLM client, not optional per agent. Reduces privacy risk and makes the privacy story demonstrable.

### ADR-008: MCP for read and enrichment, REST adapter for money movement
The documented MCP tool areas are orders, invoices, subscriptions, disputes, catalog, shipment, and reporting. Authorize, void, and Payouts are not listed. Money-moving calls therefore go through the REST adapter, which also gives us idempotency keys, retries, and policy checks that an LLM-driven tool call would bypass. MCP is limited to read-only enrichment (e.g., dispute history, transaction reporting) feeding the Guardian. This keeps the "agents decide, platform enforces" rule intact and still shows PayPal's agent tooling in use.

## 4. Request flows

### 4.1 Create and lock a deal
1. Buyer submits NL description. API calls Negotiator; stores `Contract`.
2. API calls Guardian with contract, counterparty profile, messages. Stores `RiskAssessment`.
3. Policy Engine evaluates: risk level, budget cap, threshold. Returns `allow | require_approval | block`.
4. If allowed or approved, API creates PayPal order (AUTHORIZE). Returns approval link / order id to UI.
5. Buyer approves via PayPal JS SDK. Webhook `CHECKOUT.ORDER.APPROVED` arrives; API calls authorize; stores `authorization_id`. State: LOCKED.

### 4.2 Deliver, verify, release
1. Seller submits deliverable. State: DELIVERED.
2. API calls Verifier with deliverable and criteria. Stores `Decision`.
3. Pass: capture full amount, create payout to seller. State: RELEASED.
4. Partial: capture proportional amount, void remainder (or capture with `final_capture=true` of partial amount), payout. State: RELEASED_PARTIAL.
5. Fail: void authorization. State: VOIDED.
6. Webhooks confirm captures/payouts; timeline updates.

### 4.3 Webhook handling
1. Verify signature via PayPal API.
2. Check `webhook_events.event_id` for duplicates; insert if new.
3. Map event type to state machine event; apply; append `deal_event`.
4. Return 200 quickly; heavy work queued in-process with retry.

## 5. Deployment (Render)
- Web service: API (Node). Health check `/healthz`.
- Static site or second web service: Next.js.
- Managed Postgres.
- Env vars: see INSTRUCTIONS.md. Webhook URL: `https://<api>.onrender.com/webhooks/paypal`.

## 6. Observability
- Pino JSON logs; `deal_id`, `request_id`, `paypal_request_id` on every line.
- `/healthz` checks DB and PayPal token fetch.
- Agent calls log model, latency, token usage, schema validation result.

## 7. Scalability notes (post-hackathon)
- Move agent runs to a queue (BullMQ) for concurrency.
- Extract Guardian to its own service with a feature store.
- Replace polling/SSE with WebSockets if multi-region.

