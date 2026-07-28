-- Quick SKU product source and eBay Browse image discovery metadata
CREATE TYPE "PartProductSource" AS ENUM ('OEM', 'AFTERMARKET', 'PRIVATE_LABEL');

ALTER TABLE "Part"
ADD COLUMN "productSource" "PartProductSource" NOT NULL DEFAULT 'OEM';

ALTER TABLE "MediaAsset"
ADD COLUMN "externalUrl" TEXT,
ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'USER_UPLOAD',
ADD COLUMN "sourceMetadata" JSONB;

CREATE INDEX "Part_organizationId_productSource_idx" ON "Part"("organizationId", "productSource");
CREATE INDEX "MediaAsset_organizationId_sourceType_idx" ON "MediaAsset"("organizationId", "sourceType");
