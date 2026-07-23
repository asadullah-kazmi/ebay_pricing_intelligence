CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "OrganizationAuditEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "requestId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationAuditEvent_organizationId_occurredAt_idx"
  ON "OrganizationAuditEvent"("organizationId", "occurredAt");
CREATE INDEX "OrganizationAuditEvent_organizationId_action_occurredAt_idx"
  ON "OrganizationAuditEvent"("organizationId", "action", "occurredAt");
CREATE INDEX "OrganizationAuditEvent_organizationId_severity_occurredAt_idx"
  ON "OrganizationAuditEvent"("organizationId", "severity", "occurredAt");
CREATE INDEX "OrganizationAuditEvent_resourceType_resourceId_idx"
  ON "OrganizationAuditEvent"("resourceType", "resourceId");

ALTER TABLE "OrganizationAuditEvent"
  ADD CONSTRAINT "OrganizationAuditEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationAuditEvent"
  ADD CONSTRAINT "OrganizationAuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
