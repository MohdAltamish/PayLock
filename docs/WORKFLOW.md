# Paylock: Workflows

## 1. Deal lifecycle (happy path)

```
Buyer                 Paylock                         PayPal                 Seller
  |-- describe job ---->|                                |                      |
  |                     |-- Negotiator -> Contract        |                      |
  |<-- review/edit -----|                                |                      |
  |-- confirm --------->|                                |                      |
  |                     |-- Guardian -> Risk LOW          |                      |
  |                     |-- Policy: allow                 |                      |
  |                     |-- create order (AUTHORIZE) ---->|                      |
  |<-- approve link ----|                                |                      |
  |-- approve on PayPal ------------------------------->|                      |
  |                     |<-- webhook ORDER.APPROVED -----|                      |
  |                     |-- authorize ------------------>|                      |
  |                     |<-- AUTHORIZATION.CREATED ------|                      |
  |                     |   state LOCKED                 |------ notify ------->|
  |                     |                                |                      |
  |                     |<--------------------------- submit deliverable -------|
  |                     |-- Verifier -> PASS              |                      |
  |                     |-- capture ------------------->|                      |
  |                     |-- payout -------------------->|------ funds -------->|
  |                     |<-- CAPTURE.COMPLETED ----------|                      |
  |                     |<-- PAYOUTS-ITEM.SUCCEEDED -----|                      |
  |<-- RELEASED --------|   state RELEASED               |<--- RELEASED --------|
```

## 2. Scam path

1. Buyer creates deal with "Fresh Account Scammer" persona.
2. Guardian: NEW_ACCOUNT +25, PAYOUT_EMAIL_CHANGED_RECENTLY +25, OFF_PLATFORM_REQUEST +22 -> 72 HIGH.
3. State FLAGGED. UI shows red risk banner with three reasons and "Do not fund" recommendation.
4. Buyer may cancel (recommended) or override with reason (logged, autonomous release disabled).
5. No PayPal order is created unless overridden and approved.

## 3. Failure path

1. Deal LOCKED. Seller submits deliverable missing two of four criteria.
2. Verifier: score 45 < partialPayMin 70 -> FAIL.
3. Settlement voids authorization. State VOIDED.
4. Buyer sees per-criterion results. Seller sees what failed and can start a new deal.

## 4. Human review path

1. Verifier returns `needsHumanReview=true` (low confidence or human criterion).
2. State NEEDS_REVIEW. Buyer gets decision draft with evidence.
3. Buyer approves (release) or rejects (void). Action logged with actor HUMAN.

## 5. Agent-to-agent path (P1)

1. Buyer Agent receives goal and SpendPolicy.
2. Calls `POST /deals` with generated request; Seller Agent counters via `POST /deals/:id/counter`.
3. Negotiator reconciles; Guardian runs; policy allows if LOW and under threshold.
4. Buyer Agent approves PayPal order using sandbox buyer credentials via PayPal MCP (demo only).
5. Seller Agent delivers fixture; Verifier passes; Settlement releases. No human touches the flow.

## 6. Engineering workflow

- **Branching**: trunk-based. `main` is always deployable. Short-lived branches `feat/*`, `fix/*`.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- **MRs**: one reviewer minimum, CI green, link to issue. Squash merge.
- **CI** (`.gitlab-ci.yml`): lint, typecheck, unit tests, agent eval fixtures, Prisma migrate check, build.
- **Deploy**: Render auto-deploys `main`. Preview environments optional.
- **Issues**: labels `P0`, `P1`, `P2`, `area::agents`, `area::paypal`, `area::ui`, `area::docs`.
- **Definition of done**: tests pass, docs updated, demo path re-verified if touched.

## 7. Release checklist (pre-submission)

- [ ] `npm run eval` 10/10 schema-valid
- [ ] Happy, scam, failure paths run on hosted URL
- [ ] Webhooks confirmed in PayPal dashboard
- [ ] README fresh-clone test passed
- [ ] LICENSE visible in About
- [ ] Video uploaded, public, under 3 minutes
- [ ] Devpost form complete

