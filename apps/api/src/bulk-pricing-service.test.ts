import { describe, expect, it } from "vitest";
import { calculateBulkMarginPercent, calculateSimpleBulkSellingPrice, createBulkPricingTemplateCsv, parseBulkPricingCsv } from "./bulk-pricing-service.js";
import {
  createDefaultBulkPricingFormula,
  evaluateBulkPricingFormula,
  normalizeBulkPricingFormula,
  type BulkPricingFormula,
  type PricingFormulaComponent,
} from "./bulk-pricing-formula.js";

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
  const fee = (id: string, kind: PricingFormulaComponent["kind"], value: number, label = id): PricingFormulaComponent => ({
    id, kind, operator: "ADD", value, label, enabled: true,
    calculationType: "PERCENTAGE_DEDUCTION", calculationBase: "SELLING_PRICE",
  });
  const fixed = (value: number): PricingFormulaComponent => ({
    id: "misc", kind: "MISC_FIXED", operator: "ADD", value, label: "Miscellaneous", enabled: true,
    calculationType: "FIXED_COST", calculationBase: "PREVIOUS_TOTAL",
  });
  const margin = (value: number): PricingFormulaComponent => ({
    id: "profit", kind: "PROFIT_MARGIN_PERCENT", operator: "ADD", value, label: "Profit margin", enabled: true,
    calculationType: "TARGET_MARGIN", calculationBase: "SELLING_PRICE",
  });
  const formula = (components: PricingFormulaComponent[]): BulkPricingFormula => ({ version: 2, base: "COST_PRICE", components });

  it("reverse-solves selling-price fees and a 25% net margin for the $45 example", () => {
    const result = evaluateBulkPricingFormula(45, formula([
      fee("ebay", "EBAY_FEE_PERCENT", 13, "eBay fee"),
      fee("payoneer", "PAYONEER_FEE_PERCENT", 3, "Payoneer"),
      fee("export", "EXPORT_FEE_PERCENT", 1.3, "Export"),
      fee("buffer", "BUFFER_PERCENT", 3, "Buffer"),
      fixed(0.4),
      fee("plg", "PROMOTED_LISTING_PERCENT", 15, "PLG"),
      margin(25),
    ]));
    expect(result.sellingPrice).toBeCloseTo(114.36, 2);
    expect(result.netProfit).toBeCloseTo(28.59, 2);
    expect(result.netMargin).toBeCloseTo(25, 1);
    expect(result.breakdown.find((item) => item.id === "ebay")?.amount).toBeCloseTo(14.87, 2);
  });

  it("solves $100 with 23% fees and a 20% margin", () => {
    const result = evaluateBulkPricingFormula(100, formula([
      fee("ebay", "EBAY_FEE_PERCENT", 13),
      fee("plg", "PROMOTED_LISTING_PERCENT", 10),
      margin(20),
    ]));
    expect(result.sellingPrice).toBeCloseTo(175.44, 2);
    expect(result.netProfit).toBeCloseTo(35.09, 2);
    expect(result.netMargin).toBeCloseTo(20, 1);
  });

  it("treats 25% profit margin as margin, not markup", () => {
    const result = evaluateBulkPricingFormula(100, formula([margin(25)]));
    expect(result.sellingPrice).toBe(133.33);
    expect(result.netMargin).toBeCloseTo(25, 1);
  });

  it("keeps markup separate from net margin", () => {
    const markup: PricingFormulaComponent = {
      id: "markup", kind: "MARKUP_PERCENT", operator: "ADD", value: 25, label: "Markup", enabled: true,
      calculationType: "MARKUP", calculationBase: "BASE_COST",
    };
    const result = evaluateBulkPricingFormula(100, formula([markup]));
    expect(result.sellingPrice).toBe(125);
    expect(result.netProfit).toBe(25);
    expect(result.netMargin).toBe(20);
  });

  it("rejects formulas whose fees and target margin consume 100% or more", () => {
    expect(() => evaluateBulkPricingFormula(100, formula([
      fee("fees", "CUSTOM_PERCENT", 80),
      margin(25),
    ]))).toThrow(/consume 105%/i);
  });

  it("migrates legacy predefined fees to selling price but preserves custom sequential percentages", () => {
    const migrated = normalizeBulkPricingFormula({
      version: 1,
      base: "COST_PRICE",
      components: [
        { id: "ebay", kind: "EBAY_FEE_PERCENT", operator: "ADD", value: 13, label: "eBay", enabled: true },
        { id: "custom", kind: "CUSTOM_PERCENT", operator: "ADD", value: 5, label: "Legacy custom", enabled: true },
      ],
    });
    expect(migrated.version).toBe(2);
    expect(migrated.components[0]?.calculationBase).toBe("SELLING_PRICE");
    expect(migrated.components[1]?.calculationBase).toBe("PREVIOUS_TOTAL");
  });

  it("supports payout-based fees without making visual order change the result", () => {
    const ebay = fee("ebay", "EBAY_FEE_PERCENT", 10, "eBay");
    const payoneer = { ...fee("payoneer", "PAYONEER_FEE_PERCENT", 5, "Payoneer"), calculationBase: "EBAY_PAYOUT" as const };
    const first = evaluateBulkPricingFormula(100, formula([ebay, payoneer, margin(20)]));
    const reordered = evaluateBulkPricingFormula(100, formula([payoneer, margin(20), ebay]));
    expect(first.sellingPrice).toBe(152.67);
    expect(reordered.sellingPrice).toBe(first.sellingPrice);
    expect(first.netMargin).toBeCloseTo(20, 1);
  });

  it("keeps buyer tax out of revenue while allowing an eBay fee to use a tax-inclusive base", () => {
    const ebay = { ...fee("ebay", "EBAY_FEE_PERCENT", 10, "eBay"), calculationBase: "EBAY_ORDER_TOTAL_INCLUDING_TAX" as const };
    const result = evaluateBulkPricingFormula(100, formula([ebay, margin(0)]), {
      buyerShippingCharge: 20,
      actualShippingCost: 15,
      salesTax: 12,
    });
    expect(result.sellingPrice).toBe(109.11);
    expect(result.orderRevenue).toBe(129.11);
    expect(result.netProfit).toBeCloseTo(0, 1);
  });

  it("rejects division by zero in ordered previous-total calculations", () => {
    const legacy = createDefaultBulkPricingFormula();
    legacy.components = [{
      id: "divide", kind: "CUSTOM_PERCENT", operator: "DIVIDE", value: 0, label: "Divider", enabled: true,
      calculationType: "PERCENTAGE_DEDUCTION", calculationBase: "PREVIOUS_TOTAL",
    }];
    expect(() => normalizeBulkPricingFormula(legacy)).toThrow(/divide by zero/i);
  });
});

describe("bulk pricing calculator", () => {
  it("reverse-solves the legacy calculator to achieve the selected net margin", () => {
    const result = calculateSimpleBulkSellingPrice({ costPrice: 14.54, targetMarginPercent: 20 });

    expect(result.targetProfit).toBe(4.57);
    expect(result.sellingPrice).toBe(22.86);
    expect(result.ebayFee).toBe(2.59);
    expect(result.extraExpenses).toBe(1.16);
    expect(result.actualProfit).toBe(4.57);
    expect(result.actualProfitPercent).toBeCloseTo(20, 1);
  });

  it("calculates dynamic net profit percent on selling price for custom price", () => {
    const margin = calculateBulkMarginPercent(14.54, 25.97);
    expect(margin).toBe(26.8);
  });
});
