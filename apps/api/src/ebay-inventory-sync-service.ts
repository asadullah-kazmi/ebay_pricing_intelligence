import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { inlineJobOptions, leaseExpiry, runWithRetry, type JobRunOptions } from "./job-runtime.js";
import { enqueueOutboxEvent } from "./outbox-service.js";
import { putInventoryItem, replaceProductCompatibility } from "./providers/ebay-inventory.js";
import type { Marketplace } from "./types.js";

export class EbayInventorySyncError extends Error {
  readonly status: number;
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "EbayInventorySyncError";
    this.status = statusCode;
  }
}

const syncInclude = {
  preparation: true,
  listingDraft: { select: { id: true, marketplace: true, version: true, status: true, liveValidatedAt: true } },
} satisfies Prisma.EbayInventorySyncJobInclude;

export async function createEbayInventorySyncJob(input: {
  organizationId: string;
  userId: string;
  preparationId: string;
  confirmInventoryWrite: true;
}) {
  const preparation = await prisma.ebayInventoryPreparation.findFirst({
    where: { id: input.preparationId, organizationId: input.organizationId },
    include: { listingDraft: { select: { version: true, status: true, liveValidatedAt: true } } },
  });
  if (!preparation) throw new EbayInventorySyncError("Inventory preparation not found", 404);
  if (preparation.listingDraft.version !== preparation.draftVersion) throw new EbayInventorySyncError("The draft changed after preparation; prepare it again", 409);
  if (preparation.listingDraft.status !== "READY" || !preparation.listingDraft.liveValidatedAt) {
    throw new EbayInventorySyncError("The draft must still have current live eBay validation", 409);
  }
  const job = await prisma.ebayInventorySyncJob.upsert({
    where: { preparationId: preparation.id },
    create: {
      organizationId: input.organizationId,
      createdById: input.userId,
      listingDraftId: preparation.listingDraftId,
      preparationId: preparation.id,
      draftVersion: preparation.draftVersion,
      sku: preparation.sku,
      payloadHash: preparation.payloadHash,
    },
    update: {},
    include: syncInclude,
  });
  if (job.status !== "FAILED") return job;
  return prisma.ebayInventorySyncJob.update({
    where: { id: job.id },
    data: {
      status: "QUEUED", startedAt: null, completedAt: null, lastError: null,
      leaseOwner: null, leaseExpiresAt: null, inventoryWrittenAt: null, compatibilityWrittenAt: null,
    },
    include: syncInclude,
  });
}

export async function getEbayInventorySyncJob(organizationId: string, jobId: string) {
  const job = await prisma.ebayInventorySyncJob.findFirst({ where: { id: jobId, organizationId }, include: syncInclude });
  if (!job) throw new EbayInventorySyncError("eBay inventory sync job not found", 404);
  return job;
}

const activeSyncJobs = new Set<string>();

export async function runEbayInventorySyncJob(jobId: string, options: JobRunOptions = inlineJobOptions): Promise<void> {
  if (activeSyncJobs.has(jobId)) return;
  activeSyncJobs.add(jobId);
  try {
    const claimed = await prisma.ebayInventorySyncJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: {
        status: "RUNNING", startedAt: new Date(), completedAt: null, attemptCount: { increment: 1 },
        leaseOwner: options.leaseOwner, leaseExpiresAt: leaseExpiry(options), lastError: null,
      },
    });
    if (!claimed.count) return;
    const job = await prisma.ebayInventorySyncJob.findUnique({ where: { id: jobId }, include: syncInclude });
    if (!job) return;
    if (job.listingDraft.version !== job.draftVersion || job.listingDraft.status !== "READY" || !job.listingDraft.liveValidatedAt) {
      throw new EbayInventorySyncError("The draft changed or lost readiness after the sync was queued", 409);
    }
    const marketplace = job.listingDraft.marketplace as Marketplace;
    await runWithRetry(() => putInventoryItem(job.organizationId, marketplace, job.sku, job.preparation.inventoryPayload), options);
    await prisma.ebayInventorySyncJob.update({ where: { id: job.id }, data: { inventoryWrittenAt: new Date() } });
    await runWithRetry(
      () => replaceProductCompatibility(job.organizationId, marketplace, job.sku, job.preparation.compatibilityPayload),
      options,
    );
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.ebayInventorySyncJob.updateMany({
        where: { id: job.id, status: "RUNNING", leaseOwner: options.leaseOwner },
        data: {
          status: "COMPLETED", compatibilityWrittenAt: now, completedAt: now,
          leaseOwner: null, leaseExpiresAt: null, lastError: null,
        },
      });
      await enqueueOutboxEvent(tx, {
        organizationId: job.organizationId,
        topic: "listing.inventory.synced",
        aggregateType: "ListingDraft",
        aggregateId: job.listingDraftId,
        payload: { draftId: job.listingDraftId, preparationId: job.preparationId, sku: job.sku, payloadHash: job.payloadHash },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "eBay inventory sync failed";
    await prisma.ebayInventorySyncJob.updateMany({
      where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
      data: { status: "FAILED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: message },
    }).catch(() => undefined);
  } finally {
    activeSyncJobs.delete(jobId);
  }
}

export function startEbayInventorySyncJob(jobId: string, options: JobRunOptions = inlineJobOptions): void {
  setImmediate(() => void runEbayInventorySyncJob(jobId, options));
}

export function getActiveEbayInventorySyncJobCount(): number {
  return activeSyncJobs.size;
}

export async function startQueuedEbayInventorySyncJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const queued = await prisma.ebayInventorySyncJob.findMany({ where: { status: "QUEUED" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  queued.forEach(({ id }) => startEbayInventorySyncJob(id, options));
  return queued.length;
}

export async function resumeInterruptedEbayInventorySyncJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  await prisma.ebayInventorySyncJob.updateMany({
    where: { status: "RUNNING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
    data: { status: "QUEUED", startedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: "Worker lease expired; job requeued" },
  });
  return startQueuedEbayInventorySyncJobs(options);
}
