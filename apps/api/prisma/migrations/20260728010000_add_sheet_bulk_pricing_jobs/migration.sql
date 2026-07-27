-- Sheet-based bulk pricing jobs (CSV upload on Pricing page)
CREATE TABLE "BulkPricingJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "defaultCondition" TEXT NOT NULL DEFAULT 'ANY',
    "status" "PricingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalItems" INTEGER NOT NULL,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "noMatchItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "sourceFilename" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BulkPricingJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkPricingJobItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bulkPricingJobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "notes" TEXT,
    "catalogMatch" BOOLEAN NOT NULL DEFAULT false,
    "catalogPartId" TEXT,
    "status" "PricingJobItemStatus" NOT NULL DEFAULT 'QUEUED',
    "competitorCount" INTEGER NOT NULL DEFAULT 0,
    "lowest" DECIMAL(12,2),
    "average" DECIMAL(12,2),
    "median" DECIMAL(12,2),
    "highest" DECIMAL(12,2),
    "marketRecommended" DECIMAL(12,2),
    "sellingPrice" DECIMAL(12,2),
    "floorPrice" DECIMAL(12,2),
    "marginPercent" DECIMAL(8,2),
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BulkPricingJobItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BulkPricingJobItem_bulkPricingJobId_rowNumber_key" ON "BulkPricingJobItem"("bulkPricingJobId", "rowNumber");
CREATE INDEX "BulkPricingJob_organizationId_createdAt_idx" ON "BulkPricingJob"("organizationId", "createdAt");
CREATE INDEX "BulkPricingJob_organizationId_status_idx" ON "BulkPricingJob"("organizationId", "status");
CREATE INDEX "BulkPricingJob_createdById_idx" ON "BulkPricingJob"("createdById");
CREATE INDEX "BulkPricingJobItem_organizationId_status_idx" ON "BulkPricingJobItem"("organizationId", "status");
CREATE INDEX "BulkPricingJobItem_bulkPricingJobId_status_idx" ON "BulkPricingJobItem"("bulkPricingJobId", "status");

ALTER TABLE "BulkPricingJob" ADD CONSTRAINT "BulkPricingJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkPricingJob" ADD CONSTRAINT "BulkPricingJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BulkPricingJobItem" ADD CONSTRAINT "BulkPricingJobItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkPricingJobItem" ADD CONSTRAINT "BulkPricingJobItem_bulkPricingJobId_fkey" FOREIGN KEY ("bulkPricingJobId") REFERENCES "BulkPricingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
