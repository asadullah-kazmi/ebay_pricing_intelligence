CREATE TYPE "RetentionRunMode" AS ENUM ('PREVIEW', 'APPLY');
CREATE TYPE "RetentionRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "OrganizationRetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "readNotificationDays" INTEGER NOT NULL DEFAULT 90,
    "competitorSnapshotDays" INTEGER NOT NULL DEFAULT 90,
    "publishedOutboxDays" INTEGER NOT NULL DEFAULT 30,
    "resolvedDeadLetterDays" INTEGER NOT NULL DEFAULT 180,
    "auditArchiveAfterDays" INTEGER NOT NULL DEFAULT 365,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationRetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataRetentionRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "mode" "RetentionRunMode" NOT NULL,
    "status" "RetentionRunStatus" NOT NULL DEFAULT 'QUEUED',
    "cutoffSnapshot" JSONB NOT NULL,
    "result" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataRetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationRetentionPolicy_organizationId_key"
ON "OrganizationRetentionPolicy"("organizationId");
CREATE INDEX "OrganizationRetentionPolicy_updatedById_idx"
ON "OrganizationRetentionPolicy"("updatedById");
CREATE INDEX "DataRetentionRun_organizationId_createdAt_idx"
ON "DataRetentionRun"("organizationId", "createdAt");
CREATE INDEX "DataRetentionRun_organizationId_status_idx"
ON "DataRetentionRun"("organizationId", "status");
CREATE INDEX "DataRetentionRun_status_leaseExpiresAt_idx"
ON "DataRetentionRun"("status", "leaseExpiresAt");

ALTER TABLE "OrganizationRetentionPolicy" ADD CONSTRAINT "OrganizationRetentionPolicy_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationRetentionPolicy" ADD CONSTRAINT "OrganizationRetentionPolicy_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DataRetentionRun" ADD CONSTRAINT "DataRetentionRun_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataRetentionRun" ADD CONSTRAINT "DataRetentionRun_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
