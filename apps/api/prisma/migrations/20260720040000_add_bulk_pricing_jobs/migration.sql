CREATE TYPE "PricingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "PricingJobItemStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'NO_MATCHES', 'FAILED');
CREATE TYPE "PricingConditionMode" AS ENUM ('MATCH_PART', 'ANY', 'NEW', 'USED');

CREATE TABLE "PricingJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "conditionMode" "PricingConditionMode" NOT NULL DEFAULT 'MATCH_PART',
    "status" "PricingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalItems" INTEGER NOT NULL,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "noMatchItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PricingJobItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pricingJobId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "queryPartNumber" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "status" "PricingJobItemStatus" NOT NULL DEFAULT 'QUEUED',
    "competitorCount" INTEGER NOT NULL DEFAULT 0,
    "lowest" DECIMAL(12,2),
    "average" DECIMAL(12,2),
    "median" DECIMAL(12,2),
    "highest" DECIMAL(12,2),
    "recommendedPrice" DECIMAL(12,2),
    "currency" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingJobItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompetitorListingSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pricingJobItemId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "shipping" DECIMAL(12,2) NOT NULL,
    "landedPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "matchedOn" TEXT[],
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetitorListingSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PricingJobItem_pricingJobId_partId_key" ON "PricingJobItem"("pricingJobId", "partId");
CREATE UNIQUE INDEX "CompetitorListingSnapshot_pricingJobItemId_listingId_key" ON "CompetitorListingSnapshot"("pricingJobItemId", "listingId");
CREATE INDEX "PricingJob_organizationId_createdAt_idx" ON "PricingJob"("organizationId", "createdAt");
CREATE INDEX "PricingJob_organizationId_status_idx" ON "PricingJob"("organizationId", "status");
CREATE INDEX "PricingJob_createdById_idx" ON "PricingJob"("createdById");
CREATE INDEX "PricingJobItem_organizationId_status_idx" ON "PricingJobItem"("organizationId", "status");
CREATE INDEX "PricingJobItem_partId_completedAt_idx" ON "PricingJobItem"("partId", "completedAt");
CREATE INDEX "CompetitorListingSnapshot_organizationId_listingId_idx" ON "CompetitorListingSnapshot"("organizationId", "listingId");
CREATE INDEX "CompetitorListingSnapshot_pricingJobItemId_landedPrice_idx" ON "CompetitorListingSnapshot"("pricingJobItemId", "landedPrice");

ALTER TABLE "PricingJob" ADD CONSTRAINT "PricingJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingJob" ADD CONSTRAINT "PricingJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PricingJobItem" ADD CONSTRAINT "PricingJobItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingJobItem" ADD CONSTRAINT "PricingJobItem_pricingJobId_fkey" FOREIGN KEY ("pricingJobId") REFERENCES "PricingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingJobItem" ADD CONSTRAINT "PricingJobItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorListingSnapshot" ADD CONSTRAINT "CompetitorListingSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorListingSnapshot" ADD CONSTRAINT "CompetitorListingSnapshot_pricingJobItemId_fkey" FOREIGN KEY ("pricingJobItemId") REFERENCES "PricingJobItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
