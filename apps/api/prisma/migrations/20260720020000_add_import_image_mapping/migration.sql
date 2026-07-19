-- CreateEnum
CREATE TYPE "ImageMatchStrategy" AS ENUM ('MANIFEST', 'SKU_FOLDER', 'IMAGE_GROUP_FOLDER', 'SKU_FILENAME', 'UNMATCHED', 'AMBIGUOUS');
CREATE TYPE "ImageMatchStatus" AS ENUM ('MATCHED', 'REVIEW_REQUIRED', 'UNMATCHED');

-- AlterTable
ALTER TABLE "ImportBatch"
  ADD COLUMN "imageArchiveChecksum" TEXT,
  ADD COLUMN "imageIssues" JSONB,
  ADD COLUMN "imageMatchCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "imageReviewCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "imageUnmatchedCount" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "ImportBatch_image_counts_check" CHECK (
    "imageMatchCount" >= 0 AND "imageReviewCount" >= 0 AND "imageUnmatchedCount" >= 0
  );

-- CreateTable
CREATE TABLE "ImportMediaMatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "importRowId" TEXT,
  "mediaAssetId" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "strategy" "ImageMatchStrategy" NOT NULL,
  "status" "ImageMatchStatus" NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportMediaMatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportMediaMatch_displayOrder_check" CHECK ("displayOrder" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportMediaMatch_importBatchId_sourcePath_key" ON "ImportMediaMatch"("importBatchId", "sourcePath");
CREATE INDEX "ImportMediaMatch_organizationId_status_idx" ON "ImportMediaMatch"("organizationId", "status");
CREATE INDEX "ImportMediaMatch_importRowId_displayOrder_idx" ON "ImportMediaMatch"("importRowId", "displayOrder");
CREATE INDEX "ImportMediaMatch_mediaAssetId_idx" ON "ImportMediaMatch"("mediaAssetId");

-- AddForeignKey
ALTER TABLE "ImportMediaMatch" ADD CONSTRAINT "ImportMediaMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportMediaMatch" ADD CONSTRAINT "ImportMediaMatch_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportMediaMatch" ADD CONSTRAINT "ImportMediaMatch_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "ImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportMediaMatch" ADD CONSTRAINT "ImportMediaMatch_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
