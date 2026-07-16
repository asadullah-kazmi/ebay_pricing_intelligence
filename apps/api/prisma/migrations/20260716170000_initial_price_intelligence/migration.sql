CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "oem" TEXT NOT NULL,
    "brand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Search" (
    "id" TEXT NOT NULL,
    "oem" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "competitorCount" INTEGER NOT NULL,
    "lowest" DECIMAL(12,2),
    "average" DECIMAL(12,2),
    "median" DECIMAL(12,2),
    "highest" DECIMAL(12,2),
    "recommendedPrice" DECIMAL(12,2),
    "currency" TEXT,
    CONSTRAINT "Search_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "shipping" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "matchedOn" TEXT[],
    "oem" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "shipping" DECIMAL(12,2) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Part_oem_key" ON "Part"("oem");
CREATE INDEX "Search_oem_searchedAt_idx" ON "Search"("oem", "searchedAt");
CREATE INDEX "PriceHistory_listingId_capturedAt_idx" ON "PriceHistory"("listingId", "capturedAt");
CREATE INDEX "PriceHistory_searchId_idx" ON "PriceHistory"("searchId");
ALTER TABLE "Search" ADD CONSTRAINT "Search_oem_fkey" FOREIGN KEY ("oem") REFERENCES "Part"("oem") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_oem_fkey" FOREIGN KEY ("oem") REFERENCES "Part"("oem") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE CASCADE ON UPDATE CASCADE;
