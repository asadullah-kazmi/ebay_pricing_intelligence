import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

const workerService = "background-jobs";

export interface WorkerHealth {
  status: "ok" | "unavailable" | "stale" | "stopped";
  service: typeof workerService;
  lastSeenAt: string | null;
  ageMs: number | null;
  activeJobs: number;
  metrics: {
    polls: number;
    pollFailures: number;
    pricingJobsDispatched: number;
    fitmentJobsDispatched: number;
    inventoryPreparationJobsDispatched: number;
    outboxPublished: number;
    outboxFailed: number;
  };
}

const emptyMetrics = {
  polls: 0,
  pollFailures: 0,
  pricingJobsDispatched: 0,
  fitmentJobsDispatched: 0,
  inventoryPreparationJobsDispatched: 0,
  outboxPublished: 0,
  outboxFailed: 0,
};

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function recordWorkerHeartbeat(
  instanceId: string,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  const now = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { id: instanceId },
    create: {
      id: instanceId,
      service: workerService,
      status: "RUNNING",
      startedAt: now,
      lastSeenAt: now,
      metadata,
    },
    update: {
      status: "RUNNING",
      lastSeenAt: now,
      stoppedAt: null,
      metadata,
    },
  });
}

export async function markWorkerStopped(instanceId: string): Promise<void> {
  const now = new Date();
  await prisma.workerHeartbeat.updateMany({
    where: { id: instanceId },
    data: { status: "STOPPED", stoppedAt: now, lastSeenAt: now },
  });
}

export async function renewWorkerJobLeases(instanceId: string, leaseDurationMs: number): Promise<void> {
  const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);
  await prisma.$transaction([
    prisma.pricingJob.updateMany({
      where: { status: "RUNNING", leaseOwner: instanceId },
      data: { leaseExpiresAt },
    }),
    prisma.fitmentJob.updateMany({
      where: { status: "RUNNING", leaseOwner: instanceId },
      data: { leaseExpiresAt },
    }),
    prisma.inventoryPreparationJob.updateMany({
      where: { status: "RUNNING", leaseOwner: instanceId },
      data: { leaseExpiresAt },
    }),
  ]);
}

export async function getWorkerHealth(maxAgeMs: number): Promise<WorkerHealth> {
  const heartbeat = await prisma.workerHeartbeat.findFirst({
    where: { service: workerService },
    orderBy: { lastSeenAt: "desc" },
    select: { status: true, lastSeenAt: true, metadata: true },
  });
  if (!heartbeat) {
    return { status: "unavailable", service: workerService, lastSeenAt: null, ageMs: null, activeJobs: 0, metrics: emptyMetrics };
  }
  const metadata = typeof heartbeat.metadata === "object" && heartbeat.metadata !== null && !Array.isArray(heartbeat.metadata)
    ? heartbeat.metadata as Record<string, unknown>
    : {};
  const rawMetrics = typeof metadata.metrics === "object" && metadata.metrics !== null && !Array.isArray(metadata.metrics)
    ? metadata.metrics as Record<string, unknown>
    : {};
  const metrics = {
    polls: numberField(rawMetrics.polls),
    pollFailures: numberField(rawMetrics.pollFailures),
    pricingJobsDispatched: numberField(rawMetrics.pricingJobsDispatched),
    fitmentJobsDispatched: numberField(rawMetrics.fitmentJobsDispatched),
    inventoryPreparationJobsDispatched: numberField(rawMetrics.inventoryPreparationJobsDispatched),
    outboxPublished: numberField(rawMetrics.outboxPublished),
    outboxFailed: numberField(rawMetrics.outboxFailed),
  };
  const ageMs = Math.max(0, Date.now() - heartbeat.lastSeenAt.getTime());
  const status = heartbeat.status === "STOPPED" ? "stopped" : ageMs > maxAgeMs ? "stale" : "ok";
  return {
    status,
    service: workerService,
    lastSeenAt: heartbeat.lastSeenAt.toISOString(),
    ageMs,
    activeJobs: numberField(metadata.activeJobs),
    metrics,
  };
}
