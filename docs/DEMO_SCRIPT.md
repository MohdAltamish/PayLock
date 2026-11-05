# Paylock: Demo Video Script (target 2:50)

Record at 1080p, screen plus webcam bubble optional, no music or royalty-free only. Pre-seed data. Rehearse twice.

| Time | Scene | On screen | Voiceover |
|------|-------|-----------|-----------|
| 0:00-0:15 | Hook | Title card, then a chat screenshot of a freelancer asking "Did you send the payment?" | "Every day, freelancers finish work and never get paid. And buyers pay deposits to people who vanish. Payments are trust-blind. Paylock fixes that." |
| 0:15-0:30 | What it is | Landing page, three-step strip | "Paylock is an AI escrow agent on PayPal. It locks funds, verifies the work, flags risk before you pay, and releases money on proof." |
| 0:30-1:20 | Happy path | Create deal wizard: type request, show Negotiator contract, Risk LOW banner, PayPal sandbox approval, LOCKED badge. Switch to seller, submit URL, Verifier per-criterion ticks, RELEASED, payout batch id | "I describe the job. The Negotiator turns it into testable criteria. The Trust Guardian checks the seller: low risk. I reserve funds with PayPal. The seller delivers. The Verifier checks every criterion with evidence, and PayPal pays out instantly." |
| 1:20-1:55 | Scam path | New deal with Fresh Account Scammer, HIGH risk banner expands to show three signals, "Do not fund" | "Now a different seller. Two-day-old account, payout email changed ten minutes ago, and a message asking to pay outside the platform. Paylock blocks funding and tells me exactly why. Not a vibe, evidence." |
| 1:55-2:20 | Failure path | Submit bad deliverable, FAIL with two unmet criteria, VOIDED, "funds returned" | "And when work doesn't meet the bar, the authorization is voided. The buyer keeps their money, the seller sees exactly what failed." |
| 2:20-2:40 | Architecture and guardrails | Architecture diagram, audit log, PII redaction slide | "Under the hood: PayPal Orders, Payouts, and Webhooks, the PayPal Agent Toolkit, and three AI agents with structured outputs. Agents decide, the platform enforces: spend caps, approval thresholds, a full audit log, and PII redaction before any model call." |
| 2:40-2:50 | Close | Logo, repo URL, hosted URL | "Paylock. AI escrow that pays on proof. Built for the PayPal AI Hackathon." |

## Devpost "Tools used" paragraph
PayPal Orders v2 (authorize/capture/void), PayPal Payouts v1, PayPal Webhooks, PayPal Agent Toolkit (MCP) for agent-side reconciliation, [LLM provider and model] for the Negotiator, Trust Guardian, and Verifier agents with JSON-schema structured outputs, Next.js, Fastify, PostgreSQL/Prisma, Render for hosting.

