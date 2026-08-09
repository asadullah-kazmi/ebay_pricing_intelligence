CREATE TABLE "ListingTeam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2563EB',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListingDraftTeam" (
    "listingDraftId" TEXT NOT NULL,
    "listingTeamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingDraftTeam_pkey" PRIMARY KEY ("listingDraftId", "listingTeamId")
);

CREATE UNIQUE INDEX "ListingTeam_organizationId_normalizedName_key"
ON "ListingTeam"("organizationId", "normalizedName");

CREATE INDEX "ListingTeam_organizationId_isArchived_name_idx"
ON "ListingTeam"("organizationId", "isArchived", "name");

CREATE INDEX "ListingDraftTeam_listingTeamId_listingDraftId_idx"
ON "ListingDraftTeam"("listingTeamId", "listingDraftId");

ALTER TABLE "ListingTeam"
ADD CONSTRAINT "ListingTeam_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListingDraftTeam"
ADD CONSTRAINT "ListingDraftTeam_listingDraftId_fkey"
FOREIGN KEY ("listingDraftId") REFERENCES "ListingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListingDraftTeam"
ADD CONSTRAINT "ListingDraftTeam_listingTeamId_fkey"
FOREIGN KEY ("listingTeamId") REFERENCES "ListingTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
