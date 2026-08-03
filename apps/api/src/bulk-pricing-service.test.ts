import { describe, expect, it } from "vitest";
import { createBulkPricingTemplateCsv, parseBulkPricingCsv } from "./bulk-pricing-service.js";

describe("bulk pricing sheet parser", () => {
  it("parses required columns and defaults currency/condition", () => {
    const rows = parseBulkPricingCsv(
      ["PartNumber,Brand,CostPrice", "8K0615301M,Audi,45.5"].join("\n"),
      { marketplace: "EBAY_US", condition: "USED", currency: "GBP" },
    );
    expect(rows).toEqual([{
      rowNumber: 1,
      sku: "AUDI-8K0615301M-001",
      partNumber: "8K0615301M",
      brand: "Audi",
      costPrice: 45.5,
      quantity: 1,
      currency: "GBP",
      condition: "USED",
      notes: null,
    }]);
  });

  it("accepts header aliases but uses upload-level currency and condition", () => {
    const rows = parseBulkPricingCsv(
      ["sku,part no,brand,cost,qty,currency,condition,notes", "X,ABC123,BMW,$10.00,7,GBP,NEW,ok"].join("\n"),
      { marketplace: "EBAY_US", condition: "USED", currency: "USD" },
    );
    expect(rows[0]).toMatchObject({
      sku: "X",
      partNumber: "ABC123",
      costPrice: 10,
      quantity: 7,
      currency: "USD",
      condition: "USED",
      notes: "ok",
    });
  });

  it("accepts more than 50 rows in one upload", () => {
    const csv = [
      "PartNumber,Brand,CostPrice",
      ...Array.from({ length: 75 }, (_value, index) => `ABC${index + 1},Audi,45`),
    ].join("\n");
    const rows = parseBulkPricingCsv(csv, { marketplace: "EBAY_US", condition: "NEW", currency: "USD" });
    expect(rows).toHaveLength(75);
    expect(rows[74]).toMatchObject({ rowNumber: 75, partNumber: "ABC75", condition: "NEW" });
  });

  it("exposes a template with required headers", () => {
    expect(createBulkPricingTemplateCsv()).toContain("PartNumber,Brand,CostPrice,Quantity,Notes");
    expect(createBulkPricingTemplateCsv()).not.toContain("SKU");
    expect(createBulkPricingTemplateCsv()).not.toContain("Currency");
    expect(createBulkPricingTemplateCsv()).not.toContain("Condition");
  });
});
