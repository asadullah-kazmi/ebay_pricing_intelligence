CREATE TABLE "CatalogSavedView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSavedView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogSavedView_organizationId_userId_name_key"
ON "CatalogSavedView"("organizationId", "userId", "name");

CREATE INDEX "CatalogSavedView_organizationId_userId_updatedAt_idx"
ON "CatalogSavedView"("organizationId", "userId", "updatedAt");

ALTER TABLE "CatalogSavedView"
ADD CONSTRAINT "CatalogSavedView_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogSavedView"
ADD CONSTRAINT "CatalogSavedView_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
