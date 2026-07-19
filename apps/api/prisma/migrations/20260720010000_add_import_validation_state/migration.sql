-- AlterEnum
ALTER TYPE "ImportBatchStatus" ADD VALUE 'REVIEW_REQUIRED' BEFORE 'READY_TO_COMMIT';

-- AlterTable
ALTER TABLE "ImportBatch"
  ADD COLUMN "errors" JSONB,
  ADD COLUMN "warnings" JSONB;

-- Align the live catalog with the normalized v1 import contract.
ALTER TABLE "Part"
  ADD COLUMN "normalizedSku" TEXT,
  ADD COLUMN "donorMileage" INTEGER,
  ADD COLUMN "donorColor" TEXT,
  ADD COLUMN "placement" TEXT,
  ADD COLUMN "notes" TEXT;

UPDATE "Part" SET "normalizedSku" = UPPER(TRIM("sku"));
ALTER TABLE "Part" ALTER COLUMN "normalizedSku" SET NOT NULL;

DROP INDEX "Part_organizationId_sku_key";
CREATE UNIQUE INDEX "Part_organizationId_normalizedSku_key" ON "Part"("organizationId", "normalizedSku");

ALTER TABLE "Part"
  ADD CONSTRAINT "Part_donorMileage_check" CHECK ("donorMileage" IS NULL OR "donorMileage" >= 0);
