import { createHash } from "node:crypto";
import { Prisma, type PartCondition } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";
import { parseConfirmableImportRow } from "./import-review-service.js";
import {
  assembleQuickSkuPrepared,
  enhanceQuickSkuWithAi,
  fetchQuickSkuFitment,
  identifyQuickSkuPart,
  attachAftermarketBrowseImages,
} from "./quick-sku-service.js";
import type { Marketplace } from "./types.js";
import { allocateOrganizationSku } from "./sku-policy-service.js";

export class PipelineError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "PipelineError";
  }
}

const activeJobs = new Set<string>();

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function pipelineErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Unable to process this row").slice(0, 1_000);
}

export function pipelineProgress(totalRows: number, processedRows: number, failedRows: number) {
  const finishedRows = Math.min(totalRows, processedRows + failedRows);
  return {
    finishedRows,
    percent: totalRows ? Math.round((finishedRows / totalRows) * 100) : 0,
  };
}

const batchSummarySelect = {
  id: true,
  originalFilename: true,
  status: true,
  totalRows: true,
  validRows: true,
  warningRows: true,
  invalidRows: true,
  processedRows: true,
  failedRows: true,
  defaultCondition: true,
  marketplace: true,
  assignImages: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  listingTeam: { select: { id: true, name: true, color: true, isArchived: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ImportBatchSelect;

export async function listPipelineJobs(organizationId: string, limit = 30) {
  const jobs = await prisma.importBatch.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: batchSummarySelect,
  });
  return { jobs: jobs.map((job) => ({ ...job, progress: pipelineProgress(job.totalRows, job.processedRows, job.failedRows) })) };
}

export async function getPipelineJob(organizationId: string, importBatchId: string) {
  const job = await prisma.importBatch.findFirst({
    where: { id: importBatchId, organizationId },
    select: {
      ...batchSummarySelect,
      rows: {
        orderBy: { rowNumber: "asc" },
        select: {
          id: true,
          rowNumber: true,
          status: true,
          pipelineStage: true,
          pipelineError: true,
          normalizedData: true,
          enrichmentData: true,
          committedPart: {
            select: {
              id: true,
              sku: true,
              primaryPartNumber: true,
              brand: true,
              partName: true,
              status: true,
              listingDrafts: { select: { id: true, title: true, status: true, marketplace: true }, take: 1 },
              fitmentApplications: { where: { status: "APPROVED" }, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!job) throw new PipelineError("Pipeline job not found", 404);
  return { ...job, progress: pipelineProgress(job.totalRows, job.processedRows, job.failedRows) };
}

export async function configurePipelineJob(input: {
  organizationId: string;
  importBatchId: string;
  listingTeamId: string;
  condition: PartCondition;
  marketplace: Marketplace;
  assignImages: boolean;
}) {
  const [batch, team] = await Promise.all([
    prisma.importBatch.findFirst({ where: { id: input.importBatchId, organizationId: input.organizationId } }),
    prisma.listingTeam.findFirst({ where: { id: input.listingTeamId, organizationId: input.organizationId, isArchived: false } }),
  ]);
  if (!batch) throw new PipelineError("Pipeline job not found", 404);
  if (!team) throw new PipelineError("Select an active listing team", 400);
  if (batch.invalidRows) throw new PipelineError(`${batch.invalidRows} invalid row(s) must be corrected before processing`, 409);
  if (["COMPLETED", "FAILED"].includes(batch.status)) throw new PipelineError("This pipeline job has already finished", 409);

  return prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      listingTeamId: team.id,
      defaultCondition: input.condition,
      marketplace: input.marketplace,
      assignImages: input.assignImages,
      status: "COMMITTING",
      startedAt: batch.startedAt ?? new Date(),
      completedAt: null,
    },
    select: batchSummarySelect,
  });
}

async function updateRowStage(rowId: string, pipelineStage: "IDENTIFYING" | "FITMENT" | "BUILDING_LISTING" | "CATALOG") {
  await prisma.importRow.update({ where: { id: rowId }, data: { pipelineStage, pipelineError: null } });
}

async function processPipelineRow(input: {
  organizationId: string;
  userId: string;
  batchId: string;
  rowId: string;
  teamId: string;
  condition: PartCondition;
  marketplace: Marketplace;
  assignImages: boolean;
}) {
  const row = await prisma.importRow.findFirst({
    where: { id: input.rowId, importBatchId: input.batchId, organizationId: input.organizationId },
    include: {
      mediaMatches: {
        where: { status: "MATCHED" },
        orderBy: [{ displayOrder: "asc" }, { sourcePath: "asc" }],
        select: { mediaAssetId: true },
      },
    },
  });
  if (!row) throw new PipelineError("Pipeline row not found", 404);
  if (row.committedPartId) {
    await prisma.importRow.update({ where: { id: row.id }, data: { status: "COMMITTED", pipelineStage: "COMPLETED", pipelineError: null } });
    return row.committedPartId;
  }

  const data = parseConfirmableImportRow(row.normalizedData);
  const brand = data.brand?.trim() || "Unbranded";
  await updateRowStage(row.id, "IDENTIFYING");
  const identifiedBase = await identifyQuickSkuPart(input.organizationId, {
    partNumber: data.primaryPartNumber,
    brand,
    marketplace: input.marketplace,
  });
  const identified = await enhanceQuickSkuWithAi(identifiedBase, { condition: input.condition });

  await updateRowStage(row.id, "FITMENT");
  const fitment = await fetchQuickSkuFitment(input.organizationId, {
    partNumber: data.primaryPartNumber,
    brand,
    marketplace: input.marketplace,
    epid: identified.best?.epid ?? null,
  });

  await updateRowStage(row.id, "BUILDING_LISTING");
  const prepared = assembleQuickSkuPrepared({ identify: identified, fitment, condition: input.condition });
  const enrichmentData = {
    identificationSource: prepared.identificationSource,
    matched: prepared.matched,
    epid: prepared.candidateEpid,
    score: prepared.candidateScore,
    categoryId: prepared.categoryId,
    categoryName: prepared.categoryName,
    fitmentCount: prepared.fitmentCount,
    fitmentReason: prepared.fitmentReason,
    title: prepared.listingTitle,
  };
  await prisma.importRow.update({ where: { id: row.id }, data: { enrichmentData: asJson(enrichmentData) } });

  await updateRowStage(row.id, "CATALOG");
  const stagedMediaIds = [...new Set(row.mediaMatches.map(({ mediaAssetId }) => mediaAssetId))];
  const result = await prisma.$transaction(async (tx) => {
    const hasUploadedSku = data.skuProvided !== false;
    const allocatedSku = hasUploadedSku
      ? { sku: data.sku, normalizedSku: data.normalizedSku }
      : await allocateOrganizationSku(tx, input.organizationId, data.primaryPartNumber);
    if (hasUploadedSku) {
      const existing = await tx.part.findFirst({ where: { organizationId: input.organizationId, normalizedSku: allocatedSku.normalizedSku }, select: { id: true } });
      if (existing) throw new PipelineError(`SKU ${allocatedSku.sku} already exists in the catalog`, 409);
    }
    const vehicle = data.vin ? await tx.vehicle.upsert({
      where: { organizationId_vin: { organizationId: input.organizationId, vin: data.vin } },
      create: { organizationId: input.organizationId, vin: data.vin }, update: {}, select: { id: true },
    }) : null;
    const warehouse = data.warehouse ? await tx.warehouse.upsert({
      where: { organizationId_code: { organizationId: input.organizationId, code: data.warehouse } },
      create: { organizationId: input.organizationId, code: data.warehouse, name: data.warehouse }, update: {}, select: { id: true },
    }) : null;
    const bin = warehouse && data.binLocation ? await tx.binLocation.upsert({
      where: { warehouseId_code: { warehouseId: warehouse.id, code: data.binLocation } },
      create: { organizationId: input.organizationId, warehouseId: warehouse.id, code: data.binLocation }, update: {}, select: { id: true },
    }) : null;

    const externalMediaIds: string[] = [];
    for (const [index, imageUrl] of (data.imageUrls ?? []).entries()) {
      const checksum = createHash("sha256").update(imageUrl).digest("hex");
      const mediaAsset = await tx.mediaAsset.upsert({
        where: { organizationId_storageKey: { organizationId: input.organizationId, storageKey: `external/pipeline/${checksum}` } },
        create: {
          organizationId: input.organizationId,
          storageKey: `external/pipeline/${checksum}`,
          externalUrl: imageUrl,
          sourceType: "PIPELINE_URL",
          sourceMetadata: asJson({ importBatchId: input.batchId, importRowId: row.id, imageUrl }),
          originalFilename: `${allocatedSku.sku}-image-${index + 1}.jpg`.slice(0, 255),
          mimeType: "image/jpeg",
          byteSize: 0,
          checksum,
          status: "READY",
        },
        update: { externalUrl: imageUrl, status: "READY" },
        select: { id: true },
      });
      externalMediaIds.push(mediaAsset.id);
    }
    const uniqueMediaIds = [...new Set([...stagedMediaIds, ...externalMediaIds])];

    const part = await tx.part.create({
      data: {
        organizationId: input.organizationId,
        sku: allocatedSku.sku,
        normalizedSku: allocatedSku.normalizedSku,
        primaryPartNumber: data.primaryPartNumber,
        normalizedPartNumber: data.normalizedPartNumber,
        brand: data.brand?.trim() || prepared.identifiedBrand || brand,
        partName: prepared.partName,
        description: data.description ?? prepared.description,
        condition: input.condition,
        imageGroup: data.imageGroup,
        status: uniqueMediaIds.length ? "READY_FOR_ENRICHMENT" : "NEEDS_IMAGES",
        donorVehicleId: vehicle?.id,
        donorMileage: data.donorMileage,
        donorColor: data.donorColor,
        placement: prepared.placement ?? data.placement,
        notes: data.notes,
        createdById: input.userId,
        partNumbers: { create: [
          { organizationId: input.organizationId, type: "PRIMARY", value: data.primaryPartNumber, normalizedValue: data.normalizedPartNumber },
          ...data.interchangeNumbers.map((value) => ({ organizationId: input.organizationId, type: "INTERCHANGE" as const, value, normalizedValue: value.toUpperCase().replace(/[^A-Z0-9]/g, "") })),
        ] },
        inventoryItem: { create: {
          organizationId: input.organizationId,
          warehouseId: warehouse?.id,
          binLocationId: bin?.id,
          quantity: data.quantity,
          cost: new Prisma.Decimal(data.cost),
          currency: data.currency,
          weight: data.weight === undefined ? undefined : new Prisma.Decimal(data.weight),
          weightUnit: data.weightUnit,
          length: data.length === undefined ? undefined : new Prisma.Decimal(data.length),
          width: data.width === undefined ? undefined : new Prisma.Decimal(data.width),
          height: data.height === undefined ? undefined : new Prisma.Decimal(data.height),
          dimensionUnit: data.dimensionUnit,
        } },
        media: { create: uniqueMediaIds.map((mediaAssetId, displayOrder) => ({
          organizationId: input.organizationId, mediaAssetId, displayOrder, approved: true,
          altText: `${prepared.partName} - ${allocatedSku.sku}`,
        })) },
      },
    });

    if (prepared.applications.length) await tx.fitmentApplication.createMany({
      data: prepared.applications.map(({ fingerprint, properties }) => ({
        organizationId: input.organizationId,
        partId: part.id,
        marketplace: input.marketplace,
        source: "EBAY_CATALOG",
        status: "APPROVED",
        fingerprint,
        properties: asJson(properties),
        notes: prepared.candidateEpid ? `Pipeline enrichment from eBay catalog (${prepared.candidateEpid})` : null,
        createdById: input.userId,
        approvedById: input.userId,
        approvedAt: new Date(),
        decisionReason: "Automatically approved by catalog pipeline",
      })),
    });

    const aspects = {
      ...prepared.aspects,
      "Manufacturer Part Number": [data.primaryPartNumber],
      Brand: [data.brand?.trim() || prepared.identifiedBrand || brand],
      ...(prepared.placement || data.placement ? { Placement: [prepared.placement || data.placement!] } : {}),
    };
    const issues = [
      ...(!uniqueMediaIds.length ? [{ code: "IMAGES_REQUIRED", severity: "BLOCKER", field: "images", message: "Add approved listing images" }] : []),
      ...(data.sellingPrice === undefined ? [{ code: "PRICE_REQUIRED", severity: "BLOCKER", field: "price", message: "Set a selling price" }] : []),
      { code: "POLICIES_REQUIRED", severity: "BLOCKER", field: "policies", message: "Assign eBay business policies" },
    ];
    const draft = await tx.listingDraft.create({
      data: {
        organizationId: input.organizationId,
        partId: part.id,
        marketplace: input.marketplace,
        status: "BLOCKED",
        title: prepared.listingTitle,
        description: data.description ?? prepared.description,
        categoryId: prepared.categoryId,
        condition: input.condition,
        ebayCondition: input.condition === "NEW" ? "NEW" : null,
        price: data.sellingPrice === undefined ? null : new Prisma.Decimal(data.sellingPrice),
        currency: data.currency,
        quantity: data.quantity,
        aspects: asJson(aspects),
        validationIssues: asJson(issues),
        validatedAt: new Date(),
        createdById: input.userId,
        updatedById: input.userId,
        teams: { create: { listingTeamId: input.teamId } },
      },
    });
    await tx.listingDraftVersion.create({
      data: {
        organizationId: input.organizationId,
        listingDraftId: draft.id,
        version: 1,
        snapshot: asJson({ title: prepared.listingTitle, description: data.description ?? prepared.description, categoryId: prepared.categoryId, condition: input.condition, price: data.sellingPrice ?? null, currency: data.currency, quantity: data.quantity, aspects, status: "BLOCKED", validationIssues: issues }),
        reason: "Created by automated catalog pipeline",
        createdById: input.userId,
      },
    });
    await tx.importRow.update({
      where: { id: row.id },
      data: { status: "COMMITTED", pipelineStage: "COMPLETED", pipelineError: null, enrichmentData: asJson(enrichmentData), committedPartId: part.id },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "pipeline.row.completed",
      resourceType: "ImportRow",
      resourceId: row.id,
      summary: `Pipeline added ${allocatedSku.sku} to the catalog`,
      metadata: { importBatchId: input.batchId, partId: part.id, listingDraftId: draft.id, teamId: input.teamId, fitmentCount: prepared.fitmentCount },
    });
    return { partId: part.id, listingDraftId: draft.id };
  }, { maxWait: 10_000, timeout: 60_000 });

  if (input.assignImages) {
    const images = await attachAftermarketBrowseImages({
      organizationId: input.organizationId,
      partId: result.partId,
      partNumber: data.primaryPartNumber,
      brand: data.brand?.trim() || prepared.identifiedBrand || brand,
      marketplace: input.marketplace,
      condition: input.condition,
      requestedCount: 2,
    });
    if (images.attachedCount >= 2) {
      await prisma.$transaction([
        prisma.part.update({ where: { id: result.partId }, data: { status: "READY_FOR_ENRICHMENT" } }),
        prisma.listingDraft.update({
          where: { id: result.listingDraftId },
          data: {
            validationIssues: asJson([
              ...(data.sellingPrice === undefined
                ? [{ code: "PRICE_REQUIRED", severity: "BLOCKER", field: "price", message: "Set a selling price" }]
                : []),
              { code: "POLICIES_REQUIRED", severity: "BLOCKER", field: "policies", message: "Assign eBay business policies" },
            ]),
          },
        }),
        prisma.importRow.update({
          where: { id: row.id },
          data: { enrichmentData: asJson({ ...enrichmentData, images }) },
        }),
      ]);
    } else {
      await prisma.importRow.update({
        where: { id: row.id },
        data: { enrichmentData: asJson({ ...enrichmentData, images }) },
      });
    }
  }
  return result.partId;
}

export async function runPipelineJob(input: { organizationId: string; importBatchId: string }) {
  if (activeJobs.has(input.importBatchId)) return;
  activeJobs.add(input.importBatchId);
  try {
    const batch = await prisma.importBatch.findFirst({
      where: { id: input.importBatchId, organizationId: input.organizationId },
      select: { id: true, createdById: true, listingTeamId: true, defaultCondition: true, marketplace: true, assignImages: true, status: true },
    });
    if (!batch) throw new PipelineError("Pipeline job not found", 404);
    if (!batch.listingTeamId || !batch.defaultCondition) throw new PipelineError("Pipeline team and condition are not configured", 409);
    if (batch.status !== "COMMITTING") return;

    const rows = await prisma.importRow.findMany({
      where: { importBatchId: batch.id, status: { in: ["VALID", "WARNING", "COMMITTED"] }, pipelineStage: { notIn: ["COMPLETED", "FAILED"] } },
      orderBy: { rowNumber: "asc" },
      select: { id: true },
    });
    for (const row of rows) {
      try {
        await processPipelineRow({
          organizationId: input.organizationId,
          userId: batch.createdById,
          batchId: batch.id,
          rowId: row.id,
          teamId: batch.listingTeamId,
          condition: batch.defaultCondition,
          marketplace: batch.marketplace as Marketplace,
          assignImages: batch.assignImages,
        });
        await prisma.importBatch.update({ where: { id: batch.id }, data: { processedRows: { increment: 1 } } });
      } catch (error) {
        const message = pipelineErrorMessage(error);
        await prisma.$transaction([
          prisma.importRow.update({ where: { id: row.id }, data: { pipelineStage: "FAILED", pipelineError: message } }),
          prisma.importBatch.update({ where: { id: batch.id }, data: { failedRows: { increment: 1 } } }),
        ]);
        console.error(JSON.stringify({ type: "pipeline_row_failed", importBatchId: batch.id, importRowId: row.id, error: message }));
      }
    }
    const counts = await prisma.importRow.groupBy({ by: ["pipelineStage"], where: { importBatchId: batch.id }, _count: { _all: true } });
    const failedRows = counts.find(({ pipelineStage }) => pipelineStage === "FAILED")?._count._all ?? 0;
    const processedRows = counts.find(({ pipelineStage }) => pipelineStage === "COMPLETED")?._count._all ?? 0;
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "COMPLETED", processedRows, failedRows, completedAt: new Date(), confirmedAt: new Date() },
    });
  } finally {
    activeJobs.delete(input.importBatchId);
  }
}

export async function startPipelineJob(input: {
  organizationId: string;
  importBatchId: string;
  listingTeamId: string;
  condition: PartCondition;
  marketplace: Marketplace;
  assignImages: boolean;
}) {
  const job = await configurePipelineJob(input);
  void runPipelineJob({ organizationId: input.organizationId, importBatchId: input.importBatchId }).catch((error) => {
    console.error(JSON.stringify({ type: "pipeline_job_failed", importBatchId: input.importBatchId, error: pipelineErrorMessage(error) }));
  });
  return { ...job, progress: pipelineProgress(job.totalRows, job.processedRows, job.failedRows) };
}

export async function retryPipelineJob(input: { organizationId: string; importBatchId: string }) {
  const batch = await prisma.importBatch.findFirst({ where: { id: input.importBatchId, organizationId: input.organizationId } });
  if (!batch) throw new PipelineError("Pipeline job not found", 404);
  if (!batch.listingTeamId || !batch.defaultCondition) throw new PipelineError("Pipeline job is not configured", 409);
  await prisma.$transaction([
    prisma.importRow.updateMany({ where: { importBatchId: batch.id, pipelineStage: "FAILED" }, data: { pipelineStage: "QUEUED", pipelineError: null } }),
    prisma.importBatch.update({ where: { id: batch.id }, data: { status: "COMMITTING", failedRows: 0, completedAt: null } }),
  ]);
  void runPipelineJob({ organizationId: input.organizationId, importBatchId: input.importBatchId });
  return { accepted: true };
}

export async function resumeInterruptedPipelineJobs() {
  const jobs = await prisma.importBatch.findMany({ where: { status: "COMMITTING", listingTeamId: { not: null }, defaultCondition: { not: null } }, select: { id: true, organizationId: true } });
  for (const job of jobs) void runPipelineJob({ organizationId: job.organizationId, importBatchId: job.id });
  return jobs.length;
}
