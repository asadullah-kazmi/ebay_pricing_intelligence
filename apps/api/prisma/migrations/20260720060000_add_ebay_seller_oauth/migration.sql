CREATE TYPE "EbayConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'EXPIRED', 'DISCONNECTED');

CREATE TABLE "EbaySellerConnection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectedById" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "status" "EbayConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "ebayUserId" TEXT,
  "username" TEXT,
  "accountType" TEXT,
  "registrationMarketplace" TEXT,
  "scopes" TEXT[],
  "accessTokenCiphertext" BYTEA,
  "accessTokenIv" BYTEA,
  "accessTokenTag" BYTEA,
  "refreshTokenCiphertext" BYTEA,
  "refreshTokenIv" BYTEA,
  "refreshTokenTag" BYTEA,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "refreshTokenExpiresAt" TIMESTAMP(3),
  "lastRefreshedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "disconnectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EbaySellerConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EbayOAuthState" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EbayOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EbaySellerConnection_organizationId_key" ON "EbaySellerConnection"("organizationId");
CREATE INDEX "EbaySellerConnection_status_idx" ON "EbaySellerConnection"("status");
CREATE INDEX "EbaySellerConnection_ebayUserId_idx" ON "EbaySellerConnection"("ebayUserId");
CREATE UNIQUE INDEX "EbayOAuthState_stateHash_key" ON "EbayOAuthState"("stateHash");
CREATE INDEX "EbayOAuthState_organizationId_expiresAt_idx" ON "EbayOAuthState"("organizationId", "expiresAt");
CREATE INDEX "EbayOAuthState_expiresAt_idx" ON "EbayOAuthState"("expiresAt");

ALTER TABLE "EbaySellerConnection" ADD CONSTRAINT "EbaySellerConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbaySellerConnection" ADD CONSTRAINT "EbaySellerConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EbayOAuthState" ADD CONSTRAINT "EbayOAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbayOAuthState" ADD CONSTRAINT "EbayOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
