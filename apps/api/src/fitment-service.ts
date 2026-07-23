import { createHash } from "node:crypto";
import { Prisma, type FitmentJobItemStatus, type FitmentJobStatus } from "@prisma/client";
import { prisma } from "./db.js";
import { normalizePartNumber } from "./domain/matching.js";
import { inlineJobOptions, leaseExpiry, runWithRetry, type JobRunOptions } from "./job-runtime.js";
import { captureDeadLetter, resolveDeadLetter } from "./dead-letter-service.js";
import { enqueueOutboxEvent } from "./outbox-service.js";
import { discoverEbayFitment, getEbayProductCompatibilities, type EbayFitmentCandidate } from "./providers/ebay-fitment.js";
import type { Marketplace } from "./types.js";

export class FitmentJobError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "FitmentJobError";
  }
}

export interface CreateFitmentJobInput { partIds: string[]; marketplace: Marketplace }
export interface ScoredFitmentCandidate extends EbayFitmentCandidate { score: number; matchedOn: string[] }

const activeJobs = new Set<string>();

export function getActiveFitmentJobCount(): number {
  return activeJobs.size;
}
const discoveryTerminalStatuses = new Set<FitmentJobItemStatus>(["REVIEW_REQUIRED", "NO_CANDIDATE", "APPROVED", "FAILED"]);

function normalizedText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function scoreFitmentCandidate(candidate: EbayFitmentCandidate, part: { partNumber: string; brand: string | null }): ScoredFitmentCandidate {
  const partNumber = normalizePartNumber(part.partNumber);
  const matchingAspectNames = ["manufacturer part number", "mpn", "oe/oem part number", "interchange part number"];
  const aspectMatch = Object.entries(candidate.aspects).some(([name, values]) =>
    matchingAspectNames.includes(name.toLowerCase()) && values.some((value) => normalizePartNumber(value) === partNumber),
  );
  const titleMatch = normalizePartNumber(candidate.title).includes(partNumber);
  const brand = normalizedText(part.brand);
  const brandMatch = Boolean(brand) && (normalizedText(candidate.brand) === brand || normalizedText(candidate.title).includes(brand));
  const matchedOn = [aspectMatch && "exact part-number aspect", brandMatch && "brand", titleMatch && "part number in title"].filter(Boolean) as string[];
  return { ...candidate, score: (aspectMatch ? 70 : 0) + (brandMatch ? 20 : 0) + (titleMatch ? 10 : 0), matchedOn };
}

export function normalizeFitmentApplications(applications: Array<Record<string, string>>) {
  const seen = new Set<string>();
  return applications.flatMap((properties) => {
    const sorted = Object.fromEntries(Object.entries(properties).filter(([, value]) => value.trim()).sort(([a], [b]) => a.localeCompare(b)));
    if (!Object.keys(sorted).length) return [];
    const fingerprint = createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [{ fingerprint, properties: sorted }];
  });
}

const jobInclude = {
  items: {
    orderBy: { createdAt: "asc" as const },
    include: {
      part: { select: { id: true, sku: true, primaryPartNumber: true, partName: true, brand: true } },
      candidates: { orderBy: [{ score: "desc" as const }, { title: "asc" as const }] },
      applications: { orderBy: { approvedAt: "asc" as const }, take: 100 },
    },
  },
};

export async function getFitmentJob(organizationId: string, jobId: string) {
  const job = await prisma.fitmentJob.findFirst({
    where: { id: jobId, organizationId },
    omit: { leaseOwner: true, leaseExpiresAt: true },
    include: jobInclude,
  });
  if (!job) throw new FitmentJobError("Fitment job not found", 404);
  return job;
}

export async function listFitmentJobs(organizationId: string, limit = 10) {
  return prisma.fitmentJob.findMany({
    where: { organizationId }, orderBy: { createdAt: "desc" }, take: limit,
    select: {
      id: true, marketplace: true, status: true, totalItems: true, reviewedItems: true,
      noCandidateItems: true, failedItems: true, startedAt: true, completedAt: true, createdAt: true,
    },
  });
}

export async function createFitmentJob(organizationId: string, createdById: string, input: CreateFitmentJobInput) {
  const partIds = [...new Set(input.partIds)];
  const active = await prisma.fitmentJob.findFirst({ where: { organizationId, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
  if (active) throw new FitmentJobError("Another fitment discovery job is already running for this organization", 409);
  const parts = await prisma.part.findMany({
    where: { organizationId, id: { in: partIds }, status: { not: "ARCHIVED" } },
    select: { id: true, primaryPartNumber: true, brand: true, partName: true },
  });
  if (parts.length !== partIds.length) throw new FitmentJobError("One or more selected parts are unavailable or archived", 404);
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.fitmentJob.create({
        data: {
          organizationId, createdById, marketplace: input.marketplace, totalItems: parts.length,
          items: { create: parts.map((part) => ({ organizationId, partId: part.id, query: [part.brand, part.partName, part.primaryPartNumber].filter(Boolean).join(" ") })) },
        },
        include: jobInclude,
      });
      await enqueueOutboxEvent(tx, {
        organizationId,
        topic: "fitment.job.created",
        aggregateType: "FitmentJob",
        aggregateId: created.id,
        payload: { jobId: created.id, organizationId, marketplace: input.marketplace, partIds },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new FitmentJobError("Another fitment discovery job is already running for this organization", 409);
    }
    throw error;
  }
}

function jobStatus(statuses: FitmentJobItemStatus[]): FitmentJobStatus {
  if (!statuses.every((status) => discoveryTerminalStatuses.has(status))) return "RUNNING";
  const failed = statuses.filter((status) => status === "FAILED").length;
  const review = statuses.filter((status) => status === "REVIEW_REQUIRED").length;
  if (review) return "REVIEW_REQUIRED";
  if (failed === statuses.length) return "FAILED";
  if (failed) return "PARTIAL";
  return "COMPLETED";
}

async function refreshFitmentJob(jobId: string, leaseOwner?: string) {
  const items = await prisma.fitmentJobItem.findMany({ where: { fitmentJobId: jobId }, select: { status: true } });
  const statuses = items.map(({ status }) => status);
  const status = jobStatus(statuses);
  const discoveryFinished = statuses.every((itemStatus) => discoveryTerminalStatuses.has(itemStatus));
  await prisma.fitmentJob.updateMany({ where: { id: jobId, ...(leaseOwner ? { status: "RUNNING", leaseOwner } : {}) }, data: {
    status,
    reviewedItems: statuses.filter((itemStatus) => itemStatus === "APPROVED").length,
    noCandidateItems: statuses.filter((itemStatus) => itemStatus === "NO_CANDIDATE").length,
    failedItems: statuses.filter((itemStatus) => itemStatus === "FAILED").length,
    ...(discoveryFinished ? { completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } : {}),
  } });
}

async function processFitmentItem(item: {
  id: string; organizationId: string; part: { primaryPartNumber: string; brand: string | null; partName: string | null };
}, marketplace: Marketplace, options: JobRunOptions) {
  await prisma.fitmentJobItem.update({ where: { id: item.id }, data: { status: "RUNNING", startedAt: new Date(), error: null } });
  try {
    const discovery = await runWithRetry(async () => {
      await prisma.fitmentJobItem.update({ where: { id: item.id }, data: { attemptCount: { increment: 1 } } });
      return discoverEbayFitment({
        partNumber: item.part.primaryPartNumber,
        brand: item.part.brand,
        partName: item.part.partName,
      }, marketplace);
    }, options, async (error, attempt, delayMs) => {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown fitment discovery error";
      await prisma.fitmentJobItem.update({ where: { id: item.id }, data: { error: `Attempt ${attempt} failed; retrying in ${delayMs}ms: ${message}` } });
    });
    const candidates = discovery.candidates.map((candidate) => scoreFitmentCandidate(candidate, { partNumber: item.part.primaryPartNumber, brand: item.part.brand })).filter(({ score }) => score > 0);
    await prisma.$transaction(async (tx) => {
      if (candidates.length) await tx.fitmentCandidate.createMany({ data: candidates.map((candidate) => ({
        organizationId: item.organizationId, fitmentJobItemId: item.id, epid: candidate.epid, title: candidate.title,
        brand: candidate.brand, imageUrl: candidate.imageUrl, productWebUrl: candidate.productWebUrl,
        score: candidate.score, matchedOn: candidate.matchedOn, aspects: candidate.aspects,
      })) });
      await tx.fitmentJobItem.update({ where: { id: item.id }, data: {
        status: candidates.length ? "REVIEW_REQUIRED" : "NO_CANDIDATE",
        categoryId: discovery.categoryId, categoryName: discovery.categoryName, completedAt: new Date(),
      } });
      await resolveDeadLetter(tx, "FITMENT_ITEM", item.id);
    }, { maxWait: 10_000, timeout: 60_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown fitment discovery error";
    await prisma.$transaction(async (tx) => {
      const failed = await tx.fitmentJobItem.update({
        where: { id: item.id },
        data: { status: "FAILED", error: message, completedAt: new Date() },
      });
      await captureDeadLetter(tx, {
        organizationId: item.organizationId,
        type: "FITMENT_ITEM",
        jobId: failed.fitmentJobId,
        itemId: item.id,
        payload: {
          partNumber: item.part.primaryPartNumber,
          brand: item.part.brand,
          partName: item.part.partName,
          marketplace,
        },
        error: message,
        attempts: failed.attemptCount,
      });
    });
  }
}

export async function runFitmentJob(jobId: string, options: JobRunOptions = inlineJobOptions): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    const claimed = await prisma.fitmentJob.updateMany({
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
    const job = await prisma.fitmentJob.findUnique({ where: { id: jobId }, select: {
      marketplace: true,
      items: { where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: {
        id: true, organizationId: true, part: { select: { primaryPartNumber: true, brand: true, partName: true } },
      } },
    } });
    if (!job) return;
    for (const item of job.items) {
      await processFitmentItem(item, job.marketplace as Marketplace, options);
      await prisma.fitmentJob.updateMany({
        where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
        data: { leaseExpiresAt: leaseExpiry(options) },
      });
      await refreshFitmentJob(jobId, options.leaseOwner);
    }
  } catch (error) {
    console.error(JSON.stringify({ type: "fitment_job_error", jobId, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" } }));
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown fitment job error";
    await prisma.fitmentJob.updateMany({
      where: { id: jobId, status: "RUNNING", leaseOwner: options.leaseOwner },
      data: { status: "FAILED", completedAt: new Date(), lastError: message, leaseOwner: null, leaseExpiresAt: null },
    }).catch(() => undefined);
  } finally { activeJobs.delete(jobId); }
}

export function startFitmentJob(jobId: string, options: JobRunOptions = inlineJobOptions): void {
  setImmediate(() => void runFitmentJob(jobId, options));
}

export async function startQueuedFitmentJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const queued = await prisma.fitmentJob.findMany({
    where: { status: "QUEUED" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  queued.forEach(({ id }) => startFitmentJob(id, options));
  return queued.length;
}

export async function approveFitmentCandidate(organizationId: string, itemId: string, candidateId: string) {
  const item = await prisma.fitmentJobItem.findFirst({ where: { id: itemId, organizationId }, include: {
    fitmentJob: { select: { id: true, marketplace: true } }, candidates: { where: { id: candidateId } },
  } });
  if (!item) throw new FitmentJobError("Fitment review item not found", 404);
  if (item.status === "APPROVED") throw new FitmentJobError("This fitment item has already been approved", 409);
  if (item.status !== "REVIEW_REQUIRED") throw new FitmentJobError("This fitment item is not ready for review", 409);
  const candidate = item.candidates[0];
  if (!candidate) throw new FitmentJobError("Candidate does not belong to this fitment item", 404);
  let compatibility;
  try { compatibility = await getEbayProductCompatibilities(candidate.epid, item.fitmentJob.marketplace as Marketplace); }
  catch (error) { throw new FitmentJobError(error instanceof Error ? error.message : "eBay compatibility lookup failed", 502); }
  const applications = normalizeFitmentApplications(compatibility.applications);
  if (!applications.length) throw new FitmentJobError("eBay returned no compatibility applications for this product candidate");
  await prisma.$transaction(async (tx) => {
    await tx.fitmentApplication.createMany({ data: applications.map(({ fingerprint, properties }) => ({
      organizationId, fitmentJobItemId: item.id, partId: item.partId, fingerprint, properties,
    })) });
    await tx.fitmentJobItem.update({ where: { id: item.id }, data: {
      status: "APPROVED", approvedCandidateId: candidate.id, metadataVersion: compatibility.metadataVersion,
      applicationCount: applications.length, completedAt: new Date(), error: null,
    } });
  }, { maxWait: 10_000, timeout: 60_000 });
  await refreshFitmentJob(item.fitmentJob.id);
  return getFitmentJob(organizationId, item.fitmentJob.id);
}

export async function resumeInterruptedFitmentJobs(options: JobRunOptions = inlineJobOptions): Promise<number> {
  const stale = await prisma.fitmentJob.findMany({
    where: { status: "RUNNING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const { id } of stale) {
    await prisma.$transaction(async (tx) => {
      const reclaimed = await tx.fitmentJob.updateMany({
        where: { id, status: "RUNNING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
        data: { status: "QUEUED", startedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: "Worker lease expired; job requeued" },
      });
      if (reclaimed.count) {
        await tx.fitmentJobItem.updateMany({
          where: { fitmentJobId: id, status: "RUNNING" },
          data: { status: "QUEUED", startedAt: null },
        });
      }
    });
  }
  return startQueuedFitmentJobs(options);
}
