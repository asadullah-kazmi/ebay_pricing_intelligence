import { Prisma, type OrganizationRetentionPolicy, type RetentionRunMode } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";
import { inlineJobOptions, leaseExpiry, type JobRunOptions } from "./job-runtime.js";
import { enqueueOutboxEvent } from "./outbox-service.js";

export class RetentionError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "RetentionError";
  }
}

export interface RetentionPolicyValues {
  readNotificationDays: number;
  competitorSnapshotDays: number;
  publishedOutboxDays: number;
  resolvedDeadLetterDays: number;
  auditArchiveAfterDays: number;
}

export const defaultRetentionPolicy: RetentionPolicyValues = {
  readNotificationDays: 90,
  competitorSnapshotDays: 90,
  publishedOutboxDays: 30,
  resolvedDeadLetterDays: 180,
  auditArchiveAfterDays: 365,
};

interface RetentionCutoffs {
  generatedAt: string;
  readNotificationsBefore: string;
  competitorSnapshotsBefore: string;
  publishedOutboxBefore: string;
  resolvedDeadLettersBefore: string;
  auditArchiveEligibleBefore: string;
}

export function buildRetentionCutoffs(policy: RetentionPolicyValues, now = new Date()): RetentionCutoffs {
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  return {
    generatedAt: now.toISOString(),
    readNotificationsBefore: before(policy.readNotificationDays),
    competitorSnapshotsBefore: before(policy.competitorSnapshotDays),
    publishedOutboxBefore: before(policy.publishedOutboxDays),
    resolvedDeadLettersBefore: before(policy.resolvedDeadLetterDays),
    auditArchiveEligibleBefore: before(policy.auditArchiveAfterDays),
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseCutoffs(value: Prisma.JsonValue): RetentionCutoffs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RetentionError("Retention cutoff snapshot is invalid", 409);
  const row = value as Record<string, unknown>;
  const required = [
    "generatedAt", "readNotificationsBefore", "competitorSnapshotsBefore",
    "publishedOutboxBefore", "resolvedDeadLettersBefore", "auditArchiveEligibleBefore",
  ] as const;
  if (required.some((key) => typeof row[key] !== "string" || Number.isNaN(Date.parse(row[key] as string)))) {
    throw new RetentionError("Retention cutoff snapshot is invalid", 409);
  }
  return Object.fromEntries(required.map((key) => [key, row[key]])) as unknown as RetentionCutoffs;
}

function valuesFromPolicy(policy: OrganizationRetentionPolicy | null): RetentionPolicyValues {
  return policy ? {
    readNotificationDays: policy.readNotificationDays,
    competitorSnapshotDays: policy.competitorSnapshotDays,
    publishedOutboxDays: policy.publishedOutboxDays,
    resolvedDeadLetterDays: policy.resolvedDeadLetterDays,
    auditArchiveAfterDays: policy.auditArchiveAfterDays,
  } : defaultRetentionPolicy;
}

export async function getRetentionPolicy(organizationId: string) {
  const policy = await prisma.organizationRetentionPolicy.findUnique({ where: { organizationId } });
  return policy ?? { id: null, organizationId, updatedById: null, ...defaultRetentionPolicy, createdAt: null, updatedAt: null };
}

export async function updateRetentionPolicy(
  organizationId: string,
  userId: string,
  input: RetentionPolicyValues,
  requestId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const policy = await tx.organizationRetentionPolicy.upsert({
      where: { organizationId },
      create: { organizationId, updatedById: userId, ...input },
      update: { updatedById: userId, ...input },
    });
    await recordAuditEvent(tx, {
      organizationId, actorUserId: userId,
      action: "retention.policy.updated", resourceType: "OrganizationRetentionPolicy", resourceId: policy.id,
      severity: "WARNING", summary: "Organization data-retention policy updated",
      metadata: json(input), requestId,
    });
    return policy;
  });
}

export async function createRetentionRun(input: {
  organizationId: string;
  userId: string;
  mode: RetentionRunMode;
  requestId?: string;
}) {
  const active = await prisma.dataRetentionRun.findFirst({
    where: { organizationId: input.organizationId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (active) throw new RetentionError("Another retention run is already queued or running", 409);
  const stored = await prisma.organizationRetentionPolicy.findUnique({ where: { organizationId: input.organizationId } });
  const cutoffSnapshot = buildRetentionCutoffs(valuesFromPolicy(stored));
  return prisma.$transaction(async (tx) => {
    const run = await tx.dataRetentionRun.create({
      data: {
        organizationId: input.organizationId,
        createdById: input.userId,
        mode: input.mode,
        cutoffSnapshot: json(cutoffSnapshot),
      },
    });
    await recordAuditEvent(tx, {
      organizationId: input.organizationId, actorUserId: input.userId,
      action: "retention.run.queued", resourceType: "DataRetentionRun", resourceId: run.id,
      severity: input.mode === "APPLY" ? "CRITICAL" : "INFO",
      summary: `${input.mode === "APPLY" ? "Destructive" : "Preview"} retention run queued`,
      metadata: { mode: input.mode, cutoffSnapshot: json(cutoffSnapshot) }, requestId: input.requestId,
    });
    return run;
  });
}

export function listRetentionRuns(organizationId: string, limit: number) {
  return prisma.dataRetentionRun.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    omit: { leaseOwner: true, leaseExpiresAt: true },
    include: { createdBy: { select: { id: true, email: true, name: true } } },
  });
}

async function previewCounts(organizationId: string, cutoffs: RetentionCutoffs) {
  const [
    readNotifications,
    competitorSnapshots,
    publishedOutboxEvents,
    resolvedDeadLetters,
    expiredIdempotencyRecords,
    auditEventsEligibleForArchive,
  ] = await Promise.all([
    prisma.userNotification.count({ where: { organizationId, readAt: { not: null, lt: new Date(cutoffs.readNotificationsBefore) } } }),
    prisma.competitorListingSnapshot.count({ where: { organizationId, capturedAt: { lt: new Date(cutoffs.competitorSnapshotsBefore) } } }),
    prisma.outboxEvent.count({ where: { organizationId, status: "PUBLISHED", publishedAt: { lt: new Date(cutoffs.publishedOutboxBefore) } } }),
    prisma.deadLetterEntry.count({ where: { organizationId, status: "RESOLVED", resolvedAt: { lt: new Date(cutoffs.resolvedDeadLettersBefore) } } }),
    prisma.idempotencyRecord.count({ where: { organizationId, expiresAt: { lt: new Date(cutoffs.generatedAt) } } }),
    prisma.organizationAuditEvent.count({ where: { organizationId, occurredAt: { lt: new Date(cutoffs.auditArchiveEligibleBefore) } } }),
  ]);
  return { readNotifications, competitorSnapshots, publishedOutboxEvents, resolvedDeadLetters, expiredIdempotencyRecords, auditEventsEligibleForArchive };
}

async function applyRetention(tx: Prisma.TransactionClient, organizationId: string, cutoffs: RetentionCutoffs) {
  const [readNotifications, competitorSnapshots, publishedOutboxEvents, resolvedDeadLetters, expiredIdempotencyRecords, auditEventsEligibleForArchive] = await Promise.all([
    tx.userNotification.deleteMany({ where: { organizationId, readAt: { not: null, lt: new Date(cutoffs.readNotificationsBefore) } } }),
    tx.competitorListingSnapshot.deleteMany({ where: { organizationId, capturedAt: { lt: new Date(cutoffs.competitorSnapshotsBefore) } } }),
    tx.outboxEvent.deleteMany({ where: { organizationId, status: "PUBLISHED", publishedAt: { lt: new Date(cutoffs.publishedOutboxBefore) } } }),
    tx.deadLetterEntry.deleteMany({ where: { organizationId, status: "RESOLVED", resolvedAt: { lt: new Date(cutoffs.resolvedDeadLettersBefore) } } }),
    tx.idempotencyRecord.deleteMany({ where: { organizationId, expiresAt: { lt: new Date(cutoffs.generatedAt) } } }),
    tx.organizationAuditEvent.count({ where: { organizationId, occurredAt: { lt: new Date(cutoffs.auditArchiveEligibleBefore) } } }),
  ]);
  return {
    readNotifications: readNotifications.count,
    competitorSnapshots: competitorSnapshots.count,
    publishedOutboxEvents: publishedOutboxEvents.count,
    resolvedDeadLetters: resolvedDeadLetters.count,
    expiredIdempotencyRecords: expiredIdempotencyRecords.count,
    auditEventsEligibleForArchive,
  };
}

async function completeRetentionRun(
  tx: Prisma.TransactionClient,
  run: { id: string; organizationId: string; createdById: string; mode: RetentionRunMode },
  result: Awaited<ReturnType<typeof previewCounts>>,
) {
  await tx.dataRetentionRun.update({
    where: { id: run.id },
    data: { status: "COMPLETED", result: json(result), completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
  });
  await recordAuditEvent(tx, {
    organizationId: run.organizationId, actorUserId: run.createdById,
    action: "retention.run.completed", resourceType: "DataRetentionRun", resourceId: run.id,
    severity: run.mode === "APPLY" ? "CRITICAL" : "INFO",
    summary: `${run.mode === "APPLY" ? "Applied" : "Previewed"} organization retention policy`,
    metadata: { mode: run.mode, result: json(result), auditEventsDeleted: 0 },
  });
  await enqueueOutboxEvent(tx, {
    organizationId: run.organizationId,
    topic: "retention.run.completed",
    aggregateType: "DataRetentionRun",
    aggregateId: run.id,
    payload: { mode: run.mode, result: json(result) },
  });
}

const activeRuns = new Set<string>();

export function getActiveRetentionRunCount() {
  return activeRuns.size;
}

export async function runRetentionJob(runId: string, options: JobRunOptions = inlineJobOptions) {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  try {
    const claimed = await prisma.dataRetentionRun.updateMany({
      where: { id: runId, status: "QUEUED" },
      data: {
        status: "RUNNING", startedAt: new Date(), completedAt: null, attemptCount: { increment: 1 },
        leaseOwner: options.leaseOwner, leaseExpiresAt: leaseExpiry(options), lastError: null,
      },
    });
    if (!claimed.count) return;
    const run = await prisma.dataRetentionRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const cutoffs = parseCutoffs(run.cutoffSnapshot);
    if (run.mode === "APPLY") {
      await prisma.$transaction(async (tx) => {
        const result = await applyRetention(tx, run.organizationId, cutoffs);
        await completeRetentionRun(tx, run, result);
      }, { maxWait: 10_000, timeout: 120_000 });
    } else {
      const result = await previewCounts(run.organizationId, cutoffs);
      await prisma.$transaction((tx) => completeRetentionRun(tx, run, result));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Retention run failed";
    const failedRun = await prisma.dataRetentionRun.findUnique({ where: { id: runId }, select: { organizationId: true, createdById: true, mode: true } }).catch(() => null);
    if (failedRun) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.dataRetentionRun.updateMany({
          where: { id: runId, status: "RUNNING", leaseOwner: options.leaseOwner },
          data: { status: "FAILED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: message },
        });
        if (!updated.count) return;
        await recordAuditEvent(tx, {
          organizationId: failedRun.organizationId, actorUserId: failedRun.createdById,
          action: "retention.run.failed", resourceType: "DataRetentionRun", resourceId: runId,
          severity: "CRITICAL", summary: "Organization retention run failed",
          metadata: { mode: failedRun.mode, error: message },
        });
        await enqueueOutboxEvent(tx, {
          organizationId: failedRun.organizationId,
          topic: "retention.run.failed",
          aggregateType: "DataRetentionRun",
          aggregateId: runId,
          payload: { mode: failedRun.mode, error: message },
        });
      }).catch(() => undefined);
    }
  } finally {
    activeRuns.delete(runId);
  }
}

export function startRetentionJob(runId: string, options: JobRunOptions = inlineJobOptions) {
  setImmediate(() => void runRetentionJob(runId, options));
}

export async function startQueuedRetentionJobs(options: JobRunOptions = inlineJobOptions) {
  const runs = await prisma.dataRetentionRun.findMany({ where: { status: "QUEUED" }, select: { id: true }, orderBy: { createdAt: "asc" } });
  runs.forEach(({ id }) => startRetentionJob(id, options));
  return runs.length;
}

export async function resumeInterruptedRetentionJobs(options: JobRunOptions = inlineJobOptions) {
  await prisma.dataRetentionRun.updateMany({
    where: { status: "RUNNING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }] },
    data: { status: "QUEUED", startedAt: null, leaseOwner: null, leaseExpiresAt: null, lastError: "Worker lease expired; retention run requeued" },
  });
  return startQueuedRetentionJobs(options);
}
