# Paylock: Workflows

## 1. Deal lifecycle (happy path)

```
Buyer                 Paylock                         PayPal                 Seller
  |-- describe job ---->|                                |                      |
  |                     |-- Negotiator -> Contract        |                      |
  |<-- review/edit -----|                                |                      |
  |-- confirm --------->|                                |                      |
  |                     |-- Guardian -> Risk LOW          |                      |
  |                     |-- Policy: allow (PolicyDecision)|                      |
  |                     |-- create order (AUTHORIZE) ---->|                      |
  |<-- v6 PayPal session|                                |                      |
  |-- approve in PayPal popup ------------------------->|                      |
  |-- onApprove: POST /deals/:id/authorize ->|           |                      |
  |                     |-- GET order (verify amount,     |                      |
  |                     |   currency, custom_id) -------->|                      |
  |                     |-- authorize ------------------>|                      |
  |                     |<-- authorization CREATED ------|                      |
  |                     |   state LOCKED (sync, ADR-009)  |------ notify ------->|
  |                     |<-- webhooks ORDER.APPROVED,     |                      |
  |                     |    AUTHORIZATION.CREATED        |                      |
  |                     |    (append "PayPal confirmed")  |                      |
  |                     |                                |                      |
  |                     |<--------------------------- submit deliverable -------|
  |                     |-- Verifier -> PASS (Decision)   |                      |
  |                     |-- capture, final_capture=true ->|                      |
  |                     |-- payout --------------------->|------ funds -------->|
  |                     |<-- poll batch / PAYOUTS-ITEM.SUCCEEDED                 |
  |                     |<-- CAPTURE.COMPLETED (confirm)  |                      |
  |<-- RELEASED --------|   state RELEASED               |<--- RELEASED --------|
```

## 2. Scam path

1. Buyer creates deal with "Fresh Account Scammer" persona.
2. Guardian: NEW_ACCOUNT +25, PAYOUT_EMAIL_CHANGED_RECENTLY +25, ZERO_HISTORY +10, OFF_PLATFORM_REQUEST +22 -> 82 HIGH.
3. State FLAGGED. UI shows red risk banner with the signals and a "Do not fund" recommendation.
4. Buyer may cancel (recommended) or override with reason (logged; release then needs human approval).
5. No PayPal order is created unless overridden and approved.

## 3. Failure path

1. Deal LOCKED. Seller submits deliverable missing two of four criteria.
2. Verifier: score 45 < partialPayMin 70 -> FAIL.
3. Settlement voids authorization. State VOIDED. UI says "funds returned".
4. Buyer sees per-criterion results. Seller sees what failed and can start a new deal.

## 4. Human review path

1. Verifier returns `needsHumanReview=true` (low confidence or human criterion), or the deal was overridden from HIGH risk.
2. State NEEDS_REVIEW. Buyer gets decision draft with evidence.
3. Buyer approves (release) or rejects (void). Action logged with actor HUMAN.

## 5. Exception paths

- **Authorization declined** (`INSTRUMENT_DECLINED`, `TRANSACTION_REFUSED`, or status DENIED): FUNDING -> CANCELLED; the timeline shows the PayPal reason. No retry with the same instrument.
- **Order mismatch** (amount, currency or `custom_id` differs, or the order is not APPROVED): any authorization created is voided; FUNDING -> CANCELLED with `ORDER_MISMATCH` and a timeline alert.
- **Daily cap exceeded at authorize**: the new authorization is voided; FUNDING -> CANCELLED with `POLICY_CAP`.
- **Reservation expired**: authorization `expiration_time` passes while LOCKED (or while delivery, verification or review is still open) -> VOIDED with `AUTH_EXPIRED`; the timeline says "reservation expired".
- **Settlement error**: capture, payout or void fails after retries -> SETTLEMENT_ERROR with a timeline alert. The buyer retries; the retry resumes only the failed step (a payout re-send uses a new `sender_batch_id` and the same `sender_item_id = dealId`, and only after a terminal failure). If a payout cannot succeed after capture, the runbook in SECURITY_PRIVACY section 4 applies (refund is P2).

## 6. Agent-to-agent path (P1)

1. Buyer Agent receives goal and SpendPolicy.
2. Calls `POST /deals` with generated request; Seller Agent counters via `POST /deals/:id/counter`.
3. Negotiator reconciles; Guardian runs; policy allows if LOW and under threshold.
4. Buyer approval of the PayPal order happens through the v6 flow in a browser, or the demo path is scripted. The Buyer Agent never calls the MCP `pay_order` tool; MCP stays read-only.
5. Seller Agent delivers fixture; Verifier passes; Settlement releases.

## 7. Engineering workflow

- **Branching**: trunk-based. `main` is always deployable. Short-lived branches `feat/*`, `fix/*`.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- **MRs**: one per phase at minimum, CI green, link to issue. Squash merge.
- **CI** (`.github/workflows/ci.yml`, GitHub Actions): lint, typecheck, unit and DB tests against a Postgres 16 service, build, and gitleaks secret scanning on every push and pull request to `main`. The agent eval job (replay fixtures) runs on manual dispatch.
- **Deploy**: Render auto-deploys `main`. Preview environments optional.
- **Issues**: labels `P0`, `P1`, `P2`, `area::agents`, `area::paypal`, `area::ui`, `area::docs`.
- **Definition of done**: tests pass, docs updated, demo path re-verified if touched.

## 8. Release checklist (pre-submission)

- [ ] `npm run eval` 10/10 schema-valid
- [ ] Happy, scam, failure paths run on hosted URL
- [ ] Webhooks confirmed in PayPal dashboard
- [ ] README fresh-clone test passed
- [ ] LICENSE visible in About
- [ ] Render Postgres plan confirmed for the judging period (paid, or re-create procedure ready)
- [ ] Video uploaded, public, under 3 minutes
- [ ] Devpost form complete
