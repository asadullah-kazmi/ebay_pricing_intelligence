-- CreateEnum
CREATE TYPE "WeightUnit" AS ENUM ('LB', 'KG');
CREATE TYPE "DimensionUnit" AS ENUM ('IN', 'CM');

-- AlterTable
ALTER TABLE "InventoryItem"
  ADD COLUMN "weightUnit" "WeightUnit",
  ADD COLUMN "dimensionUnit" "DimensionUnit";

-- Require units whenever their corresponding measurements are present.
ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_weight_unit_check"
    CHECK (("weight" IS NULL AND "weightUnit" IS NULL) OR ("weight" IS NOT NULL AND "weightUnit" IS NOT NULL)),
  ADD CONSTRAINT "InventoryItem_dimension_unit_check"
    CHECK (
      ("length" IS NULL AND "width" IS NULL AND "height" IS NULL AND "dimensionUnit" IS NULL)
      OR
      (("length" IS NOT NULL OR "width" IS NOT NULL OR "height" IS NOT NULL) AND "dimensionUnit" IS NOT NULL)
    );
