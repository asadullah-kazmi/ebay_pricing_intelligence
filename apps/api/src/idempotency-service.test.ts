import { describe, expect, it } from "vitest";
import { requestHash, stableJson } from "./idempotency-service.js";

describe("idempotency request hashing", () => {
  it("is stable across object key ordering", () => {
    expect(stableJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(requestHash({ a: 1, b: [2, 3] })).toBe(requestHash({ b: [2, 3], a: 1 }));
  });

  it("changes when request content changes", () => {
    expect(requestHash({ partIds: ["a"] })).not.toBe(requestHash({ partIds: ["b"] }));
  });
});
