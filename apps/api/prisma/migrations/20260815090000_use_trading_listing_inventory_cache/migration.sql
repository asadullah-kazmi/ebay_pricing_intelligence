ALTER TABLE "EbayInventoryCacheItem" ADD COLUMN "sourceKey" TEXT NOT NULL DEFAULT '';

UPDATE "EbayInventoryCacheItem"
SET "sourceKey" = COALESCE(NULLIF("listingId", ''), 'SKU:' || "sku")
WHERE "sourceKey" = '';

DROP INDEX IF EXISTS "EbayInventoryCacheItem_ebaySellerConnectionId_marketplace_sku_key";

CREATE UNIQUE INDEX "EbayInventoryCacheItem_ebaySellerConnectionId_marketplace_sourceKey_key"
ON "EbayInventoryCacheItem"("ebaySellerConnectionId", "marketplace", "sourceKey");

CREATE INDEX "EbayInventoryCacheItem_organizationId_listingId_idx"
ON "EbayInventoryCacheItem"("organizationId", "listingId");
