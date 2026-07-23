CREATE TYPE "FitmentApplicationSource" AS ENUM ('EBAY_CATALOG', 'MANUAL', 'DONOR_VEHICLE');
CREATE TYPE "FitmentApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

ALTER TABLE "FitmentApplication"
  ADD COLUMN "marketplace" TEXT,
  ADD COLUMN "source" "FitmentApplicationSource" NOT NULL DEFAULT 'EBAY_CATALOG',
  ADD COLUMN "status" "FitmentApplicationStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "sourceVehicleId" TEXT,
  ADD COLUMN "sourceEvidence" JSONB,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "fitmentJobItemId" DROP NOT NULL,
  ALTER COLUMN "approvedAt" DROP DEFAULT,
  ALTER COLUMN "approvedAt" DROP NOT NULL;

UPDATE "FitmentApplication" AS application
SET "marketplace" = job."marketplace"
FROM "FitmentJobItem" AS item
JOIN "FitmentJob" AS job ON job."id" = item."fitmentJobId"
WHERE application."fitmentJobItemId" = item."id";

UPDATE "FitmentApplication"
SET "marketplace" = 'EBAY_US'
WHERE "marketplace" IS NULL;

ALTER TABLE "FitmentApplication"
  ALTER COLUMN "marketplace" SET NOT NULL,
  ALTER COLUMN "marketplace" SET DEFAULT 'EBAY_US';

CREATE TABLE "FitmentApplicationRevision" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fitmentApplicationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FitmentApplicationRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FitmentApplication_organizationId_partId_marketplace_status_idx"
  ON "FitmentApplication"("organizationId", "partId", "marketplace", "status");
CREATE INDEX "FitmentApplication_sourceVehicleId_idx" ON "FitmentApplication"("sourceVehicleId");
CREATE INDEX "FitmentApplication_createdById_idx" ON "FitmentApplication"("createdById");
CREATE INDEX "FitmentApplication_approvedById_idx" ON "FitmentApplication"("approvedById");
CREATE UNIQUE INDEX "FitmentApplicationRevision_fitmentApplicationId_revision_key"
  ON "FitmentApplicationRevision"("fitmentApplicationId", "revision");
CREATE INDEX "FitmentApplicationRevision_organizationId_createdAt_idx"
  ON "FitmentApplicationRevision"("organizationId", "createdAt");
CREATE INDEX "FitmentApplicationRevision_createdById_idx"
  ON "FitmentApplicationRevision"("createdById");

ALTER TABLE "FitmentApplication"
  ADD CONSTRAINT "FitmentApplication_sourceVehicleId_fkey"
  FOREIGN KEY ("sourceVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FitmentApplication"
  ADD CONSTRAINT "FitmentApplication_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FitmentApplication"
  ADD CONSTRAINT "FitmentApplication_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FitmentApplicationRevision"
  ADD CONSTRAINT "FitmentApplicationRevision_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FitmentApplicationRevision"
  ADD CONSTRAINT "FitmentApplicationRevision_fitmentApplicationId_fkey"
  FOREIGN KEY ("fitmentApplicationId") REFERENCES "FitmentApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FitmentApplicationRevision"
  ADD CONSTRAINT "FitmentApplicationRevision_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
