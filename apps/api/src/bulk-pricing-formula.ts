import { z } from "zod";

export const pricingFormulaComponentKinds = [
  "EBAY_FEE_PERCENT",
  "PROMOTED_LISTING_PERCENT",
  "PAYONEER_FEE_PERCENT",
  "EXPORT_FEE_PERCENT",
  "BUFFER_PERCENT",
  "MISC_FIXED",
  "PROFIT_MARGIN_PERCENT",
  "MARKUP_PERCENT",
  "CUSTOM_PERCENT",
  "CUSTOM_FIXED",
] as const;

export const pricingFormulaOperators = ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"] as const;
export const pricingFormulaCalculationTypes = ["FIXED_COST", "PERCENTAGE_DEDUCTION", "TARGET_MARGIN", "MARKUP"] as const;
export const pricingFormulaCalculationBases = [
  "SELLING_PRICE",
  "ITEM_PRICE",
  "ORDER_TOTAL",
  "SELLER_REVENUE_BEFORE_TAX",
  "EBAY_ORDER_TOTAL_INCLUDING_TAX",
  "EBAY_PAYOUT",
  "PREVIOUS_TOTAL",
  "BASE_COST",
  "CUSTOM",
] as const;

export type PricingFormulaComponentKind = typeof pricingFormulaComponentKinds[number];
export type PricingFormulaOperator = typeof pricingFormulaOperators[number];
export type PricingFormulaCalculationType = typeof pricingFormulaCalculationTypes[number];
export type PricingFormulaCalculationBase = typeof pricingFormulaCalculationBases[number];

export type PricingFormulaComponent = {
  id: string;
  kind: PricingFormulaComponentKind;
  operator: PricingFormulaOperator;
  value: number;
  label: string;
  enabled: boolean;
  calculationType: PricingFormulaCalculationType;
  calculationBase: PricingFormulaCalculationBase | null;
};

export type BulkPricingFormula = {
  version: 2;
  base: "COST_PRICE";
  components: PricingFormulaComponent[];
};

export type PricingFormulaContext = {
  buyerShippingCharge?: number;
  actualShippingCost?: number;
  salesTax?: number;
  customBaseAmount?: number;
};

export type PricingFormulaBreakdown = PricingFormulaComponent & {
  role: "FIXED_COST" | "PERCENTAGE_FEE" | "TARGET_PROFIT" | "MARKUP_PROFIT";
  baseAmount: number | null;
  amount: number;
};

const labels: Record<PricingFormulaComponentKind, string> = {
  EBAY_FEE_PERCENT: "eBay fee",
  PROMOTED_LISTING_PERCENT: "Promoted Listings General",
  PAYONEER_FEE_PERCENT: "Payoneer fee",
  EXPORT_FEE_PERCENT: "Export fee",
  BUFFER_PERCENT: "Buffer",
  MISC_FIXED: "Other miscellaneous charges",
  PROFIT_MARGIN_PERCENT: "Profit margin",
  MARKUP_PERCENT: "Markup",
  CUSTOM_PERCENT: "Custom percentage",
  CUSTOM_FIXED: "Custom fixed charge",
};

const percentageKinds = new Set<PricingFormulaComponentKind>([
  "EBAY_FEE_PERCENT", "PROMOTED_LISTING_PERCENT", "PAYONEER_FEE_PERCENT",
  "EXPORT_FEE_PERCENT", "BUFFER_PERCENT", "PROFIT_MARGIN_PERCENT",
  "MARKUP_PERCENT", "CUSTOM_PERCENT",
]);

const predefinedDeductionKinds = new Set<PricingFormulaComponentKind>([
  "EBAY_FEE_PERCENT", "PROMOTED_LISTING_PERCENT", "PAYONEER_FEE_PERCENT",
  "EXPORT_FEE_PERCENT", "BUFFER_PERCENT",
]);

const calculationBaseSchema = z.enum(pricingFormulaCalculationBases);
const componentSchema = z.object({
  id: z.string().trim().min(1).max(64),
  kind: z.enum(pricingFormulaComponentKinds),
  operator: z.enum(pricingFormulaOperators),
  value: z.number().finite().min(0).max(1_000_000),
  label: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().default(true),
  calculationType: z.enum(pricingFormulaCalculationTypes).optional(),
  calculationBase: calculationBaseSchema.nullable().optional(),
}).strict();

const formulaSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  base: z.literal("COST_PRICE"),
  components: z.array(componentSchema).min(1).max(20),
}).strict();

type AffineAmount = { sellingPriceCoefficient: number; constant: number };
type CalculationPlan = {
  formula: BulkPricingFormula;
  costPrice: number;
  context: Required<Omit<PricingFormulaContext, "customBaseAmount">> & { customBaseAmount: number | null };
  totalFixedCosts: number;
  markupTarget: number;
  targetMarginRate: number;
  feeExpressions: Array<{ component: PricingFormulaComponent; baseExpression: AffineAmount; expression: AffineAmount }>;
  fixedBreakdown: PricingFormulaBreakdown[];
  markupBreakdown: PricingFormulaBreakdown[];
};

function rounded(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function defaultSemantics(kind: PricingFormulaComponentKind, legacy: boolean) {
  if (kind === "PROFIT_MARGIN_PERCENT") return { calculationType: "TARGET_MARGIN" as const, calculationBase: "SELLING_PRICE" as const };
  if (kind === "MARKUP_PERCENT") return { calculationType: "MARKUP" as const, calculationBase: "BASE_COST" as const };
  if (kind === "MISC_FIXED" || kind === "CUSTOM_FIXED") return { calculationType: "FIXED_COST" as const, calculationBase: "PREVIOUS_TOTAL" as const };
  if (kind === "CUSTOM_PERCENT" && legacy) return { calculationType: "PERCENTAGE_DEDUCTION" as const, calculationBase: "PREVIOUS_TOTAL" as const };
  return { calculationType: "PERCENTAGE_DEDUCTION" as const, calculationBase: "SELLING_PRICE" as const };
}

export function isPercentageComponent(kind: PricingFormulaComponentKind) {
  return percentageKinds.has(kind);
}

export function createDefaultBulkPricingFormula(input: { profitMarginPercent?: number; bufferPercent?: number } = {}): BulkPricingFormula {
  const component = (
    id: string,
    kind: PricingFormulaComponentKind,
    value: number,
  ): PricingFormulaComponent => ({
    id,
    kind,
    operator: "ADD",
    value,
    label: labels[kind],
    enabled: true,
    ...defaultSemantics(kind, false),
  });
  return {
    version: 2,
    base: "COST_PRICE",
    components: [
      component("ebay-fee", "EBAY_FEE_PERCENT", 11.35),
      component("payoneer-fee", "PAYONEER_FEE_PERCENT", 2),
      component("export-fee", "EXPORT_FEE_PERCENT", 1.3),
      component("buffer", "BUFFER_PERCENT", input.bufferPercent ?? 1),
      component("misc", "MISC_FIXED", 0.4),
      component("profit", "PROFIT_MARGIN_PERCENT", input.profitMarginPercent ?? 20),
    ],
  };
}

export function normalizeBulkPricingFormula(value: unknown): BulkPricingFormula {
  const parsed = formulaSchema.parse(value);
  const ids = new Set<string>();
  const legacy = parsed.version === 1;
  return {
    version: 2,
    base: "COST_PRICE",
    components: parsed.components.map((component) => {
      if (ids.has(component.id)) throw new Error(`Duplicate pricing formula component id: ${component.id}`);
      ids.add(component.id);
      const defaults = defaultSemantics(component.kind, legacy);
      const preserveLegacySequentialOperation = legacy
        && isPercentageComponent(component.kind)
        && component.kind !== "PROFIT_MARGIN_PERCENT"
        && component.kind !== "MARKUP_PERCENT"
        && (component.operator === "MULTIPLY" || component.operator === "DIVIDE");
      const normalized: PricingFormulaComponent = {
        ...component,
        label: component.label || labels[component.kind],
        enabled: component.enabled,
        calculationType: component.calculationType ?? defaults.calculationType,
        calculationBase: component.calculationBase ?? (preserveLegacySequentialOperation ? "PREVIOUS_TOTAL" : defaults.calculationBase),
      };
      if (normalized.operator === "DIVIDE" && normalized.value === 0) throw new Error("A pricing formula cannot divide by zero");
      if (normalized.calculationType === "TARGET_MARGIN" && normalized.kind !== "PROFIT_MARGIN_PERCENT") {
        throw new Error(`${normalized.label} is not a target-margin component`);
      }
      if (normalized.calculationType === "MARKUP" && normalized.kind !== "MARKUP_PERCENT") {
        throw new Error(`${normalized.label} is not a markup component`);
      }
      if (normalized.calculationType === "FIXED_COST" && isPercentageComponent(normalized.kind)) {
        throw new Error(`${normalized.label} cannot be configured as a fixed cost`);
      }
      if (normalized.calculationType === "PERCENTAGE_DEDUCTION" && !isPercentageComponent(normalized.kind)) {
        throw new Error(`${normalized.label} must be configured as a fixed cost`);
      }
      return normalized;
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

function normalizeContext(costPrice: number, input: PricingFormulaContext = {}) {
  if (!Number.isFinite(costPrice) || costPrice < 0) throw new Error("Cost price must be a non-negative number");
  const values = {
    buyerShippingCharge: input.buyerShippingCharge ?? 0,
    actualShippingCost: input.actualShippingCost ?? 0,
    salesTax: input.salesTax ?? 0,
    customBaseAmount: input.customBaseAmount ?? null,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error(`${name} must be a non-negative number`);
  }
  return { ...values, buyerShippingCharge: rounded(values.buyerShippingCharge), actualShippingCost: rounded(values.actualShippingCost), salesTax: rounded(values.salesTax), customBaseAmount: values.customBaseAmount === null ? null : rounded(values.customBaseAmount) };
}

function applyOperation(current: number, operator: PricingFormulaOperator, operand: number) {
  if (operator === "ADD") return current + operand;
  if (operator === "SUBTRACT") return current - operand;
  if (operator === "MULTIPLY") return current * operand;
  if (operand === 0) throw new Error("A pricing formula cannot divide by zero");
  return current / operand;
}

function externalBaseExpression(
  base: PricingFormulaCalculationBase,
  costPrice: number,
  context: ReturnType<typeof normalizeContext>,
  ebayPayout: AffineAmount | null,
): AffineAmount {
  if (base === "SELLING_PRICE" || base === "ITEM_PRICE") return { sellingPriceCoefficient: 1, constant: 0 };
  if (base === "ORDER_TOTAL" || base === "SELLER_REVENUE_BEFORE_TAX") return { sellingPriceCoefficient: 1, constant: context.buyerShippingCharge };
  if (base === "EBAY_ORDER_TOTAL_INCLUDING_TAX") return { sellingPriceCoefficient: 1, constant: context.buyerShippingCharge + context.salesTax };
  if (base === "BASE_COST") return { sellingPriceCoefficient: 0, constant: costPrice };
  if (base === "CUSTOM") {
    if (context.customBaseAmount === null) throw new Error("A custom calculation base amount is required");
    return { sellingPriceCoefficient: 0, constant: context.customBaseAmount };
  }
  if (base === "EBAY_PAYOUT") {
    if (!ebayPayout) throw new Error("eBay payout is not available for this component");
    return ebayPayout;
  }
  throw new Error("PREVIOUS_TOTAL must be evaluated as an ordered component");
}

function feeExpression(component: PricingFormulaComponent, base: AffineAmount): AffineAmount {
  if (component.operator !== "ADD" && component.operator !== "SUBTRACT") {
    throw new Error(`${component.label} must use Add or Subtract unless its calculation base is Previous total`);
  }
  const sign = component.operator === "ADD" ? 1 : -1;
  const rate = component.value / 100 * sign;
  return { sellingPriceCoefficient: base.sellingPriceCoefficient * rate, constant: base.constant * rate };
}

function buildCalculationPlan(costPriceInput: number, formulaInput: unknown, contextInput: PricingFormulaContext = {}): CalculationPlan {
  const formula = normalizeBulkPricingFormula(formulaInput);
  const costPrice = rounded(costPriceInput);
  const context = normalizeContext(costPriceInput, contextInput);
  let previousTotal = rounded(costPrice + context.actualShippingCost);
  let markupTarget = 0;
  let targetMarginRate = 0;
  const fixedBreakdown: PricingFormulaBreakdown[] = [];
  const markupBreakdown: PricingFormulaBreakdown[] = [];
  const externalFees: PricingFormulaComponent[] = [];

  for (const component of formula.components) {
    if (!component.enabled) continue;
    if (component.calculationType === "FIXED_COST") {
      const before = previousTotal;
      previousTotal = rounded(applyOperation(before, component.operator, component.value));
      if (previousTotal < 0) throw new Error(`${component.label} makes total fixed costs negative`);
      fixedBreakdown.push({ ...component, role: "FIXED_COST", baseAmount: before, amount: rounded(previousTotal - before) });
      continue;
    }
    if (component.calculationType === "TARGET_MARGIN") {
      if (component.operator !== "ADD" || component.calculationBase !== "SELLING_PRICE") throw new Error("Profit margin must use Add and Selling price as its base");
      if (component.value >= 100) throw new Error("Profit margin must be less than 100%");
      targetMarginRate += component.value / 100;
      continue;
    }
    if (component.calculationType === "MARKUP") {
      if (component.operator !== "ADD") throw new Error("Markup must use the Add operation");
      let baseAmount: number;
      if (component.calculationBase === "BASE_COST") baseAmount = costPrice;
      else if (component.calculationBase === "PREVIOUS_TOTAL") baseAmount = previousTotal;
      else if (component.calculationBase === "CUSTOM" && context.customBaseAmount !== null) baseAmount = context.customBaseAmount;
      else throw new Error("Markup base must be Base cost, Previous total, or Custom");
      const amount = rounded(baseAmount * component.value / 100);
      markupTarget = rounded(markupTarget + amount);
      markupBreakdown.push({ ...component, role: "MARKUP_PROFIT", baseAmount, amount });
      continue;
    }
    if (component.calculationBase === "PREVIOUS_TOTAL") {
      const before = previousTotal;
      const operand = component.operator === "MULTIPLY" || component.operator === "DIVIDE"
        ? component.value / 100
        : rounded(before * component.value / 100);
      previousTotal = rounded(applyOperation(before, component.operator, operand));
      if (previousTotal < 0) throw new Error(`${component.label} makes total fixed costs negative`);
      fixedBreakdown.push({ ...component, role: "FIXED_COST", baseAmount: before, amount: rounded(previousTotal - before) });
      continue;
    }
    externalFees.push(component);
  }

  const nonPayoutFees = externalFees.filter((component) => component.calculationBase !== "EBAY_PAYOUT");
  const feeExpressions: Array<{ component: PricingFormulaComponent; baseExpression: AffineAmount; expression: AffineAmount }> = nonPayoutFees.map((component) => {
    const baseExpression = externalBaseExpression(component.calculationBase!, costPrice, context, null);
    return { component, baseExpression, expression: feeExpression(component, baseExpression) };
  });
  const ebaySpecific = feeExpressions.filter(({ component }) => component.kind === "EBAY_FEE_PERCENT" || component.kind === "PROMOTED_LISTING_PERCENT");
  const ebayPayout = ebaySpecific.reduce<AffineAmount>((payout, fee) => ({
    sellingPriceCoefficient: payout.sellingPriceCoefficient - fee.expression.sellingPriceCoefficient,
    constant: payout.constant - fee.expression.constant,
  }), { sellingPriceCoefficient: 1, constant: context.buyerShippingCharge });
  for (const component of externalFees.filter((item) => item.calculationBase === "EBAY_PAYOUT")) {
    if (component.kind === "EBAY_FEE_PERCENT" || component.kind === "PROMOTED_LISTING_PERCENT") throw new Error(`${component.label} cannot use eBay payout as its own base`);
    feeExpressions.push({ component, baseExpression: ebayPayout, expression: feeExpression(component, ebayPayout) });
  }

  return { formula, costPrice, context, totalFixedCosts: previousTotal, markupTarget, targetMarginRate, feeExpressions, fixedBreakdown, markupBreakdown };
}

function amountFromExpression(expression: AffineAmount, sellingPrice: number) {
  return rounded(expression.sellingPriceCoefficient * sellingPrice + expression.constant);
}

export function calculateFeeBreakdown(sellingPriceInput: number, costPrice: number, formulaInput: unknown, contextInput: PricingFormulaContext = {}) {
  const plan = buildCalculationPlan(costPrice, formulaInput, contextInput);
  if (!Number.isFinite(sellingPriceInput) || sellingPriceInput < 0) throw new Error("Selling price must be a non-negative number");
  const sellingPrice = rounded(sellingPriceInput);
  const percentageBreakdown: PricingFormulaBreakdown[] = plan.feeExpressions.map(({ component, baseExpression, expression }) => ({
    ...component,
    role: "PERCENTAGE_FEE",
    baseAmount: amountFromExpression(baseExpression, sellingPrice),
    amount: amountFromExpression(expression, sellingPrice),
  }));
  const targetBreakdown: PricingFormulaBreakdown[] = plan.formula.components
    .filter((component) => component.enabled && component.calculationType === "TARGET_MARGIN")
    .map((component) => ({ ...component, role: "TARGET_PROFIT", baseAmount: sellingPrice, amount: rounded(sellingPrice * component.value / 100) }));
  return [...plan.fixedBreakdown, ...percentageBreakdown, ...plan.markupBreakdown, ...targetBreakdown]
    .sort((left, right) => plan.formula.components.findIndex((item) => item.id === left.id) - plan.formula.components.findIndex((item) => item.id === right.id));
}

export function calculateNetProfit(sellingPriceInput: number, costPrice: number, formulaInput: unknown, contextInput: PricingFormulaContext = {}) {
  const plan = buildCalculationPlan(costPrice, formulaInput, contextInput);
  const sellingPrice = rounded(sellingPriceInput);
  const totalFees = rounded(plan.feeExpressions.reduce((sum, fee) => sum + amountFromExpression(fee.expression, sellingPrice), 0));
  const orderRevenue = rounded(sellingPrice + plan.context.buyerShippingCharge);
  return rounded(orderRevenue - plan.totalFixedCosts - totalFees);
}

export function calculateNetMargin(sellingPrice: number, costPrice: number, formulaInput: unknown, contextInput: PricingFormulaContext = {}) {
  if (sellingPrice <= 0) return null;
  return rounded(calculateNetProfit(sellingPrice, costPrice, formulaInput, contextInput) / sellingPrice * 100);
}

export function calculateSellingPrice(costPrice: number, formulaInput: unknown, contextInput: PricingFormulaContext = {}) {
  const plan = buildCalculationPlan(costPrice, formulaInput, contextInput);
  const totalFeeCoefficient = plan.feeExpressions.reduce((sum, fee) => sum + fee.expression.sellingPriceCoefficient, 0);
  const totalFeeConstant = plan.feeExpressions.reduce((sum, fee) => sum + fee.expression.constant, 0);
  const consumedRate = totalFeeCoefficient + plan.targetMarginRate;
  if (consumedRate >= 1) {
    throw new Error(`Selected fees and target margin consume ${rounded(consumedRate * 100)}% of the selling price. Reduce fees or target margin.`);
  }
  const denominator = 1 - consumedRate;
  const numerator = plan.totalFixedCosts + plan.markupTarget + totalFeeConstant - plan.context.buyerShippingCharge;
  const sellingPrice = rounded(Math.max(0, numerator / denominator));
  if (!Number.isFinite(sellingPrice) || sellingPrice > 100_000_000) throw new Error("Pricing formula result is outside the supported range");
  const breakdown = calculateFeeBreakdown(sellingPrice, costPrice, plan.formula, contextInput);
  const totalPercentageFees = rounded(breakdown.filter((item) => item.role === "PERCENTAGE_FEE").reduce((sum, item) => sum + item.amount, 0));
  const netProfit = calculateNetProfit(sellingPrice, costPrice, plan.formula, contextInput);
  const netMargin = sellingPrice > 0 ? rounded(netProfit / sellingPrice * 100) : null;
  const targetProfit = rounded(sellingPrice * plan.targetMarginRate + plan.markupTarget);
  return {
    formula: plan.formula,
    costPrice: plan.costPrice,
    sellingPrice,
    formulaFloorPrice: sellingPrice,
    itemPrice: sellingPrice,
    buyerShippingCharge: plan.context.buyerShippingCharge,
    orderRevenue: rounded(sellingPrice + plan.context.buyerShippingCharge),
    actualShippingCost: plan.context.actualShippingCost,
    salesTax: plan.context.salesTax,
    totalFixedCosts: plan.totalFixedCosts,
    totalPercentageFees,
    totalPercentageDeductionRate: rounded(totalFeeCoefficient * 100),
    targetProfit,
    markupTarget: plan.markupTarget,
    netProfit,
    netMargin,
    actualProfitPercent: netMargin,
    expenseImpact: rounded(plan.totalFixedCosts - plan.costPrice + totalPercentageFees),
    breakdown,
  };
}

export function evaluateBulkPricingFormula(costPrice: number, formulaInput: unknown, contextInput: PricingFormulaContext = {}) {
  return calculateSellingPrice(costPrice, formulaInput, contextInput);
}

export function calculateFormulaMarginForSellingPrice(costPrice: number, sellingPrice: number, formulaInput: unknown, contextInput: PricingFormulaContext = {}) {
  return calculateNetMargin(sellingPrice, costPrice, formulaInput, contextInput);
}

export function formulaDefinition(kind: PricingFormulaComponentKind) {
  return { label: labels[kind], isPercentage: isPercentageComponent(kind), ...defaultSemantics(kind, false) };
}

export function isPredefinedDeduction(kind: PricingFormulaComponentKind) {
  return predefinedDeductionKinds.has(kind);
}
