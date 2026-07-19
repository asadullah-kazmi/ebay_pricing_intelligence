import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import type { ParsedImport } from "./import-parser.js";

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
