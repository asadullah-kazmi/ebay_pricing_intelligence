export interface LoadProbeResult {
  durationMs: number;
  status: number;
  ok: boolean;
  error?: string;
}

export interface LoadProbeSummary {
  requests: number;
  successful: number;
  failed: number;
  errorRate: number;
  requestsPerSecond: number;
  latencyMs: { min: number; p50: number; p95: number; p99: number; max: number };
  statuses: Record<string, number>;
}

export function validateLoadTarget(rawBaseUrl: string, confirmation: string | undefined): URL {
  const url = new URL(rawBaseUrl);
  if (url.username || url.password) throw new Error("LOAD_TEST_BASE_URL must not contain credentials");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("LOAD_TEST_BASE_URL must contain only the origin");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (!local && url.protocol !== "https:") throw new Error("The load-test target must use HTTPS outside localhost");
  if (local && url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The load-test target must use HTTP or HTTPS");
  if (confirmation !== url.host) {
    throw new Error(`Set LOAD_TEST_CONFIRM_TARGET=${url.host} to confirm the exact target`);
  }
  return url;
}

export function boundedInteger(raw: string | undefined, fallback: number, name: string, maximum: number): number {
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

export function percentile(values: number[], requestedPercentile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(requestedPercentile * sorted.length) - 1);
  return sorted[index] ?? 0;
}

export function summarizeLoadResults(results: LoadProbeResult[], elapsedMs: number): LoadProbeSummary {
  const durations = results.map((result) => result.durationMs);
  const successful = results.filter((result) => result.ok).length;
  const statuses = results.reduce<Record<string, number>>((counts, result) => {
    const key = result.status ? String(result.status) : "network_error";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const min = durations.length ? Math.min(...durations) : 0;
  const max = durations.length ? Math.max(...durations) : 0;
  return {
    requests: results.length,
    successful,
    failed: results.length - successful,
    errorRate: results.length ? (results.length - successful) / results.length : 0,
    requestsPerSecond: elapsedMs > 0 ? results.length / (elapsedMs / 1_000) : 0,
    latencyMs: {
      min,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max,
    },
    statuses,
  };
}
