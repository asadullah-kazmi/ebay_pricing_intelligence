ALTER TABLE "PricingJob"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leaseOwner" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT;

ALTER TABLE "PricingJobItem"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "FitmentJob"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leaseOwner" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT;

ALTER TABLE "FitmentJobItem"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PricingJob_status_leaseExpiresAt_idx" ON "PricingJob"("status", "leaseExpiresAt");
CREATE INDEX "FitmentJob_status_leaseExpiresAt_idx" ON "FitmentJob"("status", "leaseExpiresAt");
CREATE INDEX "WorkerHeartbeat_service_lastSeenAt_idx" ON "WorkerHeartbeat"("service", "lastSeenAt");
CREATE INDEX "WorkerHeartbeat_status_lastSeenAt_idx" ON "WorkerHeartbeat"("status", "lastSeenAt");
