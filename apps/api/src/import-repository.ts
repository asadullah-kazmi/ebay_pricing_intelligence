import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import type { ParsedImport } from "./import-parser.js";
import type { ImageArchiveIssue, ImageMappingRow, MappedArchiveImage } from "./image-archive.js";

export class ImportBatchStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportBatchStateError";
  }
}

export interface ImportBatchSummary {
  id: string;
  status: string;
  originalFilename: string;
  templateVersion: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  invalidRows: number;
  createdAt: Date;
  reused: boolean;
}

function toSummary(batch: Omit<ImportBatchSummary, "reused">, reused: boolean): ImportBatchSummary {
  return { ...batch, reused };
}

export async function findImportByChecksum(organizationId: string, checksum: string): Promise<ImportBatchSummary | null> {
  const batch = await prisma.importBatch.findUnique({
    where: { organizationId_checksum: { organizationId, checksum } },
    select: {
      id: true,
      status: true,
      originalFilename: true,
      templateVersion: true,
      totalRows: true,
      validRows: true,
      warningRows: true,
      invalidRows: true,
      createdAt: true,
    },
  });
  return batch ? toSummary(batch, true) : null;
}

export async function findExistingNormalizedSkus(organizationId: string, normalizedSkus: string[]): Promise<Set<string>> {
  if (!normalizedSkus.length) return new Set();
  const parts = await prisma.part.findMany({
    where: { organizationId, normalizedSku: { in: [...new Set(normalizedSkus)] } },
    select: { normalizedSku: true },
  });
  return new Set(parts.map(({ normalizedSku }) => normalizedSku));
}

export async function stageParsedImport(input: {
  organizationId: string;
  createdById: string;
  originalFilename: string;
  checksum: string;
  sourceFileKey: string;
  parsed: ParsedImport;
}): Promise<ImportBatchSummary> {
  const validRows = input.parsed.rows.filter(({ status }) => status === "VALID").length;
  const warningRows = input.parsed.rows.filter(({ status }) => status === "WARNING").length;
  const invalidRows = input.parsed.rows.filter(({ status }) => status === "INVALID").length;
  const status = input.parsed.errors.length
    ? "FAILED"
    : invalidRows
      ? "REVIEW_REQUIRED"
      : "READY_TO_COMMIT";

  try {
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          organizationId: input.organizationId,
          createdById: input.createdById,
          originalFilename: input.originalFilename,
          templateVersion: "1.0",
          checksum: input.checksum,
          sourceFileKey: input.sourceFileKey,
          status,
          totalRows: input.parsed.rows.length,
          validRows,
          warningRows,
          invalidRows,
          errors: input.parsed.errors as unknown as Prisma.InputJsonValue,
          warnings: input.parsed.warnings as unknown as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          status: true,
          originalFilename: true,
          templateVersion: true,
          totalRows: true,
          validRows: true,
          warningRows: true,
          invalidRows: true,
          createdAt: true,
        },
      });
      if (input.parsed.rows.length) {
        await tx.importRow.createMany({
          data: input.parsed.rows.map((row) => ({
            organizationId: input.organizationId,
            importBatchId: created.id,
            rowNumber: row.rowNumber,
            rawData: row.rawData as Prisma.InputJsonValue,
            normalizedData: row.normalizedData
              ? row.normalizedData as unknown as Prisma.InputJsonValue
              : Prisma.JsonNull,
            status: row.status,
            errors: row.errors as unknown as Prisma.InputJsonValue,
            warnings: row.warnings as unknown as Prisma.InputJsonValue,
          })),
        });
      }
      return created;
    });
    return toSummary(batch, false);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await findImportByChecksum(input.organizationId, input.checksum);
      if (existing) return existing;
    }
    throw error;
  }
}

export interface ImageMappingBatch {
  id: string;
  status: string;
  invalidRows: number;
  imageArchiveKey: string | null;
  imageArchiveChecksum: string | null;
  imageMatchCount: number;
  imageReviewCount: number;
  imageUnmatchedCount: number;
  rows: ImageMappingRow[];
}

export async function findImageMappingBatch(organizationId: string, importBatchId: string): Promise<ImageMappingBatch | null> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: importBatchId, organizationId },
    select: {
      id: true,
      status: true,
      invalidRows: true,
      imageArchiveKey: true,
      imageArchiveChecksum: true,
      imageMatchCount: true,
      imageReviewCount: true,
      imageUnmatchedCount: true,
      rows: {
        where: { status: { in: ["VALID", "WARNING"] } },
        select: { id: true, rowNumber: true, normalizedData: true },
      },
    },
  });
  if (!batch) return null;
  const rows = batch.rows.flatMap((row) => {
    const data = row.normalizedData;
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const sku = data.sku;
    const imageGroup = data.imageGroup;
    const vin = data.vin;
    if (typeof sku !== "string" || typeof imageGroup !== "string" || (vin !== null && typeof vin !== "string")) return [];
    return [{ id: row.id, rowNumber: row.rowNumber, sku, imageGroup, vin }];
  });
  return { ...batch, rows };
}

export async function findReusableMediaAsset(organizationId: string, checksum: string) {
  return prisma.mediaAsset.findFirst({
    where: { organizationId, checksum, status: { not: "QUARANTINED" } },
    select: { id: true },
  });
}

export async function saveImageArchiveMappings(input: {
  organizationId: string;
  importBatchId: string;
  archiveKey: string;
  archiveChecksum: string;
  invalidRows: number;
  issues: ImageArchiveIssue[];
  mappings: Array<MappedArchiveImage & { mediaAssetId: string }>;
}) {
  const imageMatchCount = input.mappings.filter(({ status }) => status === "MATCHED").length;
  const imageReviewCount = input.mappings.filter(({ status }) => status === "REVIEW_REQUIRED").length;
  const imageUnmatchedCount = input.mappings.filter(({ status }) => status === "UNMATCHED").length;
  const status = input.invalidRows || imageReviewCount || imageUnmatchedCount || input.issues.some(({ severity }) => severity === "error")
    ? "REVIEW_REQUIRED"
    : "READY_TO_COMMIT";

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ImportBatch" WHERE "id" = ${input.importBatchId} AND "organizationId" = ${input.organizationId} FOR UPDATE`;
    const batch = await tx.importBatch.findFirst({
      where: { id: input.importBatchId, organizationId: input.organizationId },
      select: {
        id: true,
        status: true,
        imageArchiveChecksum: true,
        imageMatchCount: true,
        imageReviewCount: true,
        imageUnmatchedCount: true,
      },
    });
    if (!batch) throw new ImportBatchStateError("Import batch not found");
    if (["FAILED", "COMMITTING", "COMPLETED"].includes(batch.status)) {
      throw new ImportBatchStateError("This import can no longer accept an image archive");
    }
    if (batch.imageArchiveChecksum === input.archiveChecksum) return {
      id: batch.id,
      status: batch.status,
      imageMatchCount: batch.imageMatchCount,
      imageReviewCount: batch.imageReviewCount,
      imageUnmatchedCount: batch.imageUnmatchedCount,
      reused: true,
    };
    if (batch.imageArchiveChecksum) throw new ImportBatchStateError("This import already has a different image archive");
    if (input.mappings.length) {
      await tx.importMediaMatch.createMany({
        data: input.mappings.map((mapping) => ({
          organizationId: input.organizationId,
          importBatchId: input.importBatchId,
          importRowId: mapping.importRowId,
          mediaAssetId: mapping.mediaAssetId,
          sourcePath: mapping.sourcePath,
          strategy: mapping.strategy,
          status: mapping.status,
          displayOrder: mapping.displayOrder,
        })),
      });
    }
    const saved = await tx.importBatch.update({
      where: { id: input.importBatchId },
      data: {
        imageArchiveKey: input.archiveKey,
        imageArchiveChecksum: input.archiveChecksum,
        imageMatchCount,
        imageReviewCount,
        imageUnmatchedCount,
        imageIssues: input.issues as unknown as Prisma.InputJsonValue,
        status,
      },
      select: {
        id: true,
        status: true,
        imageMatchCount: true,
        imageReviewCount: true,
        imageUnmatchedCount: true,
      },
    });
    return { ...saved, reused: false };
  });
}
