# Paylock: Setup, Run, Test, Deploy

## Prerequisites
- Node.js 20+, npm 10+
- Docker (for local Postgres 16 and local-only `run_checks`)
- PayPal Developer account with:
  - a **US** sandbox business account (the platform: receives captures, sends payouts) with a sandbox REST app assigned to it
  - on that app: **Payouts** and **Transaction Search** enabled (Apps & Credentials → app → Features)
  - two US sandbox personal accounts (buyer, seller)
  - payment review turned **off** on the business account (otherwise authorizations can stay `PENDING`)
- An LLM API key (OpenAI-compatible or Anthropic)
- A public HTTPS tunnel for local webhooks (we use ngrok)

## 0. Install the PayPal AI Toolkit (for your coding assistant)

Clone it **next to** this repo, never inside it, and reference it from there:

```bash
git clone https://github.com/paypal/AI-Toolkit.git ../AI-Toolkit
```

Then pick your assistant:

```bash
# Claude Code (marketplace)
/plugin marketplace add paypal/AI-Toolkit
/plugin install paypal@paypal-ai-toolkit
# or local: claude --plugin-dir ../AI-Toolkit

# OpenAI Codex
codex plugin marketplace add paypal/AI-Toolkit
codex plugin add paypal@paypal-ai-toolkit

# Cursor
cursor-agent plugin marketplace add https://github.com/paypal/AI-Toolkit
```

IBM Bob: open `../AI-Toolkit` in Bob. It authenticates to the MCP server through the browser (OAuth), so no token is needed.

**Assistant token (separate from the app's credentials):**
1. Generate a sandbox token with the client-credentials curl command from `/paypal:setup`, using your sandbox client id and secret.
2. Put it in your assistant's config (`~/.claude/settings.json` env block for Claude Code, `~/.codex/config.toml` for Codex, the plugin Configure panel for Cursor), not in `~/.zshrc`. Keep it on a single line.
3. Fully quit and reopen the assistant, then run `/paypal:setup`.
4. It expires in up to 9 hours. Run `/paypal:setup refresh` on a 401.

Never commit this token or paste it into issues or chat. The app never uses it.

## 1. Clone and install
```bash
git clone https://gitlab.com/gitlab-ai-hackathon/paylock.git
cd paylock
nvm use        # Node 20 from .nvmrc
npm install
```

## 2. Environment
Copy and fill:
```bash
cp .env.example .env
chmod 600 .env
```

`.env.example` lists every variable with comments. The important ones:

```env
DATABASE_URL=postgresql://paylock:paylock@localhost:5432/paylock

PAYPAL_ENV=sandbox                # sandbox only for the hackathon
PAYPAL_CLIENT_ID=                 # sandbox app on the US business account
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=                # printed by scripts/webhook-register.ts
PAYPAL_PLATFORM_EMAIL=            # sandbox business account email
PAYPAL_SANDBOX_BUYER_EMAIL=       # sandbox personal account (buyer)
PAYPAL_SANDBOX_SELLER_EMAIL=      # sandbox personal account (payout recipient)

LLM_PROVIDER=openai               # openai | anthropic | replay
LLM_API_KEY=
LLM_MODEL=

APP_URL=http://localhost:3000
API_URL=http://localhost:4000
SESSION_SECRET=                   # 32+ random bytes, e.g. `openssl rand -hex 32`
PAYLOCK_FREEZE=0
```

## 3. Database
```bash
docker compose up -d postgres
npm run db:migrate
npm run seed            # demo users and the 4 personas
```

## 4. PayPal sandbox setup (app)
The app does **not** use the assistant token. `apps/api/src/paypal/token.ts` requests its own with the client-credentials grant and caches it until 60 seconds before `expires_in`.

Use `/paypal:sandbox` and `/paypal:test-accounts` for accounts, test instruments and webhook testing guidance.

### Webhooks (local)
PayPal cannot deliver to `localhost`; the URL must be public HTTPS.

```bash
npm run dev:api                       # API on :4000
ngrok http 4000                       # copy the https URL
npm run webhook:register -- https://<id>.ngrok-free.app
```

`webhook:register` lists the valid event names (`GET /v1/notifications/webhooks-event-types`), then creates the webhook, or PATCHes the existing one to the new URL if it already exists (a new ngrok URL means a PATCH, not a new webhook; an app can have at most 10). Put the printed id in `PAYPAL_WEBHOOK_ID` (or pass `--write-env`) and restart the API.

**Test with real events.** Run `npm run smoke -- card-capture` (no buyer login needed) and watch the API log for verified `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.CAPTURE.*` events. Delivery takes roughly 10 to 75+ seconds. Events from the Dashboard Webhooks Simulator or `simulate-event` carry a fixed `webhook_id` and **never** pass signature verification; use them only to check that the listener is reachable. To re-test verification, resend a real event: `POST /v1/notifications/webhooks-events/{id}/resend`.

## Day 1 verification checklist (blocks all later work)
- [ ] Toolkit installed at `../AI-Toolkit`; `/paypal:setup` passes
- [ ] Token has the Payouts and reporting scopes; `GET /v1/reporting/balances` returns 200
- [ ] `npm run mcp:list-tools` writes `docs/mcp-tools.txt`
- [ ] SKILLS.md `mcp_get_disputes` and `mcp_list_transactions` rows confirmed (renamed to real tool names) or deleted
- [ ] `npm run smoke -- capture`, then approve as the sandbox buyer, then `npm run smoke -- capture --order <id>` (authorize, capture)
- [ ] `npm run smoke -- void` (same two steps)
- [ ] `npm run smoke -- partial` (same two steps; one capture with `final_capture: true` closes the authorization)
- [ ] `npm run smoke -- payout` (balance pre-check, then Payouts to the seller sandbox account)
- [ ] `npm run smoke -- idempotency`, `-- honor`, `-- card-authorize`, `-- decline`
- [ ] Authorization `expiration_time` and honor-period behavior recorded in ARCHITECTURE.md ADR-001
- [ ] Webhook received and signature verified from the raw body
- [ ] `/paypal:explain-error <code>` run on every failure and the fix noted in `docs/pitfalls.md`
- [x] JS SDK version for the buyer approval button: **v6** (toolkit default for new projects)

## 5. Run locally
```bash
npm run dev          # API on :4000 and web on :3000
ngrok http 4000      # in another terminal; then npm run webhook:register -- <url>
```
Open http://localhost:3000?demo=1.

## 6. Tests
```bash
npm run lint
npm run typecheck
npm test             # unit tests: state machine, policy engine, payment math, adapter (mocked HTTP)
npm run eval         # agent fixtures (requires LLM key, or LLM_PROVIDER=replay)
npm run e2e          # Playwright: happy, scam, failure paths (sandbox card funding)
npm run e2e:popup    # Playwright through the real sandbox buyer popup (may be flaky)
```

`npm test` runs unit tests and, when Postgres is reachable, the `*.db.test.ts` integration suites against a separate `paylock_test` database (`TEST_DATABASE_URL`; created and migrated automatically). Set `REQUIRE_DB_TESTS=1` in CI so a missing database fails the run. Integration suites run the real PayPal adapter over an in-memory sandbox and are labelled "mocked PayPal".

Sandbox end-to-end check of the deal core (no browser):

```bash
AGENTS_MODE=stub E2E_FUNDING=card PORT=4100 npx tsx --env-file=.env apps/api/src/server.ts
API_URL=http://localhost:4100 scripts/curl-happy.sh   # PASS -> RELEASED, FAIL -> VOIDED
```

## 7. Demo walkthrough (local or hosted)
1. Sign in as Buyer (demo login).
2. Create deal with persona "Honest Seller". Confirm contract. Risk LOW. Reserve funds with the sandbox buyer login in the PayPal popup.
3. Switch to Seller. Submit deliverable URL `<APP_URL>/demo/deliverables/pass`. Watch the Verifier pass and the payout land.
4. Create deal with persona "Fresh Account Scammer". Observe HIGH risk and the block.
5. Create deal with persona "Bad Deliverable" and submit `<APP_URL>/demo/deliverables/bad`. Observe FAIL and "funds returned".

Between runs: `npm run demo:reset` (deletes demo deals and re-bases persona account ages so results repeat).

## 8. Deploy to Render
`render.yaml` defines the services. All builds run from the **repo root** so npm workspaces resolve.

1. API web service (Starter): build `npm ci && npm run build -w apps/api`, pre-deploy `npm run db:deploy -w apps/api`, start `npm run start -w apps/api`. Health check `/healthz`.
2. Web web service (Next.js App Router needs a server, not a static site): build `npm ci && npm run build -w apps/web`, start `npm run start -w apps/web`. Set `API_URL` to the API's internal or public URL.
3. Postgres: managed. Free Postgres expires 30 days after creation and judging may run weeks past Nov 13. Either upgrade to a paid plan before submission, or follow the re-create procedure below.
4. Set all env vars (never `E2E_FUNDING`). Point the PayPal webhook at `https://<api>.onrender.com/webhooks/paypal` with `npm run webhook:register`.
5. Seed once from the **API** service shell (free web services have no shell): `npm run seed -w apps/api`.

Re-create and re-seed procedure (free Postgres): create a new Postgres instance, update `DATABASE_URL` on the API service, redeploy (migrations run in pre-deploy), run `npm run seed -w apps/api` from the API shell, then re-run the three demo paths.

## 9. Troubleshooting
- **Webhook signature fails**: wrong `PAYPAL_WEBHOOK_ID`, body parsed before verification, or a simulator event. Use the raw body and a real event.
- **Balance check 403 `NOT_AUTHORIZED`**: enable Transaction Search on the app, then mint a new token.
- **Authorization stays `PENDING`**: payment review is on for the sandbox business account; turn it off.
- **Authorization expired**: the reservation passed its `expiration_time`; the deal shows "reservation expired". Create a new deal.
- **Payout pending**: sandbox payouts can take a minute; the UI shows "Confirming with PayPal…".
- **Agent schema errors**: check `LLM_MODEL` supports JSON schema output; see logs for the validation error.

## 10. Repository layout
```
apps/
  api/        Fastify API, agents, PayPal adapter, Prisma
  web/        Next.js UI
packages/
  schemas/    Zod schemas shared by API and web
  skills/     Tool implementations
fixtures/     Eval cases, personas, sample deliverables
scripts/      seed, demo-reset, void-all, paypal smoke tests, webhook-register, mcp-list-tools
docs/         This documentation
```
