ALTER TYPE "EbayOfferStatus" ADD VALUE 'REVISION_QUEUED';
ALTER TYPE "EbayOfferStatus" ADD VALUE 'WITHDRAW_QUEUED';
ALTER TYPE "EbayOfferStatus" ADD VALUE 'WITHDRAWN';
ALTER TYPE "EbayOfferStatus" ADD VALUE 'DRIFTED';

CREATE TYPE "EbayListingOperation" AS ENUM ('REVISE', 'WITHDRAW', 'RECONCILE');
CREATE TYPE "EbayListingOperationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

ALTER TABLE "EbayOffer"
  ADD COLUMN "lastRevisionAt" TIMESTAMP(3),
  ADD COLUMN "revisionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "withdrawnAt" TIMESTAMP(3),
  ADD COLUMN "remoteListingStatus" TEXT,
  ADD COLUMN "remoteSnapshot" JSONB,
  ADD COLUMN "driftIssues" JSONB,
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

CREATE TABLE "EbayListingOperationJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "listingDraftId" TEXT NOT NULL,
    "ebayOfferId" TEXT NOT NULL,
    "inventorySyncJobId" TEXT,
    "targetDraftVersion" INTEGER NOT NULL,
    "action" "EbayListingOperation" NOT NULL,
    "status" "EbayListingOperationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedPayload" JSONB,
    "remoteSnapshot" JSONB,
    "driftIssues" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EbayListingOperationJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EbayListingOperationJob_organizationId_createdAt_idx" ON "EbayListingOperationJob"("organizationId", "createdAt");
CREATE INDEX "EbayListingOperationJob_status_leaseExpiresAt_idx" ON "EbayListingOperationJob"("status", "leaseExpiresAt");
CREATE INDEX "EbayListingOperationJob_ebayOfferId_action_createdAt_idx" ON "EbayListingOperationJob"("ebayOfferId", "action", "createdAt");

ALTER TABLE "EbayListingOperationJob" ADD CONSTRAINT "EbayListingOperationJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayListingOperationJob" ADD CONSTRAINT "EbayListingOperationJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EbayListingOperationJob" ADD CONSTRAINT "EbayListingOperationJob_listingDraftId_fkey" FOREIGN KEY ("listingDraftId") REFERENCES "ListingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayListingOperationJob" ADD CONSTRAINT "EbayListingOperationJob_ebayOfferId_fkey" FOREIGN KEY ("ebayOfferId") REFERENCES "EbayOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayListingOperationJob" ADD CONSTRAINT "EbayListingOperationJob_inventorySyncJobId_fkey" FOREIGN KEY ("inventorySyncJobId") REFERENCES "EbayInventorySyncJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
