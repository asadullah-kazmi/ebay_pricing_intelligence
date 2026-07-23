import {
  disconnectDatabase,
  resumeInterruptedFitmentJobs,
  resumeInterruptedPricingJobs,
  startQueuedFitmentJobs,
  startQueuedPricingJobs,
} from "@price-intel/api/jobs";

const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2_000);
if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 500 || pollIntervalMs > 60_000) {
  throw new Error("WORKER_POLL_INTERVAL_MS must be an integer between 500 and 60000");
}
if ((process.env.JOB_EXECUTION_MODE?.trim() || "inline") !== "worker") {
  throw new Error("The worker service requires JOB_EXECUTION_MODE=worker");
}

let stopping = false;
let pollInProgress = false;
let timer: NodeJS.Timeout | undefined;

async function poll(): Promise<void> {
  if (stopping || pollInProgress) return;
  pollInProgress = true;
  try {
    const [pricingJobs, fitmentJobs] = await Promise.all([
      startQueuedPricingJobs(),
      startQueuedFitmentJobs(),
    ]);
    if (pricingJobs || fitmentJobs) {
      console.info(JSON.stringify({ type: "jobs_dispatched", pricingJobs, fitmentJobs }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      type: "worker_poll_failed",
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" },
    }));
  } finally {
    pollInProgress = false;
  }
}

async function start(): Promise<void> {
  const [pricingJobs, fitmentJobs] = await Promise.all([
    resumeInterruptedPricingJobs(),
    resumeInterruptedFitmentJobs(),
  ]);
  console.info(JSON.stringify({
    type: "worker_started",
    pollIntervalMs,
    recovered: { pricingJobs, fitmentJobs },
  }));
  await poll();
  timer = setInterval(() => void poll(), pollIntervalMs);
}

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  console.info(JSON.stringify({ type: "worker_shutdown_started", signal }));
  await disconnectDatabase();
  process.exitCode = exitCode;
  console.info(JSON.stringify({ type: "worker_shutdown_completed", signal }));
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
