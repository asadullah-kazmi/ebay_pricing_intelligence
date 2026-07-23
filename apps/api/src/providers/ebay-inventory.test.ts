import { describe, expect, it } from "vitest";
import { contentLanguage, summarizeListingFees } from "./ebay-inventory.js";

describe("eBay Inventory API localization", () => {
  it("uses the marketplace content language required by inventory writes", () => {
    expect(contentLanguage("EBAY_US")).toBe("en-US");
    expect(contentLanguage("EBAY_GB")).toBe("en-GB");
    expect(contentLanguage("EBAY_DE")).toBe("de-DE");
  });

  it("totals expected fees while retaining the raw response", () => {
    const response = {
      feeSummaries: [{
        marketplaceId: "EBAY_US",
        fees: [
          { feeType: "INSERTION_FEE", amount: { currency: "USD", value: "0.35" } },
          { feeType: "GALLERY_FEE", amount: { currency: "USD", value: "1.00" } },
        ],
        warnings: [{ message: "Example warning" }],
      }],
    };
    expect(summarizeListingFees(response)).toMatchObject({ total: 1.35, currency: "USD", warnings: [{ message: "Example warning" }] });
  });
});
