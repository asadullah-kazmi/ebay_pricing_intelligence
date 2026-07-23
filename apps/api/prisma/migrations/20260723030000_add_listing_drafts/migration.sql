CREATE TYPE "ListingDraftStatus" AS ENUM ('DRAFT', 'BLOCKED', 'READY');

CREATE TABLE "ListingDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "status" "ListingDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "condition" "PartCondition" NOT NULL,
    "price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "aspects" JSONB NOT NULL,
    "paymentPolicyId" TEXT,
    "returnPolicyId" TEXT,
    "shippingPolicyId" TEXT,
    "merchantLocationKey" TEXT,
    "validationIssues" JSONB,
    "validatedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListingDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingDraftVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingDraftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListingDraftVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingDraft_partId_marketplace_key" ON "ListingDraft"("partId", "marketplace");
CREATE INDEX "ListingDraft_organizationId_status_updatedAt_idx" ON "ListingDraft"("organizationId", "status", "updatedAt");
CREATE INDEX "ListingDraft_organizationId_marketplace_idx" ON "ListingDraft"("organizationId", "marketplace");
CREATE UNIQUE INDEX "ListingDraftVersion_listingDraftId_version_key" ON "ListingDraftVersion"("listingDraftId", "version");
CREATE INDEX "ListingDraftVersion_organizationId_createdAt_idx" ON "ListingDraftVersion"("organizationId", "createdAt");

ALTER TABLE "ListingDraft" ADD CONSTRAINT "ListingDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingDraft" ADD CONSTRAINT "ListingDraft_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingDraft" ADD CONSTRAINT "ListingDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingDraft" ADD CONSTRAINT "ListingDraft_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ListingDraftVersion" ADD CONSTRAINT "ListingDraftVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingDraftVersion" ADD CONSTRAINT "ListingDraftVersion_listingDraftId_fkey" FOREIGN KEY ("listingDraftId") REFERENCES "ListingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingDraftVersion" ADD CONSTRAINT "ListingDraftVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
