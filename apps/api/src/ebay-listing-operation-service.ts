import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { buildOfferPayload, EbayOfferError } from "./ebay-offer-service.js";
import { inlineJobOptions, leaseExpiry, runWithRetry, type JobRunOptions } from "./job-runtime.js";
import { enqueueOutboxEvent } from "./outbox-service.js";
import { getOfferSnapshot, updateOffer, withdrawOffer, type RemoteOfferSnapshot } from "./providers/ebay-inventory.js";
import type { Marketplace } from "./types.js";
import { recordAuditEvent } from "./audit-service.js";

export class EbayListingOperationError extends Error {
  readonly status: number;
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "EbayListingOperationError";
    this.status = statusCode;
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scalar(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function evaluateOfferDrift(localValue: unknown, remoteValue: unknown): string[] {
  const local = object(localValue);
  const remote = object(remoteValue);
  const localPolicies = object(local.listingPolicies);
  const remotePolicies = object(remote.listingPolicies);
  const localPrice = object(object(local.pricingSummary).price);
  const remotePrice = object(object(remote.pricingSummary).price);
  const checks: Array<[string, unknown, unknown, boolean?]> = [
    ["sku", local.sku, remote.sku],
    ["marketplaceId", local.marketplaceId, remote.marketplaceId],
    ["categoryId", local.categoryId, remote.categoryId],
    ["availableQuantity", local.availableQuantity, remote.availableQuantity, true],
    ["merchantLocationKey", local.merchantLocationKey, remote.merchantLocationKey],
    ["paymentPolicyId", localPolicies.paymentPolicyId, remotePolicies.paymentPolicyId],
    ["returnPolicyId", localPolicies.returnPolicyId, remotePolicies.returnPolicyId],
    ["fulfillmentPolicyId", localPolicies.fulfillmentPolicyId, remotePolicies.fulfillmentPolicyId],
    ["price.currency", localPrice.currency, remotePrice.currency],
    ["price.value", localPrice.value, remotePrice.value, true],
  ];
  return checks.flatMap(([field, localField, remoteField, numeric]) => {
    const equal = numeric
      ? Number.isFinite(Number(localField)) && Number.isFinite(Number(remoteField)) && Number(localField) === Number(remoteField)
      : scalar(localField) === scalar(remoteField);
    return equal ? [] : [`${field}: local "${scalar(localField)}", eBay "${scalar(remoteField)}"`];
  });
}

const jobInclude = {
  ebayOffer: true,
  inventorySyncJob: true,
  listingDraft: true,
} satisfies Prisma.EbayListingOperationJobInclude;

async function assertNoActiveOperation(offerId: string) {
  const active = await prisma.ebayListingOperationJob.findFirst({
    where: { ebayOfferId: offerId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { action: true },
  });
  if (active) throw new EbayListingOperationError(`A ${active.action.toLowerCase()} operation is already in progress`, 409);
}

export async function createRevisionJob(input: {
  organizationId: string;
  userId: string;
  offerId: string;
  inventorySyncJobId: string;
  confirmRevision: true;
}) {
  const [offer, sync] = await Promise.all([
    prisma.ebayOffer.findFirst({ where: { id: input.offerId, organizationId: input.organizationId }, include: { listingDraft: true } }),
    prisma.ebayInventorySyncJob.findFirst({ where: { id: input.inventorySyncJobId, organizationId: input.organizationId }, include: { listingDraft: true } }),
  ]);
  if (!offer) throw new EbayListingOperationError("Published eBay offer not found", 404);
  if (!sync) throw new EbayListingOperationError("Completed inventory sync not found", 404);
  if (offer.status !== "PUBLISHED" || !offer.ebayOfferId || !offer.ebayListingId) throw new EbayListingOperationError("Only an active, reconciled listing can be revised", 409);
  if (sync.status !== "COMPLETED" || !sync.completedAt) throw new EbayListingOperationError("Complete the new inventory sync before revising", 409);
  if (sync.listingDraftId !== offer.listingDraftId || sync.draftVersion !== sync.listingDraft.version) throw new EbayListingOperationError("Inventory sync does not match the current listing draft", 409);
  if (sync.draftVersion <= offer.draftVersion) throw new EbayListingOperationError("The published listing already contains this draft version", 409);
  if (sync.sku !== offer.sku || sync.listingDraft.marketplace !== offer.marketplace) throw new EbayListingOperationError("SKU and marketplace cannot be changed through listing revision", 409);
  if (sync.listingDraft.status !== "READY" || !sync.listingDraft.liveValidatedAt) throw new EbayListingOperationError("The revised draft must pass live eBay validation", 409);
  await assertNoActiveOperation(offer.id);
  const payload = buildOfferPayload(sync.listingDraft, sync.sku);
  const job = await prisma.$transaction(async (tx) => {
    await tx.ebayOffer.update({ where: { id: offer.id }, data: { status: "REVISION_QUEUED", lastError: null } });
    return tx.ebayListingOperationJob.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.userId,
        listingDraftId: offer.listingDraftId,
        ebayOfferId: offer.id,
        inventorySyncJobId: sync.id,
        targetDraftVersion: sync.draftVersion,
        action: "REVISE",
        requestedPayload: asJson(payload),
      },
      include: jobInclude,
    });
  });
  return job;
}

export async function createWithdrawalJob(input: {
  organizationId: string;
  userId: string;
  offerId: string;
  confirmWithdraw: true;
}) {
  const offer = await prisma.ebayOffer.findFirst({ where: { id: input.offerId, organizationId: input.organizationId } });
  if (!offer) throw new EbayListingOperationError("Published eBay offer not found", 404);
  if (!["PUBLISHED", "DRIFTED"].includes(offer.status) || !offer.ebayOfferId || !offer.ebayListingId) {
    throw new EbayListingOperationError("Only a live or drifted published listing can be withdrawn", 409);
  }
  await assertNoActiveOperation(offer.id);
  return prisma.$transaction(async (tx) => {
    await tx.ebayOffer.update({ where: { id: offer.id }, data: { status: "WITHDRAW_QUEUED", lastError: null } });
    return tx.ebayListingOperationJob.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.userId,
        listingDraftId: offer.listingDraftId,
        ebayOfferId: offer.id,
        targetDraftVersion: offer.draftVersion,
        action: "WITHDRAW",
      },
      include: jobInclude,
    });
  });
}

export async function createReconciliationJob(input: { organizationId: string; userId: string; offerId: string }) {
  const offer = await prisma.ebayOffer.findFirst({ where: { id: input.offerId, organizationId: input.organizationId } });
  if (!offer) throw new EbayListingOperationError("eBay offer not found", 404);
  if (!offer.ebayOfferId) throw new EbayListingOperationError("The local offer has no remote eBay offer ID", 409);
  if (!offer.publishedAt && !offer.ebayListingId) throw new EbayListingOperationError("Only a previously published offer can be reconciled as a listing", 409);
  await assertNoActiveOperation(offer.id);
  return prisma.ebayListingOperationJob.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.userId,
      listingDraftId: offer.listingDraftId,
      ebayOfferId: offer.id,
      targetDraftVersion: offer.draftVersion,
      action: "RECONCILE",
    },
    include: jobInclude,
  });
}

export async function getListingOperationJob(organizationId: string, jobId: string) {
  const job = await prisma.ebayListingOperationJob.findFirst({ where: { id: jobId, organizationId }, include: jobInclude });
  if (!job) throw new EbayListingOperationError("eBay listing operation job not found", 404);
  return job;
}

function resolvedStatus(snapshot: RemoteOfferSnapshot, driftIssues: string[]) {
  if (["ACTIVE", "OUT_OF_STOCK"].includes(snapshot.listingStatus ?? "")) return driftIssues.length ? "DRIFTED" as const : "PUBLISHED" as const;
  return "WITHDRAWN" as const;
}

async function persistReconciliation(
  job: Prisma.EbayListingOperationJobGetPayload<{ include: typeof jobInclude }>,
  snapshot: RemoteOfferSnapshot,
  driftIssues: string[],
) {
  const now = new Date();
  const status = resolvedStatus(snapshot, driftIssues);
  await prisma.$transaction(async (tx) => {
    await tx.ebayOffer.update({
      where: { id: job.ebayOffer.id },
      data: {
        status,
        ebayListingId: snapshot.listingId ?? job.ebayOffer.ebayListingId,
        remoteListingStatus: snapshot.listingStatus,
        remoteSnapshot: asJson(snapshot.payload),
        driftIssues: asJson(driftIssues),
        lastReconciledAt: now,
        ...(status === "WITHDRAWN" ? { withdrawnAt: job.ebayOffer.withdrawnAt ?? now } : {}),
        lastError: null,
      },
    });
    await tx.ebayListingOperationJob.update({
      where: { id: job.id },
      data: { remoteSnapshot: asJson(snapshot.payload), driftIssues: asJson(driftIssues) },
    });
    await enqueueOutboxEvent(tx, {
      organizationId: job.organizationId,
      topic: driftIssues.length ? "listing.reconciliation.drifted" : "listing.reconciled",
      aggregateType: "ListingDraft",
      aggregateId: job.listingDraftId,
      payload: { offerId: job.ebayOffer.id, listingId: snapshot.listingId, listingStatus: snapshot.listingStatus, driftIssues },
    });
    await recordAuditEvent(tx, {
      organizationId: job.organizationId,
      actorUserId: job.createdById,
      action: driftIssues.length ? "ebay.listing.drift_detected" : "ebay.listing.reconciled",
      resourceType: "EbayOffer",
      resourceId: job.ebayOffer.id,
      severity: driftIssues.length ? "WARNING" : "INFO",
      summary: driftIssues.length ? `Detected ${driftIssues.length} eBay listing drift issue(s)` : "Reconciled eBay listing state",
      metadata: { listingId: snapshot.listingId, listingStatus: snapshot.listingStatus, driftIssues },
    });
  });
}

async function runReconcile(job: Prisma.EbayListingOperationJobGetPayload<{ include: typeof jobInclude }>, options: JobRunOptions) {
  if (!job.ebayOffer.ebayOfferId) throw new EbayListingOperationError("Remote offer ID is missing", 409);
  const snapshot = await runWithRetry(
    () => getOfferSnapshot(job.organizationId, job.ebayOffer.marketplace as Marketplace, job.ebayOffer.ebayOfferId!),
    options,
  );
  await persistReconciliation(job, snapshot, evaluateOfferDrift(job.ebayOffer.offerPayload, snapshot.payload));
}

async function runRevision(job: Prisma.EbayListingOperationJobGetPayload<{ include: typeof jobInclude }>, options: JobRunOptions) {
  if (!job.ebayOffer.ebayOfferId || !job.inventorySyncJob || !job.requestedPayload) throw new EbayListingOperationError("Revision evidence is incomplete", 409);
  const sync = job.inventorySyncJob;
  if (job.listingDraft.version !== job.targetDraftVersion || job.listingDraft.status !== "READY" || !job.listingDraft.liveValidatedAt) {
    throw new EbayListingOperationError("Draft changed or lost live readiness after revision approval", 409);
  }
  if (sync.status !== "COMPLETED" || sync.draftVersion !== job.targetDraftVersion) {
    throw new EbayListingOperationError("Revision inventory sync is stale or incomplete", 409);
  }
  const marketplace = job.ebayOffer.marketplace as Marketplace;
  const before = await runWithRetry(() => getOfferSnapshot(job.organizationId, marketplace, job.ebayOffer.ebayOfferId!), options);
  if (!["ACTIVE", "OUT_OF_STOCK"].includes(before.listingStatus ?? "")) throw new EbayListingOperationError("Remote listing is not active; reconcile it before revision", 409);
  await runWithRetry(() => updateOffer(job.organizationId, marketplace, job.ebayOffer.ebayOfferId!, job.requestedPayload), options);
  const after = await runWithRetry(() => getOfferSnapshot(job.organizationId, marketplace, job.ebayOffer.ebayOfferId!), options);
  const driftIssues = evaluateOfferDrift(job.requestedPayload, after.payload);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.ebayOffer.update({
      where: { id: job.ebayOffer.id },
      data: {
        inventorySyncJobId: sync.id,
        preparationId: sync.preparationId,
        draftVersion: sync.draftVersion,
        payloadHash: sync.payloadHash,
        offerPayload: job.requestedPayload as Prisma.InputJsonValue,
        status: driftIssues.length ? "DRIFTED" : "PUBLISHED",
        revisionCount: { increment: 1 },
        lastRevisionAt: now,
        remoteListingStatus: after.listingStatus,
        remoteSnapshot: asJson(after.payload),
        driftIssues: asJson(driftIssues),
        lastReconciledAt: now,
        lastError: null,
      },
    });
    await tx.ebayListingOperationJob.update({
      where: { id: job.id },
      data: { remoteSnapshot: asJson(after.payload), driftIssues: asJson(driftIssues) },
    });
    await enqueueOutboxEvent(tx, {
      organizationId: job.organizationId,
      topic: "listing.revised",
      aggregateType: "ListingDraft",
      aggregateId: job.listingDraftId,
      payload: { offerId: job.ebayOffer.id, listingId: after.listingId, draftVersion: sync.draftVersion, driftIssues },
    });
    await recordAuditEvent(tx, {
      organizationId: job.organizationId,
      actorUserId: job.createdById,
      action: "ebay.listing.revised",
      resourceType: "EbayOffer",
      resourceId: job.ebayOffer.id,
      severity: driftIssues.length ? "WARNING" : "INFO",
      summary: `Revised eBay listing to draft version ${sync.draftVersion}`,
      metadata: { listingId: after.listingId, draftVersion: sync.draftVersion, driftIssues },
    });
  });
}

async function runWithdrawal(job: Prisma.EbayListingOperationJobGetPayload<{ include: typeof jobInclude }>, options: JobRunOptions) {
  if (!job.ebayOffer.ebayOfferId) throw new EbayListingOperationError("Remote offer ID is missing", 409);
  const marketplace = job.ebayOffer.marketplace as Marketplace;
  let snapshot = await runWithRetry(() => getOfferSnapshot(job.organizationId, marketplace, job.ebayOffer.ebayOfferId!), options);
  if (["ACTIVE", "OUT_OF_STOCK"].includes(snapshot.listingStatus ?? "")) {
    try {
      await withdrawOffer(job.organizationId, marketplace, job.ebayOffer.ebayOfferId);
    } catch (error) {
      snapshot = await getOfferSnapshot(job.organizationId, marketplace, job.ebayOffer.ebayOfferId).catch(() => snapshot);
      if (["ACTIVE", "OUT_OF_STOCK"].includes(snapshot.listingStatus ?? "")) throw error;
    }
    snapshot = await runWithRetry(() => getOfferSnapshot(job.organizationId, marketplace, job.ebayOffer.ebayOfferId!), options);
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.ebayOffer.update({
      where: { id: job.ebayOffer.id },
      data: {
        status: "WITHDRAWN",
        withdrawnAt: now,
        remoteListingStatus: snapshot.listingStatus,
        remoteSnapshot: asJson(snapshot.payload),
        driftIssues: asJson([]),
        lastReconciledAt: now,
        lastError: null,
      },
    });
    await tx.ebayListingOperationJob.update({
      where: { id: job.id },
      data: { remoteSnapshot: asJson(snapshot.payload), driftIssues: asJson([]) },
    });
    await enqueueOutboxEvent(tx, {
      organizationId: job.organizationId,
      topic: "listing.withdrawn",
      aggregateType: "ListingDraft",
      aggregateId: job.listingDraftId,
      payload: { offerId: job.ebayOffer.id, listingId: job.ebayOffer.ebayListingId, remoteStatus: snapshot.listingStatus },
    });
    await recordAuditEvent(tx, {
      organizationId: job.organizationId,
      actorUserId: job.createdById,
      action: "ebay.listing.withdrawn",
      resourceType: "EbayOffer",
      resourceId: job.ebayOffer.id,
      severity: "WARNING",
      summary: "Withdrew eBay listing",
      metadata: { listingId: job.ebayOffer.ebayListingId, remoteStatus: snapshot.listingStatus },
    });
  });
}

const activeJobs = new Set<string>();

export async function runListingOperationJob(jobId: string, options: JobRunOptions = inlineJobOptions): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    const claimed = await prisma.ebayListingOperationJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: {
        status: "RUNNING", startedAt: new Date(), completedAt: null, attemptCount: { increment: 1 },
        leaseOwner: options.leaseOwner, leaseExpiresAt: leaseExpiry(options), lastError: null,
      },
    });
    if (!claimed.count) return;
    const job = await prisma.ebayListingOperationJob.findUnique({ where: { id: jobId }, include: jobInclude });
    if (!job) return;
    if (job.action === "REVISE") await runRevision(job, options);
    else if (job.action === "WITHDRAW") await runWithdrawal(job, options);
    else await runReconcile(job, options);
    await prisma.ebayListingOperationJob.updateMany({
      where: { id: job.id, status: "RUNNING", leaseOwner: options.leaseOwner },
      data: { status: "COMPLETED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "eBay listing operation failed";
    const job = await prisma.ebayListingOperationJob.findUnique({
      where: { id: jobId },
      select: { ebayOfferId: true, action: true, ebayOffer: { select: { driftIssues: true } } },
    }).catch(() => null);
    await prisma.$transaction([
      prisma.ebayListingOperationJob.updateMany({
        where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
        data: { status: "FAILED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: message },
      }),
      ...(job ? [prisma.ebayOffer.update({
        where: { id: job.ebayOfferId },
        data: {
          ...(job.action === "WITHDRAW"
            ? { status: Array.isArray(job.ebayOffer.driftIssues) && job.ebayOffer.driftIssues.length ? "DRIFTED" as const : "PUBLISHED" as const }
            : job.action === "REVISE" ? { status: "PUBLISHED" as const } : {}),
          lastError: message,
        },
      })] : []),
    ]).catch(() => undefined);
  } finally {
    activeJobs.delete(jobId);
  }
}

export function startListingOperationJob(jobId: string, options: JobRunOptions = inlineJobOptions) {
  setImmediate(() => void runListingOperationJob(jobId, options));
}

export function getActiveListingOperationJobCount() {
  return activeJobs.size;
}

export async function startQueuedListingOperationJobs(options: JobRunOptions = inlineJobOptions) {
  const jobs = await prisma.ebayListingOperationJob.findMany({ where: { status: "QUEUED" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  jobs.forEach(({ id }) => startListingOperationJob(id, options));
  return jobs.length;
}

export async function resumeInterruptedListingOperationJobs(options: JobRunOptions = inlineJobOptions) {
  await prisma.ebayListingOperationJob.updateMany({
    where: { status: "RUNNING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
    data: { status: "QUEUED", startedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: "Worker lease expired; job requeued" },
  });
  return startQueuedListingOperationJobs(options);
}
