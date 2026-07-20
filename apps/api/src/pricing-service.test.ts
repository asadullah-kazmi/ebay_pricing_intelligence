import { describe, expect, it } from "vitest";
import { resolvePricingCondition, selectExactCompetitors } from "./pricing-service.js";
import type { RawListing } from "./types.js";

function listing(overrides: Partial<RawListing> = {}): RawListing {
  return {
    id: "v1|123|0",
    title: "OEM module 84178783",
    seller: "competitor",
    price: 40,
    shipping: 7.5,
    currency: "USD",
    condition: "Used",
    marketplace: "EBAY_US",
    url: "https://www.ebay.com/itm/123",
    aspects: { "OE/OEM Part Number": ["84178783"] },
    ...overrides,
  };
}

describe("bulk pricing selection", () => {
  it("uses each catalog part condition when requested", () => {
    expect(resolvePricingCondition("MATCH_PART", "NEW")).toBe("NEW");
    expect(resolvePricingCondition("MATCH_PART", "USED")).toBe("USED");
    expect(resolvePricingCondition("ANY", "USED")).toBe("ANY");
  });

  it("keeps only exact item-specific matches and excludes owned sellers", () => {
    const matches = selectExactCompetitors([
      listing(),
      listing({ id: "owned", seller: "My-Store" }),
      listing({ id: "partial", aspects: { "OE/OEM Part Number": ["841787830"] } }),
    ], "84-178-783", new Set(["my-store"]));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: "v1|123|0", landedPrice: 47.5, matchedOn: ["OE/OEM Part Number"] });
  });
});
