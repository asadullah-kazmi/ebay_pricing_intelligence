ALTER TABLE "ListingDraft" ADD COLUMN "ebayCondition" TEXT;
ALTER TABLE "EbayCategoryMetadata" ADD COLUMN "conditions" JSONB;

CREATE TYPE "EbayInventorySyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "EbayInventorySyncJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "listingDraftId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "EbayInventorySyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "inventoryWrittenAt" TIMESTAMP(3),
    "compatibilityWrittenAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EbayInventorySyncJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EbayInventorySyncJob_preparationId_key" ON "EbayInventorySyncJob"("preparationId");
CREATE INDEX "EbayInventorySyncJob_organizationId_createdAt_idx" ON "EbayInventorySyncJob"("organizationId", "createdAt");
CREATE INDEX "EbayInventorySyncJob_status_leaseExpiresAt_idx" ON "EbayInventorySyncJob"("status", "leaseExpiresAt");

ALTER TABLE "EbayInventorySyncJob" ADD CONSTRAINT "EbayInventorySyncJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayInventorySyncJob" ADD CONSTRAINT "EbayInventorySyncJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EbayInventorySyncJob" ADD CONSTRAINT "EbayInventorySyncJob_listingDraftId_fkey" FOREIGN KEY ("listingDraftId") REFERENCES "ListingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayInventorySyncJob" ADD CONSTRAINT "EbayInventorySyncJob_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "EbayInventoryPreparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
