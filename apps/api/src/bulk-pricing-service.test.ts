import { describe, expect, it } from "vitest";
import { createBulkPricingTemplateCsv, parseBulkPricingCsv } from "./bulk-pricing-service.js";

describe("bulk pricing sheet parser", () => {
  it("parses required columns and defaults currency/condition", () => {
    const rows = parseBulkPricingCsv(
      ["SKU,PartNumber,Brand,CostPrice", "AUDI-1,8K0615301M,Audi,45.5"].join("\n"),
      { marketplace: "EBAY_US", condition: "USED" },
    );
    expect(rows).toEqual([{
      rowNumber: 1,
      sku: "AUDI-1",
      partNumber: "8K0615301M",
      brand: "Audi",
      costPrice: 45.5,
      currency: "USD",
      condition: "USED",
      notes: null,
    }]);
  });

  it("accepts header aliases and row overrides", () => {
    const rows = parseBulkPricingCsv(
      ["sku,part no,brand,cost,currency,condition,notes", "X,ABC123,BMW,$10.00,GBP,NEW,ok"].join("\n"),
      { marketplace: "EBAY_US", condition: "ANY" },
    );
    expect(rows[0]).toMatchObject({
      partNumber: "ABC123",
      costPrice: 10,
      currency: "GBP",
      condition: "NEW",
      notes: "ok",
    });
  });

  it("exposes a template with required headers", () => {
    expect(createBulkPricingTemplateCsv()).toContain("SKU,PartNumber,Brand,CostPrice,Currency,Condition,Notes");
  });
});
