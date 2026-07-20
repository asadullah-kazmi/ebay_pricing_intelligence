import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./http-hardening.js";

describe("fixed-window rate limiter", () => {
  it("allows requests through the configured limit and then rejects", () => {
    const limiter = new FixedWindowRateLimiter(2, 60_000);
    expect(limiter.consume("client", 1_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("client", 1_001)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("client", 1_002)).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
  });

  it("isolates clients and resets expired windows", () => {
    const limiter = new FixedWindowRateLimiter(1, 10_000);
    expect(limiter.consume("client-a", 5_000).allowed).toBe(true);
    expect(limiter.consume("client-a", 5_001).allowed).toBe(false);
    expect(limiter.consume("client-b", 5_001).allowed).toBe(true);
    expect(limiter.consume("client-a", 15_000)).toMatchObject({ allowed: true, remaining: 0 });
  });
});
