import { createHash } from "node:crypto";
import { Prisma, type DimensionUnit, type PartCondition, type WeightUnit } from "@prisma/client";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { getObjectStorage } from "./object-storage.js";
import { enqueueOutboxEvent } from "./outbox-service.js";
import { uploadImageToEbay } from "./providers/ebay-media.js";
import { inlineJobOptions, leaseExpiry, runWithRetry, type JobRunOptions } from "./job-runtime.js";

export class InventoryPreparationError extends Error {
  readonly status: number;
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 | 503 = 400) {
    super(message);
    this.name = "InventoryPreparationError";
    this.status = statusCode;
  }
}

interface PayloadInput {
  title: string;
  description: string;
  condition: PartCondition;
  quantity: number;
  aspects: Record<string, string[]>;
  imageUrls: string[];
  weight: number | null;
  weightUnit: WeightUnit | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: DimensionUnit | null;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function record(value: Prisma.JsonValue): Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, values]) =>
    Array.isArray(values) ? [[key, values.filter((item): item is string => typeof item === "string")]] : [],
  ));
}

function propertyRecord(value: Prisma.JsonValue): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => typeof item === "string" && item.trim() ? [[key, item]] : []));
}

function decimal(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value.toString());
}

export function buildInventoryItemPayload(input: PayloadInput) {
  const warnings: string[] = [];
  const condition = input.condition === "NEW" ? "NEW" : "USED_GOOD";
  if (input.condition === "USED") warnings.push("Used catalog condition is staged as USED_GOOD; confirm it is supported by the selected category before writing to eBay.");
  const packageWeightAndSize: Record<string, unknown> = {};
  if (input.weight !== null && input.weightUnit) {
    packageWeightAndSize.weight = { value: input.weight, unit: input.weightUnit === "LB" ? "POUND" : "KILOGRAM" };
  }
  if ([input.length, input.width, input.height].every((value) => value !== null) && input.dimensionUnit) {
    packageWeightAndSize.dimensions = {
      length: input.length,
      width: input.width,
      height: input.height,
      unit: input.dimensionUnit === "IN" ? "INCH" : "CENTIMETER",
    };
  } else if ([input.length, input.width, input.height].some((value) => value !== null)) {
    warnings.push("Incomplete package dimensions were omitted from the eBay payload.");
  }
  return {
    payload: {
      availability: { shipToLocationAvailability: { quantity: input.quantity } },
      condition,
      ...(input.condition === "USED" ? { conditionDescription: input.description.slice(0, 1_000) } : {}),
      product: {
        title: input.title,
        description: input.description,
        aspects: input.aspects,
        imageUrls: input.imageUrls,
      },
      ...(Object.keys(packageWeightAndSize).length ? { packageWeightAndSize } : {}),
    },
    warnings,
  };
}

export function buildCompatibilityPayload(applications: Array<Record<string, string>>) {
  return applications.length ? {
    compatibleProducts: applications.map((properties) => ({
      compatibilityProperties: Object.entries(properties).map(([name, value]) => ({ name, value })),
    })),
  } : null;
}

async function stageImage(input: {
  organizationId: string;
  mediaAsset: { id: string; storageKey: string; originalFilename: string; mimeType: string; checksum: string };
}) {
  const environment = getConfig().ebay.environment;
  const existing = await prisma.ebayPublishedImage.findUnique({
    where: { organizationId_mediaAssetId_environment: { organizationId: input.organizationId, mediaAssetId: input.mediaAsset.id, environment } },
  });
  const reusable = existing?.status === "READY"
    && existing.sourceChecksum === input.mediaAsset.checksum
    && existing.imageUrl
    && existing.expirationDate
    && existing.expirationDate.getTime() > Date.now() + 3 * 86_400_000;
  if (reusable) return existing.imageUrl!;

  const storage = getObjectStorage();
  if (!storage) throw new InventoryPreparationError("Object storage is not configured", 503);
  await prisma.ebayPublishedImage.upsert({
    where: { organizationId_mediaAssetId_environment: { organizationId: input.organizationId, mediaAssetId: input.mediaAsset.id, environment } },
    create: { organizationId: input.organizationId, mediaAssetId: input.mediaAsset.id, environment, status: "PENDING", sourceChecksum: input.mediaAsset.checksum },
    update: { status: "PENDING", sourceChecksum: input.mediaAsset.checksum, lastError: null },
  });
  try {
    const bytes = await storage.readImage(input.organizationId, input.mediaAsset.storageKey);
    const uploaded = await uploadImageToEbay({ bytes, filename: input.mediaAsset.originalFilename, mimeType: input.mediaAsset.mimeType });
    const saved = await prisma.ebayPublishedImage.update({
      where: { organizationId_mediaAssetId_environment: { organizationId: input.organizationId, mediaAssetId: input.mediaAsset.id, environment } },
      data: {
        status: "READY",
        ebayImageId: uploaded.imageId,
        imageUrl: uploaded.imageUrl,
        maxDimensionImageUrl: uploaded.maxDimensionImageUrl,
        expirationDate: uploaded.expirationDate,
        uploadedAt: new Date(),
        lastError: null,
      },
    });
    return saved.imageUrl!;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "eBay image upload failed";
    await prisma.ebayPublishedImage.update({
      where: { organizationId_mediaAssetId_environment: { organizationId: input.organizationId, mediaAssetId: input.mediaAsset.id, environment } },
      data: { status: "FAILED", lastError: message },
    });
    throw new InventoryPreparationError(`Unable to stage ${input.mediaAsset.originalFilename}: ${message}`, 502);
  }
}

export async function prepareInventoryItem(input: {
  organizationId: string;
  userId: string;
  draftId: string;
  expectedVersion: number;
}) {
  const draft = await prisma.listingDraft.findFirst({
    where: { id: input.draftId, organizationId: input.organizationId },
    include: {
      part: {
        include: {
          inventoryItem: true,
          media: {
            where: { approved: true, mediaAsset: { status: "READY" } },
            orderBy: { displayOrder: "asc" },
            include: { mediaAsset: true },
          },
          fitmentApplications: { orderBy: { approvedAt: "asc" } },
        },
      },
      inventoryPreparations: { where: { draftVersion: input.expectedVersion }, take: 1 },
    },
  });
  if (!draft) throw new InventoryPreparationError("Listing draft not found", 404);
  if (draft.version !== input.expectedVersion) throw new InventoryPreparationError("Listing draft changed; reload it before preparing inventory", 409);
  if (draft.status !== "READY" || !draft.liveValidatedAt) throw new InventoryPreparationError("The draft must pass live eBay validation before inventory preparation", 409);
  if (draft.inventoryPreparations[0]) return serializePreparation(draft.inventoryPreparations[0]);
  if (!draft.description) throw new InventoryPreparationError("Listing description is required");
  if (!draft.part.inventoryItem) throw new InventoryPreparationError("Part inventory data is missing", 409);
  if (!draft.part.media.length) throw new InventoryPreparationError("At least one approved image is required", 409);
  if (draft.part.sku.length > 50) throw new InventoryPreparationError("eBay inventory SKUs cannot exceed 50 characters");

  const selectedMedia = draft.part.media.slice(0, 24);
  const imageUrls: string[] = [];
  for (const media of selectedMedia) {
    imageUrls.push(await stageImage({ organizationId: input.organizationId, mediaAsset: media.mediaAsset }));
  }
  const inventory = draft.part.inventoryItem;
  const built = buildInventoryItemPayload({
    title: draft.title,
    description: draft.description,
    condition: draft.condition,
    quantity: draft.quantity,
    aspects: record(draft.aspects),
    imageUrls,
    weight: decimal(inventory.weight),
    weightUnit: inventory.weightUnit,
    length: decimal(inventory.length),
    width: decimal(inventory.width),
    height: decimal(inventory.height),
    dimensionUnit: inventory.dimensionUnit,
  });
  const compatibilityPayload = buildCompatibilityPayload(draft.part.fitmentApplications.map(({ properties }) => propertyRecord(properties)));
  const warnings = [
    ...built.warnings,
    ...(draft.part.media.length > 24 ? [`Only the first 24 of ${draft.part.media.length} approved images were staged.`] : []),
    ...(!compatibilityPayload ? ["No approved vehicle compatibility will be attached to this inventory item."] : []),
  ];
  const payloadHash = createHash("sha256").update(JSON.stringify({
    sku: draft.part.sku,
    inventoryPayload: built.payload,
    compatibilityPayload,
  })).digest("hex");

  const preparation = await prisma.$transaction(async (tx) => {
    const created = await tx.ebayInventoryPreparation.create({
      data: {
        organizationId: input.organizationId,
        listingDraftId: draft.id,
        draftVersion: draft.version,
        sku: draft.part.sku,
        payloadHash,
        inventoryPayload: asJson(built.payload),
        compatibilityPayload: compatibilityPayload ? asJson(compatibilityPayload) : Prisma.JsonNull,
        warnings: asJson(warnings),
        createdById: input.userId,
      },
    });
    await enqueueOutboxEvent(tx, {
      organizationId: input.organizationId,
      topic: "listing.inventory.prepared",
      aggregateType: "ListingDraft",
      aggregateId: draft.id,
      payload: { draftId: draft.id, draftVersion: draft.version, preparationId: created.id, payloadHash },
    });
    return created;
  });
  return serializePreparation(preparation);
}

function serializePreparation(preparation: {
  id: string;
  listingDraftId: string;
  draftVersion: number;
  sku: string;
  payloadHash: string;
  inventoryPayload: Prisma.JsonValue;
  compatibilityPayload: Prisma.JsonValue | null;
  warnings: Prisma.JsonValue;
  createdAt: Date;
}) {
  return preparation;
}

export async function getLatestInventoryPreparation(organizationId: string, draftId: string) {
  const preparation = await prisma.ebayInventoryPreparation.findFirst({
    where: { organizationId, listingDraftId: draftId },
    orderBy: { draftVersion: "desc" },
  });
  if (!preparation) throw new InventoryPreparationError("Inventory preparation not found", 404);
  return serializePreparation(preparation);
}

const activePreparationJobs = new Set<string>();

const jobInclude = {
  preparation: true,
  listingDraft: { select: { id: true, part: { select: { sku: true } } } },
} satisfies Prisma.InventoryPreparationJobInclude;

export async function createInventoryPreparationJob(input: {
  organizationId: string;
  userId: string;
  draftId: string;
  expectedVersion: number;
}) {
  const draft = await prisma.listingDraft.findFirst({
    where: { id: input.draftId, organizationId: input.organizationId },
    select: {
      id: true,
      version: true,
      status: true,
      liveValidatedAt: true,
      part: { select: { media: { where: { approved: true, mediaAsset: { status: "READY" } }, select: { id: true }, take: 1 } } },
    },
  });
  if (!draft) throw new InventoryPreparationError("Listing draft not found", 404);
  if (draft.version !== input.expectedVersion) throw new InventoryPreparationError("Listing draft changed; reload it before preparing inventory", 409);
  if (draft.status !== "READY" || !draft.liveValidatedAt) throw new InventoryPreparationError("The draft must pass live eBay validation before inventory preparation", 409);
  if (!draft.part.media.length) throw new InventoryPreparationError("At least one approved image is required", 409);
  const job = await prisma.inventoryPreparationJob.upsert({
    where: { listingDraftId_draftVersion: { listingDraftId: draft.id, draftVersion: draft.version } },
    create: {
      organizationId: input.organizationId,
      createdById: input.userId,
      listingDraftId: draft.id,
      draftVersion: draft.version,
    },
    update: {},
    include: jobInclude,
  });
  if (job.status !== "FAILED") return job;
  return prisma.inventoryPreparationJob.update({
    where: { id: job.id },
    data: { status: "QUEUED", startedAt: null, completedAt: null, lastError: null, leaseOwner: null, leaseExpiresAt: null },
    include: jobInclude,
  });
}

export async function getInventoryPreparationJob(organizationId: string, jobId: string) {
  const job = await prisma.inventoryPreparationJob.findFirst({ where: { id: jobId, organizationId }, include: jobInclude });
  if (!job) throw new InventoryPreparationError("Inventory preparation job not found", 404);
  return job;
}

export async function runInventoryPreparationJob(jobId: string, options: JobRunOptions = inlineJobOptions): Promise<void> {
  if (activePreparationJobs.has(jobId)) return;
  activePreparationJobs.add(jobId);
  try {
    const claimed = await prisma.inventoryPreparationJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        completedAt: null,
        attemptCount: { increment: 1 },
        leaseOwner: options.leaseOwner,
        leaseExpiresAt: leaseExpiry(options),
        lastError: null,
      },
    });
    if (!claimed.count) return;
    const job = await prisma.inventoryPreparationJob.findUnique({
      where: { id: jobId },
      select: { organizationId: true, createdById: true, listingDraftId: true, draftVersion: true },
    });
    if (!job) return;
    const preparation = await runWithRetry(
      () => prepareInventoryItem({
        organizationId: job.organizationId,
        userId: job.createdById,
        draftId: job.listingDraftId,
        expectedVersion: job.draftVersion,
      }),
      options,
    );
    await prisma.inventoryPreparationJob.updateMany({
      where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
      data: {
        status: "COMPLETED",
        preparationId: preparation.id,
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Inventory preparation failed";
    await prisma.inventoryPreparationJob.updateMany({
      where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
      data: { status: "FAILED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: message },
    }).catch(() => undefined);
  } finally {
    activePreparationJobs.delete(jobId);
  }
}

export function startInventoryPreparationJob(jobId: string, options: JobRunOptions = inlineJobOptions): void {
  setImmediate(() => void runInventoryPreparationJob(jobId, options));
}

export function getActiveInventoryPreparationJobCount(): number {
  return activePreparationJobs.size;
}

export async function startQueuedInventoryPreparationJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const queued = await prisma.inventoryPreparationJob.findMany({ where: { status: "QUEUED" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  queued.forEach(({ id }) => startInventoryPreparationJob(id, options));
  return queued.length;
}

export async function resumeInterruptedInventoryPreparationJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  await prisma.inventoryPreparationJob.updateMany({
    where: { status: "RUNNING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
    data: { status: "QUEUED", startedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: "Worker lease expired; job requeued" },
  });
  return startQueuedInventoryPreparationJobs(options);
}
