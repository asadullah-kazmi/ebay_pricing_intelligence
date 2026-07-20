import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { normalizePartNumber } from "./domain/matching.js";

export class ImportReviewError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400, readonly details?: unknown) {
    super(message);
    this.name = "ImportReviewError";
  }
}

const normalizedImportRowSchema = z.object({
  templateVersion: z.literal("1.0"),
  vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/).nullable(),
  sku: z.string().min(1).max(100),
  normalizedSku: z.string().min(1).max(100),
  primaryPartNumber: z.string().min(1).max(100),
  normalizedPartNumber: z.string().min(1).max(100),
  condition: z.enum(["NEW", "USED"]),
  quantity: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  imageGroup: z.string().min(1),
  brand: z.string().optional(),
  partName: z.string().optional(),
  interchangeNumbers: z.array(z.string()),
  description: z.string().optional(),
  donorMileage: z.number().int().nonnegative().optional(),
  donorColor: z.string().optional(),
  placement: z.string().optional(),
  warehouse: z.string().optional(),
  binLocation: z.string().optional(),
  weight: z.number().nonnegative().optional(),
  weightUnit: z.enum(["LB", "KG"]).optional(),
  length: z.number().nonnegative().optional(),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  dimensionUnit: z.enum(["IN", "CM"]).optional(),
  notes: z.string().optional(),
}).strict().superRefine((data, context) => {
  if (data.normalizedSku !== data.sku.toUpperCase()) {
    context.addIssue({ code: "custom", path: ["normalizedSku"], message: "Normalized SKU does not match SKU" });
  }
  if (data.normalizedPartNumber !== normalizePartNumber(data.primaryPartNumber)) {
    context.addIssue({ code: "custom", path: ["normalizedPartNumber"], message: "Normalized part number does not match primary part number" });
  }
  if ((data.weight !== undefined) !== (data.weightUnit !== undefined)) {
    context.addIssue({ code: "custom", path: ["weightUnit"], message: "Weight and weight unit must be supplied together" });
  }
  const hasDimensions = data.length !== undefined || data.width !== undefined || data.height !== undefined;
  if (hasDimensions !== (data.dimensionUnit !== undefined)) {
    context.addIssue({ code: "custom", path: ["dimensionUnit"], message: "Dimensions and dimension unit must be supplied together" });
  }
  if (data.binLocation && !data.warehouse) {
    context.addIssue({ code: "custom", path: ["warehouse"], message: "Warehouse is required for a bin location" });
  }
});

export type ConfirmableImportRow = z.infer<typeof normalizedImportRowSchema>;

export interface ImportReadinessInput {
  status: string;
  totalRows: number;
  invalidRows: number;
  imageReviewCount: number;
  imageUnmatchedCount: number;
}

export function buildImportReadiness(batch: ImportReadinessInput) {
  const blockers: Array<{ code: string; message: string }> = [];
  if (batch.status === "FAILED") blockers.push({ code: "IMPORT_FAILED", message: "The spreadsheet import failed and must be replaced" });
  if (batch.status === "COMMITTING") blockers.push({ code: "IMPORT_COMMITTING", message: "The import is already being confirmed" });
  if (batch.status === "COMPLETED") blockers.push({ code: "IMPORT_COMPLETED", message: "The import has already been confirmed" });
  if (!batch.totalRows) blockers.push({ code: "NO_ROWS", message: "The import contains no catalog rows" });
  if (batch.invalidRows) blockers.push({ code: "INVALID_ROWS", message: `${batch.invalidRows} spreadsheet row(s) must be corrected in a new import` });
  const unresolvedImages = batch.imageReviewCount + batch.imageUnmatchedCount;
  if (unresolvedImages) blockers.push({ code: "UNRESOLVED_IMAGES", message: `${unresolvedImages} image(s) still require assignment or removal` });
  return { canConfirm: blockers.length === 0, blockers };
}

export function parseConfirmableImportRow(value: unknown): ConfirmableImportRow {
  const result = normalizedImportRowSchema.safeParse(value);
  if (!result.success) throw new ImportReviewError("A staged row contains invalid normalized data", 409, result.error.issues);
  return result.data;
}

async function refreshImageCounts(tx: Prisma.TransactionClient, batch: { id: string; invalidRows: number; totalRows: number }) {
  const grouped = await tx.importMediaMatch.groupBy({
    by: ["status"],
    where: { importBatchId: batch.id },
    _count: { _all: true },
  });
  const count = (status: "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED") => grouped.find((group) => group.status === status)?._count._all ?? 0;
  const imageMatchCount = count("MATCHED");
  const imageReviewCount = count("REVIEW_REQUIRED");
  const imageUnmatchedCount = count("UNMATCHED");
  const status = batch.invalidRows || imageReviewCount || imageUnmatchedCount ? "REVIEW_REQUIRED" : "READY_TO_COMMIT";
  await tx.importBatch.update({
    where: { id: batch.id },
    data: { imageMatchCount, imageReviewCount, imageUnmatchedCount, status },
  });
  return {
    counts: { imageMatchCount, imageReviewCount, imageUnmatchedCount },
    readiness: buildImportReadiness({ ...batch, status, imageReviewCount, imageUnmatchedCount }),
  };
}

export async function getImportPreview(input: {
  organizationId: string;
  importBatchId: string;
  page: number;
  pageSize: number;
}) {
  const batch = await prisma.importBatch.findFirst({
    where: { id: input.importBatchId, organizationId: input.organizationId },
    select: {
      id: true, originalFilename: true, templateVersion: true, status: true,
      totalRows: true, validRows: true, warningRows: true, invalidRows: true,
      imageMatchCount: true, imageReviewCount: true, imageUnmatchedCount: true,
      errors: true, warnings: true, imageIssues: true, confirmedAt: true, createdAt: true, updatedAt: true,
      rows: {
        orderBy: { rowNumber: "asc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true, rowNumber: true, status: true, rawData: true, normalizedData: true,
          errors: true, warnings: true, committedPartId: true,
          mediaMatches: {
            orderBy: [{ displayOrder: "asc" }, { sourcePath: "asc" }],
            select: {
              id: true, sourcePath: true, strategy: true, status: true, displayOrder: true,
              mediaAsset: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true, width: true, height: true, status: true } },
            },
          },
        },
      },
      mediaMatches: {
        where: { importRowId: null },
        orderBy: [{ status: "asc" }, { sourcePath: "asc" }],
        take: 100,
        select: {
          id: true, sourcePath: true, strategy: true, status: true, displayOrder: true,
          mediaAsset: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true, width: true, height: true, status: true } },
        },
      },
      _count: { select: { rows: true, mediaMatches: { where: { importRowId: null } } } },
    },
  });
  if (!batch) throw new ImportReviewError("Import batch not found", 404);
  const { rows, mediaMatches: unassignedImages, _count, ...summary } = batch;
  return {
    batch: summary,
    readiness: buildImportReadiness(batch),
    pagination: { page: input.page, pageSize: input.pageSize, totalRows: _count.rows, totalPages: Math.ceil(_count.rows / input.pageSize) },
    rows,
    unassignedImages,
    unassignedImageTotal: _count.mediaMatches,
  };
}

export async function correctImportMediaMatch(input: {
  organizationId: string;
  importBatchId: string;
  mediaMatchId: string;
  importRowId: string | null;
  displayOrder?: number;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ImportBatch" WHERE "id" = ${input.importBatchId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
    const match = await tx.importMediaMatch.findFirst({
      where: { id: input.mediaMatchId, importBatchId: input.importBatchId, organizationId: input.organizationId },
      select: { id: true, displayOrder: true, importBatch: { select: { status: true, invalidRows: true, totalRows: true } } },
    });
    if (!match) throw new ImportReviewError("Image match not found", 404);
    if (["FAILED", "COMMITTING", "COMPLETED"].includes(match.importBatch.status)) {
      throw new ImportReviewError("This import can no longer be edited", 409);
    }
    if (input.importRowId) {
      const row = await tx.importRow.findFirst({
        where: { id: input.importRowId, importBatchId: input.importBatchId, organizationId: input.organizationId, status: { in: ["VALID", "WARNING"] } },
        select: { id: true },
      });
      if (!row) throw new ImportReviewError("Target import row is not valid or does not belong to this batch", 400);
    }
    const updated = await tx.importMediaMatch.update({
      where: { id: match.id },
      data: {
        importRowId: input.importRowId,
        displayOrder: input.displayOrder ?? match.displayOrder,
        strategy: "MANUAL",
        status: input.importRowId ? "MATCHED" : "UNMATCHED",
      },
      select: { id: true, importRowId: true, sourcePath: true, strategy: true, status: true, displayOrder: true },
    });
    return { match: updated, ...await refreshImageCounts(tx, { id: input.importBatchId, ...match.importBatch }) };
  });
}

export async function discardImportMediaMatch(input: { organizationId: string; importBatchId: string; mediaMatchId: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ImportBatch" WHERE "id" = ${input.importBatchId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
    const match = await tx.importMediaMatch.findFirst({
      where: { id: input.mediaMatchId, importBatchId: input.importBatchId, organizationId: input.organizationId },
      select: { id: true, importBatch: { select: { status: true, invalidRows: true, totalRows: true } } },
    });
    if (!match) throw new ImportReviewError("Image match not found", 404);
    if (["FAILED", "COMMITTING", "COMPLETED"].includes(match.importBatch.status)) {
      throw new ImportReviewError("This import can no longer be edited", 409);
    }
    await tx.importMediaMatch.delete({ where: { id: match.id } });
    return { discarded: true, ...await refreshImageCounts(tx, { id: input.importBatchId, ...match.importBatch }) };
  });
}

export async function confirmImportBatch(input: { organizationId: string; importBatchId: string; userId: string }) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ImportBatch" WHERE "id" = ${input.importBatchId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
      const batch = await tx.importBatch.findFirst({
        where: { id: input.importBatchId, organizationId: input.organizationId },
        select: {
          id: true, status: true, totalRows: true, invalidRows: true, imageReviewCount: true, imageUnmatchedCount: true,
          rows: {
            where: { status: { in: ["VALID", "WARNING", "COMMITTED"] } },
            orderBy: { rowNumber: "asc" },
            select: {
              id: true, rowNumber: true, status: true, normalizedData: true, committedPartId: true,
              mediaMatches: {
                where: { status: "MATCHED" },
                orderBy: [{ displayOrder: "asc" }, { sourcePath: "asc" }],
                select: { mediaAssetId: true, sourcePath: true },
              },
            },
          },
        },
      });
      if (!batch) throw new ImportReviewError("Import batch not found", 404);
      if (batch.status === "COMPLETED") {
        return { id: batch.id, status: batch.status, committedParts: batch.rows.filter((row) => row.committedPartId).length, reused: true };
      }
      const readiness = buildImportReadiness(batch);
      if (!readiness.canConfirm) throw new ImportReviewError("Import is not ready to confirm", 409, readiness.blockers);

      const rows = batch.rows.map((row) => ({ ...row, data: parseConfirmableImportRow(row.normalizedData) }));
      if (rows.length !== batch.totalRows) throw new ImportReviewError("Not every import row is ready to commit", 409);
      const normalizedSkus = rows.map(({ data }) => data.normalizedSku);
      if (new Set(normalizedSkus).size !== normalizedSkus.length) throw new ImportReviewError("The import contains duplicate normalized SKUs", 409);
      const existing = await tx.part.findMany({
        where: { organizationId: input.organizationId, normalizedSku: { in: normalizedSkus } },
        select: { normalizedSku: true },
      });
      if (existing.length) throw new ImportReviewError("One or more SKUs now exist in the catalog; upload a corrected import", 409, existing);

      await tx.importBatch.update({ where: { id: batch.id }, data: { status: "COMMITTING" } });
      let committedParts = 0;
      for (const row of rows) {
        const data = row.data;
        const vehicle = data.vin
          ? await tx.vehicle.upsert({
              where: { organizationId_vin: { organizationId: input.organizationId, vin: data.vin } },
              create: { organizationId: input.organizationId, vin: data.vin },
              update: {},
              select: { id: true },
            })
          : null;
        const warehouse = data.warehouse
          ? await tx.warehouse.upsert({
              where: { organizationId_code: { organizationId: input.organizationId, code: data.warehouse } },
              create: { organizationId: input.organizationId, code: data.warehouse, name: data.warehouse },
              update: {},
              select: { id: true },
            })
          : null;
        const binLocation = warehouse && data.binLocation
          ? await tx.binLocation.upsert({
              where: { warehouseId_code: { warehouseId: warehouse.id, code: data.binLocation } },
              create: { organizationId: input.organizationId, warehouseId: warehouse.id, code: data.binLocation },
              update: {},
              select: { id: true },
            })
          : null;
        const uniqueMedia = [...new Map(row.mediaMatches.map((match) => [match.mediaAssetId, match])).values()];
        const interchangeNumbers = [...new Map(data.interchangeNumbers.map((value) => [normalizePartNumber(value), value])).entries()]
          .filter(([normalized]) => normalized && normalized !== data.normalizedPartNumber);
        const part = await tx.part.create({
          data: {
            organizationId: input.organizationId,
            sku: data.sku,
            normalizedSku: data.normalizedSku,
            primaryPartNumber: data.primaryPartNumber,
            normalizedPartNumber: data.normalizedPartNumber,
            brand: data.brand,
            partName: data.partName,
            description: data.description,
            condition: data.condition,
            imageGroup: data.imageGroup,
            status: uniqueMedia.length ? "READY_FOR_ENRICHMENT" : "NEEDS_IMAGES",
            donorVehicleId: vehicle?.id,
            donorMileage: data.donorMileage,
            donorColor: data.donorColor,
            placement: data.placement,
            notes: data.notes,
            createdById: input.userId,
            partNumbers: {
              create: [
                { organizationId: input.organizationId, type: "PRIMARY", value: data.primaryPartNumber, normalizedValue: data.normalizedPartNumber },
                ...interchangeNumbers.map(([normalizedValue, value]) => ({ organizationId: input.organizationId, type: "INTERCHANGE" as const, value, normalizedValue })),
              ],
            },
            inventoryItem: {
              create: {
                organizationId: input.organizationId,
                warehouseId: warehouse?.id,
                binLocationId: binLocation?.id,
                quantity: data.quantity,
                cost: new Prisma.Decimal(data.cost),
                currency: data.currency,
                weight: data.weight === undefined ? undefined : new Prisma.Decimal(data.weight),
                weightUnit: data.weightUnit,
                length: data.length === undefined ? undefined : new Prisma.Decimal(data.length),
                width: data.width === undefined ? undefined : new Prisma.Decimal(data.width),
                height: data.height === undefined ? undefined : new Prisma.Decimal(data.height),
                dimensionUnit: data.dimensionUnit,
              },
            },
            media: {
              create: uniqueMedia.map((match, displayOrder) => ({
                organizationId: input.organizationId,
                mediaAssetId: match.mediaAssetId,
                displayOrder,
                approved: true,
                altText: data.partName ? `${data.partName} - ${data.sku}` : `Automotive part ${data.sku}`,
              })),
            },
          },
          select: { id: true },
        });
        await tx.importRow.update({ where: { id: row.id }, data: { status: "COMMITTED", committedPartId: part.id } });
        committedParts += 1;
      }
      const completed = await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: "COMPLETED", confirmedAt: new Date() },
        select: { id: true, status: true, confirmedAt: true },
      });
      return { ...completed, committedParts, reused: false };
    }, { maxWait: 10_000, timeout: 60_000 });
  } catch (error) {
    if (error instanceof ImportReviewError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ImportReviewError("A catalog record was created concurrently; refresh the preview and retry", 409);
    }
    throw error;
  }
}
