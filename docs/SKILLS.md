# Paylock: Agent Skills (Tool Catalog)

Each skill is a typed function exposed to agents via tool calling. Skills are side-effect classified; agents may only call `read` skills directly. `write` skills are invoked by the Settlement module after policy checks.

| Skill | Class | Signature | Description | Used by |
|-------|-------|-----------|-------------|---------|
| `get_counterparty_profile` | read | `(userId) -> TrustProfile (redacted)` | Account age, completed/failed deals, disputes, reports, verification | Negotiator, Guardian |
| `get_deal_velocity` | read | `(userId, windowMinutes) -> { count, amounts[] }` | Recent deal creation rate | Guardian |
| `get_paypal_verification` | read | `(orderId) -> { payerVerified, payeeVerified }` | From Orders v2 response | Guardian |
| `estimate_market_price` | read | `(scope) -> { low, high, currency }` | Heuristic table by category for TOO_GOOD_PRICING | Negotiator, Guardian |
| `fetch_url` | read | `(url, viewport?) -> { status, title, textExcerpt, screenshotKey? }` | Headless fetch with size/time limits, SSRF-guarded | Verifier |
| `inspect_repo` | read | `(repoUrl) -> { files[], readme, hasTests, license }` | Shallow clone metadata | Verifier |
| `run_checks` | read | `(repoUrl, command) -> { exitCode, stdoutTail }` | Sandboxed test run, allowlisted commands, 60s cap | Verifier |
| `read_file` | read | `(storageKey) -> text` | Deliverable file content, 200KB cap | Verifier |
| `paypal_create_order` | write | `(dealId, amount, currency) -> { orderId, approveUrl }` | Orders v2, intent AUTHORIZE | Settlement |
| `paypal_authorize` | write | `(orderId) -> { authorizationId, expiresAt }` | Payments v2 authorize | Settlement |
| `paypal_capture` | write | `(authId, amount, final) -> { captureId }` | Capture authorization | Settlement |
| `paypal_void` | write | `(authId) -> void` | Void authorization | Settlement |
| `paypal_payout` | write | `(recipientEmail, amount, note) -> { batchId }` | Payouts v1 | Settlement |
| `paypal_verify_webhook` | read | `(headers, body) -> boolean` | Webhook signature verification | Webhook Handler |
| `redact_pii` | util | `(text) -> { text, map }` | Tokenize PII | LLM client middleware |
| `restore_pii` | util | `(text, map) -> text` | Reverse tokens for UI | LLM client middleware |
| `write_audit` | util | `(entry) -> void` | Append audit row | All modules |
| `mcp_list_tools` | util | `() -> ToolDescriptor[]` | Startup check; lists tools exposed by PayPal sandbox MCP; logged for the README | Boot |
| `mcp_get_disputes` | read | `(filters) -> Dispute[]` | **CONFIRM tool name and sandbox support.** Feeds DISPUTES signal | Guardian |
| `mcp_list_transactions` | read | `(range) -> Transaction[]` | **CONFIRM.** Reconciliation and demo "PayPal says" panel | Buyer/Seller agents (P1) |

## Safety rules for skills

- `fetch_url` blocks private IP ranges, follows max 3 redirects, 5MB cap, 10s timeout.
- `run_checks` runs in an ephemeral container with no network and read-only repo mount; commands allowlisted (`npm test`, `pytest`, `go test`).
- `write` skills require a `policyDecisionId` proving the Policy Engine approved the action for this deal state.
- All skills log inputs (hashed where sensitive), outputs, duration, and caller.

## Two skill systems (do not confuse them)

| | Runtime agent skills (this doc) | PayPal AI Toolkit skills |
|---|---|---|
| Who uses them | Paylock's Negotiator, Guardian, Verifier | Your coding assistant |
| When | While the app runs | While you write code |
| Money movement | Via Settlement and the REST adapter only | None |
| Location | `packages/skills/` | Installed plugin (`paypal-best-practices`, `paypal-routing`) |

## Dev-time assistant skills to add (repo-local, optional)
`.claude/skills/paylock-invariants/SKILL.md` (or the equivalent for your assistant):
- Never capture or pay out without a stored Decision and a Policy approval id.
- All PayPal writes go through the adapter with `PayPal-Request-Id`.
- Webhooks must be verified from the raw body.
- Amounts use `Decimal`, never floats.
This complements the toolkit's best-practices skill with project-specific rules.

