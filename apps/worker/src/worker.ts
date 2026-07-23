import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  disconnectDatabase,
  getActiveFitmentJobCount,
  getActivePricingJobCount,
  markWorkerStopped,
  recordWorkerHeartbeat,
  renewWorkerJobLeases,
  resumeInterruptedFitmentJobs,
  resumeInterruptedPricingJobs,
  type JobRunOptions,
} from "@price-intel/api/jobs";

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

const pollIntervalMs = integerEnv("WORKER_POLL_INTERVAL_MS", 2_000, 500, 60_000);
const heartbeatIntervalMs = integerEnv("WORKER_HEARTBEAT_INTERVAL_MS", 10_000, 5_000, 60_000);
const leaseDurationMs = integerEnv("WORKER_LEASE_DURATION_MS", 60_000, 15_000, 600_000);
const maxAttempts = integerEnv("WORKER_MAX_ATTEMPTS", 3, 1, 10);
const retryBaseDelayMs = integerEnv("WORKER_RETRY_BASE_DELAY_MS", 1_000, 100, 30_000);
const shutdownTimeoutMs = integerEnv("WORKER_SHUTDOWN_TIMEOUT_MS", 30_000, 5_000, 120_000);
if (heartbeatIntervalMs * 3 > leaseDurationMs) {
  throw new Error("WORKER_LEASE_DURATION_MS must be at least three times WORKER_HEARTBEAT_INTERVAL_MS");
}
if ((process.env.JOB_EXECUTION_MODE?.trim() || "inline") !== "worker") {
  throw new Error("The worker service requires JOB_EXECUTION_MODE=worker");
}
const instanceId = `${hostname()}-${process.pid}-${randomUUID()}`;
const jobOptions: JobRunOptions = { leaseOwner: instanceId, leaseDurationMs, maxAttempts, retryBaseDelayMs };

let stopping = false;
let pollInProgress = false;
let pollTimer: NodeJS.Timeout | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
const metrics = { polls: 0, pollFailures: 0, pricingJobsDispatched: 0, fitmentJobsDispatched: 0 };

function activeJobs(): number {
  return getActivePricingJobCount() + getActiveFitmentJobCount();
}

async function heartbeat(): Promise<void> {
  await recordWorkerHeartbeat(instanceId, {
    processId: process.pid,
    pollIntervalMs,
    heartbeatIntervalMs,
    leaseDurationMs,
    activeJobs: activeJobs(),
    metrics,
  });
  await renewWorkerJobLeases(instanceId, leaseDurationMs);
}

async function poll(): Promise<void> {
  if (stopping || pollInProgress) return;
  pollInProgress = true;
  metrics.polls += 1;
  try {
    const [pricingJobs, fitmentJobs] = await Promise.all([
      resumeInterruptedPricingJobs(jobOptions),
      resumeInterruptedFitmentJobs(jobOptions),
    ]);
    metrics.pricingJobsDispatched += pricingJobs;
    metrics.fitmentJobsDispatched += fitmentJobs;
    if (pricingJobs || fitmentJobs) {
      console.info(JSON.stringify({ type: "jobs_dispatched", pricingJobs, fitmentJobs, activeJobs: activeJobs() }));
    }
  } catch (error) {
    metrics.pollFailures += 1;
    console.error(JSON.stringify({
      type: "worker_poll_failed",
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" },
    }));
  } finally {
    pollInProgress = false;
  }
}

async function start(): Promise<void> {
  await heartbeat();
  const [pricingJobs, fitmentJobs] = await Promise.all([
    resumeInterruptedPricingJobs(jobOptions),
    resumeInterruptedFitmentJobs(jobOptions),
  ]);
  console.info(JSON.stringify({
    type: "worker_started",
    pollIntervalMs,
    heartbeatIntervalMs,
    leaseDurationMs,
    maxAttempts,
    recovered: { pricingJobs, fitmentJobs },
  }));
  pollTimer = setInterval(() => void poll(), pollIntervalMs);
  heartbeatTimer = setInterval(() => void heartbeat().catch((error) => {
    console.error(JSON.stringify({
      type: "worker_heartbeat_failed",
      error: error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" },
    }));
  }), heartbeatIntervalMs);
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (pollTimer) clearInterval(pollTimer);
  console.info(JSON.stringify({ type: "worker_shutdown_started", signal, activeJobs: activeJobs() }));
  const deadline = Date.now() + shutdownTimeoutMs;
  while (activeJobs() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await markWorkerStopped(instanceId).catch((error) => {
    console.error(JSON.stringify({ type: "worker_stop_heartbeat_failed", error: error instanceof Error ? error.message : "Unknown error" }));
  });
  await disconnectDatabase();
  process.exitCode = exitCode;
  console.info(JSON.stringify({ type: "worker_shutdown_completed", signal, drained: activeJobs() === 0 }));
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("unhandledRejection", (error) => {
  console.error(JSON.stringify({
    type: "worker_unhandled_rejection",
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" },
  }));
  void shutdown("unhandledRejection", 1);
});
process.once("uncaughtException", (error) => {
  console.error(JSON.stringify({ type: "worker_uncaught_exception", error: { name: error.name, message: error.message, stack: error.stack } }));
  void shutdown("uncaughtException", 1);
});

void start().catch((error) => {
  console.error(JSON.stringify({
    type: "worker_start_failed",
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" },
  }));
  void shutdown("startupFailure", 1);
});
