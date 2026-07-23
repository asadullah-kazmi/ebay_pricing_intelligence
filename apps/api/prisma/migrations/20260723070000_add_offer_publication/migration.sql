CREATE TYPE "EbayOfferStatus" AS ENUM ('PREPARING', 'FEES_READY', 'PUBLISH_QUEUED', 'PUBLISHED', 'FAILED');
CREATE TYPE "EbayOfferJobAction" AS ENUM ('PREPARE', 'PUBLISH');
CREATE TYPE "EbayOfferJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "EbayOffer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingDraftId" TEXT NOT NULL,
    "inventorySyncJobId" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "offerPayload" JSONB NOT NULL,
    "ebayOfferId" TEXT,
    "ebayListingId" TEXT,
    "status" "EbayOfferStatus" NOT NULL DEFAULT 'PREPARING',
    "feeResponse" JSONB,
    "feeTotal" DECIMAL(12,2),
    "feeCurrency" TEXT,
    "warnings" JSONB,
    "lastError" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EbayOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EbayOfferJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "listingDraftId" TEXT NOT NULL,
    "ebayOfferId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "action" "EbayOfferJobAction" NOT NULL,
    "status" "EbayOfferJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EbayOfferJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EbayOffer_listingDraftId_key" ON "EbayOffer"("listingDraftId");
CREATE UNIQUE INDEX "EbayOffer_inventorySyncJobId_key" ON "EbayOffer"("inventorySyncJobId");
CREATE INDEX "EbayOffer_organizationId_status_updatedAt_idx" ON "EbayOffer"("organizationId", "status", "updatedAt");
CREATE INDEX "EbayOffer_ebayOfferId_idx" ON "EbayOffer"("ebayOfferId");
CREATE INDEX "EbayOffer_ebayListingId_idx" ON "EbayOffer"("ebayListingId");
CREATE UNIQUE INDEX "EbayOfferJob_ebayOfferId_action_draftVersion_key" ON "EbayOfferJob"("ebayOfferId", "action", "draftVersion");
CREATE INDEX "EbayOfferJob_organizationId_createdAt_idx" ON "EbayOfferJob"("organizationId", "createdAt");
CREATE INDEX "EbayOfferJob_status_leaseExpiresAt_idx" ON "EbayOfferJob"("status", "leaseExpiresAt");

ALTER TABLE "EbayOffer" ADD CONSTRAINT "EbayOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayOffer" ADD CONSTRAINT "EbayOffer_listingDraftId_fkey" FOREIGN KEY ("listingDraftId") REFERENCES "ListingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayOffer" ADD CONSTRAINT "EbayOffer_inventorySyncJobId_fkey" FOREIGN KEY ("inventorySyncJobId") REFERENCES "EbayInventorySyncJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EbayOffer" ADD CONSTRAINT "EbayOffer_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EbayOfferJob" ADD CONSTRAINT "EbayOfferJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayOfferJob" ADD CONSTRAINT "EbayOfferJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EbayOfferJob" ADD CONSTRAINT "EbayOfferJob_listingDraftId_fkey" FOREIGN KEY ("listingDraftId") REFERENCES "ListingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayOfferJob" ADD CONSTRAINT "EbayOfferJob_ebayOfferId_fkey" FOREIGN KEY ("ebayOfferId") REFERENCES "EbayOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
