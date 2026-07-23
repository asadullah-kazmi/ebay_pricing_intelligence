import { Prisma, type DeadLetterType } from "@prisma/client";
import { prisma } from "./db.js";

export class DeadLetterError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "DeadLetterError";
  }
}

export async function captureDeadLetter(tx: Prisma.TransactionClient, input: {
  organizationId: string;
  type: DeadLetterType;
  jobId: string;
  itemId: string;
  payload: Prisma.InputJsonValue;
  error: string;
  attempts: number;
}): Promise<void> {
  await tx.deadLetterEntry.upsert({
    where: { type_itemId: { type: input.type, itemId: input.itemId } },
    create: { ...input, status: "OPEN" },
    update: {
      payload: input.payload,
      error: input.error,
      attempts: input.attempts,
      status: "OPEN",
      requeuedAt: null,
      resolvedAt: null,
    },
  });
}

export async function resolveDeadLetter(tx: Prisma.TransactionClient, type: DeadLetterType, itemId: string): Promise<void> {
  await tx.deadLetterEntry.updateMany({
    where: { type, itemId, status: "REQUEUED" },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

export async function listDeadLetters(
  organizationId: string,
  input: { status?: "OPEN" | "REQUEUED" | "RESOLVED"; limit: number },
) {
  return prisma.deadLetterEntry.findMany({
    where: { organizationId, status: input.status },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    select: {
      id: true,
      type: true,
      jobId: true,
      itemId: true,
      payload: true,
      error: true,
      attempts: true,
      status: true,
      requeuedAt: true,
      resolvedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function requeueDeadLetter(organizationId: string, entryId: string) {
  const entry = await prisma.deadLetterEntry.findFirst({ where: { id: entryId, organizationId } });
  if (!entry) throw new DeadLetterError("Dead-letter entry not found", 404);
  if (entry.status !== "OPEN") throw new DeadLetterError("Only open dead-letter entries can be requeued", 409);

  try {
    if (entry.type === "PRICING_ITEM") {
      const item = await prisma.pricingJobItem.findFirst({
        where: { id: entry.itemId, organizationId, pricingJobId: entry.jobId },
        include: { pricingJob: { select: { status: true } } },
      });
      if (!item) throw new DeadLetterError("Pricing job item no longer exists", 404);
      if (item.status !== "FAILED" || item.pricingJob.status === "RUNNING" || item.pricingJob.status === "QUEUED") {
        throw new DeadLetterError("Pricing job item is not ready to be requeued", 409);
      }
      await prisma.$transaction(async (tx) => {
        await tx.competitorListingSnapshot.deleteMany({ where: { pricingJobItemId: item.id } });
        await tx.pricingJobItem.update({
          where: { id: item.id },
          data: { status: "QUEUED", error: null, startedAt: null, completedAt: null },
        });
        await tx.pricingJob.update({
          where: { id: entry.jobId },
          data: { status: "QUEUED", completedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: null },
        });
        await tx.deadLetterEntry.update({
          where: { id: entry.id },
          data: { status: "REQUEUED", requeuedAt: new Date(), resolvedAt: null },
        });
        await tx.outboxEvent.create({
          data: {
            organizationId,
            topic: "pricing.job.requeued",
            aggregateType: "PricingJob",
            aggregateId: entry.jobId,
            payload: { jobId: entry.jobId, itemId: entry.itemId, deadLetterId: entry.id },
          },
        });
      });
    } else {
      const item = await prisma.fitmentJobItem.findFirst({
        where: { id: entry.itemId, organizationId, fitmentJobId: entry.jobId },
        include: { fitmentJob: { select: { status: true } } },
      });
      if (!item) throw new DeadLetterError("Fitment job item no longer exists", 404);
      if (item.status !== "FAILED" || item.fitmentJob.status === "RUNNING" || item.fitmentJob.status === "QUEUED") {
        throw new DeadLetterError("Fitment job item is not ready to be requeued", 409);
      }
      await prisma.$transaction(async (tx) => {
        await tx.fitmentCandidate.deleteMany({ where: { fitmentJobItemId: item.id } });
        await tx.fitmentJobItem.update({
          where: { id: item.id },
          data: { status: "QUEUED", error: null, startedAt: null, completedAt: null },
        });
        await tx.fitmentJob.update({
          where: { id: entry.jobId },
          data: { status: "QUEUED", completedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: null },
        });
        await tx.deadLetterEntry.update({
          where: { id: entry.id },
          data: { status: "REQUEUED", requeuedAt: new Date(), resolvedAt: null },
        });
        await tx.outboxEvent.create({
          data: {
            organizationId,
            topic: "fitment.job.requeued",
            aggregateType: "FitmentJob",
            aggregateId: entry.jobId,
            payload: { jobId: entry.jobId, itemId: entry.itemId, deadLetterId: entry.id },
          },
        });
      });
    }
  } catch (error) {
    if (error instanceof DeadLetterError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DeadLetterError("Another job is already active for this organization", 409);
    }
    throw error;
  }
  return prisma.deadLetterEntry.findUnique({ where: { id: entry.id } });
}
