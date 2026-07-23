CREATE TYPE "PricingProposalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'OVERRIDDEN',
  'SUPERSEDED'
);

CREATE TABLE "PricingRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "marketAdjustmentPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "minimumMarginPercent" DECIMAL(6,2) NOT NULL DEFAULT 20,
  "minimumProfitAmount" DECIMAL(12,2) NOT NULL DEFAULT 10,
  "requireApproval" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PricingProposal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "pricingJobItemId" TEXT NOT NULL,
  "marketplace" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "PricingProposalStatus" NOT NULL DEFAULT 'PENDING',
  "marketRecommendedPrice" DECIMAL(12,2) NOT NULL,
  "costAmount" DECIMAL(12,2),
  "costCurrency" TEXT,
  "floorPrice" DECIMAL(12,2),
  "proposedPrice" DECIMAL(12,2) NOT NULL,
  "approvedPrice" DECIMAL(12,2),
  "belowFloor" BOOLEAN NOT NULL DEFAULT false,
  "floorUnavailableReason" TEXT,
  "ruleSnapshot" JSONB NOT NULL,
  "decisionReason" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PricingProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PricingRule_organizationId_key" ON "PricingRule"("organizationId");
CREATE INDEX "PricingRule_updatedById_idx" ON "PricingRule"("updatedById");
CREATE UNIQUE INDEX "PricingProposal_pricingJobItemId_key" ON "PricingProposal"("pricingJobItemId");
CREATE INDEX "PricingProposal_organizationId_status_createdAt_idx" ON "PricingProposal"("organizationId", "status", "createdAt");
CREATE INDEX "PricingProposal_organizationId_partId_marketplace_decidedAt_idx" ON "PricingProposal"("organizationId", "partId", "marketplace", "decidedAt");
CREATE INDEX "PricingProposal_decidedById_idx" ON "PricingProposal"("decidedById");

ALTER TABLE "PricingRule"
  ADD CONSTRAINT "PricingRule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingRule"
  ADD CONSTRAINT "PricingRule_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PricingProposal"
  ADD CONSTRAINT "PricingProposal_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingProposal"
  ADD CONSTRAINT "PricingProposal_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingProposal"
  ADD CONSTRAINT "PricingProposal_pricingJobItemId_fkey"
  FOREIGN KEY ("pricingJobItemId") REFERENCES "PricingJobItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingProposal"
  ADD CONSTRAINT "PricingProposal_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
