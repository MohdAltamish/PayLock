# Paylock: Project Workplan (PWD)

Deadline: 2026-11-13 01:30 IST (2026-11-12 20:00 UTC). Submit by 2026-11-12 12:00 UTC to leave buffer.

## Team roles

| Role | Responsibilities |
|------|------------------|
| Tech lead / backend | PayPal integration, state machine, webhooks, policy engine |
| AI engineer | Agent prompts, tool definitions, structured outputs, evals |
| Frontend | Next.js UI, timeline, risk banner, deal wizard |
| Product / demo | README, docs, seed data, video, Devpost submission |

Solo? Follow the same order; roles become phases.

## Milestones

| Day | Date | Milestone | Definition of done |
|-----|------|-----------|--------------------|
| 1 | Nov 5 | Money moves | Sandbox app created; authorize, capture, void, payout working via script; webhook received locally via ngrok |
| 2 | Nov 6 | Deal core | Prisma schema, state machine, REST API for deals; happy path via curl |
| 3 | Nov 7 | Agents | Negotiator, Guardian, Verifier produce schema-valid JSON; 10 fixture cases pass |
| 4 | Nov 8 | Guardrails + UI shell | Policy engine, audit log, PII redaction; deal list, deal detail, timeline rendering |
| 5 | Nov 9 | Deployed | Render deploy, webhooks pointed at prod URL, seed script, scammer personas |
| 6 | Nov 10 | Hardening | Retries, idempotency, error states, a11y pass, README verified on clean machine |
| 7 | Nov 11 | Submission | Video recorded and uploaded; Devpost form complete; repo public with LICENSE |
| Buffer | Nov 12 | Fixes only | No new features |

## Daily task breakdown

### Day 1: Money moves
- [ ] Create PayPal sandbox business app; store client ID/secret in `.env`
- [ ] Create two sandbox personal accounts (buyer, seller)
- [ ] Script: create order (AUTHORIZE), approve via sandbox UI, authorize, capture
- [ ] Script: void authorization
- [ ] Script: payouts batch to seller sandbox email
- [ ] Register webhook, names checked against `GET /v1/notifications/webhooks-event-types`: CHECKOUT.ORDER.APPROVED, PAYMENT.AUTHORIZATION.CREATED, PAYMENT.AUTHORIZATION.VOIDED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.PENDING, PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REFUNDED, PAYMENT.PAYOUTSBATCH.SUCCESS, PAYMENT.PAYOUTSBATCH.DENIED, PAYMENT.PAYOUTS-ITEM.SUCCEEDED, PAYMENT.PAYOUTS-ITEM.FAILED, PAYMENT.PAYOUTS-ITEM.UNCLAIMED, PAYMENT.PAYOUTS-ITEM.BLOCKED, PAYMENT.PAYOUTS-ITEM.RETURNED, CUSTOMER.DISPUTE.CREATED
- [ ] Verify webhook signature using PayPal verify-webhook-signature endpoint, from the raw body, with a real (not simulated) event
- [ ] Balance pre-check (`GET /v1/reporting/balances`) passes before the payout script

### Day 2: Deal core
- [ ] Prisma schema (see DESIGN.md)
- [ ] State machine with explicit transitions and guards
- [ ] Fastify routes: deals, deliverables, decisions, webhooks
- [ ] Idempotency keys on all PayPal writes

### Day 3: Agents
- [ ] LLM provider abstraction
- [ ] Negotiator: NL to contract JSON
- [ ] Guardian: signals plus LLM rubric to risk JSON
- [ ] Verifier: deliverable plus criteria to decision JSON
- [ ] Fixture suite: 4 happy, 3 scam, 3 fail

### Day 4: Guardrails + UI shell
- [ ] Policy engine (caps, thresholds, risk gating)
- [ ] Audit log writer (append-only table)
- [ ] PII redactor middleware before LLM calls
- [ ] UI: deal list, create wizard, deal detail with timeline

### Day 5: Deployed
- [ ] Render web service plus Postgres
- [ ] Env vars, health check, webhook URL updated
- [ ] Seed script with 4 personas: Honest Seller, Fresh Account Scammer, Off-Platform Pusher, Bad Deliverable
- [ ] Postgres plan for the judging period: paid before submission, or the re-create and re-seed procedure documented (free Postgres expires after 30 days)

### Day 6: Hardening
- [ ] Retry/backoff on PayPal 5xx and 429
- [ ] Webhook replay safe
- [ ] Error toasts and empty states
- [ ] Keyboard and screen reader pass
- [ ] Fresh clone: README steps succeed

### Day 7: Submission
- [ ] Record video per DEMO_SCRIPT.md
- [ ] Upload to YouTube (public, no copyrighted music)
- [ ] Devpost: description, tools used, repo link, demo URL, video link

## Cut list (if a phase overruns its time budget by 25%, cut in this order)
Budgets per phase are in BUILD_PLAN.md section 2.5; time is logged in `docs/progress.md`.
1. F15 dispute export
2. E2E popup run
3. MCP enrichment
4. Verifier tool loop
5. `refundCapture` (runbook falls back to manual payout retry)
6. F13 agent-to-agent API mode (keep as scripted demo)
7. `inspect_repo`
8. F12 community reports (keep static trust data)
9. Playwright reduced to the happy path
10. Partial payments (binary pass/fail only)

Never cut: authorize/capture/void, Guardian gating, Verifier, timeline, README, video.

