import { describe, expect, it } from "vitest";
import { evaluateOfferDrift } from "./ebay-listing-operation-service.js";

describe("eBay listing reconciliation", () => {
  it("reports only material offer differences", () => {
    const local = {
      sku: "SKU-1",
      marketplaceId: "EBAY_US",
      categoryId: "33596",
      availableQuantity: 2,
      merchantLocationKey: "MAIN",
      listingPolicies: { paymentPolicyId: "PAY", returnPolicyId: "RET", fulfillmentPolicyId: "SHIP" },
      pricingSummary: { price: { currency: "USD", value: "68.58" } },
    };
    expect(evaluateOfferDrift(local, {
      ...local,
      availableQuantity: 1,
      pricingSummary: { price: { currency: "USD", value: "70.00" } },
    })).toEqual([
      'availableQuantity: local "2", eBay "1"',
      'price.value: local "68.58", eBay "70.00"',
    ]);
  });
});
