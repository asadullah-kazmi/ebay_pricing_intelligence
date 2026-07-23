CREATE TYPE "UserAuthTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'ACCOUNT_RECOVERY');

ALTER TABLE "User"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3),
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecretEncrypted" TEXT,
  ADD COLUMN "pendingMfaSecretEncrypted" TEXT,
  ADD COLUMN "pendingMfaCreatedAt" TIMESTAMP(3),
  ADD COLUMN "mfaLastUsedStep" INTEGER;

CREATE TABLE "UserAuthToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "UserAuthTokenType" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserAuthToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaLoginChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaLoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserAuthToken_tokenHash_key" ON "UserAuthToken"("tokenHash");
CREATE UNIQUE INDEX "User_email_lower_key" ON "User"(LOWER("email"));
CREATE INDEX "UserAuthToken_userId_type_createdAt_idx" ON "UserAuthToken"("userId", "type", "createdAt");
CREATE INDEX "UserAuthToken_expiresAt_idx" ON "UserAuthToken"("expiresAt");
CREATE UNIQUE INDEX "MfaLoginChallenge_tokenHash_key" ON "MfaLoginChallenge"("tokenHash");
CREATE INDEX "MfaLoginChallenge_userId_expiresAt_idx" ON "MfaLoginChallenge"("userId", "expiresAt");
CREATE INDEX "MfaLoginChallenge_organizationId_expiresAt_idx" ON "MfaLoginChallenge"("organizationId", "expiresAt");
CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");
CREATE INDEX "MfaRecoveryCode_userId_usedAt_idx" ON "MfaRecoveryCode"("userId", "usedAt");

ALTER TABLE "UserAuthToken"
  ADD CONSTRAINT "UserAuthToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaLoginChallenge"
  ADD CONSTRAINT "MfaLoginChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaLoginChallenge"
  ADD CONSTRAINT "MfaLoginChallenge_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaRecoveryCode"
  ADD CONSTRAINT "MfaRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
