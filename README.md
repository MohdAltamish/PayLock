# Paylock

**AI escrow that pays on proof.**

Paylock is an AI escrow agent built on the PayPal developer platform. It locks a buyer's funds, verifies delivered work against agreed acceptance criteria, flags scam signals before any money moves, and releases PayPal payouts the moment the work passes.

Built for the PayPal AI Hackathon 2026.

## Why

Freelancers get stiffed. Buyers get scammed. Payments and trust live in different systems, so the money moves before anyone knows whether the deal is real. Paylock puts an AI agent between the agreement and the payment.

## What it does

1. **Negotiate**: buyer and seller (humans or agents) agree on scope, price, and acceptance criteria. The Negotiator agent turns that into a structured contract.
2. **Guard**: the Trust Guardian scores counterparty and message risk and warns the buyer before funds are locked.
3. **Lock**: funds are authorized via PayPal Orders v2 and held.
4. **Verify**: the Verifier agent checks the delivered work against each criterion and explains its decision.
5. **Release**: on pass, deterministic settlement code (not an LLM) captures the authorization and pays the seller via PayPal Payouts. On fail, it voids the authorization. Partial passes capture a proportional amount once and PayPal releases the rest. Agents recommend; the platform enforces policy and moves money.
6. **Audit**: every agent decision, warning, override, and payment is logged and visible on the deal timeline.

## Stack

- Next.js 14 (App Router, TypeScript) frontend
- Node.js 20 + Fastify API
- PostgreSQL 16 + Prisma
- PayPal Orders v2 and Payments v2 (authorize, capture, void), Payouts v1, Webhooks v1, JS SDK v6 (sandbox)
- PayPal MCP server, read-only, for reconciliation (if confirmed in `docs/mcp-tools.txt`)
- LLM with tool calling (OpenAI-compatible or Anthropic SDK, configurable)
- Render (hosting)

## Built with the PayPal AI Toolkit
Development used the [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit) (Apache-2.0) for best-practices guidance. The toolkit is referenced, not vendored; no toolkit files are copied into this repo.

**Toolkit commands used during development:**
- `/paypal:doctor` — validated the PayPal adapter against best practices
- `/paypal:doctor security` — security review of token handling, webhook verification, and secrets management

The hosted demo runs all agents from **recorded fixtures** (no live LLM calls). Each agent decision was recorded during development and replayed on demand, so the demo is stable, deterministic, and costs nothing to run.

## Quick start

See [docs/INSTRUCTIONS.md](docs/INSTRUCTIONS.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [PRD](docs/PRD.md) | Product requirements |
| [Project Workplan](docs/WORKPLAN.md) | 7-day plan, milestones, owners |
| [Architecture](docs/ARCHITECTURE.md) | System architecture and decisions |
| [Design](docs/DESIGN.md) | Technical design: data model, state machine, APIs |
| [AI Agents](docs/AI_AGENTS.md) | Agent roles, prompts, outputs, guardrails |
| [Skills](docs/SKILLS.md) | Agent tool catalog |
| [Workflow](docs/WORKFLOW.md) | Deal lifecycle and engineering workflow |
| [UI/UX](docs/UI_UX.md) | Screens, states, design system |
| [Security & Privacy](docs/SECURITY_PRIVACY.md) | Threat model, controls, data handling |
| [Instructions](docs/INSTRUCTIONS.md) | Setup, run, test, deploy |
| [Build Plan](docs/BUILD_PLAN.md) | Approved build plan, decisions, cut list |
| [PayPal pitfalls](docs/pitfalls.md) | Every PayPal error hit during the build and its fix |
| [Demo Script](docs/DEMO_SCRIPT.md) | 3-minute video plan |

## License

MIT. See [LICENSE](LICENSE).

