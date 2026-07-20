import "./env.js";
import { app } from "./app.js";
import { getConfig } from "./config.js";
import { disconnectDatabase } from "./db.js";
import { resumeInterruptedPricingJobs } from "./pricing-service.js";

const { port, ebay, shutdownTimeoutMs } = getConfig();
const server = app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 120_000;
console.log(`eBay provider: ${ebay.mode} (${ebay.environment})`);
void resumeInterruptedPricingJobs()
  .then((count) => { if (count) console.info(JSON.stringify({ type: "pricing_jobs_resumed", count })); })
  .catch((error) => console.error(JSON.stringify({ type: "pricing_job_recovery_failed", error: error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" } })));

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
