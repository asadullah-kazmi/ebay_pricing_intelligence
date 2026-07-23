import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { inlineJobOptions, leaseExpiry, runWithRetry, type JobRunOptions } from "./job-runtime.js";
import { enqueueOutboxEvent } from "./outbox-service.js";
import { createOffer, findOfferIdBySku, getListingFees, getPublishedListingId, publishOffer, updateOffer } from "./providers/ebay-inventory.js";
import type { Marketplace } from "./types.js";
import { recordAuditEvent } from "./audit-service.js";
import { assertApprovedListingPrice } from "./pricing-governance-service.js";

export class EbayOfferError extends Error {
  readonly status: number;
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "EbayOfferError";
    this.status = statusCode;
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function buildOfferPayload(draft: {
  marketplace: string;
  categoryId: string | null;
  quantity: number;
  price: Prisma.Decimal | null;
  currency: string;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  shippingPolicyId: string | null;
  merchantLocationKey: string | null;
}, sku: string) {
  if (!draft.categoryId || !draft.price || !draft.paymentPolicyId || !draft.returnPolicyId || !draft.shippingPolicyId || !draft.merchantLocationKey) {
    throw new EbayOfferError("Draft is missing required offer category, price, policies, or inventory location", 409);
  }
  return {
    sku,
    marketplaceId: draft.marketplace,
    format: "FIXED_PRICE",
    availableQuantity: draft.quantity,
    categoryId: draft.categoryId,
    listingDuration: "GTC",
    merchantLocationKey: draft.merchantLocationKey,
    listingPolicies: {
      paymentPolicyId: draft.paymentPolicyId,
      returnPolicyId: draft.returnPolicyId,
      fulfillmentPolicyId: draft.shippingPolicyId,
    },
    pricingSummary: { price: { currency: draft.currency, value: draft.price.toString() } },
    includeCatalogProductDetails: false,
  };
}

const offerInclude = {
  jobs: { orderBy: { createdAt: "desc" as const }, take: 5 },
} satisfies Prisma.EbayOfferInclude;

const jobInclude = {
  ebayOffer: { include: offerInclude },
} satisfies Prisma.EbayOfferJobInclude;

export async function createOfferPreparationJob(input: {
  organizationId: string;
  userId: string;
  inventorySyncJobId: string;
}) {
  const sync = await prisma.ebayInventorySyncJob.findFirst({
    where: { id: input.inventorySyncJobId, organizationId: input.organizationId },
    include: { listingDraft: true, preparation: true },
  });
  if (!sync) throw new EbayOfferError("eBay inventory sync job not found", 404);
  if (sync.status !== "COMPLETED" || !sync.completedAt) throw new EbayOfferError("Inventory and compatibility must finish syncing before offer preparation", 409);
  if (sync.listingDraft.version !== sync.draftVersion || sync.listingDraft.status !== "READY" || !sync.listingDraft.liveValidatedAt) {
    throw new EbayOfferError("The listing draft changed or lost live readiness after inventory sync", 409);
  }
  if (!sync.preparation || sync.preparation.payloadHash !== sync.payloadHash) throw new EbayOfferError("Inventory preparation no longer matches its sync job", 409);
  await assertApprovedListingPrice({
    organizationId: input.organizationId,
    partId: sync.listingDraft.partId,
    marketplace: sync.listingDraft.marketplace,
    price: sync.listingDraft.price,
    currency: sync.listingDraft.currency,
  });
  const payload = buildOfferPayload(sync.listingDraft, sync.sku);
  const existing = await prisma.ebayOffer.findUnique({ where: { listingDraftId: sync.listingDraftId } });
  if (existing?.status === "PUBLISHED") throw new EbayOfferError("This draft is already published; use the future revision workflow", 409);
  if (existing?.approvedAt) throw new EbayOfferError("This offer has a prior publication approval; retry or reconcile publication instead of preparing it again", 409);
  const offer = await prisma.ebayOffer.upsert({
    where: { listingDraftId: sync.listingDraftId },
    create: {
      organizationId: input.organizationId,
      listingDraftId: sync.listingDraftId,
      inventorySyncJobId: sync.id,
      preparationId: sync.preparation.id,
      draftVersion: sync.draftVersion,
      sku: sync.sku,
      marketplace: sync.listingDraft.marketplace,
      payloadHash: sync.payloadHash,
      offerPayload: asJson(payload),
    },
    update: {
      inventorySyncJobId: sync.id,
      preparationId: sync.preparation.id,
      draftVersion: sync.draftVersion,
      sku: sync.sku,
      marketplace: sync.listingDraft.marketplace,
      payloadHash: sync.payloadHash,
      offerPayload: asJson(payload),
      status: "PREPARING",
      feeResponse: Prisma.JsonNull,
      feeTotal: null,
      feeCurrency: null,
      warnings: Prisma.JsonNull,
      lastError: null,
      approvedById: null,
      approvedAt: null,
    },
  });
  const job = await prisma.ebayOfferJob.upsert({
    where: { ebayOfferId_action_draftVersion: { ebayOfferId: offer.id, action: "PREPARE", draftVersion: offer.draftVersion } },
    create: {
      organizationId: input.organizationId,
      createdById: input.userId,
      listingDraftId: offer.listingDraftId,
      ebayOfferId: offer.id,
      draftVersion: offer.draftVersion,
      action: "PREPARE",
    },
    update: {},
    include: jobInclude,
  });
  if (job.status !== "FAILED") return job;
  return prisma.ebayOfferJob.update({
    where: { id: job.id },
    data: { status: "QUEUED", startedAt: null, completedAt: null, lastError: null, leaseOwner: null, leaseExpiresAt: null },
    include: jobInclude,
  });
}

export async function createOfferPublishJob(input: {
  organizationId: string;
  userId: string;
  offerId: string;
  confirmPublish: true;
}) {
  const offer = await prisma.ebayOffer.findFirst({
    where: { id: input.offerId, organizationId: input.organizationId },
    include: { listingDraft: true, inventorySyncJob: true },
  });
  if (!offer) throw new EbayOfferError("eBay offer not found", 404);
  if (offer.status === "PUBLISHED") throw new EbayOfferError("Offer is already published", 409);
  if (offer.status !== "FEES_READY" || !offer.ebayOfferId || !offer.feeResponse) throw new EbayOfferError("Review a current eBay fee preview before publishing", 409);
  if (offer.listingDraft.version !== offer.draftVersion || offer.listingDraft.status !== "READY" || !offer.listingDraft.liveValidatedAt) {
    throw new EbayOfferError("The draft changed after fee preview; prepare the offer again", 409);
  }
  if (offer.inventorySyncJob.status !== "COMPLETED" || offer.inventorySyncJob.payloadHash !== offer.payloadHash) {
    throw new EbayOfferError("The inventory sync no longer matches this offer", 409);
  }
  await assertApprovedListingPrice({
    organizationId: input.organizationId,
    partId: offer.listingDraft.partId,
    marketplace: offer.listingDraft.marketplace,
    price: offer.listingDraft.price,
    currency: offer.listingDraft.currency,
  });
  const now = new Date();
  await prisma.ebayOffer.update({
    where: { id: offer.id },
    data: { status: "PUBLISH_QUEUED", approvedById: input.userId, approvedAt: now, lastError: null },
  });
  const job = await prisma.ebayOfferJob.upsert({
    where: { ebayOfferId_action_draftVersion: { ebayOfferId: offer.id, action: "PUBLISH", draftVersion: offer.draftVersion } },
    create: {
      organizationId: input.organizationId,
      createdById: input.userId,
      listingDraftId: offer.listingDraftId,
      ebayOfferId: offer.id,
      draftVersion: offer.draftVersion,
      action: "PUBLISH",
    },
    update: {},
    include: jobInclude,
  });
  if (job.status !== "FAILED") return job;
  return prisma.ebayOfferJob.update({
    where: { id: job.id },
    data: { status: "QUEUED", startedAt: null, completedAt: null, lastError: null, leaseOwner: null, leaseExpiresAt: null },
    include: jobInclude,
  });
}

export async function getOffer(organizationId: string, offerId: string) {
  const offer = await prisma.ebayOffer.findFirst({ where: { id: offerId, organizationId }, include: offerInclude });
  if (!offer) throw new EbayOfferError("eBay offer not found", 404);
  return offer;
}

export async function getOfferByDraft(organizationId: string, listingDraftId: string) {
  const offer = await prisma.ebayOffer.findFirst({ where: { organizationId, listingDraftId }, include: offerInclude });
  if (!offer) throw new EbayOfferError("eBay offer not found", 404);
  return offer;
}

export async function getOfferJob(organizationId: string, jobId: string) {
  const job = await prisma.ebayOfferJob.findFirst({ where: { id: jobId, organizationId }, include: jobInclude });
  if (!job) throw new EbayOfferError("eBay offer job not found", 404);
  return job;
}

const activeOfferJobs = new Set<string>();

async function runPrepare(job: Prisma.EbayOfferJobGetPayload<{ include: typeof jobInclude }>, options: JobRunOptions) {
  const offer = job.ebayOffer;
  const marketplace = offer.marketplace as Marketplace;
  let remoteOfferId = offer.ebayOfferId;
  if (remoteOfferId) {
    await runWithRetry(() => updateOffer(offer.organizationId, marketplace, remoteOfferId!, offer.offerPayload), options);
  } else {
    remoteOfferId = await runWithRetry(() => findOfferIdBySku(offer.organizationId, marketplace, offer.sku), options);
    if (!remoteOfferId) {
      try {
        remoteOfferId = await createOffer(offer.organizationId, marketplace, offer.offerPayload);
      } catch (error) {
        remoteOfferId = await findOfferIdBySku(offer.organizationId, marketplace, offer.sku).catch(() => null);
        if (!remoteOfferId) throw error;
      }
    }
    await prisma.ebayOffer.update({ where: { id: offer.id }, data: { ebayOfferId: remoteOfferId } });
  }
  const fees = await runWithRetry(() => getListingFees(offer.organizationId, marketplace, remoteOfferId!), options);
  await prisma.$transaction(async (tx) => {
    await tx.ebayOffer.update({
      where: { id: offer.id },
      data: {
        status: "FEES_READY",
        feeResponse: asJson(fees.response),
        feeTotal: fees.total,
        feeCurrency: fees.currency,
        warnings: asJson(fees.warnings),
        lastError: null,
      },
    });
    await enqueueOutboxEvent(tx, {
      organizationId: offer.organizationId,
      topic: "listing.offer.fees_ready",
      aggregateType: "ListingDraft",
      aggregateId: offer.listingDraftId,
      payload: { draftId: offer.listingDraftId, offerId: offer.id, ebayOfferId: remoteOfferId, feeTotal: fees.total, feeCurrency: fees.currency },
    });
    await recordAuditEvent(tx, {
      organizationId: offer.organizationId,
      actorUserId: job.createdById,
      action: "ebay.offer.fees_ready",
      resourceType: "EbayOffer",
      resourceId: offer.id,
      summary: `eBay fee preview is ready for ${offer.sku}`,
      metadata: { ebayOfferId: remoteOfferId, feeTotal: fees.total, feeCurrency: fees.currency },
    });
  });
}

async function runPublish(job: Prisma.EbayOfferJobGetPayload<{ include: typeof jobInclude }>, options: JobRunOptions) {
  const offer = await prisma.ebayOffer.findUnique({ where: { id: job.ebayOffer.id }, include: { listingDraft: true } });
  if (!offer?.ebayOfferId || offer.status !== "PUBLISH_QUEUED" || !offer.approvedAt) throw new EbayOfferError("Offer is not approved for publication", 409);
  if (offer.listingDraft.version !== offer.draftVersion || !offer.listingDraft.liveValidatedAt) throw new EbayOfferError("Draft changed after publication approval", 409);
  const marketplace = offer.marketplace as Marketplace;
  let listingId = await runWithRetry(() => getPublishedListingId(offer.organizationId, marketplace, offer.ebayOfferId!), options);
  if (!listingId) {
    try {
      listingId = await publishOffer(offer.organizationId, marketplace, offer.ebayOfferId);
    } catch (error) {
      listingId = await getPublishedListingId(offer.organizationId, marketplace, offer.ebayOfferId).catch(() => null);
      if (!listingId) throw error;
    }
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.ebayOffer.update({
      where: { id: offer.id },
      data: { status: "PUBLISHED", ebayListingId: listingId, publishedAt: now, lastError: null },
    });
    await enqueueOutboxEvent(tx, {
      organizationId: offer.organizationId,
      topic: "listing.published",
      aggregateType: "ListingDraft",
      aggregateId: offer.listingDraftId,
      payload: { draftId: offer.listingDraftId, offerId: offer.id, ebayOfferId: offer.ebayOfferId, listingId },
    });
    await recordAuditEvent(tx, {
      organizationId: offer.organizationId,
      actorUserId: job.createdById,
      action: "ebay.listing.published",
      resourceType: "EbayOffer",
      resourceId: offer.id,
      summary: `Published ${offer.sku} to eBay`,
      metadata: { listingId, ebayOfferId: offer.ebayOfferId, marketplace: offer.marketplace },
    });
  });
}

export async function runOfferJob(jobId: string, options: JobRunOptions = inlineJobOptions): Promise<void> {
  if (activeOfferJobs.has(jobId)) return;
  activeOfferJobs.add(jobId);
  try {
    const claimed = await prisma.ebayOfferJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: {
        status: "RUNNING", startedAt: new Date(), completedAt: null, attemptCount: { increment: 1 },
        leaseOwner: options.leaseOwner, leaseExpiresAt: leaseExpiry(options), lastError: null,
      },
    });
    if (!claimed.count) return;
    const job = await prisma.ebayOfferJob.findUnique({ where: { id: jobId }, include: jobInclude });
    if (!job) return;
    if (job.action === "PREPARE") await runPrepare(job, options);
    else await runPublish(job, options);
    await prisma.ebayOfferJob.updateMany({
      where: { id: job.id, status: "RUNNING", leaseOwner: options.leaseOwner },
      data: { status: "COMPLETED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "eBay offer job failed";
    const job = await prisma.ebayOfferJob.findUnique({ where: { id: jobId }, select: { ebayOfferId: true, action: true } }).catch(() => null);
    await prisma.$transaction([
      prisma.ebayOfferJob.updateMany({
        where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
        data: { status: "FAILED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: message },
      }),
      ...(job ? [prisma.ebayOffer.update({
        where: { id: job.ebayOfferId },
        data: { status: job.action === "PUBLISH" ? "FEES_READY" : "FAILED", lastError: message },
      })] : []),
    ]).catch(() => undefined);
  } finally {
    activeOfferJobs.delete(jobId);
  }
}

export function startOfferJob(jobId: string, options: JobRunOptions = inlineJobOptions): void {
  setImmediate(() => void runOfferJob(jobId, options));
}

export function getActiveOfferJobCount(): number {
  return activeOfferJobs.size;
}

export async function startQueuedOfferJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const queued = await prisma.ebayOfferJob.findMany({ where: { status: "QUEUED" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  queued.forEach(({ id }) => startOfferJob(id, options));
  return queued.length;
}

export async function resumeInterruptedOfferJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  await prisma.ebayOfferJob.updateMany({
    where: { status: "RUNNING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
    data: { status: "QUEUED", startedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: "Worker lease expired; job requeued" },
  });
  return startQueuedOfferJobs(options);
}
