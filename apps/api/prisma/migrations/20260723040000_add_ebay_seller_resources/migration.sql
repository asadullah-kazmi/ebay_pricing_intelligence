CREATE TYPE "EbaySellerResourceType" AS ENUM ('PAYMENT_POLICY', 'RETURN_POLICY', 'FULFILLMENT_POLICY', 'INVENTORY_LOCATION');

CREATE TABLE "EbaySellerResource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "type" "EbaySellerResourceType" NOT NULL,
    "remoteId" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EbaySellerResource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EbayCategoryMetadata" (
    "id" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "aspects" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EbayCategoryMetadata_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ListingDraft" ADD COLUMN "liveValidatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EbaySellerResource_organizationId_marketplace_type_remoteId_key" ON "EbaySellerResource"("organizationId", "marketplace", "type", "remoteId");
CREATE INDEX "EbaySellerResource_organizationId_marketplace_type_idx" ON "EbaySellerResource"("organizationId", "marketplace", "type");
CREATE UNIQUE INDEX "EbayCategoryMetadata_marketplace_categoryId_key" ON "EbayCategoryMetadata"("marketplace", "categoryId");
CREATE INDEX "EbayCategoryMetadata_fetchedAt_idx" ON "EbayCategoryMetadata"("fetchedAt");

ALTER TABLE "EbaySellerResource" ADD CONSTRAINT "EbaySellerResource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
