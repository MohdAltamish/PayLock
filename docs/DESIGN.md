# Paylock: Technical Design

## 1. Domain model

```
User 1---* Deal *---1 User            (buyer, seller)
Deal 1---1 Contract
Deal 1---* RiskAssessment
Deal 1---* Deliverable
Deal 1---* Decision
Deal 1---* PaymentRecord
Deal 1---* DealEvent
User 1---1 SpendPolicy
User 1---1 TrustProfile
User 1---* Report (as reporter and as subject)
WebhookEvent (standalone, dedup)
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
  VOIDED
  CANCELLED
}

enum RiskLevel { LOW MEDIUM HIGH }
enum DecisionOutcome { PASS PARTIAL FAIL }
enum Actor { HUMAN AGENT PAYPAL SYSTEM }

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  displayName   String
  paypalEmail   String?
  isAgent       Boolean  @default(false)
  createdAt     DateTime @default(now())
  spendPolicy   SpendPolicy?
  trustProfile  TrustProfile?
  dealsAsBuyer  Deal[]   @relation("buyer")
  dealsAsSeller Deal[]   @relation("seller")
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
  id                  String   @id @default(cuid())
  userId              String   @unique
  user                User     @relation(fields: [userId], references: [id])
  completedDeals      Int      @default(0)
  failedDeals         Int      @default(0)
  disputes            Int      @default(0)
  reportsReceived     Int      @default(0)
  payoutEmailChanges  Int      @default(0)
  lastPayoutEmailChangeAt DateTime?
  paypalVerified      Boolean  @default(false)
  score               Int      @default(50)   // 0-100, higher is more trusted
  updatedAt           DateTime @updatedAt
}

model Deal {
  id            String    @id @default(cuid())
  buyerId       String
  sellerId      String
  buyer         User      @relation("buyer", fields: [buyerId], references: [id])
  seller        User      @relation("seller", fields: [sellerId], references: [id])
  state         DealState @default(DRAFT)
  amount        Decimal   @db.Decimal(12,2)
  currency      String    @default("USD")
  paypalOrderId String?   @unique
  paypalAuthId  String?   @unique
  contract      Contract?
  risks         RiskAssessment[]
  deliverables  Deliverable[]
  decisions     Decision[]
  payments      PaymentRecord[]
  events        DealEvent[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Contract {
  id             String   @id @default(cuid())
  dealId         String   @unique
  deal           Deal     @relation(fields: [dealId], references: [id])
  title          String
  scope          String
  criteria       Json     // AcceptanceCriterion[]
  deadline       DateTime?
  partialPayMin  Int      @default(70) // % score required for partial payout
  rawRequest     String
  modelMeta      Json
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
  id            String          @id @default(cuid())
  dealId        String
  deal          Deal            @relation(fields: [dealId], references: [id])
  deliverableId String
  outcome       DecisionOutcome
  score         Int             // 0-100
  perCriterion  Json            // CriterionResult[]
  reasoning     String
  payoutPercent Int
  overriddenBy  String?
  createdAt     DateTime        @default(now())
}

model PaymentRecord {
  id             String   @id @default(cuid())
  dealId         String
  deal           Deal     @relation(fields: [dealId], references: [id])
  kind           String   // authorize | capture | void | payout
  paypalId       String   @unique
  amount         Decimal  @db.Decimal(12,2)
  status         String
  raw            Json
  createdAt      DateTime @default(now())
}

model DealEvent {
  id        String   @id @default(cuid())
  dealId    String
  deal      Deal     @relation(fields: [dealId], references: [id])
  type      String
  fromState DealState?
  toState   DealState?
  actor     Actor
  payload   Json
  createdAt DateTime @default(now())
  @@index([dealId, createdAt])
}

model WebhookEvent {
  eventId    String   @id
  eventType  String
  receivedAt DateTime @default(now())
  processed  Boolean  @default(false)
  raw        Json
}

model AuditLog {
  id         String   @id @default(cuid())
  dealId     String?
  actor      Actor
  actorId    String?
  action     String
  before     Json?
  after      Json?
  payloadHash String
  createdAt  DateTime @default(now())
  @@index([dealId])
}
```

## 3. State machine

```
DRAFT -> CONTRACTED            : contract.created (Negotiator)
CONTRACTED -> GUARDED          : risk.assessed level=LOW
CONTRACTED -> AWAITING_APPROVAL: risk.assessed level=MEDIUM or amount > approvalThreshold
CONTRACTED -> FLAGGED          : risk.assessed level=HIGH
FLAGGED -> AWAITING_APPROVAL   : buyer.override (logged, requires reason)
FLAGGED -> CANCELLED           : buyer.cancel
AWAITING_APPROVAL -> GUARDED   : buyer.approve
AWAITING_APPROVAL -> CANCELLED : buyer.reject
GUARDED -> FUNDING             : paypal.order.created
FUNDING -> LOCKED              : paypal.authorization.created
FUNDING -> CANCELLED           : paypal.order.voided | timeout
LOCKED -> DELIVERED            : seller.deliverable.submitted
DELIVERED -> VERIFYING         : verifier.started
VERIFYING -> RELEASING         : decision PASS | PARTIAL (>= partialPayMin)
VERIFYING -> VOIDED            : decision FAIL -> paypal.void
VERIFYING -> NEEDS_REVIEW      : schema failure | low confidence
NEEDS_REVIEW -> RELEASING      : human.approve
NEEDS_REVIEW -> VOIDED         : human.reject
RELEASING -> RELEASED          : capture + payout confirmed (full)
RELEASING -> RELEASED_PARTIAL  : capture + payout confirmed (partial)
LOCKED -> VOIDED               : deadline passed, no delivery -> paypal.void
```

Guards:
- `FUNDING` requires `policy.allow == true` recorded in the same transaction.
- `RELEASING` requires `paypalAuthId` present and not expired.
- Any transition writes a `DealEvent` and an `AuditLog` row atomically.

## 4. API (REST, JSON)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/deals` | Create from NL; runs Negotiator; returns deal with contract |
| POST | `/deals/:id/guard` | Run Guardian; returns risk assessment and policy action |
| POST | `/deals/:id/approve` | Buyer approves MEDIUM risk or above-threshold deal |
| POST | `/deals/:id/override` | Buyer overrides HIGH risk; body: `{ reason }` |
| POST | `/deals/:id/fund` | Create PayPal order (AUTHORIZE); returns `orderId`, approval URL |
| POST | `/deals/:id/deliverables` | Seller submits deliverable; triggers Verifier |
| POST | `/deals/:id/decisions/:decisionId/override` | Human override of verifier |
| GET | `/deals/:id` | Deal with contract, latest risk, decisions, payments |
| GET | `/deals/:id/events` | SSE stream of DealEvents |
| GET | `/deals` | List for current user |
| POST | `/users/:id/reports` | Report a counterparty |
| POST | `/webhooks/paypal` | PayPal webhook receiver |
| GET | `/healthz` | Health |

Agent-to-agent (P1): same endpoints with `X-Agent-Key`; agents use PayPal MCP tools for their own side.

Errors: RFC 7807 problem+json. Every response carries `request_id`.

## 5. Agent output schemas (Zod)

```ts
export const AcceptanceCriterion = z.object({
  id: z.string(),
  description: z.string(),
  weight: z.number().min(1).max(10),
  verifiable: z.enum(["automatic", "llm", "human"]),
});

export const ContractOut = z.object({
  title: z.string().max(120),
  scope: z.string(),
  price: z.number().positive(),
  currency: z.string().length(3),
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
| PAYPAL_UNVERIFIED | payer/payee not verified | +10 |
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
Fallback: if LLM fails, use deterministic signals only and mark `source: rule`.

## 7. Payment math

- Full pass: capture `amount`, `final_capture=true`; payout `amount - platformFee` (fee 0 in demo).
- Partial: `payoutPercent = clamp(score, partialPayMin, 100)` if score >= partialPayMin else FAIL. Capture `amount * payoutPercent / 100` with `final_capture=true` (remainder auto-released).
- Fail: void authorization.
- Currency: minor units handled with `Decimal`; never floats.

## 8. Idempotency and retries

- `PayPal-Request-Id = sha256(dealId:action:attempt)`.
- Retries: 3 attempts, exponential backoff 500ms base, on 429 and 5xx.
- Webhook dedup by `event_id`; replay safe.
- State transitions wrapped in a DB transaction with `SELECT ... FOR UPDATE` on the deal row.

