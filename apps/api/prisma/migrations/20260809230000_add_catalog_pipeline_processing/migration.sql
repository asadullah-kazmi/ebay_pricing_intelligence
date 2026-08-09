CREATE TYPE "PipelineRowStage" AS ENUM (
  'QUEUED',
  'IDENTIFYING',
  'FITMENT',
  'BUILDING_LISTING',
  'CATALOG',
  'COMPLETED',
  'FAILED'
);

ALTER TABLE "ImportBatch"
ADD COLUMN "listingTeamId" TEXT,
ADD COLUMN "defaultCondition" "PartCondition",
ADD COLUMN "marketplace" TEXT NOT NULL DEFAULT 'EBAY_US',
ADD COLUMN "processedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "ImportRow"
ADD COLUMN "pipelineStage" "PipelineRowStage" NOT NULL DEFAULT 'QUEUED',
ADD COLUMN "pipelineError" TEXT,
ADD COLUMN "enrichmentData" JSONB;

CREATE INDEX "ImportRow_importBatchId_pipelineStage_rowNumber_idx"
ON "ImportRow"("importBatchId", "pipelineStage", "rowNumber");

CREATE INDEX "ImportBatch_organizationId_updatedAt_idx"
ON "ImportBatch"("organizationId", "updatedAt" DESC);

ALTER TABLE "ImportBatch"
ADD CONSTRAINT "ImportBatch_listingTeamId_fkey"
FOREIGN KEY ("listingTeamId") REFERENCES "ListingTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
