CREATE TYPE "EbayImageStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
CREATE TYPE "InventoryPreparationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "EbayPublishedImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" "EbayImageStatus" NOT NULL DEFAULT 'PENDING',
    "sourceChecksum" TEXT NOT NULL,
    "ebayImageId" TEXT,
    "imageUrl" TEXT,
    "maxDimensionImageUrl" TEXT,
    "expirationDate" TIMESTAMP(3),
    "lastError" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EbayPublishedImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EbayInventoryPreparation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingDraftId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "inventoryPayload" JSONB NOT NULL,
    "compatibilityPayload" JSONB,
    "warnings" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EbayInventoryPreparation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryPreparationJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "listingDraftId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "status" "InventoryPreparationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "preparationId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryPreparationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EbayPublishedImage_organizationId_mediaAssetId_environment_key" ON "EbayPublishedImage"("organizationId", "mediaAssetId", "environment");
CREATE INDEX "EbayPublishedImage_organizationId_status_idx" ON "EbayPublishedImage"("organizationId", "status");
CREATE INDEX "EbayPublishedImage_expirationDate_idx" ON "EbayPublishedImage"("expirationDate");
CREATE UNIQUE INDEX "EbayInventoryPreparation_listingDraftId_draftVersion_key" ON "EbayInventoryPreparation"("listingDraftId", "draftVersion");
CREATE INDEX "EbayInventoryPreparation_organizationId_createdAt_idx" ON "EbayInventoryPreparation"("organizationId", "createdAt");
CREATE INDEX "EbayInventoryPreparation_payloadHash_idx" ON "EbayInventoryPreparation"("payloadHash");
CREATE UNIQUE INDEX "InventoryPreparationJob_preparationId_key" ON "InventoryPreparationJob"("preparationId");
CREATE UNIQUE INDEX "InventoryPreparationJob_listingDraftId_draftVersion_key" ON "InventoryPreparationJob"("listingDraftId", "draftVersion");
CREATE INDEX "InventoryPreparationJob_organizationId_createdAt_idx" ON "InventoryPreparationJob"("organizationId", "createdAt");
CREATE INDEX "InventoryPreparationJob_status_leaseExpiresAt_idx" ON "InventoryPreparationJob"("status", "leaseExpiresAt");

ALTER TABLE "EbayPublishedImage" ADD CONSTRAINT "EbayPublishedImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayPublishedImage" ADD CONSTRAINT "EbayPublishedImage_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayInventoryPreparation" ADD CONSTRAINT "EbayInventoryPreparation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayInventoryPreparation" ADD CONSTRAINT "EbayInventoryPreparation_listingDraftId_fkey" FOREIGN KEY ("listingDraftId") REFERENCES "ListingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayInventoryPreparation" ADD CONSTRAINT "EbayInventoryPreparation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryPreparationJob" ADD CONSTRAINT "InventoryPreparationJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryPreparationJob" ADD CONSTRAINT "InventoryPreparationJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryPreparationJob" ADD CONSTRAINT "InventoryPreparationJob_listingDraftId_fkey" FOREIGN KEY ("listingDraftId") REFERENCES "ListingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryPreparationJob" ADD CONSTRAINT "InventoryPreparationJob_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "EbayInventoryPreparation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
