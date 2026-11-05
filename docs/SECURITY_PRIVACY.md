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
- Session auth (NextAuth) for humans; API keys with scopes for agents (`deals:write`, `deliverables:write`).
- Row-level checks: buyer-only actions (approve, override), seller-only actions (deliver).

### Payment safety
- `intent=AUTHORIZE`; capture only after Decision stored in same transaction.
- `final_capture=true` ensures remainder is released on partial.
- Payout recipient is the seller's PayPal email recorded at contract time; changes after LOCKED trigger PAYOUT_EMAIL_CHANGED signal and require buyer confirmation.
- Spend policy enforced in Policy Engine; UI cannot bypass.

### Agent safety
- Agents have read tools only; Settlement is deterministic code.
- All untrusted text fenced: `<DELIVERABLE>`, `<MESSAGE>`, `<TOOL_RESULT>` with instruction to ignore embedded directives.
- Output schema validation; one retry; fail-safe routing.
- Temperature 0 for Guardian and Verifier.

### Webhooks
- Verify via PayPal `/v1/notifications/verify-webhook-signature`.
- Store `event_id`; ignore duplicates.
- Process asynchronously; respond 200 within 2s.

### Infrastructure
- TLS everywhere (Render managed).
- Secrets in Render env vars; never committed. `.env.example` only.
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
- Kill switch env var `PAYLOCK_FREEZE=1` blocks all write skills.
- Runbook: rotate PayPal secret, revoke agent keys, void open authorizations via script `scripts/void-all.ts`.

