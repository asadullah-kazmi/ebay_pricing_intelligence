export type PricingFormulaComponentKind =
  | "EBAY_FEE_PERCENT" | "PROMOTED_LISTING_PERCENT" | "PAYONEER_FEE_PERCENT"
  | "EXPORT_FEE_PERCENT" | "BUFFER_PERCENT" | "MISC_FIXED"
  | "PROFIT_MARGIN_PERCENT" | "MARKUP_PERCENT" | "CUSTOM_PERCENT" | "CUSTOM_FIXED";
export type PricingFormulaOperator = "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE";
export type PricingFormulaCalculationType = "FIXED_COST" | "PERCENTAGE_DEDUCTION" | "TARGET_MARGIN" | "MARKUP";
export type PricingFormulaCalculationBase =
  | "SELLING_PRICE" | "ITEM_PRICE" | "ORDER_TOTAL" | "SELLER_REVENUE_BEFORE_TAX"
  | "EBAY_ORDER_TOTAL_INCLUDING_TAX" | "EBAY_PAYOUT" | "PREVIOUS_TOTAL" | "BASE_COST" | "CUSTOM";
export type PricingFormulaComponent = {
  id: string;
  kind: PricingFormulaComponentKind;
  operator: PricingFormulaOperator;
  value: number;
  label: string;
  enabled: boolean;
  calculationType?: PricingFormulaCalculationType;
  calculationBase?: PricingFormulaCalculationBase | null;
};
export type BulkPricingFormula = { version: 1 | 2; base: "COST_PRICE"; components: PricingFormulaComponent[] };
export type FormulaBreakdown = PricingFormulaComponent & {
  calculationType: PricingFormulaCalculationType;
  calculationBase: PricingFormulaCalculationBase | null;
  role: "FIXED_COST" | "PERCENTAGE_FEE" | "TARGET_PROFIT" | "MARKUP_PROFIT";
  baseAmount: number | null;
  amount: number;
};
export type FormulaContext = { buyerShippingCharge?: number; actualShippingCost?: number; salesTax?: number; customBaseAmount?: number };

export const formulaComponentDefinitions: Array<{
  kind: PricingFormulaComponentKind;
  label: string;
  unit: "%" | "fixed";
  defaultValue: number;
  calculationType: PricingFormulaCalculationType;
  calculationBase: PricingFormulaCalculationBase;
}> = [
  { kind: "EBAY_FEE_PERCENT", label: "eBay fee", unit: "%", defaultValue: 11.35, calculationType: "PERCENTAGE_DEDUCTION", calculationBase: "SELLING_PRICE" },
  { kind: "PROMOTED_LISTING_PERCENT", label: "Promoted Listings General", unit: "%", defaultValue: 15, calculationType: "PERCENTAGE_DEDUCTION", calculationBase: "SELLING_PRICE" },
  { kind: "PAYONEER_FEE_PERCENT", label: "Payoneer fee", unit: "%", defaultValue: 2, calculationType: "PERCENTAGE_DEDUCTION", calculationBase: "SELLING_PRICE" },
  { kind: "EXPORT_FEE_PERCENT", label: "Export fee", unit: "%", defaultValue: 1.3, calculationType: "PERCENTAGE_DEDUCTION", calculationBase: "SELLING_PRICE" },
  { kind: "BUFFER_PERCENT", label: "Buffer", unit: "%", defaultValue: 1, calculationType: "PERCENTAGE_DEDUCTION", calculationBase: "SELLING_PRICE" },
  { kind: "MISC_FIXED", label: "Other miscellaneous charges", unit: "fixed", defaultValue: 0.4, calculationType: "FIXED_COST", calculationBase: "PREVIOUS_TOTAL" },
  { kind: "PROFIT_MARGIN_PERCENT", label: "Profit margin", unit: "%", defaultValue: 20, calculationType: "TARGET_MARGIN", calculationBase: "SELLING_PRICE" },
  { kind: "MARKUP_PERCENT", label: "Markup", unit: "%", defaultValue: 25, calculationType: "MARKUP", calculationBase: "BASE_COST" },
  { kind: "CUSTOM_PERCENT", label: "Custom percentage", unit: "%", defaultValue: 0, calculationType: "PERCENTAGE_DEDUCTION", calculationBase: "SELLING_PRICE" },
  { kind: "CUSTOM_FIXED", label: "Custom fixed charge", unit: "fixed", defaultValue: 0, calculationType: "FIXED_COST", calculationBase: "PREVIOUS_TOTAL" },
];

export const formulaCalculationBaseDefinitions: Array<{ value: PricingFormulaCalculationBase; label: string }> = [
  { value: "SELLING_PRICE", label: "Selling price" },
  { value: "ITEM_PRICE", label: "Item price" },
  { value: "ORDER_TOTAL", label: "Item + buyer shipping" },
  { value: "SELLER_REVENUE_BEFORE_TAX", label: "Seller revenue before tax" },
  { value: "EBAY_ORDER_TOTAL_INCLUDING_TAX", label: "eBay total incl. tax" },
  { value: "EBAY_PAYOUT", label: "eBay payout" },
  { value: "PREVIOUS_TOTAL", label: "Previous total" },
  { value: "BASE_COST", label: "Base cost" },
  { value: "CUSTOM", label: "Custom base" },
];

const percentKinds = new Set<PricingFormulaComponentKind>(formulaComponentDefinitions.filter((item) => item.unit === "%").map((item) => item.kind));
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function definition(kind: PricingFormulaComponentKind) {
  return formulaComponentDefinitions.find((item) => item.kind === kind)!;
}

export function normalizePricingFormula(formula: BulkPricingFormula): BulkPricingFormula {
  const legacy = formula.version === 1;
  return {
    version: 2,
    base: "COST_PRICE",
    components: formula.components.map((component) => {
      const defaults = definition(component.kind);
      const preserveLegacySequential = legacy && component.kind !== "PROFIT_MARGIN_PERCENT" && component.kind !== "MARKUP_PERCENT"
        && (component.kind === "CUSTOM_PERCENT" || component.operator === "MULTIPLY" || component.operator === "DIVIDE");
      const legacyCustomBase = preserveLegacySequential ? "PREVIOUS_TOTAL" : defaults.calculationBase;
      return {
        ...component,
        label: component.label || defaults.label,
        calculationType: component.calculationType ?? defaults.calculationType,
        calculationBase: component.calculationBase ?? legacyCustomBase,
      };
    }),
  };
}

export function createDefaultPricingFormula(): BulkPricingFormula {
  const defaultKinds: PricingFormulaComponentKind[] = [
    "EBAY_FEE_PERCENT", "PAYONEER_FEE_PERCENT", "EXPORT_FEE_PERCENT",
    "BUFFER_PERCENT", "MISC_FIXED", "PROFIT_MARGIN_PERCENT",
  ];
  return {
    version: 2,
    base: "COST_PRICE",
    components: defaultKinds.map((kind) => {
      const item = definition(kind);
      return {
        id: kind.toLowerCase(), kind, operator: "ADD", value: item.defaultValue,
        label: item.label, enabled: true, calculationType: item.calculationType, calculationBase: item.calculationBase,
      };
    }),
  };
}

function operation(current: number, operator: PricingFormulaOperator, operand: number) {
  if (operator === "ADD") return current + operand;
  if (operator === "SUBTRACT") return current - operand;
  if (operator === "MULTIPLY") return current * operand;
  if (operand === 0) throw new Error("A pricing formula cannot divide by zero");
  return current / operand;
}

type Affine = { coefficient: number; constant: number };

function evaluateInternal(costInput: number, formulaInput: BulkPricingFormula, contextInput: FormulaContext = {}) {
  if (!Number.isFinite(costInput) || costInput < 0) throw new Error("Cost price must be a non-negative number");
  const formula = normalizePricingFormula(formulaInput);
  const costPrice = round(costInput);
  const context = {
    buyerShippingCharge: round(contextInput.buyerShippingCharge ?? 0),
    actualShippingCost: round(contextInput.actualShippingCost ?? 0),
    salesTax: round(contextInput.salesTax ?? 0),
    customBaseAmount: contextInput.customBaseAmount == null ? null : round(contextInput.customBaseAmount),
  };
  let previousTotal = round(costPrice + context.actualShippingCost);
  let markupTarget = 0;
  let marginRate = 0;
  const fixed: FormulaBreakdown[] = [];
  const markup: FormulaBreakdown[] = [];
  const external: PricingFormulaComponent[] = [];

  for (const raw of formula.components) {
    if (!raw.enabled) continue;
    const component = raw as PricingFormulaComponent & { calculationType: PricingFormulaCalculationType; calculationBase: PricingFormulaCalculationBase };
    if (component.value < 0 || !Number.isFinite(component.value)) throw new Error(`${component.label} must be a non-negative number`);
    if (component.calculationType === "FIXED_COST") {
      const before = previousTotal;
      previousTotal = round(operation(before, component.operator, component.value));
      if (previousTotal < 0) throw new Error(`${component.label} makes total fixed costs negative`);
      fixed.push({ ...component, role: "FIXED_COST", baseAmount: before, amount: round(previousTotal - before) });
    } else if (component.calculationType === "TARGET_MARGIN") {
      if (component.operator !== "ADD" || component.calculationBase !== "SELLING_PRICE") throw new Error("Profit margin must use Add and Selling price");
      if (component.value >= 100) throw new Error("Profit margin must be less than 100%");
      marginRate += component.value / 100;
    } else if (component.calculationType === "MARKUP") {
      if (component.operator !== "ADD") throw new Error("Markup must use Add");
      const base = component.calculationBase === "BASE_COST" ? costPrice
        : component.calculationBase === "PREVIOUS_TOTAL" ? previousTotal
          : component.calculationBase === "CUSTOM" && context.customBaseAmount !== null ? context.customBaseAmount
            : Number.NaN;
      if (!Number.isFinite(base)) throw new Error("Markup base must be Base cost, Previous total, or Custom");
      const amount = round(base * component.value / 100);
      markupTarget = round(markupTarget + amount);
      markup.push({ ...component, role: "MARKUP_PROFIT", baseAmount: base, amount });
    } else if (component.calculationBase === "PREVIOUS_TOTAL") {
      const before = previousTotal;
      const operand = component.operator === "MULTIPLY" || component.operator === "DIVIDE" ? component.value / 100 : round(before * component.value / 100);
      previousTotal = round(operation(before, component.operator, operand));
      if (previousTotal < 0) throw new Error(`${component.label} makes total fixed costs negative`);
      fixed.push({ ...component, role: "FIXED_COST", baseAmount: before, amount: round(previousTotal - before) });
    } else {
      external.push(component);
    }
  }

  const baseExpression = (base: PricingFormulaCalculationBase, payout: Affine | null): Affine => {
    if (base === "SELLING_PRICE" || base === "ITEM_PRICE") return { coefficient: 1, constant: 0 };
    if (base === "ORDER_TOTAL" || base === "SELLER_REVENUE_BEFORE_TAX") return { coefficient: 1, constant: context.buyerShippingCharge };
    if (base === "EBAY_ORDER_TOTAL_INCLUDING_TAX") return { coefficient: 1, constant: context.buyerShippingCharge + context.salesTax };
    if (base === "BASE_COST") return { coefficient: 0, constant: costPrice };
    if (base === "CUSTOM" && context.customBaseAmount !== null) return { coefficient: 0, constant: context.customBaseAmount };
    if (base === "EBAY_PAYOUT" && payout) return payout;
    throw new Error(base === "CUSTOM" ? "A custom base amount is required" : "Invalid calculation base");
  };
  const expression = (component: PricingFormulaComponent, base: Affine): Affine => {
    if (component.operator !== "ADD" && component.operator !== "SUBTRACT") throw new Error(`${component.label} must use Add or Subtract unless based on Previous total`);
    const rate = component.value / 100 * (component.operator === "ADD" ? 1 : -1);
    return { coefficient: base.coefficient * rate, constant: base.constant * rate };
  };
  const nonPayout = external.filter((item) => item.calculationBase !== "EBAY_PAYOUT").map((component) => {
    const base = baseExpression(component.calculationBase!, null);
    return { component, base, expression: expression(component, base) };
  });
  const payout = nonPayout.filter(({ component }) => component.kind === "EBAY_FEE_PERCENT" || component.kind === "PROMOTED_LISTING_PERCENT").reduce<Affine>((current, fee) => ({ coefficient: current.coefficient - fee.expression.coefficient, constant: current.constant - fee.expression.constant }), { coefficient: 1, constant: context.buyerShippingCharge });
  const fees = [...nonPayout];
  for (const component of external.filter((item) => item.calculationBase === "EBAY_PAYOUT")) {
    if (component.kind === "EBAY_FEE_PERCENT" || component.kind === "PROMOTED_LISTING_PERCENT") throw new Error(`${component.label} cannot use eBay payout as its own base`);
    fees.push({ component, base: payout, expression: expression(component, payout) });
  }
  const feeCoefficient = fees.reduce((sum, fee) => sum + fee.expression.coefficient, 0);
  const feeConstant = fees.reduce((sum, fee) => sum + fee.expression.constant, 0);
  const consumed = feeCoefficient + marginRate;
  if (consumed >= 1) throw new Error(`Selected fees and target margin consume ${round(consumed * 100)}% of the selling price. Reduce fees or target margin.`);
  const sellingPrice = round(Math.max(0, (previousTotal + markupTarget + feeConstant - context.buyerShippingCharge) / (1 - consumed)));
  const feeBreakdown: FormulaBreakdown[] = fees.map(({ component, base, expression: fee }) => {
    const amount = round(fee.coefficient * sellingPrice + fee.constant);
    return { ...component, calculationType: component.calculationType!, calculationBase: component.calculationBase ?? null, role: "PERCENTAGE_FEE", baseAmount: round(base.coefficient * sellingPrice + base.constant), amount };
  });
  const targets: FormulaBreakdown[] = formula.components.filter((item) => item.enabled && item.calculationType === "TARGET_MARGIN").map((component) => ({ ...component, calculationType: "TARGET_MARGIN", calculationBase: "SELLING_PRICE", role: "TARGET_PROFIT", baseAmount: sellingPrice, amount: round(sellingPrice * component.value / 100) }));
  const breakdown = [...fixed, ...feeBreakdown, ...markup, ...targets].sort((a, b) => formula.components.findIndex((item) => item.id === a.id) - formula.components.findIndex((item) => item.id === b.id));
  const totalFees = round(feeBreakdown.reduce((sum, item) => sum + item.amount, 0));
  const netProfit = round(sellingPrice + context.buyerShippingCharge - previousTotal - totalFees);
  const netMargin = sellingPrice > 0 ? round(netProfit / sellingPrice * 100) : null;
  return { formula, costPrice, sellingPrice, formulaFloorPrice: sellingPrice, totalFixedCosts: previousTotal, totalPercentageFees: totalFees, targetProfit: round(sellingPrice * marginRate + markupTarget), netProfit, netMargin, actualProfitPercent: netMargin, expenseImpact: round(previousTotal - costPrice + totalFees), breakdown, context };
}

export function evaluatePricingFormula(costPrice: number, formula: BulkPricingFormula, context: FormulaContext = {}) {
  try {
    return { ...evaluateInternal(costPrice, formula, context), error: null as string | null };
  } catch (error) {
    return {
      formula: normalizePricingFormula(formula), costPrice: Math.max(0, Number(costPrice) || 0), sellingPrice: 0,
      formulaFloorPrice: 0, totalFixedCosts: Math.max(0, Number(costPrice) || 0), totalPercentageFees: 0,
      targetProfit: 0, netProfit: 0, netMargin: null, actualProfitPercent: null, expenseImpact: 0,
      breakdown: [] as FormulaBreakdown[], context: { buyerShippingCharge: 0, actualShippingCost: 0, salesTax: 0, customBaseAmount: null },
      error: error instanceof Error ? error.message : "Invalid pricing formula",
    };
  }
}

export function calculateFormulaProfitAtPrice(costPrice: number, sellingPrice: number, formula: BulkPricingFormula, context: FormulaContext = {}) {
  const solved = evaluateInternal(costPrice, formula, context);
  const feeComponents = solved.breakdown.filter((item) => item.role === "PERCENTAGE_FEE");
  const baseAtPrice = (item: FormulaBreakdown, ebayPayout: number | null) => {
    if (item.calculationBase === "SELLING_PRICE" || item.calculationBase === "ITEM_PRICE") return sellingPrice;
    if (item.calculationBase === "ORDER_TOTAL" || item.calculationBase === "SELLER_REVENUE_BEFORE_TAX") return sellingPrice + solved.context.buyerShippingCharge;
    if (item.calculationBase === "EBAY_ORDER_TOTAL_INCLUDING_TAX") return sellingPrice + solved.context.buyerShippingCharge + solved.context.salesTax;
    if (item.calculationBase === "BASE_COST") return solved.costPrice;
    if (item.calculationBase === "CUSTOM") return solved.context.customBaseAmount ?? 0;
    if (item.calculationBase === "EBAY_PAYOUT" && ebayPayout !== null) return ebayPayout;
    return item.baseAmount ?? 0;
  };
  const feeAmount = (item: FormulaBreakdown, ebayPayout: number | null) => round(baseAtPrice(item, ebayPayout) * item.value / 100 * (item.operator === "SUBTRACT" ? -1 : 1));
  const nonPayout = feeComponents.filter((item) => item.calculationBase !== "EBAY_PAYOUT");
  const ebaySpecificFees = nonPayout.filter((item) => item.kind === "EBAY_FEE_PERCENT" || item.kind === "PROMOTED_LISTING_PERCENT").reduce((sum, item) => sum + feeAmount(item, null), 0);
  const ebayPayout = round(sellingPrice + solved.context.buyerShippingCharge - ebaySpecificFees);
  const totalFees = round(nonPayout.reduce((sum, item) => sum + feeAmount(item, null), 0) + feeComponents.filter((item) => item.calculationBase === "EBAY_PAYOUT").reduce((sum, item) => sum + feeAmount(item, ebayPayout), 0));
  const netProfit = round(sellingPrice + solved.context.buyerShippingCharge - solved.totalFixedCosts - totalFees);
  return { netProfit, netMargin: sellingPrice > 0 ? round(netProfit / sellingPrice * 100) : null, totalFees, totalFixedCosts: solved.totalFixedCosts };
}

export function componentUnit(kind: PricingFormulaComponentKind) {
  return percentKinds.has(kind) ? "%" : "fixed";
}
