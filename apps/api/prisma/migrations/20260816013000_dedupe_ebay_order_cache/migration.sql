DELETE FROM "EbayOrderCacheItem" older
USING "EbayOrderCacheItem" newer
WHERE older."ebaySellerConnectionId" = newer."ebaySellerConnectionId"
  AND older."sourceKey" = newer."sourceKey"
  AND (
    older."syncedAt" < newer."syncedAt"
    OR (
      older."syncedAt" = newer."syncedAt"
      AND older."createdAt" < newer."createdAt"
    )
    OR (
      older."syncedAt" = newer."syncedAt"
      AND older."createdAt" = newer."createdAt"
      AND older."id" < newer."id"
    )
  );

ALTER TABLE "EbayOrderCacheItem"
DROP CONSTRAINT IF EXISTS "EbayOrderCacheItem_ebaySellerConnectionId_marketplace_sourceKey_key";

ALTER TABLE "EbayOrderCacheItem"
ADD CONSTRAINT "EbayOrderCacheItem_ebaySellerConnectionId_sourceKey_key"
UNIQUE ("ebaySellerConnectionId", "sourceKey");
