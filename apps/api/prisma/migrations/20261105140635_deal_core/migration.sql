-- CreateEnum
CREATE TYPE "DealState" AS ENUM ('DRAFT', 'CONTRACTED', 'GUARDED', 'FLAGGED', 'AWAITING_APPROVAL', 'FUNDING', 'LOCKED', 'DELIVERED', 'VERIFYING', 'NEEDS_REVIEW', 'RELEASING', 'RELEASED', 'RELEASED_PARTIAL', 'SETTLEMENT_ERROR', 'VOIDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('PASS', 'PARTIAL', 'FAIL');

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('HUMAN', 'AGENT', 'PAYPAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PolicyResult" AS ENUM ('ALLOW', 'REQUIRE_APPROVAL', 'BLOCK');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ORDER', 'AUTHORIZE', 'CAPTURE', 'VOID', 'PAYOUT', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "paypalEmail" TEXT,
    "isAgent" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpendPolicy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maxPerDeal" DECIMAL(12,2) NOT NULL,
    "dailyCap" DECIMAL(12,2) NOT NULL,
    "approvalThreshold" DECIMAL(12,2) NOT NULL,
    "allowMediumRisk" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',

    CONSTRAINT "SpendPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedDeals" INTEGER NOT NULL DEFAULT 0,
    "failedDeals" INTEGER NOT NULL DEFAULT 0,
    "disputes" INTEGER NOT NULL DEFAULT 0,
    "reportsReceived" INTEGER NOT NULL DEFAULT 0,
    "payoutEmailChanges" INTEGER NOT NULL DEFAULT 0,
    "lastPayoutEmailChangeAt" TIMESTAMP(3),
    "paypalVerified" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 50,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "state" "DealState" NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payoutEmail" TEXT,
    "paypalOrderId" TEXT,
    "paypalAuthId" TEXT,
    "authExpiresAt" TIMESTAMP(3),
    "requiresHumanRelease" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "fundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "deadline" TIMESTAMP(3),
    "partialPayMin" INTEGER NOT NULL DEFAULT 70,
    "rawRequest" TEXT NOT NULL,
    "modelMeta" JSONB NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "signals" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "score" INTEGER NOT NULL,
    "perCriterion" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "payoutPercent" INTEGER NOT NULL,
    "needsHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "overriddenBy" TEXT,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" "PolicyResult" NOT NULL,
    "reasons" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "decisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "policyDecisionId" TEXT,
    "paypalId" TEXT,
    "amount" DECIMAL(12,2),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paypalStatus" TEXT,
    "raw" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealEvent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromState" "DealState",
    "toState" "DealState",
    "actor" "Actor" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "dealId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "actor" "Actor" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "SpendPolicy_userId_key" ON "SpendPolicy"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustProfile_userId_key" ON "TrustProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_paypalOrderId_key" ON "Deal"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_paypalAuthId_key" ON "Deal"("paypalAuthId");

-- CreateIndex
CREATE INDEX "Deal_buyerId_state_idx" ON "Deal"("buyerId", "state");

-- CreateIndex
CREATE INDEX "Deal_state_idx" ON "Deal"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_dealId_key" ON "Contract"("dealId");

-- CreateIndex
CREATE INDEX "Message_dealId_createdAt_idx" ON "Message"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "RiskAssessment_dealId_createdAt_idx" ON "RiskAssessment"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_dealId_createdAt_idx" ON "Decision"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyDecision_dealId_action_idx" ON "PolicyDecision"("dealId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_idempotencyKey_key" ON "PaymentRecord"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_paypalId_key" ON "PaymentRecord"("paypalId");

-- CreateIndex
CREATE INDEX "PaymentRecord_dealId_kind_idx" ON "PaymentRecord"("dealId", "kind");

-- CreateIndex
CREATE INDEX "PaymentRecord_status_idx" ON "PaymentRecord"("status");

-- CreateIndex
CREATE INDEX "DealEvent_dealId_createdAt_idx" ON "DealEvent"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_subjectId_idx" ON "Report"("subjectId");

-- CreateIndex
CREATE INDEX "AuditLog_dealId_idx" ON "AuditLog"("dealId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendPolicy" ADD CONSTRAINT "SpendPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustProfile" ADD CONSTRAINT "TrustProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_policyDecisionId_fkey" FOREIGN KEY ("policyDecisionId") REFERENCES "PolicyDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealEvent" ADD CONSTRAINT "DealEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
