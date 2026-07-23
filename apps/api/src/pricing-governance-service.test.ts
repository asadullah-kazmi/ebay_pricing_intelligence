import { describe, expect, it } from "vitest";
import { calculateGovernedPrice, defaultPricingRule } from "./pricing-governance-service.js";

describe("pricing governance calculation", () => {
  it("uses the higher of minimum profit and margin as the cost floor", () => {
    expect(calculateGovernedPrice({
      marketRecommendedPrice: 90,
      marketCurrency: "USD",
      costAmount: 80,
      costCurrency: "USD",
      rule: defaultPricingRule,
    })).toEqual({
      marketRecommendedPrice: 90,
      floorPrice: 100,
      proposedPrice: 100,
      floorUnavailableReason: null,
    });
  });

  it("applies the organization market adjustment without going below the floor", () => {
    expect(calculateGovernedPrice({
      marketRecommendedPrice: 100,
      marketCurrency: "USD",
      costAmount: 40,
      costCurrency: "USD",
      rule: { ...defaultPricingRule, marketAdjustmentPercent: -10 },
    })).toMatchObject({ floorPrice: 50, proposedPrice: 90 });
  });

  it("refuses to calculate a floor across currencies", () => {
    expect(calculateGovernedPrice({
      marketRecommendedPrice: 75,
      marketCurrency: "GBP",
      costAmount: 50,
      costCurrency: "USD",
      rule: defaultPricingRule,
    })).toMatchObject({
      floorPrice: null,
      proposedPrice: 75,
      floorUnavailableReason: "COST_CURRENCY_MISMATCH",
    });
  });
});
