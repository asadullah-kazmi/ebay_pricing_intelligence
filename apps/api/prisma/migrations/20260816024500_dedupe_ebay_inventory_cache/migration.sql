DELETE FROM "EbayInventoryCacheItem" older
USING "EbayInventoryCacheItem" newer
WHERE older."ebaySellerConnectionId" = newer."ebaySellerConnectionId"
  AND older."sourceKey" = newer."sourceKey"
  AND (
    older."syncedAt" < newer."syncedAt"
    OR (
      older."syncedAt" = newer."syncedAt"
      AND older."updatedAt" < newer."updatedAt"
    )
    OR (
      older."syncedAt" = newer."syncedAt"
      AND older."updatedAt" = newer."updatedAt"
      AND older."id" < newer."id"
    )
  );

ALTER TABLE "EbayInventoryCacheItem"
DROP CONSTRAINT IF EXISTS "EbayInventoryCacheItem_ebaySellerConnectionId_marketplace_sourceKey_key";

ALTER TABLE "EbayInventoryCacheItem"
ADD CONSTRAINT "EbayInventoryCacheItem_ebaySellerConnectionId_sourceKey_key"
UNIQUE ("ebaySellerConnectionId", "sourceKey");
