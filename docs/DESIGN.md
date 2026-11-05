# Paylock: Technical Design

Currency: **USD only** for the demo. All money is a Decimal string (`^\d{1,10}\.\d{2}$`) in APIs and agent outputs, and `Decimal(12,2)` in the database. Never floats.

## 1. Domain model

```
User 1---* Deal *---1 User            (buyer, seller)
Deal 1---1 Contract
Deal 1---* RiskAssessment
Deal 1---* Message
Deal 1---* Deliverable
Deal 1---* Decision
Deal 1---* PolicyDecision
Deal 1---* PaymentRecord
Deal 1---* DealEvent
User 1---1 SpendPolicy
User 1---1 TrustProfile
User 1---* ApiKey
User 1---* Report (as reporter and as subject)
WebhookEvent (standalone, dedup by PayPal event id)
AuditLog (append-only)
```

## 2. Prisma schema (core)

```prisma
enum DealState {
  DRAFT
  CONTRACTED
  GUARDED
  FLAGGED
  AWAITING_APPROVAL
  FUNDING
  LOCKED
  DELIVERED
  VERIFYING
  NEEDS_REVIEW
  RELEASING
  RELEASED
  RELEASED_PARTIAL
  SETTLEMENT_ERROR
  VOIDED
  CANCELLED
}

enum RiskLevel { LOW MEDIUM HIGH }
enum DecisionOutcome { PASS PARTIAL FAIL }
enum Actor { HUMAN AGENT PAYPAL SYSTEM }
enum PolicyResult { ALLOW REQUIRE_APPROVAL BLOCK }
enum PaymentKind { ORDER AUTHORIZE CAPTURE VOID PAYOUT REFUND }
enum PaymentStatus { PENDING SUCCEEDED FAILED }

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  displayName   String
  paypalEmail   String?
  isAgent       Boolean  @default(false)
  isDemo        Boolean  @default(false)
  createdAt     DateTime @default(now())
  spendPolicy   SpendPolicy?
  trustProfile  TrustProfile?
  apiKeys       ApiKey[]
  dealsAsBuyer  Deal[]   @relation("buyer")
  dealsAsSeller Deal[]   @relation("seller")
  reportsMade   Report[] @relation("reporter")
  reportsAbout  Report[] @relation("subject")
}

model ApiKey {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  keyHash   String    @unique          // sha256 of the key; the key itself is shown once
  scopes    String[]                   // deals:write, deliverables:write
  createdAt DateTime  @default(now())
  revokedAt DateTime?
}

model SpendPolicy {
  id                 String  @id @default(cuid())
  userId             String  @unique
  user               User    @relation(fields: [userId], references: [id])
  maxPerDeal         Decimal @db.Decimal(12,2)
  dailyCap           Decimal @db.Decimal(12,2)
  approvalThreshold  Decimal @db.Decimal(12,2)
  allowMediumRisk    Boolean @default(false)
  currency           String  @default("USD")
}

model TrustProfile {
  id                      String    @id @default(cuid())
  userId                  String    @unique
  user                    User      @relation(fields: [userId], references: [id])
  accountCreatedAt        DateTime  @default(now())   // re-based by demo:reset for personas
  completedDeals          Int       @default(0)
  failedDeals             Int       @default(0)
  disputes                Int       @default(0)
  reportsReceived         Int       @default(0)
  payoutEmailChanges      Int       @default(0)
  lastPayoutEmailChangeAt DateTime?
  paypalVerified          Boolean   @default(false)
  score                   Int       @default(50)      // 0-100, higher is more trusted
  updatedAt               DateTime  @updatedAt
}

model Deal {
  id                   String    @id @default(cuid())
  buyerId              String
  sellerId             String
  buyer                User      @relation("buyer", fields: [buyerId], references: [id])
  seller               User      @relation("seller", fields: [sellerId], references: [id])
  state                DealState @default(DRAFT)
  amount               Decimal   @db.Decimal(12,2)
  currency             String    @default("USD")
  payoutEmail          String?   // seller payout email snapshot at contract time
  paypalOrderId        String?   @unique
  paypalAuthId         String?   @unique
  authExpiresAt        DateTime? // from PayPal expiration_time
  requiresHumanRelease Boolean   @default(false)   // set by a HIGH-risk override
  blockReason          String?   // POLICY_CAP | ORDER_MISMATCH | AUTH_DECLINED | AUTH_EXPIRED | REFUNDED | ...
  isDemo               Boolean   @default(false)
  contract             Contract?
  risks                RiskAssessment[]
  messages             Message[]
  deliverables         Deliverable[]
  decisions            Decision[]
  policyDecisions      PolicyDecision[]
  payments             PaymentRecord[]
  events               DealEvent[]
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  @@index([buyerId, state])
}

model Contract {
  id             String    @id @default(cuid())
  dealId         String    @unique
  deal           Deal      @relation(fields: [dealId], references: [id])
  title          String
  scope          String
  criteria       Json      // AcceptanceCriterion[]
  deadline       DateTime? // capped to the authorization safe window (ADR-001)
  partialPayMin  Int       @default(70) // % score required for partial payout
  rawRequest     String
  modelMeta      Json
}

model Message {
  id        String   @id @default(cuid())
  dealId    String
  deal      Deal     @relation(fields: [dealId], references: [id])
  authorId  String
  body      String   // untrusted; fenced as <MESSAGE> in prompts
  createdAt DateTime @default(now())
  @@index([dealId, createdAt])
}

model RiskAssessment {
  id         String    @id @default(cuid())
  dealId     String
  deal       Deal      @relation(fields: [dealId], references: [id])
  score      Int       // 0-100 risk, higher is riskier
  level      RiskLevel
  signals    Json      // Signal[]
  summary    String
  action     String    // allow | require_approval | block
  fallback   Boolean   @default(false) // true when the LLM failed and rules-only scoring was used
  overridden Boolean   @default(false)
  createdAt  DateTime  @default(now())
}

model Deliverable {
  id        String   @id @default(cuid())
  dealId    String
  deal      Deal     @relation(fields: [dealId], references: [id])
  kind      String   // url | text | file | repo
  content   String   // URL, text body, or storage key
  note      String?
  createdAt DateTime @default(now())
}

model Decision {
  id               String          @id @default(cuid())
  dealId           String
  deal             Deal            @relation(fields: [dealId], references: [id])
  deliverableId    String
  outcome          DecisionOutcome
  score            Int             // 0-100
  perCriterion     Json            // CriterionResult[]
  reasoning        String
  payoutPercent    Int
  needsHumanReview Boolean         @default(false)
  overriddenBy     String?
  overrideReason   String?
  createdAt        DateTime        @default(now())
}

// Proof that the Policy Engine approved a money action. Invariant 1:
// every capture, payout and refund references one, written in the same
// transaction as the pending PaymentRecord and the state transition.
model PolicyDecision {
  id         String       @id @default(cuid())
  dealId     String
  deal       Deal         @relation(fields: [dealId], references: [id])
  action     String       // fund | authorize | capture | payout | void | refund | release
  result     PolicyResult
  reasons    Json         // string[]
  inputs     Json         // risk level, amount, caps, committedToday, freeze, override
  decisionId String?      // the verifier Decision this release is based on
  createdAt  DateTime     @default(now())
  payments   PaymentRecord[]
}

model PaymentRecord {
  id               String          @id @default(cuid())
  dealId           String
  deal             Deal            @relation(fields: [dealId], references: [id])
  kind             PaymentKind
  attempt          Int             @default(1)
  idempotencyKey   String          @unique   // sha256(dealId:action:attempt)
  policyDecisionId String?
  policyDecision   PolicyDecision? @relation(fields: [policyDecisionId], references: [id])
  paypalId         String?         @unique   // order, authorization, capture, payout batch, or refund id
  amount           Decimal?        @db.Decimal(12,2)
  status           PaymentStatus   @default(PENDING)
  paypalStatus     String?         // raw PayPal status (CREATED, COMPLETED, VOIDED, SUCCESS, ...)
  raw              Json?
  error            Json?           // { name, debugId, details }
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  @@index([dealId, kind])
  @@index([status])
}

model DealEvent {
  id        String     @id @default(cuid())
  dealId    String
  deal      Deal       @relation(fields: [dealId], references: [id])
  type      String
  fromState DealState?
  toState   DealState?
  actor     Actor
  payload   Json
  createdAt DateTime   @default(now())
  @@index([dealId, createdAt])
}

model Report {
  id         String   @id @default(cuid())
  reporterId String
  subjectId  String
  reporter   User     @relation("reporter", fields: [reporterId], references: [id])
  subject    User     @relation("subject", fields: [subjectId], references: [id])
  dealId     String?
  reason     String
  createdAt  DateTime @default(now())
}

model WebhookEvent {
  eventId      String    @id                 // PayPal event id; dedup key
  eventType    String
  resourceId   String?
  dealId       String?
  receivedAt   DateTime  @default(now())
  processedAt  DateTime?
  attempts     Int       @default(0)
  raw          Json                          // only verified events are stored
}

model AuditLog {
  id          String   @id @default(cuid())
  dealId      String?
  actor       Actor
  actorId     String?
  action      String
  before      Json?
  after       Json?
  payloadHash String   // sha256 of canonical JSON
  createdAt   DateTime @default(now())
  @@index([dealId])
}
```

## 3. State machine

```
DRAFT -> CONTRACTED              : contract.created (Negotiator)
DRAFT | CONTRACTED | GUARDED -> CANCELLED : buyer.cancel
CONTRACTED -> GUARDED            : risk.assessed, level LOW (or MEDIUM with allowMediumRisk), amount <= approvalThreshold, within caps
CONTRACTED -> AWAITING_APPROVAL  : risk.assessed, level MEDIUM (allowMediumRisk false) or amount > approvalThreshold
CONTRACTED -> FLAGGED            : risk.assessed, level HIGH; or policy block POLICY_CAP
FLAGGED -> AWAITING_APPROVAL     : buyer.override (reason required; sets requiresHumanRelease; not allowed when blockReason = POLICY_CAP)
FLAGGED -> CANCELLED             : buyer.cancel
AWAITING_APPROVAL -> GUARDED     : buyer.approve
AWAITING_APPROVAL -> CANCELLED   : buyer.reject
GUARDED -> FUNDING               : paypal.order.created (PolicyDecision fund = ALLOW in the same transaction)
FUNDING -> LOCKED                : paypal.authorization.created and verified (status CREATED, amount, currency, custom_id match)
FUNDING -> CANCELLED             : authorization declined (reason shown) | ORDER_MISMATCH | POLICY_CAP at authorize | funding timeout | buyer.cancel
LOCKED -> DELIVERED              : seller.deliverable.submitted
LOCKED -> VOIDED                 : deadline passed, no delivery -> paypal.void
LOCKED -> VOIDED                 : authorization expired (blockReason AUTH_EXPIRED; timeline "reservation expired")
DELIVERED -> VERIFYING           : verifier.started
VERIFYING -> RELEASING           : decision PASS | PARTIAL (>= partialPayMin), and requiresHumanRelease = false
VERIFYING -> NEEDS_REVIEW        : schema failure | low confidence | human criterion | requiresHumanRelease = true
VERIFYING -> VOIDED              : decision FAIL -> paypal.void succeeded
NEEDS_REVIEW -> RELEASING        : human.approve
NEEDS_REVIEW -> VOIDED           : human.reject -> paypal.void succeeded
RELEASING -> RELEASED            : capture COMPLETED + payout item SUCCESS (full)
RELEASING -> RELEASED_PARTIAL    : capture COMPLETED + payout item SUCCESS (partial)
RELEASING -> SETTLEMENT_ERROR    : capture or payout failed after retries
VERIFYING | NEEDS_REVIEW | LOCKED -> SETTLEMENT_ERROR : void failed after retries
SETTLEMENT_ERROR -> RELEASING    : human.retry (resumes the failed step: capture or payout)
SETTLEMENT_ERROR -> VOIDED       : human.retry of a failed void succeeded | refund COMPLETED (blockReason REFUNDED, P2)
```

Guards:
- `FUNDING` requires a `PolicyDecision(action=fund, result=ALLOW)` written in the same transaction.
- `LOCKED` requires the authorization to match the stored order (amount, currency, `custom_id = dealId`) and the daily cap to still hold (decision D).
- `RELEASING` requires a persisted Decision, `paypalAuthId` present, `authExpiresAt` in the future, and `PAYLOCK_FREEZE` off.
- Any transition writes a `DealEvent` and an `AuditLog` row atomically, under `SELECT ... FOR UPDATE` on the deal row.
- Webhooks never call `transition` directly. They append a "PayPal confirmed" event and wake the reconciler, which only applies forward transitions (section 10).

## 4. API (REST, JSON)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/demo-login` | Demo session (signed httpOnly cookie) for a seeded user |
| GET | `/config/paypal` | Browser-safe config: `{ clientId, env }` (decision K) |
| POST | `/deals` | Create from NL; runs Negotiator; returns deal with contract |
| POST | `/deals/:id/messages` | Add a message (untrusted text) |
| POST | `/deals/:id/guard` | Run Guardian; returns risk assessment and policy action |
| POST | `/deals/:id/approve` | Buyer approves MEDIUM risk or above-threshold deal |
| POST | `/deals/:id/override` | Buyer overrides HIGH risk; body: `{ reason }` |
| POST | `/deals/:id/cancel` | Buyer cancels (DRAFT, CONTRACTED, GUARDED, FLAGGED, AWAITING_APPROVAL, FUNDING) |
| POST | `/deals/:id/fund` | Create PayPal order (AUTHORIZE); idempotent; returns `{ orderId, approveUrl }` |
| POST | `/deals/:id/authorize` | Called from v6 `onApprove`. Ignores any client orderId; uses the stored `paypalOrderId`; verifies the order via GET, authorizes, verifies the authorization |
| POST | `/deals/:id/deliverables` | Seller submits deliverable; triggers Verifier |
| POST | `/deals/:id/decisions/:decisionId/override` | Human approve or reject of a verifier decision |
| POST | `/deals/:id/settlement/retry` | Buyer retries the failed settlement step from SETTLEMENT_ERROR |
| GET | `/deals/:id` | Deal with contract, latest risk, decisions, payments |
| GET | `/deals/:id/events` | SSE stream of DealEvents (`Last-Event-ID` replay, 15s heartbeat) |
| GET | `/deals` | List for current user |
| GET/PUT | `/users/:id/policy` | Read or update spend policy (owner only) |
| POST | `/users/:id/reports` | Report a counterparty |
| POST | `/webhooks/paypal` | PayPal webhook receiver (raw body) |
| GET | `/healthz` | Health: DB and PayPal token |
| POST | `/test/fund-with-card` | E2E only. Registered only when `PAYPAL_ENV=sandbox`, `E2E_FUNDING=card` and `NODE_ENV != production`; 404 otherwise |

Agent-to-agent (P1): same endpoints with `X-Agent-Key`. Agents may use PayPal MCP tools read-only for their own reconciliation; no MCP write tools.

Errors: RFC 7807 `application/problem+json`. Every response carries `x-request-id`.

## 5. Agent output schemas (Zod)

```ts
export const Money = z.string().regex(/^\d{1,10}\.\d{2}$/);   // Decimal string, never a float
export const Currency = z.literal("USD");

export const AcceptanceCriterion = z.object({
  id: z.string(),
  description: z.string(),
  weight: z.number().int().min(1).max(10),
  verifiable: z.enum(["automatic", "llm", "human"]),
});

export const ContractOut = z.object({
  title: z.string().max(120),
  scope: z.string(),
  price: Money,
  currency: Currency,
  deadline: z.string().datetime().nullable(),
  criteria: z.array(AcceptanceCriterion).min(1).max(10),
  partialPayMin: z.number().int().min(0).max(100).default(70),
  ambiguities: z.array(z.string()),
});

export const Signal = z.object({
  code: z.string(),           // e.g. NEW_ACCOUNT, OFF_PLATFORM_REQUEST
  weight: z.number(),         // contribution to score
  evidence: z.string(),       // redacted excerpt or metric
  source: z.enum(["rule", "llm"]),
});

export const RiskOut = z.object({
  score: z.number().int().min(0).max(100),
  level: z.enum(["LOW", "MEDIUM", "HIGH"]),
  signals: z.array(Signal),
  summary: z.string().max(400),
  recommendedAction: z.enum(["allow", "require_approval", "block"]),
});

export const CriterionResult = z.object({
  criterionId: z.string(),
  met: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});

export const DecisionOut = z.object({
  outcome: z.enum(["PASS", "PARTIAL", "FAIL"]),
  score: z.number().int().min(0).max(100),
  perCriterion: z.array(CriterionResult),
  reasoning: z.string().max(800),
  payoutPercent: z.number().int().min(0).max(100),
  needsHumanReview: z.boolean(),
});
```

## 6. Risk scoring rubric (Guardian)

Deterministic signals (sum, clamp 0-100):

| Code | Condition | Weight |
|------|-----------|--------|
| NEW_ACCOUNT | account age < 7 days | +25 |
| PAYOUT_EMAIL_CHANGED_RECENTLY | change < 24h before deal | +25 |
| PAYOUT_EMAIL_MISMATCH | payout email domain differs from contact | +15 |
| ZERO_HISTORY | completedDeals == 0 | +10 |
| HIGH_FAILURE_RATE | failed/(completed+failed) > 0.3 with n >= 3 | +20 |
| DISPUTES | disputes > 0 | +15 each, cap 30 |
| REPORTS | reportsReceived > 0 | +10 each, cap 30 |
| VELOCITY | > 5 deals created in 10 min | +20 |
| UNDER_THRESHOLD_SPLITTING | amount within 5% below approvalThreshold and > 2 such deals in 24h | +20 |
| PAYPAL_UNVERIFIED | seller `TrustProfile.paypalVerified` false at guard time; buyer `payment_source.paypal.account_status` UNVERIFIED after approval | +10 |
| ESTABLISHED | account > 90 days and completedDeals >= 10 and no disputes | -20 |

LLM signals (each +0 to +25 based on confidence):

| Code | Pattern |
|------|---------|
| OFF_PLATFORM_REQUEST | asks to pay or talk outside Paylock/PayPal |
| UPFRONT_FEE_REQUEST | asks for release fee, insurance, deposit before work |
| FRIENDS_FAMILY_REQUEST | asks for F&F or no-protection payment |
| URGENCY_PRESSURE | artificial deadlines, "now or never" |
| OVERPAYMENT_SCHEME | proposes overpay and refund |
| IDENTITY_MISMATCH | name, business, or location inconsistencies |
| TOO_GOOD_PRICING | price far below market for described scope |

Levels: 0-29 LOW, 30-59 MEDIUM, 60-100 HIGH.

Fallback (decision E): if the LLM fails schema validation twice, use deterministic signals only, mark them `source: rule`, set `fallback = true`, and if the deal has any messages raise the level to at least MEDIUM (nothing has read the message text, so a human approves).

Policy caps are not risk signals. Exceeding `maxPerDeal` or `dailyCap` is a policy block (`blockReason = POLICY_CAP`), which cannot be overridden. The daily cap counts deals in LOCKED, DELIVERED, VERIFYING, NEEDS_REVIEW, RELEASING, RELEASED, RELEASED_PARTIAL or SETTLEMENT_ERROR, created today (UTC), for the same buyer.

## 7. Payment math

- Full pass: capture `amount` with `final_capture: true` sent explicitly (the OpenAPI default is `false`). Payout `amount` (the captured gross). The platform absorbs PayPal's fee, recorded from `seller_receivable_breakdown` (decision G).
- Partial: `payoutPercent = clamp(score, partialPayMin, 100)` if score >= partialPayMin, else FAIL. Capture `round_down(amount * payoutPercent / 100, 2)` with `final_capture: true`. No void: a final capture releases the uncaptured remainder (confirm in sandbox, C6). Payout the captured amount.
- Fail: void the authorization.
- Refund (P2, after a failed payout): `POST /v2/payments/captures/{id}/refund` for the captured amount, gated by a `PolicyDecision(action=refund)`.
- Currency: USD only; `Decimal` everywhere; amounts round down to cents so we never capture more than authorized.

## 8. Idempotency and retries

- `PayPal-Request-Id = sha256(dealId:action:attempt)`, where `attempt` is a stored logical attempt on the `PaymentRecord`, not the HTTP retry count. HTTP retries reuse the same key.
- Retries: 3 retries (4 tries total), exponential backoff with jitter, 500ms base, on 429, 5xx, network errors and `PREVIOUS_REQUEST_IN_PROGRESS`. Honor `Retry-After`. Never retry other 4xx (`INSTRUMENT_DECLINED`, `TRANSACTION_REFUSED` and validation errors fail immediately).
- `debug_id` is logged on every PayPal error.
- Payouts: `sender_batch_header.sender_batch_id = paylock-{dealId}-{attempt}`; PayPal rejects any `sender_batch_id` reused within 30 days, so a re-send increments `attempt`. `items[0].sender_item_id = dealId` on every attempt so re-sends stay traceable.
- Payout re-send rule (decision F): only when the previous item ended `FAILED`, `RETURNED`, `BLOCKED`, `REFUNDED` or `REVERSED`, or the batch ended `DENIED`. `PENDING`, `UNCLAIMED` and `ONHOLD` mean poll again, never re-send. There is no item-level `DENIED`.
- Webhook dedup by PayPal event `id`; replay safe.
- State transitions wrapped in a DB transaction with `SELECT ... FOR UPDATE` on the deal row.

## 9. Settlement (two transactions, invariant 1)

A PayPal call cannot run inside a DB transaction, so each money step is:

1. **Transaction 1**: lock the deal; check state; check a persisted Decision exists (for capture and payout); evaluate policy (freeze, override, authorization not expired); insert `PolicyDecision`, a `PENDING` `PaymentRecord` with its idempotency key, the transition, a `DealEvent` and an `AuditLog` row.
2. **Adapter call** with a `SettlementApproval` referencing that `PolicyDecision`. The adapter re-reads the row and refuses if it is missing, not `ALLOW`, or for a different deal or action.
3. **Transaction 2**: record the PayPal result on the `PaymentRecord` and apply the next transition.

A sweeper resumes any `PENDING` `PaymentRecord` with the same idempotency key after a crash.

## 10. Webhook reconciliation

- The route verifies the signature from the raw body, inserts `WebhookEvent` (duplicate id: return 200, do nothing), returns 200, then processes asynchronously.
- Processing maps the event to a deal (`custom_id`, authorization id, capture id, or `sender_item_id`), appends a "PayPal confirmed" `DealEvent`, and wakes the reconciler.
- The reconciler reads the current resource from PayPal with GET and applies only forward transitions. A webhook never moves a deal backwards and never triggers a money write.
