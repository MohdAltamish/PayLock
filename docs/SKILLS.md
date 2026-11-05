# Paylock: Agent Skills (Tool Catalog)

Each skill is a typed function. Skills are side-effect classified; agents only ever receive `read` skills, and in the default mode the orchestrator calls them and fences the results into the prompt (decision H). `write` skills are invoked only by the Settlement module after policy checks, and require a `SettlementApproval` tied to a persisted `PolicyDecision`.

| Skill | Class | Signature | Description | Used by |
|-------|-------|-----------|-------------|---------|
| `get_counterparty_profile` | read | `(userId) -> TrustProfile (redacted)` | Account age, completed/failed deals, disputes, reports, verification | Negotiator, Guardian |
| `get_deal_velocity` | read | `(userId, windowMinutes) -> { count, amounts[] }` | Recent deal creation rate | Guardian |
| `get_paypal_verification` | read | `(dealId) -> { payerVerified?, payeeVerified }` | Seller: `TrustProfile.paypalVerified` at guard time. Buyer: `payment_source.paypal.account_status` from `GET /v2/checkout/orders/{id}` after approval (Orders v2 exposes no payee status) | Guardian |
| `estimate_market_price` | read | `(scope) -> { low, high, currency }` | Heuristic table by category for TOO_GOOD_PRICING; money as Decimal strings | Negotiator, Guardian |
| `fetch_url` | read | `(url) -> { status, title, textExcerpt, metaViewport, hasForm }` | HTTP fetch with size/time limits, SSRF-guarded. No real viewport rendering on the hosted app (ADR-010) | Verifier |
| `inspect_repo` | read | `(repoUrl) -> { files[], readme, hasTests, license }` | Metadata via the GitHub/GitLab REST API; those hosts only | Verifier |
| `run_checks` | read | `(repoUrl, command) -> { exitCode, stdoutTail }` | **Local only.** Sandboxed test run, allowlisted commands, 60s cap. Disabled on the hosted app | Verifier |
| `read_file` | read | `(storageKey) -> text` | Deliverable file content, 200KB cap | Verifier |
| `paypal_create_order` | write | `(dealId, amount, currency) -> { orderId, approveUrl }` | Orders v2, intent AUTHORIZE, `custom_id = dealId` | Settlement (funding) |
| `paypal_authorize` | write | `(dealId) -> { authorizationId, expiresAt }` | Uses the stored order id; verifies order and authorization | Settlement (funding) |
| `paypal_capture` | write | `(approval, authId, amount, final) -> { captureId }` | Capture authorization; `final_capture` always sent explicitly | Settlement |
| `paypal_void` | write | `(authId) -> void` | Void authorization; allowed during `PAYLOCK_FREEZE` | Settlement, void-all |
| `paypal_payout` | write | `(approval, recipientEmail, amount, attempt) -> { batchId }` | Payouts v1; `sender_batch_id` per attempt, `sender_item_id = dealId` | Settlement |
| `paypal_refund` | write | `(approval, captureId, amount) -> { refundId }` | P2. Refund after a payout fails post-capture | Settlement |
| `paypal_verify_webhook` | read | `(headers, rawBody) -> boolean` | Webhook signature verification | Webhook Handler |
| `redact_pii` | util | `(text) -> { text, map }` | Tokenize PII | LLM client middleware |
| `restore_pii` | util | `(text, map) -> text` | Reverse tokens for UI | LLM client middleware |
| `write_audit` | util | `(entry) -> void` | Append audit row | All modules |
| `mcp_list_tools` | util | `() -> ToolDescriptor[]` | Startup check and `scripts/mcp-list-tools.ts`; lists tools exposed by the PayPal sandbox MCP server; saved to `docs/mcp-tools.txt` | Boot |
| `mcp_get_disputes` | read | `(filters) -> Dispute[]` | Maps to MCP tools `list_disputes` (params: `disputed_transaction_id`, `dispute_state`, `page_size`, `page`) and `get_dispute`. **Confirmed exposed (C2, 2026-11-05), but not working in sandbox**: every call returns `{"ok":false,"code":"PAYPAL_API_SETUP_ERROR","message":"Unsupported cache mode: default"}`. Disabled until a re-check shows it working; the DISPUTES signal uses `TrustProfile.disputes` meanwhile. See docs/mcp-tools.txt | Guardian |
| `mcp_list_transactions` | read | `(range) -> Transaction[]` | Maps to MCP tool `list_transactions` (params: `transaction_id`, `transaction_status`, `start_date`, `end_date`, `search_months`, `page_size`, `page`). **Confirmed exposed (C3), same `PAYPAL_API_SETUP_ERROR`.** Transaction Search is enabled on the app, and REST `GET /v1/reporting/balances` works, so the failure is on the MCP server side. Disabled until re-checked | Buyer/Seller agents (P1) |

## Safety rules for skills

- `fetch_url` resolves DNS and connects to the checked IP; blocks private, loopback, link-local and cloud-metadata ranges (IPv4 and IPv6); ports 80 and 443 only; max 3 redirects, each re-checked; 5MB cap; 10s timeout. `FETCH_URL_DEV_ALLOW_HOSTS` may allow localhost only when `NODE_ENV != production` (decision I).
- `run_checks` runs locally in an ephemeral container (`--network none`, read-only repo mount); commands allowlisted (`npm test`, `pytest`, `go test`). Not available on the hosted app.
- `write` skills require a `SettlementApproval` referencing a `PolicyDecision` that approved this action for this deal. `PAYLOCK_FREEZE=1` blocks every write skill except `paypal_void`.
- All skills log inputs (hashed where sensitive), outputs, duration, and caller.
- MCP tools are read-only enrichment. No MCP write tool (`create_order`, `pay_order`, invoices, subscriptions) is ever called at runtime.

## Two skill systems (do not confuse them)

| | Runtime agent skills (this doc) | PayPal AI Toolkit skills |
|---|---|---|
| Who uses them | Paylock's Negotiator, Guardian, Verifier | Your coding assistant |
| When | While the app runs | While you write code |
| Money movement | Via Settlement and the REST adapter only | None |
| Location | `packages/skills/` | Installed plugin (`paypal-best-practices`, `paypal-routing`), referenced at `../AI-Toolkit`, never copied |

## Dev-time assistant skills to add (repo-local, optional)
`.claude/skills/paylock-invariants/SKILL.md` (or the equivalent for your assistant):
- Never capture or pay out without a stored Decision and a Policy approval id.
- All PayPal writes go through the adapter with `PayPal-Request-Id`.
- Webhooks must be verified from the raw body.
- Amounts use `Decimal`, never floats.
This complements the toolkit's best-practices skill with project-specific rules.
