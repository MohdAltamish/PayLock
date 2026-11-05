# Paylock: Product Requirements Document

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Status | Approved for hackathon build |
| Owner | Product lead |
| Last updated | 2026-11-05 |

## 1. Problem statement

Payments for services are trust-blind. A buyer pays up front and hopes the work arrives; a seller delivers and hopes to get paid. Scammers exploit the gap on both sides: fake sellers take deposits and vanish, fake buyers dispute legitimate work. Existing escrow is slow, manual, expensive, and absent from most freelance and peer-to-peer deals. As AI agents begin transacting on behalf of people, the gap gets worse: an agent with a wallet and no judgment is a liability.

## 2. Vision

Every payment for work should be conditional on proof, and every counterparty should be risk-checked before money moves, with an AI agent doing the checking in seconds.

## 3. Goals

| # | Goal | Metric (demo scope) |
|---|------|---------------------|
| G1 | Funds never leave the buyer until work is verified | 100% of deals follow authorize, verify, capture or void |
| G2 | Risky counterparties are flagged before funding | Guardian scores every deal before lock; high risk blocks autonomous funding |
| G3 | Sellers are paid immediately on pass | Payout triggered within 5s of verifier pass in sandbox |
| G4 | Decisions are explainable | Every agent output includes per-criterion reasoning shown in UI |
| G5 | Agents can transact on behalf of humans with guardrails | Spend caps, approval thresholds, and audit log enforced server-side |

## 4. Non-goals (hackathon)

- Live (production) PayPal money movement
- Custom ML model training
- Mobile native apps
- Legal escrow licensing or regulatory compliance
- Multi-tenant SaaS billing

## 5. Target users

| Persona | Pain | Paylock value |
|---------|------|---------------|
| **Mia, freelance designer** | Non-payment after delivery; chasing invoices | Funds locked before she starts; paid instantly on pass |
| **Raj, small business buyer** | Paid a deposit to a fake developer once | Guardian flags new accounts, off-platform requests, payout email changes |
| **Buyer agent (software)** | Needs to procure a service autonomously within a budget | Structured contract, policy-enforced spend caps, verifiable release |
| **Seller agent (software)** | Needs assurance of payment before doing work | Sees the authorization hold before delivering |

## 6. User stories

### Buyer
- As a buyer, I can describe a job in plain language and get a structured contract with acceptance criteria I can edit.
- As a buyer, I see a risk assessment of the seller before I lock funds, with reasons.
- As a buyer, I can set a budget cap and an approval threshold for my agent.
- As a buyer, I receive the verifier's decision with per-criterion scores and can override it (logged).

### Seller
- As a seller, I see that funds are locked before I start work.
- As a seller, I can submit a deliverable (URL, file, text, repo) and receive a decision within minutes.
- As a seller, I'm paid via PayPal Payouts on pass without chasing anyone.

### Both
- As any party, I can view a full timeline of every state change, agent decision, and payment event.
- As any party, I can report a counterparty, which affects their trust score.

## 7. Functional requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| F1 | Create deal from natural language; Negotiator outputs structured contract (scope, price, currency, criteria, deadline) | P0 |
| F2 | Guardian evaluates deal and counterparty; outputs risk score 0-100, level, reasons, recommended action | P0 |
| F3 | Risk level gates funding: High blocks autonomous funding, Medium requires explicit human approval, Low proceeds | P0 |
| F4 | Create PayPal order with `intent: AUTHORIZE`; buyer approves; authorization stored | P0 |
| F5 | Seller submits deliverable; Verifier scores each criterion, outputs pass / partial / fail with reasoning | P0 |
| F6 | On pass: capture authorization, create payout to seller. On fail: void authorization. On partial: one capture of the proportional amount with `final_capture=true` (PayPal releases the remainder; no void), then payout | P0 |
| F7 | Receive and verify PayPal webhooks; update deal state idempotently | P0 |
| F8 | Deal timeline UI showing states, agent decisions, payment events | P0 |
| F9 | Spend policy per buyer: max per deal, daily cap, approval threshold | P0 |
| F10 | Immutable audit log of all agent and payment actions | P0 |
| F11 | PII redaction before any LLM call | P1 |
| F12 | Community report of counterparty; feeds trust score | P1 |
| F13 | Agent-to-agent mode: buyer agent and seller agent negotiate via API | P1 |
| F14 | Seeded demo data and scripted scammer personas | P1 |
| F15 | Dispute summary export when deal fails | P2 |

## 8. Non-functional requirements

- **Reliability**: demo path must succeed on repeated runs; all PayPal calls retried with backoff; webhooks idempotent.
- **Latency**: agent decisions under 15s; UI reflects state via polling or SSE within 2s.
- **Security**: secrets in env, webhook signature verification, least-privilege PayPal credentials, server-side policy enforcement only.
- **Observability**: structured JSON logs with deal_id correlation; request IDs on every PayPal call.
- **Accessibility**: WCAG 2.1 AA for core flows (keyboard nav, contrast, aria labels).

## 9. Success criteria for the hackathon

- End-to-end happy path works on hosted URL: create, guard, lock, deliver, verify, release.
- Scam path works live: Guardian flags and blocks a seeded scammer persona.
- Failure path works live: bad deliverable is rejected and authorization voided.
- README allows a judge to run locally in under 15 minutes.
- Demo video under 3 minutes shows all three paths.

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| PayPal authorization honor period and sandbox quirks | Test early (Day 1); cap deal duration in demo; document behavior |
| LLM non-determinism breaks the demo | Structured outputs with JSON schema; low temperature; seeded fixtures; fallback rule engine |
| Payouts sandbox limitations (e.g., recipient accounts) | Use sandbox personal accounts as recipients; pre-create them |
| Scope creep | P0 only until Day 4; P1 only if P0 is stable |
| Overclaiming "scam detection" | Frame as risk signals and user choice; never label a person a scammer in UI copy |

## 11. Open questions

- Should partial payment thresholds be fixed (e.g., 70%) or negotiated per contract? Default: per contract, fallback 70%.
- Currency: USD only for the hackathon demo; other currencies are a non-goal.
- Do we show the seller their own risk score? Default: no, show only "verification steps to improve trust".

