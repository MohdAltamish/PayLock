# Paylock: Project Overview

**One line:** Paylock is an AI escrow agent built on PayPal. It holds the buyer's money, checks the seller before anyone pays, verifies the work when it's delivered, and releases the payment only when the work is proven.

**Tagline:** AI escrow that pays on proof.

---

## 1. The problem, in plain words

When someone pays for work online, one side always has to trust the other first.

- If the **buyer pays first**, they hope the seller actually delivers. Many don't. Fake freelancers take deposits and disappear.
- If the **seller works first**, they hope the buyer actually pays. Many don't. Freelancers finish the job, send the invoice, and get ghosted.

Both sides lose time and money, and both sides are afraid to work with people they don't already know. This problem is getting bigger for three reasons:

1. **More people work freelance and remote**, often across borders where chasing payment is nearly impossible.
2. **Scams are getting smarter.** Scammers use urgency, fake accounts, "pay a small release fee first", and "let's finish this outside the platform" tricks that catch even careful people.
3. **AI agents are starting to spend money.** Soon your assistant will hire a designer or buy a service for you. An agent with a wallet and no judgment is a scammer's dream.

Existing escrow services are slow, expensive, and built for big deals like real estate or cars. Nobody uses escrow for a $200 logo. So most everyday work is paid on trust alone.

> Insert one sourced statistic here for the pitch, for example the latest FTC Consumer Sentinel report on payment-fraud losses, or a freelancer survey on late and non-payment. Cite the source in the video.

## 2. The solution, in plain words

Paylock puts a smart middleman between the agreement and the payment. Think of it as an escrow officer who works in seconds, costs almost nothing, and never gets tired.

Here's how a deal works:

1. **Describe the job.** The buyer types what they need in normal language. Paylock's Negotiator agent turns it into a clear contract with a checklist of what "done" means.
2. **Check the seller.** Before any money moves, the Trust Guardian agent looks at risk signals: a brand-new account, a payout email that just changed, messages asking to pay outside the platform, and so on. It gives a risk level and explains why.
3. **Lock the funds.** If risk is low, the buyer approves the payment with PayPal. The money is reserved but not sent. The seller can see it's locked, so they know they'll be paid.
4. **Deliver the work.** The seller submits the result: a link, a file, a repo, or text.
5. **Verify.** The Verifier agent checks the work against the checklist, item by item, and shows its evidence.
6. **Release or return.** If the work passes, PayPal captures the payment and pays the seller instantly. If it fails, the reservation is cancelled and the buyer keeps their money. If it partly passes, the seller gets a proportional amount.
7. **Everything is logged.** Both sides see a full timeline of every step, every AI decision, and every payment event.

The human stays in control. Medium-risk deals need a tap to approve. High-risk deals are blocked unless the buyer overrides with a reason. Spend limits are set by the buyer and enforced by the platform, not the AI.

## 3. Who it's for

| Audience | Their pain | What Paylock gives them |
|----------|-----------|------------------------|
| **Freelancers and gig workers** | Doing the work and not getting paid; chasing invoices | Money is locked before they start; paid instantly when the work passes |
| **Small businesses and individuals buying services** | Paying deposits to people who vanish; no way to judge a stranger | Risk check before paying; pay only for work that meets the checklist |
| **Marketplaces and platforms** | Disputes, chargebacks, and trust problems between their users | A drop-in escrow and verification layer |
| **AI agents (and the people who own them)** | Need to buy services autonomously without getting scammed or overspending | Structured contracts, spend caps, risk gating, and verifiable release |

First focus: freelancers and small buyers doing deals between $50 and $2,000, where traditional escrow is too expensive and too slow.

## 4. What exists today and why it falls short

| Existing approach | How it works | Where it falls short |
|-------------------|--------------|----------------------|
| **Paying on trust (most deals today)** | Buyer pays up front or seller invoices after | No protection for either side; this is the problem |
| **Traditional escrow services** (e.g., Escrow.com) | A licensed third party holds funds; humans verify and release | Built for large purchases; fees and multi-day timelines make no sense for small jobs; verification is manual |
| **Freelance marketplaces** (e.g., Upwork, Fiverr) | Platform holds funds and releases on approval | Only works inside their marketplace; high platform fees (often 10 to 20 percent); approval is a manual button, disputes are slow; no proactive scam screening |
| **Payment processor buyer or seller protection** (e.g., PayPal Purchase Protection) | After-the-fact dispute resolution | Reactive, not preventive; you find out after the money is gone; services and digital work are harder to prove |
| **Invoicing tools** | Send invoice, wait for payment | Zero enforcement; the invoice is a request, not a guarantee |
| **Crypto smart-contract escrow** | Code holds funds and releases on a condition | Hard for normal people; "condition" is usually a simple flag, not real verification of work; volatility and regulation issues |
| **Emerging agentic payment tools** (e.g., PayPal Agent Toolkit, Stripe Agent Toolkit, card networks' agent initiatives) | Let AI agents call payment APIs | They give agents the ability to pay, not the judgment of whether they should. Nobody is doing verification and risk screening for agent deals |

Verify current names, fees, and features before putting them in the video.

## 5. Competitive analysis

| Capability | Paylock | Escrow.com | Upwork / Fiverr | PayPal Protection | Crypto escrow | Agent payment toolkits |
|------------|---------|-----------|-----------------|-------------------|---------------|------------------------|
| Holds funds before work | Yes | Yes | Yes (inside marketplace) | No | Yes | No |
| Checks counterparty risk before paying | Yes, AI plus rules | Manual KYC | Ratings only | No | No | No |
| Verifies the actual work | Yes, AI with evidence | Manual | Manual button | Dispute only | Flag only | No |
| Instant payout on pass | Yes | Days | Days (hold periods) | N/A | Yes | N/A |
| Works outside a marketplace | Yes | Yes | No | Yes | Yes | Yes |
| Built for AI agents | Yes | No | No | No | Partly | Yes, but no judgment |
| Fee for a $300 job | Low (see model) | Relatively high minimum | 10 to 20 percent | Free but reactive | Gas fees, volatile | N/A |
| Explains its decisions | Yes | No | No | No | No | No |

**Where competitors are strong:** Escrow.com has licenses and legal standing. Marketplaces have liquidity (lots of buyers and sellers). PayPal has reach and trust. Paylock doesn't try to replace these. It builds on PayPal's rails and can plug into marketplaces later.

## 6. Unique selling proposition (USP)

**Paylock is the only payment flow where an AI checks the person before you pay and checks the work before they're paid, with the money held safely by PayPal in between.**

Broken down:

1. **Prevention, not just protection.** Everyone else helps after you've been scammed. Paylock warns you before.
2. **Proof-based release.** Payment is tied to a checklist that was agreed up front and verified with evidence, not a vague "are you happy?" button.
3. **Explainable.** Every risk flag and every verification result shows its reasons. No black box.
4. **Built for agents, safe for humans.** The same guardrails that stop a scammer also stop an AI agent from overspending or paying the wrong person.
5. **Small-deal friendly.** Fast and cheap enough for a $100 job.

## 7. How the AI is used (simple version)

Paylock uses three AI agents plus plain code for the money part:

- **Negotiator:** reads your request and writes a clear contract with a testable checklist.
- **Trust Guardian:** combines hard facts (account age, payout email changes, deal velocity, dispute history) with language analysis of messages (urgency pressure, off-platform requests, upfront fee asks) to produce a risk score with reasons.
- **Verifier:** checks each checklist item against the delivered work. For technical items it runs real checks (does the site load, do the tests pass). For judgment items it reads the work and cites evidence.
- **Settlement (not AI):** plain, tested code that talks to PayPal to capture, void, or pay out. The AI never touches money directly.

Privacy: personal details like names and emails are masked before anything is sent to the AI model. PayPal handles all card and bank data, so Paylock never stores it.

## 8. Business model

**Phase 1: Transaction fee (core)**
- A small percentage per completed deal, charged to the buyer, seller, or split, with a low minimum. Positioned well below marketplace fees and traditional escrow minimums.
- Example target: around 2 to 3 percent with a floor of $1 to $2 (validate against PayPal fees and margins).
- Only charged on released deals, so Paylock makes money only when both sides got what they wanted.

**Phase 2: Pro plans for power users**
- Freelancers and small agencies: branded deal pages, templates for common jobs, faster payouts, multi-currency.
- Buyers running many deals: team controls, higher automation limits, reporting.

**Phase 3: Platform and API**
- Marketplaces, agencies, and AI agent frameworks embed Paylock as their escrow and verification layer.
- Priced per transaction plus a platform fee; this is the biggest long-term opportunity as agent-to-agent commerce grows.

**Phase 4: Trust data**
- Aggregated, privacy-preserving risk signals offered as an API to partners. Must be done carefully and transparently.

**Why PayPal as the foundation:** hundreds of millions of existing accounts, buyers already trust the button, Payouts handle instant seller payments, and the PayPal Agent Toolkit and MCP server make it the natural rail for agentic commerce.

## 9. Market and opportunity (framing)

- The global freelance and gig economy is large and growing, with cross-border work rising fastest.
- Online payment fraud losses run into the billions of dollars every year and are increasing.
- Agentic commerce is a brand-new category: payment networks and processors are all shipping agent tooling, but the trust layer doesn't exist yet.

Paylock sits where these three trends meet. Insert two or three sourced numbers here for the pitch, and always cite the source.

## 10. Go-to-market (first steps)

1. **Freelancer communities first.** Designers, developers, writers who have been burned. They bring their clients to Paylock because it protects them.
2. **A "Paylock this deal" link.** A freelancer sends a link; the client funds it. No marketplace required.
3. **Templates for common jobs** (logo, landing page, blog post, data entry) so the contract step takes seconds.
4. **Agent integrations.** Publish Paylock as a tool for agent frameworks so autonomous buyers can use it by default.
5. **Marketplace partnerships** once the fraud-prevention results are proven.

## 11. Why now

- AI can finally read a contract, judge work, and spot social-engineering language reliably enough to be useful.
- PayPal's authorize-and-capture, Payouts, and Agent Toolkit give the exact building blocks needed.
- AI agents are about to start spending money at scale. The trust layer has to exist before that happens, not after.

## 12. Risks and honest limitations

| Risk | How we handle it |
|------|------------------|
| **PayPal authorizations have a limited hold period.** | Deals are time-boxed; longer jobs use milestones with separate authorizations. |
| **The AI could misjudge work.** | Confidence gates send uncertain cases to the human buyer; every decision is explainable and overridable. |
| **Risk flags could be wrong or unfair.** | Signals are behavior-based only (never demographic); we describe signals, never label people; humans can always override. |
| **Regulation.** Holding funds can trigger money-transmitter rules. | Paylock never holds money. PayPal holds the authorization; Paylock only decides when to capture or void. Legal review still required before launch. |
| **Chicken-and-egg adoption.** | Start with freelancers who have a direct incentive and bring their own clients. |
| **Hackathon scope.** | Sandbox only; no real money; a working prototype, not a licensed product. |

## 13. Roadmap after the hackathon

- **0 to 3 months:** Milestone-based deals, dispute evidence export, mobile-friendly deal pages, first real users in a closed beta.
- **3 to 6 months:** Templates marketplace, multi-currency, trust profiles, embeddable "Paylock this" button.
- **6 to 12 months:** Public API and SDK, agent framework integrations, marketplace pilot, compliance and legal structure for production money movement.

## 14. Elevator pitch (30 seconds)

"Every day, freelancers finish work and don't get paid, and buyers pay deposits to people who disappear. Paylock fixes both. It's an AI escrow agent on PayPal: it checks the seller for scam signals before you pay, locks your money, verifies the delivered work against a checklist, and pays out instantly when it passes. If the work fails, you get your money back. And because the same guardrails work for AI agents, Paylock is the trust layer for the next wave of agent-to-agent commerce."

## 15. Frequently asked questions

**Is Paylock a bank or escrow company?**
No. PayPal holds the authorization. Paylock decides when to capture or cancel it based on agreed rules and verified work.

**What if I disagree with the AI's decision?**
You can override it. Overrides are logged and shown on the timeline so both sides see what happened.

**Does the AI see my personal information?**
Personal details are masked before anything is sent to the model. Payment details never leave PayPal.

**Can a scammer trick the AI by writing clever messages?**
The Guardian treats all messages as data, not instructions, and combines language analysis with hard facts like account age and payout changes that are difficult to fake. It isn't perfect, which is why humans approve medium-risk deals and can block anything.

**What happens if the seller never delivers?**
When the deadline passes, the authorization is cancelled and the buyer's money is returned automatically.

**Why PayPal instead of building our own payments?**
Reach, trust, Payouts for instant seller payments, and PayPal's agent tooling. Building payments from scratch would take years and licenses.

## 16. Glossary

- **Authorize:** reserving money on the buyer's PayPal account without taking it yet.
- **Capture:** actually taking the reserved money.
- **Void:** cancelling the reservation so the buyer keeps their money.
- **Payout:** PayPal sending money to the seller's account.
- **Acceptance criteria:** the checklist that defines when the work is "done".
- **Risk signal:** a fact or pattern that suggests higher fraud risk, such as a brand-new account.
- **Agentic commerce:** AI agents buying and selling on behalf of people or other agents.
