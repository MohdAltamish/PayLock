# Paylock: Security and Privacy

## 1. Threat model

| Threat | Vector | Control |
|--------|--------|---------|
| Scam seller takes funds without delivering | Social engineering, fresh account | Authorize-then-capture; Guardian gating; Verifier before release |
| Scam buyer disputes legitimate work | Chargeback after delivery | Verifier evidence log exportable for disputes; PayPal dispute webhooks tracked |
| Agent manipulated via prompt injection | Malicious deliverable or message text | Data fencing in prompts; schema-only outputs; agents cannot call write skills |
| Agent overspends | Compromised or buggy agent | Server-side SpendPolicy; approval thresholds; daily caps |
| Webhook spoofing | Forged POST to `/webhooks/paypal` | PayPal signature verification; event id dedup; TLS only |
| Replay of payment actions | Retried requests | Idempotency keys on all PayPal writes; DB transaction with row lock |
| SSRF via deliverable URL | Internal URL in deliverable | `fetch_url` blocks private ranges, DNS rebinding check, redirect cap |
| Code execution via repo checks | Malicious test scripts | Ephemeral container, no network, allowlisted commands, timeout |
| Secret leakage | Logs, client bundle | Secrets only in server env; log redaction; no PayPal secret in frontend |
| PII leakage to LLM provider | Prompts | Mandatory redaction middleware |
| Threshold splitting | Many deals just under approval limit | UNDER_THRESHOLD_SPLITTING signal; daily cap |

## 2. Controls

### Authentication and authorization
- Demo sessions for humans: a signed, httpOnly, `SameSite=Lax` cookie issued by `/auth/demo-login` (no NextAuth). API keys with scopes for agents (`deals:write`, `deliverables:write`), stored as sha256 hashes.
- Origin check on state-changing requests (CSRF), since the web app proxies `/api/*` first-party.
- Row-level checks: buyer-only actions (approve, override), seller-only actions (deliver).

### Payment safety
- `intent=AUTHORIZE`; capture, payout and refund only with a persisted Decision and a `PolicyDecision` written in the same transaction as the pending payment record (ADR-011). The adapter re-checks the `PolicyDecision` before calling PayPal.
- `final_capture=true` (always sent explicitly) ensures the remainder is released on partial; no void after a final capture.
- `/authorize` never trusts a client-supplied order id: it uses the stored `paypalOrderId` and verifies amount, currency and `custom_id` via `GET` before LOCKED.
- The E2E card-funding route exists only when `PAYPAL_ENV=sandbox`, `E2E_FUNDING=card` and `NODE_ENV != production`; a test asserts a 404 under production config.
- Payout recipient is the seller's PayPal email recorded at contract time; changes after LOCKED trigger PAYOUT_EMAIL_CHANGED signal and require buyer confirmation.
- Spend policy enforced in Policy Engine; UI cannot bypass.

### Agent safety
- Agents have read tools only; Settlement is deterministic code.
- All untrusted text fenced: `<DELIVERABLE>`, `<MESSAGE>`, `<TOOL_RESULT>` with instruction to ignore embedded directives.
- Output schema validation; one retry; fail-safe routing.
- Temperature 0 for Guardian and Verifier.

### Webhooks
- Verify via PayPal `/v1/notifications/verify-webhook-signature` using the raw request bytes (never re-serialized JSON).
- On a failed signature: return 400, log it (transmission id, no body), never store or process.
- Store `event_id`; ignore duplicates.
- Process asynchronously; respond 200 within 2s.
- Webhooks only append events and wake the reconciler; they never regress state or trigger money writes.

### Infrastructure
- TLS everywhere (Render managed).
- Secrets in Render env vars; never committed. `.env.example` only. Secret detection (gitleaks) in CI.
- The browser receives only the PayPal `clientId`, at runtime from `GET /config/paypal`; no PayPal env var is in the frontend bundle.
- Dependency scanning in CI (GitLab SAST and Dependency Scanning templates).
- Rate limiting on public endpoints (100 req/min/IP).

## 3. Privacy

### Data minimization
- Store: emails (for PayPal payout), display names, deal content, decisions, payment ids.
- Do not store: card or bank data (PayPal holds it), raw PayPal access tokens beyond memory cache, IP addresses beyond rate-limit window.

### PII redaction before LLM
- Patterns: email, phone, postal address, full names (from known users), PayPal ids, URLs with query strings.
- Replaced with stable tokens per request (`<EMAIL_1>`); map held in memory only; restored for UI display.
- Logged: token counts, not content.

### Retention
- Messages and deliverable content: 90 days after deal closes (configurable), then purged.
- Audit log and payment records: retained (financial record), with PII tokenized.

### Transparency
- Risk banner shows exactly which signals fired and whether from Rule or AI.
- Users can request data export and deletion via settings (P2: manual process documented).

### Fairness
- Guardian signals are behavior-based (account age, history, message patterns), never demographic.
- Copy never labels a person; it describes signals and recommends actions.
- Overrides always available to the human buyer.

## 4. Incident response (hackathon scale)
- Kill switch env var `PAYLOCK_FREEZE=1` blocks every money write (create order, authorize, capture, payout, refund). Void stays allowed, because void returns funds to the buyer.
- Runbook, compromise: rotate the PayPal secret, revoke agent keys, set `PAYLOCK_FREEZE=1`, void open authorizations via `scripts/void-all.ts`.
- Runbook, payout failed after capture (deal in SETTLEMENT_ERROR with a completed capture):
  1. Read the payout item's `errors.name` (`GET /v1/payments/payouts/{batch_id}`) and run `/paypal:explain-error` on it. Log it in `docs/pitfalls.md`.
  2. If the cause is fixable (recipient email, sender balance, Payouts not enabled), fix it and use the timeline's retry. The retry re-sends with a new `sender_batch_id` and the same `sender_item_id = dealId`, and only if the previous item ended `FAILED`, `RETURNED`, `BLOCKED`, `REFUNDED` or `REVERSED`.
  3. If the item is `PENDING`, `UNCLAIMED` or `ONHOLD`, do not re-send; wait for the sweeper or webhook.
  4. If the seller cannot be paid, refund the buyer (P2): `refundCapture` for the captured amount, gated by a `PolicyDecision(action=refund)`; the deal goes to VOIDED with `REFUNDED`. If refund is not built (cut list), refund manually in the sandbox dashboard and record it on the timeline as a HUMAN action.

