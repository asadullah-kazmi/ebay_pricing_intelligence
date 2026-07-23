import type { Prisma, OutboxEvent } from "@prisma/client";
import { prisma } from "./db.js";

type TransactionClient = Prisma.TransactionClient;

export async function enqueueOutboxEvent(tx: TransactionClient, input: {
  organizationId: string;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
}): Promise<void> {
  await tx.outboxEvent.create({ data: input });
}

export async function publishOutboxEvents(input: {
  instanceId: string;
  leaseDurationMs: number;
  maxAttempts: number;
  batchSize?: number;
  publish: (event: Pick<OutboxEvent, "id" | "topic" | "aggregateType" | "aggregateId" | "payload" | "createdAt">) => Promise<void>;
}): Promise<{ published: number; failed: number }> {
  const now = new Date();
  const candidates = await prisma.outboxEvent.findMany({
    where: {
      nextAttemptAt: { lte: now },
      attemptCount: { lt: input.maxAttempts },
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "PROCESSING", leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: input.batchSize ?? 25,
  });
  let published = 0;
  let failed = 0;
  for (const event of candidates) {
    const claimed = await prisma.outboxEvent.updateMany({
      where: {
        id: event.id,
        attemptCount: { lt: input.maxAttempts },
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } },
          { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: input.instanceId,
        leaseExpiresAt: new Date(Date.now() + input.leaseDurationMs),
        attemptCount: { increment: 1 },
      },
    });
    if (!claimed.count) continue;
    try {
      await input.publish(event);
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, status: "PROCESSING", leaseOwner: input.instanceId },
        data: { status: "PUBLISHED", publishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null },
      });
      published += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : "Unknown outbox publication error";
      const exhausted = event.attemptCount + 1 >= input.maxAttempts;
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, status: "PROCESSING", leaseOwner: input.instanceId },
        data: {
          status: "FAILED",
          lastError: message,
          nextAttemptAt: new Date(Date.now() + (exhausted ? 24 * 60 * 60_000 : 1_000 * 2 ** event.attemptCount)),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      failed += 1;
    }
  }
  return { published, failed };
}
