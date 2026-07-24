import { describe, expect, it } from "vitest";
import { boundedInteger, percentile, summarizeLoadResults, validateLoadTarget } from "./load-probe.js";

describe("read-only load probe safeguards", () => {
  it("requires an exact target confirmation and HTTPS for remote services", () => {
    expect(() => validateLoadTarget("https://api.example.com", undefined)).toThrow("LOAD_TEST_CONFIRM_TARGET");
    expect(() => validateLoadTarget("http://api.example.com", "api.example.com")).toThrow("HTTPS");
    expect(() => validateLoadTarget("https://user:secret@api.example.com", "api.example.com")).toThrow("credentials");
    expect(validateLoadTarget("https://api.example.com", "api.example.com").origin).toBe("https://api.example.com");
    expect(validateLoadTarget("http://127.0.0.1:4000", "127.0.0.1:4000").origin).toBe("http://127.0.0.1:4000");
  });

  it("bounds concurrency and request settings", () => {
    expect(boundedInteger(undefined, 30, "REQUESTS", 1_000)).toBe(30);
    expect(() => boundedInteger("1001", 30, "REQUESTS", 1_000)).toThrow();
    expect(() => boundedInteger("2.5", 3, "CONCURRENCY", 25)).toThrow();
  });

  it("calculates latency, throughput, status, and failure metrics", () => {
    const durations = [10, 20, 30, 40, 50];
    expect(percentile(durations, 0.5)).toBe(30);
    expect(percentile(durations, 0.95)).toBe(50);
    expect(summarizeLoadResults([
      { durationMs: 10, status: 200, ok: true },
      { durationMs: 30, status: 200, ok: true },
      { durationMs: 50, status: 503, ok: false },
      { durationMs: 40, status: 0, ok: false, error: "timeout" },
    ], 1_000)).toMatchObject({
      requests: 4,
      successful: 2,
      failed: 2,
      errorRate: 0.5,
      requestsPerSecond: 4,
      latencyMs: { min: 10, p50: 30, p95: 50, p99: 50, max: 50 },
      statuses: { "200": 2, "503": 1, network_error: 1 },
    });
  });
});
