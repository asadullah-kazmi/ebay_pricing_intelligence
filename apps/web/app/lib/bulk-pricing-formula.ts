export type PricingFormulaComponentKind =
  | "EBAY_FEE_PERCENT" | "PAYONEER_FEE_PERCENT" | "EXPORT_FEE_PERCENT"
  | "BUFFER_PERCENT" | "MISC_FIXED" | "PROFIT_MARGIN_PERCENT"
  | "CUSTOM_PERCENT" | "CUSTOM_FIXED";
export type PricingFormulaOperator = "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE";
export type PricingFormulaComponent = { id: string; kind: PricingFormulaComponentKind; operator: PricingFormulaOperator; value: number; label: string; enabled: boolean };
export type BulkPricingFormula = { version: 1; base: "COST_PRICE"; components: PricingFormulaComponent[] };
export type FormulaBreakdown = PricingFormulaComponent & { subtotalBefore: number; operandAmount: number; subtotalAfter: number; changeAmount: number };

export const formulaComponentDefinitions: Array<{ kind: PricingFormulaComponentKind; label: string; unit: "%" | "fixed"; defaultValue: number }> = [
  { kind: "EBAY_FEE_PERCENT", label: "eBay fee", unit: "%", defaultValue: 11.35 },
  { kind: "PAYONEER_FEE_PERCENT", label: "Payoneer fee", unit: "%", defaultValue: 2 },
  { kind: "EXPORT_FEE_PERCENT", label: "Export fee", unit: "%", defaultValue: 1.3 },
  { kind: "BUFFER_PERCENT", label: "Buffer", unit: "%", defaultValue: 1 },
  { kind: "MISC_FIXED", label: "Other miscellaneous charges", unit: "fixed", defaultValue: 0.4 },
  { kind: "PROFIT_MARGIN_PERCENT", label: "Profit margin", unit: "%", defaultValue: 20 },
  { kind: "CUSTOM_PERCENT", label: "Custom percentage", unit: "%", defaultValue: 0 },
  { kind: "CUSTOM_FIXED", label: "Custom fixed charge", unit: "fixed", defaultValue: 0 },
];

const percentKinds = new Set<PricingFormulaComponentKind>(formulaComponentDefinitions.filter((item) => item.unit === "%").map((item) => item.kind));
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function createDefaultPricingFormula(): BulkPricingFormula {
  return {
    version: 1,
    base: "COST_PRICE",
    components: formulaComponentDefinitions.slice(0, 6).map((definition) => ({
      id: definition.kind.toLowerCase(), kind: definition.kind, operator: "ADD", value: definition.defaultValue, label: definition.label, enabled: true,
    })),
  };
}

export function evaluatePricingFormula(costPrice: number, formula: BulkPricingFormula) {
  const cost = round(Math.max(0, Number(costPrice) || 0));
  let subtotal = cost;
  let expenseImpact = 0;
  const breakdown: FormulaBreakdown[] = [];
  for (const component of formula.components) {
    if (!component.enabled) continue;
    const before = subtotal;
    const isPercent = percentKinds.has(component.kind);
    const additiveOperand = isPercent ? round(before * component.value / 100) : round(component.value);
    const factor = isPercent ? component.value / 100 : component.value;
    if (component.operator === "ADD") subtotal = before + additiveOperand;
    else if (component.operator === "SUBTRACT") subtotal = before - additiveOperand;
    else if (component.operator === "MULTIPLY") subtotal = before * factor;
    else subtotal = factor === 0 ? Number.NaN : before / factor;
    subtotal = round(subtotal);
    const changeAmount = round(subtotal - before);
    if (component.kind !== "PROFIT_MARGIN_PERCENT") expenseImpact = round(expenseImpact + changeAmount);
    breakdown.push({ ...component, subtotalBefore: before, operandAmount: component.operator === "ADD" || component.operator === "SUBTRACT" ? additiveOperand : factor, subtotalAfter: subtotal, changeAmount });
  }
  const sellingPrice = Number.isFinite(subtotal) ? Math.ceil(Math.max(0, subtotal) * 100 - Number.EPSILON) / 100 : 0;
  const netProfit = round(sellingPrice - cost - expenseImpact);
  const actualProfitPercent = sellingPrice > 0 ? round(netProfit / sellingPrice * 100) : null;
  return { costPrice: cost, sellingPrice, expenseImpact, netProfit, actualProfitPercent, breakdown };
}

export function componentUnit(kind: PricingFormulaComponentKind) {
  return percentKinds.has(kind) ? "%" : "fixed";
}
