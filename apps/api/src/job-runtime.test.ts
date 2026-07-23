import { describe, expect, it, vi } from "vitest";
import { isRetryableJobError, runWithRetry } from "./job-runtime.js";

describe("background job retries", () => {
  it("retries transient provider failures with exponential delays", async () => {
    vi.useFakeTimers();
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("provider unavailable"), { status: 503 }))
      .mockResolvedValue("ok");
    const retryEvents: number[] = [];
    const result = runWithRetry(operation, { maxAttempts: 3, retryBaseDelayMs: 100 }, async (_error, _attempt, delayMs) => {
      retryEvents.push(delayMs);
    });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(retryEvents).toEqual([100, 200]);
    vi.useRealTimers();
  });

  it("does not retry permanent provider errors", async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error("bad request"), { status: 400 }));
    await expect(runWithRetry(operation, { maxAttempts: 3, retryBaseDelayMs: 1 })).rejects.toThrow("bad request");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("recognizes transport, timeout, throttling, and server errors as transient", () => {
    expect(isRetryableJobError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableJobError(Object.assign(new Error("timeout"), { name: "TimeoutError" }))).toBe(true);
    expect(isRetryableJobError({ status: 429 })).toBe(true);
    expect(isRetryableJobError({ status: 500 })).toBe(true);
    expect(isRetryableJobError({ status: 404 })).toBe(false);
  });
});
