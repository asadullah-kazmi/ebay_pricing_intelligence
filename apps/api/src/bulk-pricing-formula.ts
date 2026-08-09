import { z } from "zod";

export const pricingFormulaComponentKinds = [
  "EBAY_FEE_PERCENT",
  "PAYONEER_FEE_PERCENT",
  "EXPORT_FEE_PERCENT",
  "BUFFER_PERCENT",
  "MISC_FIXED",
  "PROFIT_MARGIN_PERCENT",
  "CUSTOM_PERCENT",
  "CUSTOM_FIXED",
] as const;

export const pricingFormulaOperators = ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"] as const;

export type PricingFormulaComponentKind = typeof pricingFormulaComponentKinds[number];
export type PricingFormulaOperator = typeof pricingFormulaOperators[number];

export type PricingFormulaComponent = {
  id: string;
  kind: PricingFormulaComponentKind;
  operator: PricingFormulaOperator;
  value: number;
  label: string;
  enabled: boolean;
};

export type BulkPricingFormula = {
  version: 1;
  base: "COST_PRICE";
  components: PricingFormulaComponent[];
};

export type PricingFormulaBreakdown = PricingFormulaComponent & {
  subtotalBefore: number;
  operandAmount: number;
  subtotalAfter: number;
  changeAmount: number;
};

const labels: Record<PricingFormulaComponentKind, string> = {
  EBAY_FEE_PERCENT: "eBay fee",
  PAYONEER_FEE_PERCENT: "Payoneer fee",
  EXPORT_FEE_PERCENT: "Export fee",
  BUFFER_PERCENT: "Buffer",
  MISC_FIXED: "Other miscellaneous charges",
  PROFIT_MARGIN_PERCENT: "Profit margin",
  CUSTOM_PERCENT: "Custom percentage",
  CUSTOM_FIXED: "Custom fixed charge",
};

const percentKinds = new Set<PricingFormulaComponentKind>([
  "EBAY_FEE_PERCENT", "PAYONEER_FEE_PERCENT", "EXPORT_FEE_PERCENT",
  "BUFFER_PERCENT", "PROFIT_MARGIN_PERCENT", "CUSTOM_PERCENT",
]);

const componentSchema = z.object({
  id: z.string().trim().min(1).max(64),
  kind: z.enum(pricingFormulaComponentKinds),
  operator: z.enum(pricingFormulaOperators),
  value: z.number().finite().min(0).max(1_000_000),
  label: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().default(true),
}).strict();

const formulaSchema = z.object({
  version: z.literal(1),
  base: z.literal("COST_PRICE"),
  components: z.array(componentSchema).min(1).max(20),
}).strict();

function rounded(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundedUp(value: number) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

export function isPercentageComponent(kind: PricingFormulaComponentKind) {
  return percentKinds.has(kind);
}

export function createDefaultBulkPricingFormula(input: { profitMarginPercent?: number; bufferPercent?: number } = {}): BulkPricingFormula {
  return {
    version: 1,
    base: "COST_PRICE",
    components: [
      { id: "ebay-fee", kind: "EBAY_FEE_PERCENT", operator: "ADD", value: 11.35, label: labels.EBAY_FEE_PERCENT, enabled: true },
      { id: "payoneer-fee", kind: "PAYONEER_FEE_PERCENT", operator: "ADD", value: 2, label: labels.PAYONEER_FEE_PERCENT, enabled: true },
      { id: "export-fee", kind: "EXPORT_FEE_PERCENT", operator: "ADD", value: 1.3, label: labels.EXPORT_FEE_PERCENT, enabled: true },
      { id: "buffer", kind: "BUFFER_PERCENT", operator: "ADD", value: input.bufferPercent ?? 1, label: labels.BUFFER_PERCENT, enabled: true },
      { id: "misc", kind: "MISC_FIXED", operator: "ADD", value: 0.4, label: labels.MISC_FIXED, enabled: true },
      { id: "profit", kind: "PROFIT_MARGIN_PERCENT", operator: "ADD", value: input.profitMarginPercent ?? 20, label: labels.PROFIT_MARGIN_PERCENT, enabled: true },
    ],
  };
}

export function normalizeBulkPricingFormula(value: unknown): BulkPricingFormula {
  const parsed = formulaSchema.parse(value);
  const ids = new Set<string>();
  return {
    version: 1,
    base: "COST_PRICE",
    components: parsed.components.map((component) => {
      if (ids.has(component.id)) throw new Error(`Duplicate pricing formula component id: ${component.id}`);
      ids.add(component.id);
      if (component.operator === "DIVIDE" && component.value === 0) throw new Error("A pricing formula cannot divide by zero");
      return {
        ...component,
        label: component.label || labels[component.kind],
        enabled: component.enabled,
      };
    }),
  };
}

export function parseBulkPricingFormulaJson(value: string | undefined, fallback?: { profitMarginPercent?: number; bufferPercent?: number }) {
  if (!value) return createDefaultBulkPricingFormula(fallback);
  try {
    return normalizeBulkPricingFormula(JSON.parse(value));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid pricing formula";
    throw new Error(`Invalid pricing formula: ${message}`);
  }
}

export function evaluateBulkPricingFormula(costPrice: number, formulaInput: unknown) {
  const formula = normalizeBulkPricingFormula(formulaInput);
  const safeCost = rounded(Math.max(0, costPrice));
  let subtotal = safeCost;
  let expenseImpact = 0;
  const breakdown: PricingFormulaBreakdown[] = [];

  for (const component of formula.components) {
    if (!component.enabled) continue;
    const before = subtotal;
    const percentage = isPercentageComponent(component.kind);
    const additiveOperand = percentage ? rounded(before * component.value / 100) : rounded(component.value);
    const factor = percentage ? component.value / 100 : component.value;
    if (component.operator === "ADD") subtotal = before + additiveOperand;
    else if (component.operator === "SUBTRACT") subtotal = before - additiveOperand;
    else if (component.operator === "MULTIPLY") subtotal = before * factor;
    else {
      if (factor === 0) throw new Error("A pricing formula cannot divide by zero");
      subtotal = before / factor;
    }
    if (!Number.isFinite(subtotal) || Math.abs(subtotal) > 100_000_000) throw new Error("Pricing formula result is outside the supported range");
    subtotal = rounded(subtotal);
    const changeAmount = rounded(subtotal - before);
    if (component.kind !== "PROFIT_MARGIN_PERCENT") expenseImpact = rounded(expenseImpact + changeAmount);
    breakdown.push({ ...component, subtotalBefore: before, operandAmount: component.operator === "ADD" || component.operator === "SUBTRACT" ? additiveOperand : factor, subtotalAfter: subtotal, changeAmount });
  }

  const sellingPrice = roundedUp(Math.max(0, subtotal));
  const netProfit = rounded(sellingPrice - safeCost - expenseImpact);
  const actualProfitPercent = sellingPrice > 0 ? rounded(netProfit / sellingPrice * 100) : null;
  return { formula, costPrice: safeCost, sellingPrice, formulaFloorPrice: sellingPrice, expenseImpact, netProfit, actualProfitPercent, breakdown };
}

export function calculateFormulaMarginForSellingPrice(costPrice: number, sellingPrice: number, formulaInput: unknown) {
  const evaluated = evaluateBulkPricingFormula(costPrice, formulaInput);
  const sale = rounded(Math.max(0, sellingPrice));
  if (sale <= 0) return null;
  return rounded((sale - evaluated.costPrice - evaluated.expenseImpact) / sale * 100);
}
