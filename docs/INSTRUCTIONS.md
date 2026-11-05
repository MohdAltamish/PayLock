# Paylock: Setup, Run, Test, Deploy

## Prerequisites
- Node.js 20+, npm 10+
- PostgreSQL 16 (local or Docker)
- PayPal Developer account with a sandbox business app and two sandbox personal accounts
- An LLM API key (OpenAI-compatible or Anthropic)
- ngrok or similar for local webhooks

## 0. Install the PayPal AI Toolkit (for your coding assistant)

Pick your assistant:

```bash
# Claude Code
/plugin install paypal@claude-plugins-official
/reload-plugins

# OpenAI Codex
codex plugin marketplace add paypal/AI-Toolkit
codex plugin add paypal@paypal-ai-toolkit

# Cursor
cursor-agent plugin marketplace add https://github.com/paypal/AI-Toolkit
```

IBM Bob: clone `https://github.com/paypal/AI-Toolkit` and open it in Bob. It authenticates to the MCP server through the browser (OAuth), so no token is needed.

**Assistant token (separate from the app's credentials):**
1. Generate a sandbox token with the client-credentials curl command from the toolkit README, using your sandbox client id and secret.
2. Put it in your assistant's config (`~/.claude/settings.json` env block for Claude Code, `~/.codex/config.toml` for Codex, the plugin Configure panel for Cursor), not in `~/.zshrc`. Keep it on a single line.
3. Fully quit and reopen the assistant, then run `/paypal:setup`.
4. It expires in up to 8 hours. Run `/paypal:setup refresh` on a 401.

Never commit this token or paste it into issues or chat.

## 1. Clone and install
```bash
git clone https://gitlab.com/gitlab-ai-hackathon/paylock.git
cd paylock
npm install
```

## 2. Environment
Copy and fill:
```bash
cp .env.example .env
```

```env
# Database
DATABASE_URL=postgresql://paylock:paylock@localhost:5432/paylock

# PayPal (sandbox)
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_PLATFORM_EMAIL=            # sandbox business email receiving captures

# LLM
LLM_PROVIDER=openai               # openai | anthropic
LLM_API_KEY=
LLM_MODEL=                        # e.g. a current tool-calling model

# App
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
SESSION_SECRET=change-me
PAYLOCK_FREEZE=0
```

## 3. Database
```bash
docker compose up -d postgres
npx prisma migrate dev
npm run seed            # creates demo users and personas
```

## 4. PayPal sandbox setup (app)
The app does **not** use the assistant token. It requests its own:

```ts
// apps/api/src/paypal/token.ts (sketch)
// POST {base}/v1/oauth2/token, Basic auth(clientId:secret), grant_type=client_credentials
// cache access_token; refresh when now > issuedAt + expires_in - 60s
```

Use `/paypal:sandbox` and `/paypal:test-accounts` for accounts, test cards, and webhook testing guidance. Then follow steps 1 to 5 as already documented (app, two personal accounts, Payouts enabled, webhook events, webhook id).

## Day 1 verification checklist (blocks all later work)
- [ ] Toolkit installed; `/paypal:setup` passes
- [ ] Ask the assistant: "List the PayPal MCP tools." Save the output to `docs/mcp-tools.txt`
- [ ] Mark in SKILLS.md which of `mcp_get_disputes` and `mcp_list_transactions` exist; delete the rows that don't
- [ ] Script: create order (AUTHORIZE), approve, authorize, capture
- [ ] Script: void an authorization
- [ ] Script: Payouts to the seller sandbox account
- [ ] Record the authorization honor period and sandbox behavior in ARCHITECTURE.md (ADR-001)
- [ ] Webhook received and signature verified from the raw body
- [ ] Use `/paypal:explain-error <code>` on every failure and note the fix in `docs/pitfalls.md`
- [ ] Confirm which JS SDK version the toolkit hook recommends (v5 or v6) for the buyer approval button

## 5. Run locally
```bash
npm run dev          # starts API on :4000 and web on :3000
ngrok http 4000      # in another terminal; update PayPal webhook URL
```
Open http://localhost:3000?demo=1.

## 6. Tests
```bash
npm run lint
npm run typecheck
npm test             # unit tests: state machine, policy engine, payment math
npm run eval         # agent fixtures (requires LLM key)
npm run e2e          # Playwright: happy, scam, failure paths against local stack
```

## 7. Demo walkthrough (local or hosted)
1. Sign in as Buyer (demo login).
2. Create deal with persona "Honest Seller". Confirm contract. Risk LOW. Lock funds with sandbox buyer login.
3. Switch to Seller tab. Submit deliverable URL `https://example.com/demo-pass`. Watch Verifier pass and payout land.
4. Create deal with persona "Fresh Account Scammer". Observe HIGH risk and block.
5. Create deal with "Honest Seller", submit `fixtures/deliverables/bad.md`. Observe FAIL and void.

## 8. Deploy to Render
1. Create Postgres instance; copy `DATABASE_URL`.
2. Create Web Service from repo, root `apps/api`, build `npm ci && npx prisma migrate deploy && npm run build`, start `npm start`. Health check `/healthz`.
3. Create Web Service for `apps/web` (Next.js), set `API_URL`.
4. Set all env vars. Set PayPal webhook URL to the API host.
5. Run `npm run seed` once via Render shell.

## 9. Troubleshooting
- **Webhook signature fails**: wrong `PAYPAL_WEBHOOK_ID` or body parsed before verification. Ensure raw body is used.
- **Authorization expired**: sandbox honor period passed; create a new deal.
- **Payout pending**: sandbox payouts can take a minute; UI shows "Confirming with PayPal".
- **Agent schema errors**: check `LLM_MODEL` supports JSON mode / tool calling; see logs for raw output.

## 10. Repository layout
```
apps/
  api/        Fastify API, agents, PayPal adapter, Prisma
  web/        Next.js UI
packages/
  schemas/    Zod schemas shared by API and web
  skills/     Tool implementations
fixtures/     Eval cases, personas, sample deliverables
scripts/      seed, void-all, paypal smoke tests
docs/         This documentation
```

