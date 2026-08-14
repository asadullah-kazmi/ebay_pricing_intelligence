import { describe, expect, it } from "vitest";
import { acceptLanguage, contentLanguage, normalizeInventoryItemSummary, normalizeOfferSnapshot, normalizeOfferSummary, summarizeListingFees } from "./ebay-inventory.js";

describe("eBay Inventory API localization", () => {
  it("uses the marketplace content language required by inventory writes", () => {
    expect(contentLanguage("EBAY_US")).toBe("en-US");
    expect(contentLanguage("EBAY_GB")).toBe("en-GB");
    expect(contentLanguage("EBAY_DE")).toBe("de-DE");
  });

  it("uses regional accept-language values for inventory reads", () => {
    expect(acceptLanguage("EBAY_US")).toBe("en-US");
    expect(acceptLanguage("EBAY_GB")).toBe("en-GB");
    expect(acceptLanguage("EBAY_DE")).toBe("de-DE");
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

  it("normalizes published listing state from getOffer", () => {
    expect(normalizeOfferSnapshot({
      offerId: "OFFER-1",
      listing: { listingId: "123", listingStatus: "ACTIVE", listingOnHold: true, soldQuantity: 2 },
    })).toMatchObject({
      offerId: "OFFER-1", listingId: "123", listingStatus: "ACTIVE", listingOnHold: true, soldQuantity: 2,
    });
  });

  it("normalizes inventory item list rows", () => {
    expect(normalizeInventoryItemSummary({
      sku: "BLA-1000",
      condition: "USED_EXCELLENT",
      availability: { shipToLocationAvailability: { quantity: "7" } },
      product: { title: "Audi Door Shell", image: { imageUrl: "https://i.ebayimg.com/example.jpg" } },
    })).toMatchObject({
      sku: "BLA-1000",
      title: "Audi Door Shell",
      condition: "USED_EXCELLENT",
      totalQuantity: 7,
    });
  });

  it("normalizes offer list rows with price and listing identity", () => {
    expect(normalizeOfferSummary({
      offerId: "OFFER-1",
      sku: "BLA-1000",
      marketplaceId: "EBAY_US",
      status: "PUBLISHED",
      categoryId: "179850",
      availableQuantity: 3,
      pricingSummary: { price: { currency: "USD", value: "199.99" } },
      listing: { listingId: "123", listingStatus: "ACTIVE" },
    })).toMatchObject({
      offerId: "OFFER-1",
      sku: "BLA-1000",
      listingId: "123",
      priceValue: 199.99,
      priceCurrency: "USD",
      availableQuantity: 3,
    });
  });
});
