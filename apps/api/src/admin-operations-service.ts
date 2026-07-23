import { Prisma } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { startInventoryPreparationJob } from "./inventory-preparation-service.js";
import { startListingOperationJob } from "./ebay-listing-operation-service.js";
import { getWorkerHealth } from "./worker-operations.js";

export type AdminJobType =
  | "PRICING"
  | "FITMENT"
  | "INVENTORY_PREPARATION"
  | "INVENTORY_SYNC"
  | "OFFER"
  | "LISTING_OPERATION";

export class AdminOperationsError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "AdminOperationsError";
  }
}

const retryGuidance: Record<AdminJobType, string> = {
  PRICING: "Retry the failed item from the dead-letter queue.",
  FITMENT: "Retry the failed item from the dead-letter queue.",
  INVENTORY_PREPARATION: "Safe to retry because it only rebuilds a versioned local payload.",
  INVENTORY_SYNC: "Return to the listing workflow and explicitly sync inventory again.",
  OFFER: "Return to the offer workflow; publishing requires explicit approval.",
  LISTING_OPERATION: "Only reconciliation jobs are safe to retry here.",
};

interface FailedJob {
  jobType: AdminJobType;
  id: string;
  action: string | null;
  resourceId: string | null;
  label: string;
  lastError: string | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
  retryAllowed: boolean;
  retryReason: string;
}

function failedJob(input: Omit<FailedJob, "retryAllowed" | "retryReason">): FailedJob {
  return { ...input, ...getAdminRetryPolicy(input.jobType, input.action) };
}

export function getAdminRetryPolicy(jobType: AdminJobType, action: string | null) {
  const retryAllowed = jobType === "INVENTORY_PREPARATION"
    || (jobType === "LISTING_OPERATION" && action === "RECONCILE");
  return { retryAllowed, retryReason: retryGuidance[jobType] };
}

export async function getAdminOverview(organizationId: string) {
  const [
    memberCount,
    partCount,
    readyDraftCount,
    publishedCount,
    withdrawnCount,
    driftedCount,
    openDeadLetters,
    pendingOutbox,
    failedOutbox,
    pricingFailed,
    fitmentFailed,
    preparationFailed,
    syncFailed,
    offerFailed,
    listingOperationFailed,
    worker,
  ] = await Promise.all([
    prisma.organizationMembership.count({ where: { organizationId } }),
    prisma.part.count({ where: { organizationId } }),
    prisma.listingDraft.count({ where: { organizationId, status: "READY" } }),
    prisma.ebayOffer.count({ where: { organizationId, status: "PUBLISHED" } }),
    prisma.ebayOffer.count({ where: { organizationId, status: "WITHDRAWN" } }),
    prisma.ebayOffer.count({ where: { organizationId, status: "DRIFTED" } }),
    prisma.deadLetterEntry.count({ where: { organizationId, status: "OPEN" } }),
    prisma.outboxEvent.count({ where: { organizationId, status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.outboxEvent.count({ where: { organizationId, status: "FAILED" } }),
    prisma.pricingJob.count({ where: { organizationId, status: "FAILED" } }),
    prisma.fitmentJob.count({ where: { organizationId, status: "FAILED" } }),
    prisma.inventoryPreparationJob.count({ where: { organizationId, status: "FAILED" } }),
    prisma.ebayInventorySyncJob.count({ where: { organizationId, status: "FAILED" } }),
    prisma.ebayOfferJob.count({ where: { organizationId, status: "FAILED" } }),
    prisma.ebayListingOperationJob.count({ where: { organizationId, status: "FAILED" } }),
    getWorkerHealth(getConfig().jobs.workerHealthMaxAgeMs),
  ]);
  return {
    catalog: { parts: partCount, readyDrafts: readyDraftCount },
    organization: { members: memberCount },
    publishing: { published: publishedCount, withdrawn: withdrawnCount, drifted: driftedCount },
    delivery: { openDeadLetters, pendingOutbox, failedOutbox },
    failedJobs: pricingFailed + fitmentFailed + preparationFailed + syncFailed + offerFailed + listingOperationFailed,
    worker,
  };
}

export async function listPublishingOperations(organizationId: string, input: {
  status?: "PUBLISHED" | "WITHDRAWN" | "DRIFTED" | "FAILED";
  limit: number;
}) {
  return prisma.ebayOffer.findMany({
    where: { organizationId, status: input.status },
    orderBy: { updatedAt: "desc" },
    take: input.limit,
    select: {
      id: true,
      sku: true,
      marketplace: true,
      ebayOfferId: true,
      ebayListingId: true,
      status: true,
      remoteListingStatus: true,
      driftIssues: true,
      lastError: true,
      approvedAt: true,
      publishedAt: true,
      lastRevisionAt: true,
      withdrawnAt: true,
      lastReconciledAt: true,
      updatedAt: true,
      listingDraft: { select: { id: true, title: true, version: true } },
    },
  });
}

export async function listFailedJobs(organizationId: string, limit: number) {
  const take = Math.min(limit, 50);
  const [pricing, fitment, preparation, sync, offers, operations] = await Promise.all([
    prisma.pricingJob.findMany({ where: { organizationId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take }),
    prisma.fitmentJob.findMany({ where: { organizationId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take }),
    prisma.inventoryPreparationJob.findMany({
      where: { organizationId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take,
      include: { listingDraft: { select: { title: true } } },
    }),
    prisma.ebayInventorySyncJob.findMany({
      where: { organizationId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take,
      include: { listingDraft: { select: { title: true } } },
    }),
    prisma.ebayOfferJob.findMany({
      where: { organizationId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take,
      include: { listingDraft: { select: { title: true } } },
    }),
    prisma.ebayListingOperationJob.findMany({
      where: { organizationId, status: "FAILED" }, orderBy: { updatedAt: "desc" }, take,
      include: { listingDraft: { select: { title: true } } },
    }),
  ]);
  const jobs: FailedJob[] = [
    ...pricing.map((job) => failedJob({ jobType: "PRICING", id: job.id, action: null, resourceId: null, label: `${job.marketplace} pricing`, lastError: job.lastError, attemptCount: job.attemptCount, createdAt: job.createdAt, updatedAt: job.updatedAt })),
    ...fitment.map((job) => failedJob({ jobType: "FITMENT", id: job.id, action: null, resourceId: null, label: `${job.marketplace} fitment`, lastError: job.lastError, attemptCount: job.attemptCount, createdAt: job.createdAt, updatedAt: job.updatedAt })),
    ...preparation.map((job) => failedJob({ jobType: "INVENTORY_PREPARATION", id: job.id, action: "PREPARE", resourceId: job.listingDraftId, label: job.listingDraft.title, lastError: job.lastError, attemptCount: job.attemptCount, createdAt: job.createdAt, updatedAt: job.updatedAt })),
    ...sync.map((job) => failedJob({ jobType: "INVENTORY_SYNC", id: job.id, action: "SYNC", resourceId: job.listingDraftId, label: job.listingDraft.title, lastError: job.lastError, attemptCount: job.attemptCount, createdAt: job.createdAt, updatedAt: job.updatedAt })),
    ...offers.map((job) => failedJob({ jobType: "OFFER", id: job.id, action: job.action, resourceId: job.listingDraftId, label: job.listingDraft.title, lastError: job.lastError, attemptCount: job.attemptCount, createdAt: job.createdAt, updatedAt: job.updatedAt })),
    ...operations.map((job) => failedJob({ jobType: "LISTING_OPERATION", id: job.id, action: job.action, resourceId: job.listingDraftId, label: job.listingDraft.title, lastError: job.lastError, attemptCount: job.attemptCount, createdAt: job.createdAt, updatedAt: job.updatedAt })),
  ];
  return jobs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit);
}

export async function retryAdminJob(input: {
  organizationId: string;
  userId: string;
  jobType: AdminJobType;
  jobId: string;
  requestId?: string;
}) {
  let queued: { id: string; jobType: AdminJobType };
  if (input.jobType === "INVENTORY_PREPARATION") {
    queued = await prisma.$transaction(async (tx) => {
      const result = await tx.inventoryPreparationJob.updateMany({
        where: { id: input.jobId, organizationId: input.organizationId, status: "FAILED" },
        data: { status: "QUEUED", startedAt: null, completedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: null },
      });
      if (!result.count) throw new AdminOperationsError("Failed inventory preparation job not found", 404);
      await recordAuditEvent(tx, {
        organizationId: input.organizationId, actorUserId: input.userId,
        action: "admin.job.retry", resourceType: "InventoryPreparationJob", resourceId: input.jobId,
        severity: "WARNING", summary: "Administrator requeued a failed inventory preparation job",
        metadata: { jobType: input.jobType }, requestId: input.requestId,
      });
      return { id: input.jobId, jobType: input.jobType };
    });
  } else if (input.jobType === "LISTING_OPERATION") {
    queued = await prisma.$transaction(async (tx) => {
      const result = await tx.ebayListingOperationJob.updateMany({
        where: { id: input.jobId, organizationId: input.organizationId, status: "FAILED", action: "RECONCILE" },
        data: { status: "QUEUED", startedAt: null, completedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: null },
      });
      if (!result.count) throw new AdminOperationsError("Only a failed reconciliation job can be retried from the admin console", 409);
      await recordAuditEvent(tx, {
        organizationId: input.organizationId, actorUserId: input.userId,
        action: "admin.job.retry", resourceType: "EbayListingOperationJob", resourceId: input.jobId,
        severity: "WARNING", summary: "Administrator requeued a failed eBay reconciliation",
        metadata: { jobType: input.jobType, action: "RECONCILE" }, requestId: input.requestId,
      });
      return { id: input.jobId, jobType: input.jobType };
    });
  } else {
    throw new AdminOperationsError(retryGuidance[input.jobType], 409);
  }

  if (getConfig().jobs.executionMode === "inline") {
    if (queued.jobType === "INVENTORY_PREPARATION") startInventoryPreparationJob(queued.id);
    else startListingOperationJob(queued.id);
  }
  return { ...queued, status: "QUEUED" as const };
}

export function isRetryConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
