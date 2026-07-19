-- Preserve the existing competitor-pricing data while reserving Part for the tenant catalog.
ALTER TABLE "Part" RENAME TO "LegacyPricingPart";
ALTER TABLE "LegacyPricingPart" RENAME CONSTRAINT "Part_pkey" TO "LegacyPricingPart_pkey";
ALTER INDEX "Part_oem_key" RENAME TO "LegacyPricingPart_oem_key";

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'PARSING', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING', 'COMPLETED', 'FAILED');
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'VALID', 'WARNING', 'INVALID', 'COMMITTED');
CREATE TYPE "PartCondition" AS ENUM ('NEW', 'USED');
CREATE TYPE "CatalogPartStatus" AS ENUM ('IMPORTED', 'NEEDS_IMAGES', 'IMPORT_ERROR', 'READY_FOR_ENRICHMENT', 'ARCHIVED');
CREATE TYPE "PartNumberType" AS ENUM ('PRIMARY', 'OEM', 'MPN', 'INTERCHANGE');
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'QUARANTINED', 'FAILED');

-- CreateTable
CREATE TABLE "ImportBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "templateVersion" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "sourceFileKey" TEXT,
  "imageArchiveKey" TEXT,
  "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "validRows" INTEGER NOT NULL DEFAULT 0,
  "warningRows" INTEGER NOT NULL DEFAULT 0,
  "invalidRows" INTEGER NOT NULL DEFAULT 0,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportBatch_row_counts_check" CHECK (
    "totalRows" >= 0 AND "validRows" >= 0 AND "warningRows" >= 0 AND "invalidRows" >= 0
  )
);

CREATE TABLE "Vehicle" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "vin" TEXT NOT NULL,
  "year" INTEGER,
  "make" TEXT,
  "model" TEXT,
  "trim" TEXT,
  "engine" TEXT,
  "bodyStyle" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Part" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "primaryPartNumber" TEXT NOT NULL,
  "normalizedPartNumber" TEXT NOT NULL,
  "brand" TEXT,
  "partName" TEXT,
  "description" TEXT,
  "condition" "PartCondition" NOT NULL,
  "imageGroup" TEXT,
  "status" "CatalogPartStatus" NOT NULL DEFAULT 'IMPORTED',
  "donorVehicleId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportRow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "rawData" JSONB NOT NULL,
  "normalizedData" JSONB,
  "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
  "errors" JSONB,
  "warnings" JSONB,
  "committedPartId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportRow_rowNumber_check" CHECK ("rowNumber" > 0)
);

CREATE TABLE "PartNumber" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "type" "PartNumberType" NOT NULL,
  "value" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartNumber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Warehouse" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BinLocation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BinLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "binLocationId" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "cost" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "weight" DECIMAL(10,3),
  "length" DECIMAL(10,2),
  "width" DECIMAL(10,2),
  "height" DECIMAL(10,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryItem_nonnegative_check" CHECK (
    "quantity" >= 0 AND "cost" >= 0 AND
    ("weight" IS NULL OR "weight" >= 0) AND
    ("length" IS NULL OR "length" >= 0) AND
    ("width" IS NULL OR "width" >= 0) AND
    ("height" IS NULL OR "height" >= 0)
  )
);

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaAsset_dimensions_check" CHECK (
    "byteSize" >= 0 AND ("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)
  )
);

CREATE TABLE "PartMedia" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "partId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "altText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartMedia_displayOrder_check" CHECK ("displayOrder" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_organizationId_checksum_key" ON "ImportBatch"("organizationId", "checksum");
CREATE INDEX "ImportBatch_organizationId_status_createdAt_idx" ON "ImportBatch"("organizationId", "status", "createdAt");
CREATE INDEX "ImportBatch_createdById_idx" ON "ImportBatch"("createdById");
CREATE UNIQUE INDEX "Vehicle_organizationId_vin_key" ON "Vehicle"("organizationId", "vin");
CREATE INDEX "Vehicle_organizationId_year_make_model_idx" ON "Vehicle"("organizationId", "year", "make", "model");
CREATE UNIQUE INDEX "Part_organizationId_sku_key" ON "Part"("organizationId", "sku");
CREATE INDEX "Part_organizationId_normalizedPartNumber_idx" ON "Part"("organizationId", "normalizedPartNumber");
CREATE INDEX "Part_organizationId_status_createdAt_idx" ON "Part"("organizationId", "status", "createdAt");
CREATE INDEX "Part_donorVehicleId_idx" ON "Part"("donorVehicleId");
CREATE INDEX "Part_createdById_idx" ON "Part"("createdById");
CREATE UNIQUE INDEX "ImportRow_committedPartId_key" ON "ImportRow"("committedPartId");
CREATE UNIQUE INDEX "ImportRow_importBatchId_rowNumber_key" ON "ImportRow"("importBatchId", "rowNumber");
CREATE INDEX "ImportRow_organizationId_status_idx" ON "ImportRow"("organizationId", "status");
CREATE UNIQUE INDEX "PartNumber_partId_type_normalizedValue_key" ON "PartNumber"("partId", "type", "normalizedValue");
CREATE INDEX "PartNumber_organizationId_normalizedValue_idx" ON "PartNumber"("organizationId", "normalizedValue");
CREATE UNIQUE INDEX "Warehouse_organizationId_code_key" ON "Warehouse"("organizationId", "code");
CREATE UNIQUE INDEX "BinLocation_warehouseId_code_key" ON "BinLocation"("warehouseId", "code");
CREATE INDEX "BinLocation_organizationId_idx" ON "BinLocation"("organizationId");
CREATE UNIQUE INDEX "InventoryItem_partId_key" ON "InventoryItem"("partId");
CREATE INDEX "InventoryItem_organizationId_quantity_idx" ON "InventoryItem"("organizationId", "quantity");
CREATE INDEX "InventoryItem_warehouseId_binLocationId_idx" ON "InventoryItem"("warehouseId", "binLocationId");
CREATE UNIQUE INDEX "MediaAsset_organizationId_storageKey_key" ON "MediaAsset"("organizationId", "storageKey");
CREATE INDEX "MediaAsset_organizationId_checksum_idx" ON "MediaAsset"("organizationId", "checksum");
CREATE INDEX "MediaAsset_organizationId_status_idx" ON "MediaAsset"("organizationId", "status");
CREATE UNIQUE INDEX "PartMedia_partId_mediaAssetId_key" ON "PartMedia"("partId", "mediaAssetId");
CREATE UNIQUE INDEX "PartMedia_partId_displayOrder_key" ON "PartMedia"("partId", "displayOrder");
CREATE INDEX "PartMedia_organizationId_mediaAssetId_idx" ON "PartMedia"("organizationId", "mediaAssetId");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Part" ADD CONSTRAINT "Part_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Part" ADD CONSTRAINT "Part_donorVehicleId_fkey" FOREIGN KEY ("donorVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Part" ADD CONSTRAINT "Part_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_committedPartId_fkey" FOREIGN KEY ("committedPartId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PartNumber" ADD CONSTRAINT "PartNumber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartNumber" ADD CONSTRAINT "PartNumber_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartMedia" ADD CONSTRAINT "PartMedia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartMedia" ADD CONSTRAINT "PartMedia_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartMedia" ADD CONSTRAINT "PartMedia_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
