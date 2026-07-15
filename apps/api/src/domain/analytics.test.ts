import { describe, expect, it } from "vitest";
import { calculateAnalytics } from "./analytics.js";
import type { MatchedListing } from "../types.js";

const listing = (landedPrice: number): MatchedListing => ({
  id: String(landedPrice), title: "Part", seller: "seller", price: landedPrice, shipping: 0,
  landedPrice, currency: "USD", condition: "New", marketplace: "EBAY_US", url: "", aspects: {}, matchedOn: ["MPN"],
});

describe("calculateAnalytics", () => {
  it("calculates summary statistics and a median-based recommendation", () => {
    expect(calculateAnalytics([listing(10), listing(20), listing(40)])).toEqual({
      count: 3, lowest: 10, average: 23.33, median: 20, highest: 40, recommendedPrice: 19.6, currency: "USD",
    });
  });
  it("returns null for no competitors", () => expect(calculateAnalytics([])).toBeNull());
});
