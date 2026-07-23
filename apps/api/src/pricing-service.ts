import { Prisma, type PartCondition, type PricingConditionMode, type PricingJobItemStatus, type PricingJobStatus } from "@prisma/client";
import { prisma } from "./db.js";
import { calculateAnalytics } from "./domain/analytics.js";
import { matchListing, normalizePartNumber } from "./domain/matching.js";
import { getConfig } from "./config.js";
import { inlineJobOptions, leaseExpiry, runWithRetry, type JobRunOptions } from "./job-runtime.js";
import { captureDeadLetter, resolveDeadLetter } from "./dead-letter-service.js";
import { enqueueOutboxEvent } from "./outbox-service.js";
import { searchEbay } from "./providers/ebay.js";
import { createPricingProposal } from "./pricing-governance-service.js";
import type { ListingCondition, Marketplace, MatchedListing, RawListing } from "./types.js";

export class PricingJobError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "PricingJobError";
  }
}

export interface CreatePricingJobInput {
  partIds: string[];
  marketplace: Marketplace;
  conditionMode: PricingConditionMode;
}

const terminalItemStatuses = new Set<PricingJobItemStatus>(["COMPLETED", "NO_MATCHES", "FAILED"]);
const activeJobs = new Set<string>();

export function getActivePricingJobCount(): number {
  return activeJobs.size;
}

export function resolvePricingCondition(mode: PricingConditionMode, partCondition: PartCondition): ListingCondition {
  return mode === "MATCH_PART" ? partCondition : mode;
}

export function selectExactCompetitors(candidates: RawListing[], partNumber: string, ownSellers: ReadonlySet<string>): MatchedListing[] {
  const normalized = normalizePartNumber(partNumber);
  return candidates.flatMap((candidate) => {
    const matchedOn = matchListing(candidate, normalized);
    if (!matchedOn.length || ownSellers.has(candidate.seller.toLowerCase())) return [];
    return [{ ...candidate, matchedOn, landedPrice: Math.round((candidate.price + candidate.shipping) * 100) / 100 }];
  });
}

function publicJobStatus(statuses: PricingJobItemStatus[]): PricingJobStatus {
  const failed = statuses.filter((status) => status === "FAILED").length;
  if (!statuses.every((status) => terminalItemStatuses.has(status))) return "RUNNING";
  if (failed === statuses.length) return "FAILED";
  if (failed > 0) return "PARTIAL";
  return "COMPLETED";
}

function numberOrNull(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

function serializeJob<T extends {
  items: Array<{
    lowest: { toString(): string } | null;
    average: { toString(): string } | null;
    median: { toString(): string } | null;
    highest: { toString(): string } | null;
    recommendedPrice: { toString(): string } | null;
    proposal: {
      marketRecommendedPrice: { toString(): string };
      costAmount: { toString(): string } | null;
      floorPrice: { toString(): string } | null;
      proposedPrice: { toString(): string };
      approvedPrice: { toString(): string } | null;
    } | null;
    listings: Array<{ price: { toString(): string }; shipping: { toString(): string }; landedPrice: { toString(): string } }>;
  }>;
}>(job: T) {
  return {
    ...job,
    items: job.items.map((item) => ({
      ...item,
      lowest: numberOrNull(item.lowest),
      average: numberOrNull(item.average),
      median: numberOrNull(item.median),
      highest: numberOrNull(item.highest),
      recommendedPrice: numberOrNull(item.recommendedPrice),
      proposal: item.proposal ? {
        ...item.proposal,
        marketRecommendedPrice: Number(item.proposal.marketRecommendedPrice.toString()),
        costAmount: numberOrNull(item.proposal.costAmount),
        floorPrice: numberOrNull(item.proposal.floorPrice),
        proposedPrice: Number(item.proposal.proposedPrice.toString()),
        approvedPrice: numberOrNull(item.proposal.approvedPrice),
      } : null,
      listings: item.listings.map((listing) => ({
        ...listing,
        price: Number(listing.price.toString()),
        shipping: Number(listing.shipping.toString()),
        landedPrice: Number(listing.landedPrice.toString()),
      })),
    })),
  };
}

const jobInclude = {
  items: {
    orderBy: { createdAt: "asc" as const },
    include: {
      part: { select: { id: true, sku: true, primaryPartNumber: true, partName: true, condition: true } },
      listings: { orderBy: { landedPrice: "asc" as const } },
      proposal: { include: { decidedBy: { select: { id: true, email: true, name: true } } } },
    },
  },
};

export async function getPricingJob(organizationId: string, jobId: string) {
  const job = await prisma.pricingJob.findFirst({
    where: { id: jobId, organizationId },
    omit: { leaseOwner: true, leaseExpiresAt: true },
    include: jobInclude,
  });
  if (!job) throw new PricingJobError("Pricing job not found", 404);
  return serializeJob(job);
}

export async function listPricingJobs(organizationId: string, limit = 10) {
  return prisma.pricingJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, marketplace: true, conditionMode: true, status: true, totalItems: true,
      completedItems: true, noMatchItems: true, failedItems: true, startedAt: true, completedAt: true, createdAt: true,
    },
  });
}

export async function createPricingJob(organizationId: string, createdById: string, input: CreatePricingJobInput) {
  const partIds = [...new Set(input.partIds)];
  const active = await prisma.pricingJob.findFirst({ where: { organizationId, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (active) throw new PricingJobError("Another pricing job is already running for this organization", 409);

  const parts = await prisma.part.findMany({
    where: { organizationId, id: { in: partIds }, status: { not: "ARCHIVED" } },
    select: { id: true, primaryPartNumber: true, normalizedPartNumber: true, condition: true },
  });
  if (parts.length !== partIds.length) throw new PricingJobError("One or more selected parts are unavailable or archived", 404);

  try {
    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.pricingJob.create({
        data: {
          organizationId,
          createdById,
          marketplace: input.marketplace,
          conditionMode: input.conditionMode,
          totalItems: parts.length,
          items: {
            create: parts.map((part) => ({
              organizationId,
              partId: part.id,
              queryPartNumber: part.normalizedPartNumber || normalizePartNumber(part.primaryPartNumber),
              condition: resolvePricingCondition(input.conditionMode, part.condition),
            })),
          },
        },
        include: jobInclude,
      });
      await enqueueOutboxEvent(tx, {
        organizationId,
        topic: "pricing.job.created",
        aggregateType: "PricingJob",
        aggregateId: created.id,
        payload: { jobId: created.id, organizationId, marketplace: input.marketplace, partIds },
      });
      return created;
    });
    return serializeJob(job);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PricingJobError("Another pricing job is already running for this organization", 409);
    }
    throw error;
  }
}

async function refreshJobProgress(jobId: string, leaseOwner: string) {
  const items = await prisma.pricingJobItem.findMany({ where: { pricingJobId: jobId }, select: { status: true } });
  const statuses = items.map(({ status }) => status);
  const completedItems = statuses.filter((status) => status === "COMPLETED").length;
  const noMatchItems = statuses.filter((status) => status === "NO_MATCHES").length;
  const failedItems = statuses.filter((status) => status === "FAILED").length;
  const status = publicJobStatus(statuses);
  const terminal = status === "COMPLETED" || status === "PARTIAL" || status === "FAILED";
  await prisma.pricingJob.updateMany({
    where: { id: jobId, status: "RUNNING", leaseOwner },
    data: {
      status,
      completedItems,
      noMatchItems,
      failedItems,
      ...(terminal ? { completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } : {}),
    },
  });
}

async function processPricingItem(
  item: { id: string; organizationId: string; queryPartNumber: string; condition: string },
  marketplace: Marketplace,
  options: JobRunOptions,
) {
  await prisma.pricingJobItem.update({ where: { id: item.id }, data: { status: "RUNNING", startedAt: new Date(), error: null } });
  try {
    const listings = await runWithRetry(async () => {
      await prisma.pricingJobItem.update({ where: { id: item.id }, data: { attemptCount: { increment: 1 } } });
      const candidates = await searchEbay(item.queryPartNumber, marketplace, item.condition as ListingCondition);
      return selectExactCompetitors(candidates, item.queryPartNumber, getConfig().ownSellers);
    }, options, async (error, attempt, delayMs) => {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown pricing error";
      await prisma.pricingJobItem.update({ where: { id: item.id }, data: { error: `Attempt ${attempt} failed; retrying in ${delayMs}ms: ${message}` } });
    });
    const analytics = calculateAnalytics(listings);
    const completedAt = new Date();
    await prisma.$transaction(async (tx) => {
      if (listings.length) {
        await tx.competitorListingSnapshot.createMany({
          data: listings.map((listing) => ({
            organizationId: item.organizationId,
            pricingJobItemId: item.id,
            listingId: listing.id,
            title: listing.title,
            seller: listing.seller,
            price: listing.price,
            shipping: listing.shipping,
            landedPrice: listing.landedPrice,
            currency: listing.currency,
            condition: listing.condition,
            marketplace: listing.marketplace,
            url: listing.url,
            matchedOn: listing.matchedOn,
            capturedAt: completedAt,
          })),
        });
      }
      await tx.pricingJobItem.update({
        where: { id: item.id },
        data: {
          status: analytics ? "COMPLETED" : "NO_MATCHES",
          competitorCount: analytics?.count ?? 0,
          lowest: analytics?.lowest,
          average: analytics?.average,
          median: analytics?.median,
          highest: analytics?.highest,
          recommendedPrice: analytics?.recommendedPrice,
          currency: analytics?.currency,
          completedAt,
        },
      });
      if (analytics) {
        const jobItem = await tx.pricingJobItem.findUniqueOrThrow({
          where: { id: item.id },
          select: { partId: true, pricingJob: { select: { marketplace: true } } },
        });
        await createPricingProposal(tx, {
          organizationId: item.organizationId,
          partId: jobItem.partId,
          pricingJobItemId: item.id,
          marketplace: jobItem.pricingJob.marketplace,
          marketRecommendedPrice: analytics.recommendedPrice,
          currency: analytics.currency,
        });
      }
      await resolveDeadLetter(tx, "PRICING_ITEM", item.id);
    }, { maxWait: 10_000, timeout: 60_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown pricing error";
    await prisma.$transaction(async (tx) => {
      const failed = await tx.pricingJobItem.update({
        where: { id: item.id },
        data: { status: "FAILED", error: message, completedAt: new Date() },
      });
      await captureDeadLetter(tx, {
        organizationId: item.organizationId,
        type: "PRICING_ITEM",
        jobId: failed.pricingJobId,
        itemId: item.id,
        payload: { queryPartNumber: item.queryPartNumber, condition: item.condition, marketplace },
        error: message,
        attempts: failed.attemptCount,
      });
    });
  }
}

export async function runPricingJob(jobId: string, options: JobRunOptions = inlineJobOptions): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    const claimed = await prisma.pricingJob.updateMany({
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
    const job = await prisma.pricingJob.findUnique({
      where: { id: jobId },
      select: {
        marketplace: true,
        items: { where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { id: true, organizationId: true, queryPartNumber: true, condition: true } },
      },
    });
    if (!job) return;
    for (const item of job.items) {
      await processPricingItem(item, job.marketplace as Marketplace, options);
      await prisma.pricingJob.updateMany({
        where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
        data: { leaseExpiresAt: leaseExpiry(options) },
      });
      await refreshJobProgress(jobId, options.leaseOwner);
    }
  } catch (error) {
    console.error(JSON.stringify({ type: "pricing_job_error", jobId, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" } }));
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown pricing job error";
    await prisma.pricingJob.updateMany({
      where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
      data: { status: "FAILED", completedAt: new Date(), lastError: message, leaseOwner: null, leaseExpiresAt: null },
    }).catch(() => undefined);
  } finally {
    activeJobs.delete(jobId);
  }
}

export function startPricingJob(jobId: string, options: JobRunOptions = inlineJobOptions): void {
  setImmediate(() => void runPricingJob(jobId, options));
}

export async function startQueuedPricingJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const queued = await prisma.pricingJob.findMany({
    where: { status: "QUEUED" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  queued.forEach(({ id }) => startPricingJob(id, options));
  return queued.length;
}

export async function resumeInterruptedPricingJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const stale = await prisma.pricingJob.findMany({
    where: {
      status: "RUNNING",
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (stale.length) {
    for (const { id } of stale) {
      await prisma.$transaction(async (tx) => {
        const reclaimed = await tx.pricingJob.updateMany({
          where: { id, status: "RUNNING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
          data: { status: "QUEUED", startedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: "Worker lease expired; job requeued" },
        });
        if (reclaimed.count) {
          await tx.pricingJobItem.updateMany({
            where: { pricingJobId: id, status: "RUNNING" },
            data: { status: "QUEUED", startedAt: null },
          });
        }
      });
    }
  }
  return startQueuedPricingJobs(options);
}
