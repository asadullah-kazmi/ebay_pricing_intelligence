UPDATE "EbaySellerConnection" SET "scopes" = ARRAY[]::TEXT[] WHERE "scopes" IS NULL;
ALTER TABLE "EbaySellerConnection" ALTER COLUMN "scopes" SET NOT NULL;
