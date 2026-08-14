CREATE TABLE "EbayInventoryCacheItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ebaySellerConnectionId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT,
    "condition" TEXT,
    "quantity" INTEGER,
    "price" DECIMAL(12,2),
    "currency" TEXT,
    "offerId" TEXT,
    "offerStatus" TEXT,
    "listingId" TEXT,
    "listingStatus" TEXT,
    "listingOnHold" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT,
    "imageUrl" TEXT,
    "inventoryPayload" JSONB,
    "offerPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EbayInventoryCacheItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EbayInventoryCacheItem_ebaySellerConnectionId_marketplace_sku_key" ON "EbayInventoryCacheItem"("ebaySellerConnectionId", "marketplace", "sku");
CREATE INDEX "EbayInventoryCacheItem_organizationId_ebaySellerConnectionId_syncedAt_idx" ON "EbayInventoryCacheItem"("organizationId", "ebaySellerConnectionId", "syncedAt");
CREATE INDEX "EbayInventoryCacheItem_organizationId_listingStatus_idx" ON "EbayInventoryCacheItem"("organizationId", "listingStatus");
CREATE INDEX "EbayInventoryCacheItem_organizationId_offerStatus_idx" ON "EbayInventoryCacheItem"("organizationId", "offerStatus");
CREATE INDEX "EbayInventoryCacheItem_organizationId_sku_idx" ON "EbayInventoryCacheItem"("organizationId", "sku");

ALTER TABLE "EbayInventoryCacheItem" ADD CONSTRAINT "EbayInventoryCacheItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayInventoryCacheItem" ADD CONSTRAINT "EbayInventoryCacheItem_ebaySellerConnectionId_fkey" FOREIGN KEY ("ebaySellerConnectionId") REFERENCES "EbaySellerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
