import "./env.js";
import { app } from "./app.js";
import { getConfig } from "./config.js";
import { databaseIsReachable, disconnectDatabase } from "./db.js";
import { resumeInterruptedPricingJobs } from "./pricing-service.js";
import { resumeInterruptedFitmentJobs } from "./fitment-service.js";
import { cleanupExpiredBulkPricingJobs, resumeInterruptedBulkPricingJobs } from "./bulk-pricing-service.js";
import { resumeInterruptedPipelineJobs } from "./pipeline-service.js";

const { port, ebay, shutdownTimeoutMs, jobs } = getConfig();
const server = app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 120_000;
console.log(`eBay provider: ${ebay.mode} (${ebay.environment})`);
console.log(`Background job execution: ${jobs.executionMode}`);
async function runBulkPricingRetentionCleanup() {
  try {
    const count = await cleanupExpiredBulkPricingJobs();
    if (count) console.info(JSON.stringify({ type: "bulk_pricing_retention_cleanup", count }));
  } catch (error) {
    console.error(JSON.stringify({ type: "bulk_pricing_retention_cleanup_failed", error: error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" } }));
  }
}

let recoveryInProgress = false;
let databaseUnavailableLogged = false;
async function runInlineRecoveries() {
  if (recoveryInProgress) return false;
  recoveryInProgress = true;
  try {
    if (!(await databaseIsReachable())) {
      if (!databaseUnavailableLogged) {
        console.warn(JSON.stringify({ type: "background_recovery_deferred", reason: "database_unavailable" }));
        databaseUnavailableLogged = true;
      }
      return false;
    }
    if (databaseUnavailableLogged) {
      console.info(JSON.stringify({ type: "database_connection_recovered" }));
      databaseUnavailableLogged = false;
    }
    const recoveries = [
      ["pricing_jobs_resumed", resumeInterruptedPricingJobs],
      ["fitment_jobs_resumed", resumeInterruptedFitmentJobs],
      ["bulk_pricing_jobs_resumed", resumeInterruptedBulkPricingJobs],
      ["pipeline_jobs_resumed", resumeInterruptedPipelineJobs],
    ] as const;
    for (const [type, recovery] of recoveries) {
      const count = await recovery();
      if (count) console.info(JSON.stringify({ type, count }));
    }
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      type: "background_recovery_failed",
      error: error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" },
    }));
    return false;
  } finally {
    recoveryInProgress = false;
  }
}

if (jobs.executionMode === "inline") {
  void runInlineRecoveries().then((databaseAvailable) => {
    if (databaseAvailable) return runBulkPricingRetentionCleanup();
  });
}
const inlineRecoveryTimer = jobs.executionMode === "inline"
  ? setInterval(() => void runInlineRecoveries(), 60_000)
  : undefined;
inlineRecoveryTimer?.unref();
const bulkPricingRetentionTimer = jobs.executionMode === "inline"
  ? setInterval(() => void runBulkPricingRetentionCleanup(), 60 * 60 * 1000)
  : undefined;
bulkPricingRetentionTimer?.unref();

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ type: "shutdown_started", signal }));
  const forcedExit = setTimeout(() => {
    console.error(JSON.stringify({ type: "shutdown_forced", signal }));
    process.exit(1);
  }, shutdownTimeoutMs);
  forcedExit.unref();
  server.closeIdleConnections?.();
  if (inlineRecoveryTimer) clearInterval(inlineRecoveryTimer);
  if (bulkPricingRetentionTimer) clearInterval(bulkPricingRetentionTimer);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectDatabase();
  clearTimeout(forcedExit);
  process.exitCode = exitCode;
  console.info(JSON.stringify({ type: "shutdown_completed", signal }));
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("unhandledRejection", (error) => {
  console.error(JSON.stringify({ type: "unhandled_rejection", error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "UnknownError" } }));
  void shutdown("unhandledRejection", 1);
});
process.once("uncaughtException", (error) => {
  console.error(JSON.stringify({ type: "uncaught_exception", error: { name: error.name, message: error.message, stack: error.stack } }));
  void shutdown("uncaughtException", 1);
});
