import { describe, expect, it } from "vitest";
import { calculateBulkMarginPercent, calculateSimpleBulkSellingPrice, createBulkPricingTemplateCsv, parseBulkPricingCsv } from "./bulk-pricing-service.js";
import { createDefaultBulkPricingFormula, evaluateBulkPricingFormula, normalizeBulkPricingFormula } from "./bulk-pricing-formula.js";

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

describe("bulk pricing formula", () => {
  it("applies ordered fees and profit to the running subtotal", () => {
    const result = evaluateBulkPricingFormula(45, createDefaultBulkPricingFormula());
    expect(result.sellingPrice).toBe(63.23);
    expect(result.netProfit).toBe(10.54);
    expect(result.breakdown.map((step) => step.subtotalAfter)).toEqual([50.11, 51.11, 51.77, 52.29, 52.69, 63.23]);
  });

  it("supports safe mathematical operations and rejects division by zero", () => {
    const formula = createDefaultBulkPricingFormula();
    formula.components = [
      { id: "fixed", kind: "CUSTOM_FIXED", operator: "ADD", value: 5, label: "Handling", enabled: true },
      { id: "double", kind: "CUSTOM_FIXED", operator: "MULTIPLY", value: 2, label: "Multiplier", enabled: true },
      { id: "discount", kind: "CUSTOM_PERCENT", operator: "SUBTRACT", value: 10, label: "Discount", enabled: true },
    ];
    expect(evaluateBulkPricingFormula(20, formula).sellingPrice).toBe(45);
    expect(() => normalizeBulkPricingFormula({ ...formula, components: [{ ...formula.components[0], operator: "DIVIDE", value: 0 }] })).toThrow(/divide by zero/i);
  });
});

describe("bulk pricing calculator", () => {
  it("uses cost plus total fees base then adds selected profit percentage", () => {
    const result = calculateSimpleBulkSellingPrice({ costPrice: 14.54, targetMarginPercent: 20 });

    expect(result.targetProfit).toBe(3.65);
    expect(result.sellingPrice).toBe(21.26);
    expect(result.ebayFee).toBe(2.41);
    expect(result.extraExpenses).toBe(1.31);
    expect(result.actualProfit).toBe(3);
    expect(result.actualProfitPercent).toBe(14.11);
  });

  it("calculates dynamic net profit percent on selling price for custom price", () => {
    const margin = calculateBulkMarginPercent(14.54, 25.97);
    expect(margin).toBe(26.8);
  });
});
