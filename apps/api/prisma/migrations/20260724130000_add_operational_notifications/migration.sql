CREATE TYPE "NotificationCategory" AS ENUM ('PRICING', 'FITMENT', 'PUBLISHING', 'SYSTEM');
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL');
CREATE TYPE "NotificationEmailStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENT', 'FAILED');

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailPricing" BOOLEAN NOT NULL DEFAULT false,
    "emailFitment" BOOLEAN NOT NULL DEFAULT false,
    "emailPublishing" BOOLEAN NOT NULL DEFAULT false,
    "emailFailures" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionUrl" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "emailStatus" "NotificationEmailStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "emailError" TEXT,
    "emailedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_organizationId_userId_key"
ON "NotificationPreference"("organizationId", "userId");
CREATE UNIQUE INDEX "UserNotification_userId_sourceEventId_key"
ON "UserNotification"("userId", "sourceEventId");
CREATE INDEX "UserNotification_organizationId_userId_readAt_createdAt_idx"
ON "UserNotification"("organizationId", "userId", "readAt", "createdAt");
CREATE INDEX "UserNotification_organizationId_category_createdAt_idx"
ON "UserNotification"("organizationId", "category", "createdAt");

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
