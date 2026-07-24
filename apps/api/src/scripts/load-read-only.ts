import "../env.js";
import { performance } from "node:perf_hooks";
import { boundedInteger, summarizeLoadResults, validateLoadTarget, type LoadProbeResult } from "../load-probe.js";

const rawBaseUrl = process.env.LOAD_TEST_BASE_URL?.trim();
if (!rawBaseUrl) throw new Error("LOAD_TEST_BASE_URL is required");
const target = validateLoadTarget(rawBaseUrl, process.env.LOAD_TEST_CONFIRM_TARGET?.trim());
const requestCount = boundedInteger(process.env.LOAD_TEST_REQUESTS, 30, "LOAD_TEST_REQUESTS", 1_000);
const concurrency = Math.min(requestCount, boundedInteger(process.env.LOAD_TEST_CONCURRENCY, 3, "LOAD_TEST_CONCURRENCY", 25));
const timeoutMs = boundedInteger(process.env.LOAD_TEST_TIMEOUT_MS, 10_000, "LOAD_TEST_TIMEOUT_MS", 60_000);
const maximumP95Ms = boundedInteger(process.env.LOAD_TEST_MAX_P95_MS, 1_500, "LOAD_TEST_MAX_P95_MS", 60_000);
const maximumErrorRate = Number(process.env.LOAD_TEST_MAX_ERROR_RATE ?? "0.01");
if (!Number.isFinite(maximumErrorRate) || maximumErrorRate < 0 || maximumErrorRate > 1) {
  throw new Error("LOAD_TEST_MAX_ERROR_RATE must be a number between 0 and 1");
}

const accessToken = process.env.LOAD_TEST_ACCESS_TOKEN?.trim();
const paths = accessToken
  ? ["/health/live", "/api/session", "/api/parts?page=1&pageSize=10", "/api/notifications?limit=10"]
  : ["/health/live"];
const results: LoadProbeResult[] = [];
let nextIndex = 0;

async function worker(): Promise<void> {
  while (true) {
    const index = nextIndex++;
    if (index >= requestCount) return;
    const path = paths[index % paths.length]!;
    const startedAt = performance.now();
    try {
      const response = await fetch(new URL(path, target), {
        method: "GET",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.arrayBuffer();
      results.push({ durationMs: performance.now() - startedAt, status: response.status, ok: response.ok });
    } catch (error) {
      results.push({
        durationMs: performance.now() - startedAt,
        status: 0,
        ok: false,
        error: error instanceof Error ? error.name : "NetworkError",
      });
    }
  }
}

console.log(`Starting GET-only probe: target=${target.origin} requests=${requestCount} concurrency=${concurrency} authenticated=${Boolean(accessToken)}`);
const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const summary = summarizeLoadResults(results, performance.now() - startedAt);
console.log(JSON.stringify(summary, null, 2));

if (summary.latencyMs.p95 > maximumP95Ms || summary.errorRate > maximumErrorRate) {
  throw new Error(`Load thresholds failed: p95=${summary.latencyMs.p95.toFixed(1)}ms (max ${maximumP95Ms}ms), errorRate=${summary.errorRate.toFixed(4)} (max ${maximumErrorRate})`);
}
console.log("Read-only load probe passed");
