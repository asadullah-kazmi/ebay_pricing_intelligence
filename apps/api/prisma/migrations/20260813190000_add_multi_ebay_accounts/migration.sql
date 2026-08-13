-- Allow an organization to connect several eBay seller accounts.
DROP INDEX IF EXISTS "EbaySellerConnection_organizationId_key";

ALTER TABLE "EbaySellerConnection"
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultMarketplace" TEXT NOT NULL DEFAULT 'EBAY_US',
  ADD COLUMN "defaultPaymentPolicyId" TEXT,
  ADD COLUMN "defaultReturnPolicyId" TEXT,
  ADD COLUMN "defaultShippingPolicyId" TEXT,
  ADD COLUMN "defaultMerchantLocationKey" TEXT;

-- The legacy connection is the default account for every existing organization.
UPDATE "EbaySellerConnection" SET "isDefault" = true;

CREATE UNIQUE INDEX "EbaySellerConnection_organizationId_environment_ebayUserId_key"
  ON "EbaySellerConnection"("organizationId", "environment", "ebayUserId");
CREATE INDEX "EbaySellerConnection_organizationId_isDefault_status_idx"
  ON "EbaySellerConnection"("organizationId", "isDefault", "status");
CREATE UNIQUE INDEX "EbaySellerConnection_one_default_per_organization"
  ON "EbaySellerConnection"("organizationId") WHERE "isDefault" = true;

-- Scope cached policies and merchant locations to the seller account that owns them.
ALTER TABLE "EbaySellerResource" ADD COLUMN "ebaySellerConnectionId" TEXT;
UPDATE "EbaySellerResource" resource
SET "ebaySellerConnectionId" = connection."id"
FROM "EbaySellerConnection" connection
WHERE connection."organizationId" = resource."organizationId" AND connection."isDefault" = true;
ALTER TABLE "EbaySellerResource" ALTER COLUMN "ebaySellerConnectionId" SET NOT NULL;
ALTER TABLE "EbaySellerResource"
  ADD CONSTRAINT "EbaySellerResource_ebaySellerConnectionId_fkey"
  FOREIGN KEY ("ebaySellerConnectionId") REFERENCES "EbaySellerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "EbaySellerResource_organizationId_marketplace_type_remoteId_key";
DROP INDEX IF EXISTS "EbaySellerResource_organizationId_marketplace_type_idx";
CREATE UNIQUE INDEX "EbaySellerResource_ebaySellerConnectionId_marketplace_type_remoteId_key"
  ON "EbaySellerResource"("ebaySellerConnectionId", "marketplace", "type", "remoteId");
CREATE INDEX "EbaySellerResource_organizationId_ebaySellerConnectionId_marketplace_type_idx"
  ON "EbaySellerResource"("organizationId", "ebaySellerConnectionId", "marketplace", "type");

-- Persist which seller account owns each draft. Existing drafts inherit the legacy default.
ALTER TABLE "ListingDraft" ADD COLUMN "ebaySellerConnectionId" TEXT;
UPDATE "ListingDraft" draft
SET "ebaySellerConnectionId" = connection."id"
FROM "EbaySellerConnection" connection
WHERE connection."organizationId" = draft."organizationId" AND connection."isDefault" = true;
ALTER TABLE "ListingDraft"
  ADD CONSTRAINT "ListingDraft_ebaySellerConnectionId_fkey"
  FOREIGN KEY ("ebaySellerConnectionId") REFERENCES "EbaySellerConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ListingDraft_ebaySellerConnectionId_idx" ON "ListingDraft"("ebaySellerConnectionId");
