import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildOfferPayload } from "./ebay-offer-service.js";

describe("eBay offer payload", () => {
  it("builds a complete fixed-price GTC offer from a ready draft", () => {
    expect(buildOfferPayload({
      marketplace: "EBAY_US",
      categoryId: "33596",
      quantity: 2,
      price: new Prisma.Decimal("68.58"),
      currency: "USD",
      paymentPolicyId: "PAY",
      returnPolicyId: "RET",
      shippingPolicyId: "SHIP",
      merchantLocationKey: "MAIN",
    }, "SKU-1")).toEqual({
      sku: "SKU-1",
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: 2,
      categoryId: "33596",
      listingDuration: "GTC",
      merchantLocationKey: "MAIN",
      listingPolicies: { paymentPolicyId: "PAY", returnPolicyId: "RET", fulfillmentPolicyId: "SHIP" },
      pricingSummary: { price: { currency: "USD", value: "68.58" } },
      includeCatalogProductDetails: false,
    });
  });
});
