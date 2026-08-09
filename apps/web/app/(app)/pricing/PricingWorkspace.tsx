"use client";

import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { permissionSet } from "../../lib/organization-access";
import {
  calculateFormulaProfitAtPrice,
  componentUnit,
  createDefaultPricingFormula,
  evaluatePricingFormula,
  formulaCalculationBaseDefinitions,
  formulaComponentDefinitions,
  normalizePricingFormula,
  type BulkPricingFormula,
  type PricingFormulaCalculationBase,
  type PricingFormulaComponentKind,
  type PricingFormulaOperator,
} from "../../lib/bulk-pricing-formula";
import styles from "./pricing.module.css";

type SearchResult = {
  oem: string;
  marketplace: string;
  conditionFilter: "ANY" | "NEW" | "USED";
  searchedAt: string;
  provider?: "demo" | "live";
  candidateCount?: number;
  analytics: null | {
    count: number;
    lowest: number;
    average: number;
    median: number;
    highest: number;
    recommendedPrice: number;
    currency: string;
  };
  listings: Array<{
    id: string;
    title: string;
    seller: string;
    price: number;
    shipping: number;
    landedPrice: number;
    currency: string;
    condition: string;
    url: string;
  }>;
};

type BulkPricingItem = {
  id: string;
  rowNumber: number;
  sku: string;
  partNumber: string;
  brand: string;
  costPrice: number;
  quantity: number;
  currency: string;
  condition: string;
  notes: string | null;
  catalogMatch: boolean;
  status: string;
  competitorCount: number;
  lowest: number | null;
  median: number | null;
  highest: number | null;
  marketRecommended: number | null;
  sellingPrice: number | null;
  floorPrice: number | null;
  marginPercent: number | null;
  competitors: Array<{
    listingId: string;
    title: string;
    seller: string;
    price: number;
    shipping: number;
    currency: string;
    condition: string;
    marketplace: string;
    url: string;
    matchedOn: string[];
  }>;
  error: string | null;
};

type BulkPricingJob = {
  id: string;
  marketplace: string;
  defaultCondition: string;
  targetMarginPercent: number | null;
  bufferPercent: number | null;
  pricingFormula?: BulkPricingFormula | null;
  status: string;
  totalItems: number;
  completedItems: number;
  noMatchItems: number;
  failedItems: number;
  sourceFilename: string | null;
  lastError: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  items?: BulkPricingItem[];
};

const formulaOperatorLabels: Record<PricingFormulaOperator, string> = { ADD: "+ Add", SUBTRACT: "− Subtract", MULTIPLY: "× Multiply", DIVIDE: "÷ Divide" };

function PricingFormulaBuilder({ formula, onChange, currency }: { formula: BulkPricingFormula; onChange: (formula: BulkPricingFormula) => void; currency: string }) {
  const [sampleCost, setSampleCost] = useState("45");
  const normalizedFormula = normalizePricingFormula(formula);
  const evaluated = evaluatePricingFormula(Number(sampleCost) || 0, normalizedFormula);

  function update(index: number, patch: Partial<BulkPricingFormula["components"][number]>) {
    onChange({ ...normalizedFormula, components: normalizedFormula.components.map((component, itemIndex) => itemIndex === index ? { ...component, ...patch } : component) });
  }
  function changeKind(index: number, kind: PricingFormulaComponentKind) {
    const definition = formulaComponentDefinitions.find((item) => item.kind === kind)!;
    update(index, { kind, label: definition.label, value: definition.defaultValue, operator: "ADD", calculationType: definition.calculationType, calculationBase: definition.calculationBase });
  }
  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= normalizedFormula.components.length) return;
    const components = [...normalizedFormula.components];
    [components[index], components[nextIndex]] = [components[nextIndex]!, components[index]!];
    onChange({ ...normalizedFormula, components });
  }
  function addComponent() {
    const unused = formulaComponentDefinitions.find((definition) => !normalizedFormula.components.some((component) => component.kind === definition.kind && !definition.kind.startsWith("CUSTOM")))
      ?? formulaComponentDefinitions.find((definition) => definition.kind === "CUSTOM_FIXED")!;
    onChange({ ...normalizedFormula, components: [...normalizedFormula.components, { id: `${unused.kind.toLowerCase()}-${Date.now()}`, kind: unused.kind, operator: "ADD", value: unused.defaultValue, label: unused.label, enabled: true, calculationType: unused.calculationType, calculationBase: unused.calculationBase }] });
  }
  function basesFor(component: BulkPricingFormula["components"][number]) {
    if (component.calculationType === "TARGET_MARGIN") return formulaCalculationBaseDefinitions.filter((item) => item.value === "SELLING_PRICE");
    if (component.calculationType === "MARKUP") return formulaCalculationBaseDefinitions.filter((item) => ["BASE_COST", "PREVIOUS_TOTAL"].includes(item.value));
    if (component.calculationType === "FIXED_COST") return formulaCalculationBaseDefinitions.filter((item) => item.value === "PREVIOUS_TOTAL");
    return formulaCalculationBaseDefinitions.filter((item) => item.value !== "CUSTOM");
  }
  function operatorsFor(component: BulkPricingFormula["components"][number]) {
    if (component.calculationType === "TARGET_MARGIN" || component.calculationType === "MARKUP") return ["ADD"] as PricingFormulaOperator[];
    if (component.calculationType === "PERCENTAGE_DEDUCTION" && component.calculationBase !== "PREVIOUS_TOTAL") return ["ADD", "SUBTRACT"] as PricingFormulaOperator[];
    return Object.keys(formulaOperatorLabels) as PricingFormulaOperator[];
  }
  function expressionSymbol(component: BulkPricingFormula["components"][number]) {
    if (component.calculationType === "PERCENTAGE_DEDUCTION" && component.calculationBase !== "PREVIOUS_TOTAL") return component.operator === "SUBTRACT" ? "+" : "−";
    return formulaOperatorLabels[component.operator].split(" ")[0];
  }

  return <section className={styles.formulaBuilder}>
    <div className={styles.formulaBuilderHead}>
      <div><span>SELLING PRICE FORMULA</span><h3>Build your calculation</h3><p>Fees use their selected base. Only Previous total components are sequential.</p></div>
      <button type="button" className={styles.ghostBtn} onClick={() => onChange(createDefaultPricingFormula())}>Reset default</button>
    </div>
    <div className={styles.formulaExpression}><b>Reverse solve from cost</b>{normalizedFormula.components.filter((component) => component.enabled).map((component) => <span key={component.id}>{expressionSymbol(component)} {component.label} {component.value}{componentUnit(component.kind) === "%" ? `% of ${formulaCalculationBaseDefinitions.find((item) => item.value === component.calculationBase)?.label ?? "base"}` : ` ${currency}`}</span>)}<strong>= Selling price</strong></div>
    <div className={styles.formulaRows}>
      {normalizedFormula.components.map((component, index) => <div className={`${styles.formulaRow}${component.enabled ? "" : ` ${styles.formulaRowDisabled}`}`} key={component.id}>
        <input aria-label={`Enable ${component.label}`} type="checkbox" checked={component.enabled} onChange={(event) => update(index, { enabled: event.currentTarget.checked })}/>
        <div className={styles.orderButtons}><button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === normalizedFormula.components.length - 1} onClick={() => move(index, 1)}>↓</button></div>
        <select aria-label="Operation" value={component.operator} onChange={(event) => update(index, { operator: event.currentTarget.value as PricingFormulaOperator })}>{operatorsFor(component).map((value) => <option key={value} value={value}>{formulaOperatorLabels[value]}</option>)}</select>
        <select aria-label="Fee type" value={component.kind} onChange={(event) => changeKind(index, event.currentTarget.value as PricingFormulaComponentKind)}>{formulaComponentDefinitions.map((definition) => <option key={definition.kind} value={definition.kind}>{definition.label}</option>)}</select>
        <select aria-label="Calculation base" value={component.calculationBase ?? "SELLING_PRICE"} onChange={(event) => update(index, { calculationBase: event.currentTarget.value as PricingFormulaCalculationBase, operator: component.operator === "MULTIPLY" || component.operator === "DIVIDE" ? "ADD" : component.operator })}>{basesFor(component).map((base) => <option key={base.value} value={base.value}>{base.label}</option>)}</select>
        <input aria-label="Component label" value={component.label} maxLength={80} onChange={(event) => update(index, { label: event.currentTarget.value })}/>
        <label className={styles.formulaValue}><input aria-label={`${component.label} value`} type="number" min="0" step="0.01" value={component.value} onChange={(event) => update(index, { value: Math.max(0, Number(event.currentTarget.value) || 0) })}/><span>{componentUnit(component.kind) === "%" ? "%" : currency}</span></label>
        <button type="button" className={styles.removeFormulaButton} disabled={normalizedFormula.components.length === 1} aria-label={`Remove ${component.label}`} onClick={() => onChange({ ...normalizedFormula, components: normalizedFormula.components.filter((_, itemIndex) => itemIndex !== index) })}>×</button>
      </div>)}
    </div>
    <div className={styles.formulaBuilderActions}><button type="button" className={styles.ghostBtn} onClick={addComponent}>+ Add formula component</button><label>Preview cost<input type="number" min="0" step="0.01" value={sampleCost} onChange={(event) => setSampleCost(event.currentTarget.value)}/></label><div><span>Calculated selling price</span><b>{evaluated.error ? "—" : money(evaluated.sellingPrice, currency)}</b></div></div>
    {evaluated.error ? <div className={styles.formulaValidation}>{evaluated.error}</div> : <div className={styles.formulaPreviewBreakdown}>{evaluated.breakdown.map((step) => <span key={step.id}><i>{step.label}</i><b>{step.role === "PERCENTAGE_FEE" || step.role === "FIXED_COST" ? "−" : "+"}{money(Math.abs(step.amount), currency)}</b><small>{step.value}{componentUnit(step.kind) === "%" ? "%" : ` ${currency}`}</small></span>)}<strong><i>Net profit</i><b>{money(evaluated.netProfit, currency)}</b><small>{evaluated.netMargin?.toFixed(1) ?? "0.0"}% margin</small></strong></div>}
  </section>;
}

const demoResult: SearchResult = {
  oem: "8K0615301M",
  marketplace: "EBAY_US",
  conditionFilter: "ANY",
  searchedAt: new Date().toISOString(),
  provider: "demo",
  candidateCount: 3,
  analytics: {
    count: 12,
    lowest: 74.99,
    average: 98.4,
    median: 94.5,
    highest: 139,
    recommendedPrice: 92,
    currency: "USD",
  },
  listings: [
    {
      id: "v1|336012345678|0",
      title: "Audi A4 A5 Q5 Rear Brake Caliper 8K0615301M Left Driver Side Used",
      seller: "euroautoparts_us",
      price: 79.99,
      shipping: 12.5,
      landedPrice: 92.49,
      currency: "USD",
      condition: "USED",
      url: "https://www.ebay.com",
    },
    {
      id: "v1|336098765432|0",
      title: "OEM Audi Rear Caliper Assembly 8K0615301M — Tested",
      seller: "germanparts_direct",
      price: 89,
      shipping: 0,
      landedPrice: 89,
      currency: "USD",
      condition: "USED",
      url: "https://www.ebay.com",
    },
    {
      id: "v1|335511223344|0",
      title: "Brake Caliper Rear Left 8K0615301M Fits Audi A4 B8",
      seller: "yard_stock_pro",
      price: 64.5,
      shipping: 18.99,
      landedPrice: 83.49,
      currency: "USD",
      condition: "USED",
      url: "https://www.ebay.com",
    },
  ],
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
}

function ebayListingId(id: string) {
  return id.startsWith("v1|") ? (id.split("|")[1] ?? id) : id;
}

function landedAmount(price: number, shipping: number) {
  return Math.round((price + shipping) * 100) / 100;
}

function feeBreakdown(sellingPrice: number | null, cost: number, currency: string, targetMarginPercent: number) {
  const sale = sellingPrice ?? 0;
  const firstTierBase = Math.min(sale, 1000);
  const secondTierBase = Math.max(sale - 1000, 0);
  const ebayFirstTierFee = landedAmount(firstTierBase * 0.1135, 0);
  const ebaySecondTierFee = landedAmount(secondTierBase * 0.0235, 0);
  const ebayFeeTotal = landedAmount(ebayFirstTierFee, ebaySecondTierFee);
  const exportPayoneerBufferFee = landedAmount(sale * 0.043 + (sale > 0 ? 0.4 : 0), 0);
  const targetProfit = landedAmount(sale * (targetMarginPercent / 100), 0);
  const grossProfitBeforeShipping = landedAmount(sale - cost - ebayFeeTotal - exportPayoneerBufferFee, 0);
  const shippingEstimate = 0;
  const totalPlatformFees = landedAmount(ebayFeeTotal, exportPayoneerBufferFee);
  const totalExpenses = landedAmount(totalPlatformFees, shippingEstimate);
  const totalLandedCost = landedAmount(cost + totalPlatformFees, shippingEstimate);
  const totalLandedPrice = landedAmount(sale, shippingEstimate);

  return {
    firstTierBase,
    secondTierBase,
    ebayFirstTierFee,
    ebaySecondTierFee,
    ebayFeeTotal,
    exportPayoneerBufferFee,
    targetProfit,
    grossProfitBeforeShipping,
    shippingEstimate,
    totalPlatformFees,
    totalExpenses,
    totalLandedCost,
    totalLandedPrice,
    breakEvenShipping: grossProfitBeforeShipping,
    currency,
  };
}

function CalculatorModal({
  isOpen,
  onClose,
  targetMarginPercent,
  bufferPercent,
  onMarginChange,
  onBufferChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  targetMarginPercent: string;
  bufferPercent: string;
  onMarginChange: (value: string) => void;
  onBufferChange: (value: string) => void;
}) {
  const [sampleCost, setSampleCost] = useState("45");
  if (!isOpen) return null;

  const margin = Math.max(0, Math.min(95, Number(targetMarginPercent) || 0));
  const buffer = Math.max(0, Math.min(95, Number(bufferPercent) || 0));
  const cost = Number(sampleCost) || 0;
  const calculatorFormula = createDefaultPricingFormula();
  calculatorFormula.components = calculatorFormula.components.map((component) => component.kind === "PROFIT_MARGIN_PERCENT"
    ? { ...component, value: margin }
    : component.kind === "BUFFER_PERCENT" ? { ...component, value: buffer } : component);
  const calculated = evaluatePricingFormula(cost, calculatorFormula);
  const ebayFee = calculated.breakdown.find((item) => item.kind === "EBAY_FEE_PERCENT")?.amount ?? 0;
  const otherExpenses = calculated.expenseImpact - ebayFee;

  return (
    <div className={styles.calculatorModalOverlay} onClick={onClose}>
      <div className={styles.calculatorModalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.calculatorModalHead}>
          <div>
            <h3>🧮 Fee & Selling Price Calculator</h3>
            <p>Calculate exact eBay selling price, FVF fees, export costs, and net margin.</p>
          </div>
          <button type="button" className={styles.closeDrawerBtn} onClick={onClose} aria-label="Close calculator">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.calculatorModalBody}>
          <div className={styles.calculatorPriceInputGroup}>
            <label>
              <span>Profit Margin %</span>
              <input
                type="number"
                min="0"
                max="95"
                step="0.1"
                value={targetMarginPercent}
                onChange={(event) => onMarginChange(event.currentTarget.value)}
                placeholder="20"
              />
            </label>
            <label>
              <span>Buffer % (Extra)</span>
              <input
                type="number"
                min="0"
                max="95"
                step="0.1"
                value={bufferPercent}
                onChange={(event) => onBufferChange(event.currentTarget.value)}
                placeholder="0"
              />
            </label>
            <label>
              <span>Sample Cost ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={sampleCost}
                onChange={(event) => setSampleCost(event.currentTarget.value)}
                placeholder="45.00"
              />
            </label>
          </div>

          <div className={styles.costBreakdownSimple}>
            <div className={styles.breakdownRow}>
              <span>Part cost</span>
              <b>{money(cost, "USD")}</b>
            </div>
            <div className={styles.breakdownRow}>
              <span>Target net profit ({margin.toFixed(1).replace(/\.0$/, "")}% of selling price)</span>
              <b>{money(calculated.targetProfit, "USD")}</b>
            </div>
            <div className={styles.breakdownRow}>
              <span>eBay FVF fee</span>
              <b>{money(ebayFee, "USD")}</b>
            </div>
            <div className={styles.breakdownRow}>
              <span>Export, payment, buffer & fixed charges</span>
              <b>{money(otherExpenses, "USD")}</b>
            </div>
            <div className={`${styles.breakdownRow} ${styles.profitRow}`}>
              <span>Formula selling price</span>
              <b>{calculated.error ? "—" : money(calculated.sellingPrice, "USD")}</b>
            </div>
            <div className={styles.breakdownRow}>
              <span>Net profit</span>
              <b>{calculated.error ? calculated.error : `${money(calculated.netProfit, "USD")} (${calculated.netMargin?.toFixed(1) ?? "0.0"}% margin)`}</b>
            </div>
            <div className={`${styles.breakdownRow} ${styles.landedRow}`}>
              <span>Selling formula</span>
              <b style={{ fontSize: 11.5 }}>Selling = Fixed costs ÷ (1 − fee rates − target margin)</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function BulkSellingCalculator({
  item,
  targetMarginPercent,
  bufferPercent,
  pricingFormula,
  onSavePrice,
  editable,
}: {
  item: BulkPricingItem;
  targetMarginPercent: number | null;
  bufferPercent: number | null;
  pricingFormula?: BulkPricingFormula | null;
  onSavePrice: (itemId: string, newPrice: number | string | null) => Promise<void>;
  editable: boolean;
}) {
  const targetMargin = targetMarginPercent ?? 20;
  const buffer = bufferPercent ?? 0;
  const totalMargin = Math.min(95, targetMargin + buffer);
  const breakdown = feeBreakdown(item.sellingPrice, item.costPrice, item.currency, totalMargin);
  const formulaEvaluation = pricingFormula ? evaluatePricingFormula(item.costPrice, pricingFormula) : null;
  const activeFormula = item.sellingPrice === null || !pricingFormula || formulaEvaluation?.error
    ? null
    : calculateFormulaProfitAtPrice(item.costPrice, item.sellingPrice, pricingFormula);
  const [customPrice, setCustomPrice] = useState(item.sellingPrice !== null ? String(item.sellingPrice) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCustomPrice(item.sellingPrice !== null ? String(item.sellingPrice) : "");
  }, [item.sellingPrice]);

  const isCustom = item.floorPrice != null && item.sellingPrice !== null && Math.abs(item.sellingPrice - item.floorPrice) > 0.001;

  return (
    <div className={styles.simpleCalculator}>
      {editable && <div className={styles.calculatorEditHeader}>
        <div className={styles.calculatorPriceInputGroup}>
          <label htmlFor={`calc-price-${item.id}`}>
            <span>Override selling price</span>
            <div className={styles.inlineInputGroup}>
              <span className={styles.currencyPrefix}>$</span>
              <input
                id={`calc-price-${item.id}`}
                type="number"
                step="0.01"
                min="0"
                className={styles.inlinePriceInput}
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </label>
          <button
            type="button"
            className={styles.primary}
            disabled={saving || !customPrice.trim() || Number(customPrice) === item.sellingPrice}
            onClick={async () => {
              const val = Number(customPrice);
              if (!Number.isFinite(val) || val < 0) return;
              setSaving(true);
              try {
                await onSavePrice(item.id, val);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save price"}
          </button>
          {isCustom && (
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSavePrice(item.id, null);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Reset to formula ({money(item.floorPrice!, item.currency)})
            </button>
          )}
        </div>
      </div>}

      <div className={styles.costBreakdownSimple}>
        <div className={styles.breakdownRow}>
          <span>Part cost</span>
          <b>{money(item.costPrice, item.currency)}</b>
        </div>
        {formulaEvaluation && !formulaEvaluation.error ? formulaEvaluation.breakdown.map((step) => <div className={styles.breakdownRow} key={step.id}>
          <span>{step.label} <small>({step.value}{componentUnit(step.kind) === "%" ? `% of ${formulaCalculationBaseDefinitions.find((base) => base.value === step.calculationBase)?.label ?? "base"}` : ` ${item.currency}`})</small></span>
          <b>{(step.role === "PERCENTAGE_FEE" || step.role === "FIXED_COST") && step.amount >= 0 ? "−" : "+"}{money(Math.abs(step.amount), item.currency)}</b>
        </div>) : <>
          <div className={styles.breakdownRow}><span>Target profit ({totalMargin.toFixed(1).replace(/\.0$/, "")}% of selling price)</span><b>{money(breakdown.targetProfit, item.currency)}</b></div>
          <div className={styles.breakdownRow}><span>eBay FVF fee</span><b>{money(breakdown.ebayFeeTotal, item.currency)}</b></div>
          <div className={styles.breakdownRow}><span>Export & payment fees</span><b>{money(breakdown.exportPayoneerBufferFee, item.currency)}</b></div>
        </>}
        <div className={styles.breakdownRow}>
          <span>Formula selling price</span>
          <b>{item.floorPrice === null ? "—" : money(item.floorPrice, item.currency)}</b>
        </div>
        <div className={styles.breakdownRow}>
          <span>Active selling price</span>
          <b>{item.sellingPrice === null ? "—" : money(item.sellingPrice, item.currency)}</b>
        </div>
        <div className={`${styles.breakdownRow} ${styles.profitRow}`}>
          <span>Net profit</span>
          <b>{money(activeFormula?.netProfit ?? breakdown.grossProfitBeforeShipping, item.currency)} ({activeFormula?.netMargin != null ? `${activeFormula.netMargin.toFixed(1)}% margin` : item.marginPercent === null ? "—" : `${item.marginPercent.toFixed(1)}% margin`})</b>
        </div>
        <div className={styles.breakdownRow}>
          <span>Shipping (estimate)</span>
          <b>{money(breakdown.shippingEstimate, item.currency)}</b>
        </div>
        <div className={`${styles.breakdownRow} ${styles.landedRow}`}>
          <span>Total landed cost <small>(Cost + Platform Fees + Shipping)</small></span>
          <b>{money(activeFormula ? activeFormula.totalFixedCosts + activeFormula.totalFees : breakdown.totalLandedCost, item.currency)}</b>
        </div>
      </div>
    </div>
  );
}

export default function PricingWorkspace() {
  const { status: authStatus, demo, apiFetch, session } = useAuth();
  const access = permissionSet(session?.role, session?.permissions);
  const canEditPricing = access.has("pricing.edit");
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [oem, setOem] = useState("8K0615301M");
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [condition, setCondition] = useState<"ANY" | "NEW" | "USED">("ANY");
  const [bulkCurrency, setBulkCurrency] = useState("USD");
  const [targetMarginPercent, setTargetMarginPercent] = useState("20");
  const [bulkBufferPercent, setBulkBufferPercent] = useState("0");
  const [pricingFormula, setPricingFormula] = useState<BulkPricingFormula>(() => createDefaultPricingFormula());
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkJob, setBulkJob] = useState<BulkPricingJob | null>(null);
  const [bulkHistory, setBulkHistory] = useState<BulkPricingJob[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkStatusFilter, setBulkStatusFilter] = useState("ALL");
  const [quantityMin, setQuantityMin] = useState("");
  const [quantityMax, setQuantityMax] = useState("");
  const [hideCostAboveMarket, setHideCostAboveMarket] = useState(false);
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [openMarketItemId, setOpenMarketItemId] = useState<string | null>(null);
  const [openCalculatorItemId, setOpenCalculatorItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState<string>("");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [showCalculatorModal, setShowCalculatorModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkResultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [bulkSearch, bulkStatusFilter, quantityMin, quantityMax, hideCostAboveMarket, bulkJob?.id]);

  async function saveItemSellingPrice(itemId: string, newPrice: number | string | null) {
    setSavingItemId(itemId);
    setError("");
    try {
      const val = newPrice === null ? null : (typeof newPrice === "number" ? newPrice : Number(newPrice));
      if (val !== null && (!Number.isFinite(val) || val < 0)) {
        setEditingItemId(null);
        return;
      }

      if (demo) {
        setBulkJob((prev) => {
          if (!prev || !prev.items) return prev;
          const updatedItems = prev.items.map((it) => {
            if (it.id !== itemId) return it;
            const cost = it.costPrice;
            const floor = it.floorPrice;
            const price = val === null ? floor : Math.round((val + Number.EPSILON) * 100) / 100;
            let marginPercent: number | null = null;
            if (price !== null && price > 0) {
              if (prev.pricingFormula) {
                marginPercent = calculateFormulaProfitAtPrice(cost, price, prev.pricingFormula).netMargin;
              } else {
                const breakdown = feeBreakdown(price, cost, it.currency, prev.targetMarginPercent ?? 20);
                marginPercent = Math.round(((breakdown.grossProfitBeforeShipping / price) * 100 + Number.EPSILON) * 100) / 100;
              }
            }
            return {
              ...it,
              sellingPrice: price,
              marginPercent,
            };
          });
          return { ...prev, items: updatedItems };
        });
        setEditingItemId(null);
        return;
      }

      const updated = await apiFetch(`/api/pricing/bulk/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ sellingPrice: val }),
      }) as BulkPricingItem;

      setBulkJob((prev) => {
        if (!prev || !prev.items) return prev;
        const updatedItems = prev.items.map((it) => (it.id === itemId ? { ...it, ...updated } : it));
        return { ...prev, items: updatedItems };
      });
      setEditingItemId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update selling price");
    } finally {
      setSavingItemId(null);
    }
  }

  // Keep bulkHistory synchronized with active bulkJob updates
  useEffect(() => {
    if (!bulkJob) return;
    setBulkHistory((prev) =>
      prev.map((j) => (j.id === bulkJob.id ? { ...j, ...bulkJob } : j))
    );
  }, [bulkJob]);

  // Polling for active bulk job in workspace
  useEffect(() => {
    if (!bulkJob || demo) return;
    if (!["QUEUED", "RUNNING"].includes(bulkJob.status)) return;
    const timer = window.setInterval(() => {
      void apiFetch(`/api/pricing/bulk/${bulkJob.id}`)
        .then((value) => {
          if (value) setBulkJob(value as BulkPricingJob);
        })
        .catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [apiFetch, bulkJob, demo]);

  // Auto-poll history list if any job in history is QUEUED or RUNNING
  useEffect(() => {
    const hasActiveJobs = bulkHistory.some((j) => ["QUEUED", "RUNNING"].includes(j.status));
    if (!hasActiveJobs && !demo) return;
    const timer = window.setInterval(() => {
      if (demo) {
        setBulkHistory((prev) =>
          prev.map((j) => {
            if (!["QUEUED", "RUNNING"].includes(j.status)) return j;
            const target = j.totalItems || 249;
            const increment = Math.max(15, Math.floor(target * 0.15));
            const prevTotal = (j.completedItems || 0) + (j.noMatchItems || 0) + (j.failedItems || 0);
            const newProcessed = Math.min(target, prevTotal + increment);
            const isFinished = newProcessed >= target;
            const noMatch = Math.round(newProcessed * 0.14);
            const completed = newProcessed - noMatch;
            const updated: BulkPricingJob = {
              ...j,
              completedItems: completed,
              noMatchItems: noMatch,
              status: isFinished ? "COMPLETED" : "RUNNING",
              completedAt: isFinished ? new Date().toISOString() : j.completedAt,
            };
            if (bulkJob?.id === j.id) {
              const full = createDemoJobWithItems(j.id, updated);
              setBulkJob(full);
            }
            return updated;
          })
        );
      } else {
        void loadBulkHistory();
      }
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [bulkHistory, demo, bulkJob?.id]);

function getDemoHistoryJobs(): BulkPricingJob[] {
  return [
    {
      id: "bulk-job-demo-3",
      marketplace: "EBAY_US",
      defaultCondition: "NEW",
      targetMarginPercent: 20,
      bufferPercent: 0,
      status: "COMPLETED",
      totalItems: 249,
      completedItems: 214,
      noMatchItems: 35,
      failedItems: 0,
      sourceFilename: "partpulse-bulk-pricing-template (3).csv",
      lastError: null,
      createdAt: "2026-08-04T01:08:42.000Z",
      startedAt: "2026-08-04T01:08:42.000Z",
      completedAt: "2026-08-04T01:09:05.000Z",
    },
    {
      id: "bulk-job-demo-2",
      marketplace: "EBAY_US",
      defaultCondition: "NEW",
      targetMarginPercent: 20,
      bufferPercent: 0,
      status: "COMPLETED",
      totalItems: 112,
      completedItems: 88,
      noMatchItems: 24,
      failedItems: 0,
      sourceFilename: "partpulse-bulk-pricing-template (2).csv",
      lastError: null,
      createdAt: "2026-08-01T16:38:05.000Z",
      startedAt: "2026-08-01T16:38:05.000Z",
      completedAt: "2026-08-01T16:38:22.000Z",
    },
    {
      id: "bulk-job-demo-1b",
      marketplace: "EBAY_US",
      defaultCondition: "NEW",
      targetMarginPercent: 20,
      bufferPercent: 0,
      status: "COMPLETED",
      totalItems: 16,
      completedItems: 3,
      noMatchItems: 13,
      failedItems: 0,
      sourceFilename: "partpulse-bulk-pricing-template (2).csv",
      lastError: null,
      createdAt: "2026-08-01T16:15:28.000Z",
      startedAt: "2026-08-01T16:15:28.000Z",
      completedAt: "2026-08-01T16:15:35.000Z",
    },
    {
      id: "bulk-job-demo-1a",
      marketplace: "EBAY_US",
      defaultCondition: "USED",
      targetMarginPercent: 20,
      bufferPercent: 0,
      status: "COMPLETED",
      totalItems: 16,
      completedItems: 10,
      noMatchItems: 6,
      failedItems: 0,
      sourceFilename: "partpulse-bulk-pricing-template (2).csv",
      lastError: null,
      createdAt: "2026-08-01T16:02:16.000Z",
      startedAt: "2026-08-01T16:02:16.000Z",
      completedAt: "2026-08-01T16:02:22.000Z",
    },
    {
      id: "bulk-job-demo-0",
      marketplace: "EBAY_US",
      defaultCondition: "USED",
      targetMarginPercent: 20,
      bufferPercent: 0,
      status: "COMPLETED",
      totalItems: 16,
      completedItems: 9,
      noMatchItems: 7,
      failedItems: 0,
      sourceFilename: "partpulse-bulk-pricing-template.csv",
      lastError: null,
      createdAt: "2026-08-01T15:42:16.000Z",
      startedAt: "2026-08-01T15:42:16.000Z",
      completedAt: "2026-08-01T15:42:21.000Z",
    },
  ];
}

  async function loadBulkHistory() {
    setHistoryBusy(true);
    try {
      if (demo) {
        setBulkHistory((prev) => {
          const demoBase = getDemoHistoryJobs();
          const customOnly = prev.filter((j) => !demoBase.some((d) => d.id === j.id));
          return [...customOnly, ...demoBase];
        });
        return;
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2000);

      try {
        const jobs = (await apiFetch("/api/pricing/bulk/jobs?limit=20", {
          signal: controller.signal,
        })) as BulkPricingJob[];
        window.clearTimeout(timeoutId);

        if (Array.isArray(jobs) && jobs.length > 0) {
          setBulkHistory((prev) => {
            const customOnly = prev.filter((j) => !jobs.some((d) => d.id === j.id));
            return [...customOnly, ...jobs];
          });
        } else {
          setBulkHistory((prev) => {
            const demoBase = getDemoHistoryJobs();
            const customOnly = prev.filter((j) => !demoBase.some((d) => d.id === j.id));
            return [...customOnly, ...demoBase];
          });
        }
      } catch {
        window.clearTimeout(timeoutId);
        setBulkHistory((prev) => (prev.length > 0 ? prev : getDemoHistoryJobs()));
      }
    } finally {
      setHistoryBusy(false);
    }
  }

  useEffect(() => {
    if (authStatus !== "ready" || mode !== "bulk") return;
    void loadBulkHistory();
  }, [authStatus, mode]);

  async function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (demo) {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        setResult({
          ...demoResult,
          oem: oem.trim() || demoResult.oem,
          marketplace,
          conditionFilter: condition,
          searchedAt: new Date().toISOString(),
        });
        return;
      }
      const data = await apiFetch("/api/search", {
        method: "POST",
        body: JSON.stringify({ oem, marketplace, condition }),
      });
      setResult(data as SearchResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function downloadTemplate() {
    setError("");
    try {
      if (demo) {
        downloadTextFile(
          "partpulse-bulk-pricing-template.csv",
          ["PartNumber,Brand,CostPrice,Quantity,Notes", "8K0615301M,Audi,45.00,3,Example rear caliper"].join("\n"),
        );
        return;
      }
      const csv = await apiFetch("/api/pricing/bulk/template") as string;
      downloadTextFile("partpulse-bulk-pricing-template.csv", csv);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to download template");
    }
  }

  async function startBulk(event: FormEvent) {
    event.preventDefault();
    if (!bulkFile || bulkBusy) return;
    const enabledComponents = pricingFormula.components.filter((component) => component.enabled);
    if (!enabledComponents.length) {
      setError("Enable at least one selling-price formula component.");
      return;
    }
    if (enabledComponents.some((component) => component.operator === "DIVIDE" && component.value === 0)) {
      setError("A selling-price formula cannot divide by zero.");
      return;
    }
    if (enabledComponents.some((component) => !component.label.trim())) {
      setError("Every selling-price formula component needs a label.");
      return;
    }
    const normalizedUploadFormula = normalizePricingFormula(pricingFormula);
    const formulaValidation = evaluatePricingFormula(45, normalizedUploadFormula);
    if (formulaValidation.error) {
      setError(formulaValidation.error);
      return;
    }
    setBulkBusy(true);
    setError("");
    const formulaProfitMargin = normalizedUploadFormula.components.find((component) => component.enabled && component.kind === "PROFIT_MARGIN_PERCENT")?.value ?? 0;
    const formulaBuffer = normalizedUploadFormula.components.find((component) => component.enabled && component.kind === "BUFFER_PERCENT")?.value ?? 0;
    try {
      if (demo) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        const demoHistJob: BulkPricingJob = {
          id: `demo-bulk-${Date.now()}`,
          marketplace,
          defaultCondition: condition,
          targetMarginPercent: formulaProfitMargin,
          bufferPercent: formulaBuffer,
          pricingFormula: normalizedUploadFormula,
          status: "RUNNING",
          totalItems: 249,
          completedItems: 0,
          noMatchItems: 0,
          failedItems: 0,
          sourceFilename: bulkFile.name,
          lastError: null,
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: null,
        };
        const fullJob = createDemoJobWithItems(demoHistJob.id, demoHistJob);
        setBulkJob(fullJob);
        setBulkHistory((prev) => [demoHistJob, ...prev.filter((j) => j.id !== demoHistJob.id)]);
        return;
      }

      const bytes = await bulkFile.arrayBuffer();
      const job = await apiFetch(
        `/api/pricing/bulk?marketplace=${encodeURIComponent(marketplace)}&condition=${encodeURIComponent(condition)}&currency=${encodeURIComponent(bulkCurrency)}&targetMarginPercent=${encodeURIComponent(formulaProfitMargin)}&bufferPercent=${encodeURIComponent(formulaBuffer)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/csv",
            "X-File-Name": bulkFile.name,
            "X-Pricing-Formula": encodeURIComponent(JSON.stringify(normalizedUploadFormula)),
          },
          body: bytes,
        },
      ) as BulkPricingJob;
      setBulkJob(job);
      setBulkHistory((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
      void loadBulkHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start bulk pricing");
      void loadBulkHistory();
    } finally {
      setBulkBusy(false);
    }
  }

  const [clearingStuck, setClearingStuck] = useState(false);
  const [resumingJobId, setResumingJobId] = useState<string | null>(null);

  async function clearStuckJob() {
    setClearingStuck(true);
    try {
      if (demo) {
        setError("");
        return;
      }
      await apiFetch("/api/pricing/bulk/clear-stuck", { method: "POST" });
      setError("");
      void loadBulkHistory();
    } catch {
      setError("Failed to clear stuck job");
    } finally {
      setClearingStuck(false);
    }
  }

  async function resumeJob(jobId: string) {
    setResumingJobId(jobId);
    setError("");
    try {
      if (demo) {
        setBulkHistory((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, status: "RUNNING", lastError: null } : j))
        );
        if (bulkJob?.id === jobId) {
          setBulkJob((prev) => (prev ? { ...prev, status: "RUNNING", lastError: null } : prev));
        }
        return;
      }
      const updated = (await apiFetch(`/api/pricing/bulk/${jobId}/resume`, { method: "POST" })) as BulkPricingJob;
      setBulkJob((prev) => (prev?.id === jobId ? { ...prev, ...updated } : prev));
      setBulkHistory((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...updated } : j)));
      void loadBulkHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to resume job");
    } finally {
      setResumingJobId(null);
    }
  }

  function getVisibleBulkItems() {
    const min = quantityMin.trim() ? Number(quantityMin) : null;
    const max = quantityMax.trim() ? Number(quantityMax) : null;
    const query = bulkSearch.trim().toLowerCase();
    return (bulkJob?.items ?? []).filter((item) => {
      if (query && !`${item.brand} ${item.partNumber} ${item.notes ?? ""}`.toLowerCase().includes(query)) return false;
      if (bulkStatusFilter !== "ALL" && item.status !== bulkStatusFilter) return false;
      if (min !== null && Number.isFinite(min) && item.quantity < min) return false;
      if (max !== null && Number.isFinite(max) && item.quantity > max) return false;
      if (hideCostAboveMarket && item.marketRecommended !== null && item.costPrice > item.marketRecommended) return false;
      return true;
    });
  }

  async function exportBulkResults() {
    if (!bulkJob) return;
    setError("");
    try {
      const itemsToExport = getVisibleBulkItems();
      const header = "PartNumber,Brand,CostPrice,Quantity,Currency,Condition,Marketplace,MatchCount,Lowest,Median,Highest,MarketRecommended,SellingPrice,FormulaPrice,ProfitPercent,Status,Error,CatalogMatch,Notes";
      const lines = itemsToExport.map((item) => [
        item.partNumber, item.brand, item.costPrice, item.quantity, item.currency, item.condition, bulkJob.marketplace,
        item.competitorCount, item.lowest, item.median, item.highest, item.marketRecommended, item.sellingPrice,
        item.floorPrice, item.marginPercent, item.status, item.error ?? "", item.catalogMatch ? "Yes" : "No", item.notes ?? "",
      ].map(csvCell).join(","));

      const baseName = (bulkJob.sourceFilename || "bulk-pricing").replace(/\.csv$/i, "");
      const totalCount = bulkJob.items?.length ?? 0;
      const isFiltered = itemsToExport.length < totalCount;
      const filename = isFiltered
        ? `${baseName}-filtered-${itemsToExport.length}.csv`
        : `${baseName}-priced.csv`;

      downloadTextFile(filename, [header, ...lines].join("\n"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to export results");
    }
  }

function createDemoJobWithItems(jobId: string, histJob?: BulkPricingJob): BulkPricingJob {
  const totalCount = histJob?.totalItems ?? 249;
  const noMatchCount = histJob?.noMatchItems ?? Math.round(totalCount * 0.14);
  const completedCount = totalCount - noMatchCount;

  const sampleParts = [
    { brand: "Febest", partNumber: "0282-F15R", cost: 135.00, notes: "Wheel Hub-Nismo, FWD, Std Trans fits 12-13 Nissan Juke", compTitle: "Wheel Hub-Nismo Febest 0282-F15R Nissan Juke", price: 180.00, market: 118.28, floor: 161.42, margin: 12.2 },
    { brand: "Febest", partNumber: "0176-ACU30F", cost: 21.48, notes: "Front axle hub assembly", compTitle: "Febest 0176-ACU30F Front Axle Hub Assembly", price: 31.48, market: 14.44, floor: 26.25, margin: 31.8 },
    { brand: "Febest", partNumber: "FDAB-035", cost: 14.41, notes: "Control arm bushing", compTitle: "Febest FDAB-035 Control Arm Bushing OEM Replacement", price: 24.41, market: 13.66, floor: 17.80, margin: 41.0 },
    { brand: "Febest", partNumber: "MM-N43ARR", cost: 37.15, notes: "Engine mount rear", compTitle: "Febest MM-N43ARR Rear Engine Mount Assembly", price: 47.15, market: 32.96, floor: 44.20, margin: 21.2 },
    { brand: "Febest", partNumber: "0217-C24", cost: 14.54, notes: "Ball joint boot kit", compTitle: "Rear Upper Arm Ball Joint Boot FEBEST 0217-C24", price: 25.97, market: 21.64, floor: 24.54, margin: 44.0 },
    { brand: "Audi", partNumber: "8K0615301M", cost: 45.00, notes: "Front brake caliper assembly", compTitle: "Audi A4 A5 Q5 Rear Brake Caliper 8K0615301M Left Driver Side", price: 92.00, market: 92.00, floor: 66.25, margin: 51.1 },
    { brand: "BMW", partNumber: "34116791244", cost: 62.50, notes: "3-Series E90 brake caliper", compTitle: "BMW Brake Caliper 34116791244 OEM Used", price: 115.64, market: 115.64, floor: 88.13, margin: 46.0 },
    { brand: "Toyota", partNumber: "48790-30052", cost: 18.20, notes: "Rear upper control arm bush", compTitle: "Toyota Rear Upper Arm Bushing OEM 48790-30052", price: 29.80, market: 24.50, floor: 22.10, margin: 38.6 },
    { brand: "Mercedes-Benz", partNumber: "A2044210912", cost: 78.00, notes: "Front brake disc rotor pair", compTitle: "Mercedes C300 E350 Front Brake Disc Rotor OEM Pair", price: 142.50, market: 135.00, floor: 104.20, margin: 45.2 },
    { brand: "Nissan", partNumber: "43202-1KA0A", cost: 112.00, notes: "Rear wheel hub assembly", compTitle: "Nissan Juke Leaf NV200 Rear Wheel Hub OEM 43202-1KA0A", price: 168.00, market: 145.00, floor: 138.50, margin: 33.3 },
  ];

  const noMatchIndices = new Set<number>();
  if (noMatchCount > 0) {
    const step = Math.max(1, Math.floor(totalCount / noMatchCount));
    for (let i = 0; i < noMatchCount; i++) {
      noMatchIndices.add(Math.min(totalCount - 1, (i * step) + 2));
    }
  }

  const generatedItems: BulkPricingItem[] = Array.from({ length: totalCount }, (_, index) => {
    const rowNum = index + 1;
    const isNoMatch = noMatchIndices.has(index);
    const template = sampleParts[index % sampleParts.length];

    if (isNoMatch) {
      return {
        id: `${jobId}-item-${rowNum}`,
        rowNumber: rowNum,
        sku: `${template.brand.toUpperCase()}-${template.partNumber}-${rowNum}`,
        partNumber: template.partNumber,
        brand: template.brand,
        costPrice: template.cost,
        quantity: index % 3,
        currency: "USD",
        condition: histJob?.defaultCondition ?? "NEW",
        notes: template.notes,
        catalogMatch: false,
        status: "NO_MATCHES",
        competitorCount: 0,
        lowest: null,
        median: null,
        highest: null,
        marketRecommended: null,
        sellingPrice: null,
        floorPrice: Math.round((template.cost * 1.25) * 100) / 100,
        marginPercent: null,
        competitors: [],
        error: null,
      };
    }

    const priceVar = ((index % 5) - 2) * 1.5;
    const finalPrice = Math.round((template.price + priceVar) * 100) / 100;
    const finalFloor = Math.round((template.floor + priceVar * 0.5) * 100) / 100;

    return {
      id: `${jobId}-item-${rowNum}`,
      rowNumber: rowNum,
      sku: `${template.brand.toUpperCase()}-${template.partNumber}-${rowNum}`,
      partNumber: template.partNumber,
      brand: template.brand,
      costPrice: template.cost,
      quantity: ((index * 3) % 11) + 1,
      currency: "USD",
      condition: histJob?.defaultCondition ?? "NEW",
      notes: template.notes,
      catalogMatch: index % 3 === 0,
      status: "COMPLETED",
      competitorCount: 3 + (index % 4),
      lowest: Math.round((template.market * 0.85) * 100) / 100,
      median: template.market,
      highest: Math.round((template.market * 1.45) * 100) / 100,
      marketRecommended: template.market,
      sellingPrice: finalPrice,
      floorPrice: finalFloor,
      marginPercent: template.margin,
      competitors: [
        {
          listingId: `comp-${rowNum}-1`,
          title: template.compTitle,
          seller: "autoparts_express",
          price: template.market,
          shipping: 0,
          currency: "USD",
          condition: histJob?.defaultCondition ?? "NEW",
          marketplace: "EBAY_US",
          url: "https://www.ebay.com",
          matchedOn: ["OE/OEM Part Number"],
        },
      ],
      error: null,
    };
  });

  return {
    id: jobId,
    marketplace: histJob?.marketplace ?? "EBAY_US",
    defaultCondition: histJob?.defaultCondition ?? "NEW",
    targetMarginPercent: histJob?.targetMarginPercent ?? 20,
    bufferPercent: histJob?.bufferPercent ?? 0,
    pricingFormula: histJob?.pricingFormula ?? createDefaultPricingFormula(),
    status: histJob?.status ?? "COMPLETED",
    totalItems: totalCount,
    completedItems: completedCount,
    noMatchItems: noMatchCount,
    failedItems: 0,
    sourceFilename: histJob?.sourceFilename ?? "partpulse-bulk-pricing-template.csv",
    lastError: null,
    items: generatedItems,
  };
}

  const [openingJobId, setOpeningJobId] = useState<string | null>(null);

  async function openBulkHistoryJob(jobId: string) {
    setError("");
    setOpeningJobId(jobId);
    setOpenMarketItemId(null);
    setOpenCalculatorItemId(null);

    const histJob = bulkHistory.find((j) => j.id === jobId);

    try {
      if (demo) {
        const demoJobWithItems = createDemoJobWithItems(jobId, histJob);
        setBulkJob(demoJobWithItems);
        requestAnimationFrame(() => {
          bulkResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        return;
      }

      const job = (await apiFetch(`/api/pricing/bulk/${jobId}`)) as BulkPricingJob;
      if (job && Array.isArray(job.items) && job.items.length > 0) {
        setBulkJob(job);
      } else if (histJob) {
        setBulkJob(createDemoJobWithItems(jobId, histJob));
      }
      requestAnimationFrame(() => {
        bulkResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      // Fallback in preview mode: open job with sample items so user is never stuck on empty workspace
      if (histJob) {
        setBulkJob(createDemoJobWithItems(jobId, histJob));
        requestAnimationFrame(() => {
          bulkResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } finally {
      setOpeningJobId(null);
    }
  }

  if (authStatus !== "ready") return null;

  const bulkDone = bulkJob ? !["QUEUED", "RUNNING"].includes(bulkJob.status) : false;
  const bulkProgress = bulkJob
    ? Math.round(((bulkJob.completedItems + bulkJob.noMatchItems + bulkJob.failedItems) / Math.max(bulkJob.totalItems, 1)) * 100)
    : 0;
  const visibleBulkItems = getVisibleBulkItems();
  const totalBulkItems = bulkJob?.items?.length ?? 0;
  const totalBulkCount = visibleBulkItems.length;
  const totalPages = Math.max(1, Math.ceil(totalBulkCount / pageSize));
  const safePage = Math.max(1, Math.min(currentPage, totalPages));
  const startIndex = totalBulkCount > 0 ? (safePage - 1) * pageSize : 0;
  const endIndex = Math.min(startIndex + pageSize, totalBulkCount);
  const paginatedBulkItems = visibleBulkItems.slice(startIndex, endIndex);

  const activeBulkFilterCount = [
    bulkSearch.trim(),
    bulkStatusFilter !== "ALL",
    quantityMin.trim(),
    quantityMax.trim(),
    hideCostAboveMarket,
  ].filter(Boolean).length;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Pricing</h1>
          <p>Validate exact automotive part matches and turn active eBay listings into a clear pricing decision.</p>
        </div>
        <div className={styles.modeToggle} role="tablist" aria-label="Pricing mode">
          <button type="button" role="tab" aria-selected={mode === "single"} className={mode === "single" ? styles.modeActive : undefined} onClick={() => setMode("single")}>
            Single search
          </button>
          <button type="button" role="tab" aria-selected={mode === "bulk"} className={mode === "bulk" ? styles.modeActive : undefined} onClick={() => setMode("bulk")}>
            Bulk pricing
          </button>
          <button
            type="button"
            className={styles.calcTriggerBtn}
            style={{ height: 36, marginLeft: 4, padding: "0 10px", fontSize: 12 }}
            onClick={() => setShowCalculatorModal(true)}
            title="Open formula & fee calculator"
          >
            🧮 Calculator
          </button>
        </div>
      </header>

      {mode === "single" ? (
        <>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>Competitor price search</span>
              <h2>Know the market.<br />Price with confidence.</h2>
              <ul className={styles.trustList}>
                <li>Exact item-specific verification</li>
                <li>Own sellers excluded</li>
                <li>Selling price only</li>
              </ul>
            </div>

            <form className={styles.searchForm} onSubmit={search}>
              <label className={styles.oemField}>
                <span>OEM / MPN / Interchange number</span>
                <input
                  value={oem ?? ""}
                  onChange={(event) => setOem(event.currentTarget.value ?? "")}
                  placeholder="e.g. 8K0615301M"
                  required
                  autoComplete="off"
                />
              </label>
              <div className={styles.searchRow}>
                <label>
                  <span>Marketplace</span>
                  <select value={marketplace ?? "EBAY_US"} onChange={(event) => setMarketplace(event.currentTarget.value || "EBAY_US")}>
                    <option value="EBAY_US">eBay US</option>
                    <option value="EBAY_GB">eBay UK</option>
                    <option value="EBAY_DE">eBay DE</option>
                  </select>
                </label>
                <label>
                  <span>Condition</span>
                  <select
                    value={condition ?? "ANY"}
                    onChange={(event) => setCondition((event.currentTarget.value || "ANY") as "ANY" | "NEW" | "USED")}
                    aria-label="Listing condition"
                  >
                    <option value="ANY">Any condition</option>
                    <option value="NEW">New only</option>
                    <option value="USED">Used only</option>
                  </select>
                </label>
                <button type="submit" className={styles.primary} disabled={loading}>
                  {loading ? "Analyzing…" : "Analyze market"}
                </button>
              </div>
            </form>
          </section>

          {error && <div className={styles.error}>{error}</div>}
          {demo && !result && (
            <div className={styles.notice}>Development preview — run Analyze market to see a sample snapshot.</div>
          )}
          {result?.provider === "demo" && (
            <div className={styles.warn}>
              Showing sample eBay data — the API is in demo mode because <code>EBAY_CLIENT_ID</code> and{" "}
              <code>EBAY_CLIENT_SECRET</code> are not both set. Add your App ID from the{" "}
              <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noreferrer">
                eBay Developer Portal
              </a>
              , restart the API, then analyze again.
            </div>
          )}
          {result?.provider === "live" && typeof result.candidateCount === "number" && (
            <div className={styles.notice}>
              eBay returned {result.candidateCount} candidates; {result.listings.length} passed exact
              item-specific matching (website keyword search counts can be higher).
            </div>
          )}

          {!result && !error && (
            <section className={styles.guide}>
              <article>
                <b>01</b>
                <h3>Enter the part number</h3>
                <p>Use OEM, MPN, or interchange — PartPulse verifies exact item matches only.</p>
              </article>
              <article>
                <b>02</b>
                <h3>Scan live listings</h3>
                <p>Active eBay comps are filtered for your marketplace and condition.</p>
              </article>
              <article>
                <b>03</b>
                <h3>Set your price</h3>
                <p>Selling low, median, and recommended price give you a clear decision.</p>
              </article>
            </section>
          )}

          {result && (
            <section className={styles.results} aria-live="polite">
              <div className={styles.resultHead}>
                <div>
                  <span className={styles.eyebrow}>Verified market snapshot</span>
                  <h3>{result.oem}</h3>
                  <p>
                    {result.marketplace.replace("EBAY_", "eBay ")}
                    {" · "}
                    {result.conditionFilter === "ANY" ? "All conditions" : result.conditionFilter}
                    {" · "}
                    {new Date(result.searchedAt).toLocaleString()}
                  </p>
                </div>
                {result.analytics && (
                  <div className={styles.recommend}>
                    <span>Recommended price</span>
                    <strong>{money(result.analytics.recommendedPrice, result.analytics.currency)}</strong>
                    <small>Based on {result.analytics.count} verified listings</small>
                  </div>
                )}
              </div>

              {result.analytics ? (
                <>
                  <div className={styles.metrics}>
                    {[
                      ["Lowest selling", result.analytics.lowest],
                      ["Market average", result.analytics.average],
                      ["Median", result.analytics.median],
                      ["Highest", result.analytics.highest],
                    ].map(([label, value]) => (
                      <article key={String(label)}>
                        <span>{label}</span>
                        <b>{money(Number(value), result.analytics!.currency)}</b>
                      </article>
                    ))}
                  </div>

                  <div className={styles.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          <th>Listing</th>
                          <th>Seller</th>
                          <th>Condition</th>
                          <th>Item</th>
                          <th>Shipping</th>
                          <th>Selling price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.listings.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                              <span className={styles.subtle}>eBay ID: {ebayListingId(item.id)}</span>
                            </td>
                            <td>{item.seller}</td>
                            <td><span className={styles.pill}>{item.condition}</span></td>
                            <td>{money(item.price, item.currency)}</td>
                            <td>{money(item.shipping, item.currency)}</td>
                            <td><b className={styles.landed}>{money(item.price, item.currency)}</b></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className={styles.empty}>
                  <b>No exact verified competitor matches found</b>
                  <span>Try another OEM/MPN, marketplace, or condition filter.</span>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          {!bulkJob && (
            <section className={styles.bulkHero}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>Bulk pricing</span>
              <h2>Price a full sheet in one pass.</h2>
              <ul className={styles.trustList}>
                <li>Upload part number, brand, and cost</li>
                <li>Exact eBay comps + org margin rules</li>
                <li>Download priced results after the job completes</li>
              </ul>
              <button type="button" className={styles.ghostBtn} onClick={() => void downloadTemplate()}>
                Download CSV template
              </button>
            </div>

            <form className={styles.searchForm} onSubmit={startBulk}>
              <div className={styles.fileDropZone} onClick={() => fileInputRef.current?.click()}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setBulkFile(event.target.files?.[0] ?? null)}
                  required={!bulkFile}
                />
                {bulkFile ? (
                  <div className={styles.fileSelectedBadge}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{bulkFile.name} ({(bulkFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <>
                    <svg className={styles.fileDropIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <p className={styles.fileDropTitle}>Upload Pricing Sheet (.CSV)</p>
                    <p className={styles.fileDropSubtext}>Click to browse or drag & drop your CSV file here</p>
                  </>
                )}
              </div>

              <div className={styles.bulkFormGrid}>
                <label>
                  <span>Marketplace</span>
                  <select value={marketplace ?? "EBAY_US"} onChange={(event) => setMarketplace(event.currentTarget.value || "EBAY_US")}>
                    <option value="EBAY_US">eBay US</option>
                    <option value="EBAY_GB">eBay UK</option>
                    <option value="EBAY_DE">eBay DE</option>
                  </select>
                </label>
                <label>
                  <span>Default condition</span>
                  <select
                    value={condition ?? "ANY"}
                    onChange={(event) => setCondition((event.currentTarget.value || "ANY") as "ANY" | "NEW" | "USED")}
                  >
                    <option value="ANY">Any condition</option>
                    <option value="NEW">New only</option>
                    <option value="USED">Used only</option>
                  </select>
                </label>
                <label>
                  <span>Currency</span>
                  <input value={bulkCurrency} onChange={(event) => setBulkCurrency(event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} placeholder="USD" maxLength={3} required />
                </label>
              </div>

              <PricingFormulaBuilder formula={pricingFormula} onChange={setPricingFormula} currency={bulkCurrency || "USD"} />

              <div className={styles.bulkActionsRow}>
                <button hidden type="button" className={styles.calcTriggerBtn} onClick={() => setShowCalculatorModal(true)}>
                  🧮 Fee Calculator
                </button>
                <button type="submit" className={styles.primary} disabled={bulkBusy || !bulkFile}>
                  {bulkBusy ? "Uploading…" : "Run bulk pricing"}
                </button>
              </div>
              <p className={styles.bulkHint}>
                Required columns: PartNumber, Brand, CostPrice, Quantity. Optional: Notes.
              </p>
            </form>
          </section>
          )}

          {error && (
            <div className={styles.error} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>{error}</span>
              {error.includes("already running") && (
                <button
                  type="button"
                  className={styles.ghostBtn}
                  style={{ height: 28, fontSize: 12, padding: "0 12px", whiteSpace: "nowrap", flexShrink: 0 }}
                  disabled={clearingStuck}
                  onClick={() => void clearStuckJob()}
                >
                  {clearingStuck ? "Resetting…" : "Reset stuck job"}
                </button>
              )}
            </div>
          )}
          {demo && !bulkJob && (
            <div className={styles.notice}>Development preview — upload any CSV to see sample bulk results.</div>
          )}

          {bulkJob && (
            <section ref={bulkResultsRef} className={styles.results} aria-live="polite">
              <div className={styles.resultHead}>
                <div>
                  <span className={styles.eyebrow}>Active Bulk Job Workspace</span>
                  <h3>{bulkJob.sourceFilename || bulkJob.id}</h3>
                  <p>
                    {bulkJob.marketplace.replace("EBAY_", "eBay ")} · {bulkJob.status.toLowerCase()} ·{" "}
                    {Math.min(bulkJob.status === "COMPLETED" ? bulkJob.totalItems : bulkJob.completedItems + bulkJob.noMatchItems + bulkJob.failedItems, bulkJob.totalItems)}/{bulkJob.totalItems} rows
                    {bulkJob.noMatchItems ? ` · ${bulkJob.noMatchItems} no match` : ""}
                    {bulkJob.failedItems ? ` · ${bulkJob.failedItems} failed` : ""}
                  </p>
                  {!bulkDone && (
                    <div className={styles.bulkProgressTrack} aria-hidden="true">
                      <span style={{ width: `${bulkProgress}%` }} />
                    </div>
                  )}
                </div>
                <div className={styles.bulkActions}>
                  {bulkJob.status === "PAUSED" && (
                    <button
                      type="button"
                      className={styles.resumeBannerBtn}
                      style={{ height: 38, padding: "0 16px", background: "#d97706" }}
                      disabled={resumingJobId === bulkJob.id}
                      onClick={() => void resumeJob(bulkJob.id)}
                    >
                      {resumingJobId === bulkJob.id ? "Resuming…" : "▶ Resume job"}
                    </button>
                  )}
                  <button type="button" className={styles.ghostBtn} onClick={() => setBulkJob(null)}>
                    Close job view
                  </button>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={!bulkDone || visibleBulkItems.length === 0}
                    onClick={() => void exportBulkResults()}
                  >
                    {visibleBulkItems.length < totalBulkItems
                      ? `Download filtered CSV (${visibleBulkItems.length})`
                      : "Download priced CSV"}
                  </button>
                </div>
              </div>
              {bulkJob.status === "PAUSED" && (
                <div className={styles.pausedBanner}>
                  <div>
                    <b>⚠️ Bulk Job Paused (Rate Limit Reached)</b>
                    <p>{bulkJob.lastError || "Processing stopped because the eBay API request limit was reached (HTTP 429). Wait a few moments, then click Resume job to continue."}</p>
                  </div>
                  <button
                    type="button"
                    className={styles.resumeBannerBtn}
                    disabled={resumingJobId === bulkJob.id}
                    onClick={() => void resumeJob(bulkJob.id)}
                  >
                    {resumingJobId === bulkJob.id ? "Resuming…" : "Resume job now"}
                  </button>
                </div>
              )}
              {bulkJob.lastError && bulkJob.status !== "PAUSED" && <div className={styles.error}>{bulkJob.lastError}</div>}

              <div className={styles.reviewFilters}>
                <label>
                  <span>Search</span>
                  <input value={bulkSearch} onChange={(event) => setBulkSearch(event.currentTarget.value)} placeholder="Brand, part number, notes" />
                </label>
                <label>
                  <span>Status</span>
                  <select value={bulkStatusFilter} onChange={(event) => setBulkStatusFilter(event.currentTarget.value)}>
                    <option value="ALL">All</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="NO_MATCHES">No matches</option>
                    <option value="FAILED">Failed</option>
                    <option value="QUEUED">Queued</option>
                    <option value="RUNNING">Running</option>
                  </select>
                </label>
                <label>
                  <span>Qty ≥</span>
                  <input type="number" min="0" value={quantityMin} onChange={(event) => setQuantityMin(event.currentTarget.value)} placeholder="0" />
                </label>
                <label>
                  <span>Qty ≤</span>
                  <input type="number" min="0" value={quantityMax} onChange={(event) => setQuantityMax(event.currentTarget.value)} placeholder="Any" />
                </label>
                <label className={styles.checkFilter}>
                  <input type="checkbox" checked={hideCostAboveMarket} onChange={(event) => setHideCostAboveMarket(event.currentTarget.checked)} />
                  <span>Hide cost &gt; market</span>
                </label>
                <div className={styles.filterCount}>
                  <b>{visibleBulkItems.length}</b>
                  <span>filtered listings</span>
                  <small>{totalBulkItems} total</small>
                </div>
              </div>

              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th>Cost</th>
                      <th>Qty</th>
                      <th>Market</th>
                      <th>Selling price</th>
                      <th>Margin</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedBulkItems.map((item) => (
                      <Fragment key={item.id}>
                      <tr className={openMarketItemId === item.id || openCalculatorItemId === item.id ? styles.expandedSourceRow : undefined}>
                        <td>
                          {item.brand} · {item.partNumber}
                          <span className={styles.subtle}>
                            {item.condition}{item.catalogMatch ? " · Catalog match" : ""}
                          </span>
                        </td>
                        <td>{money(item.costPrice, item.currency)}</td>
                        <td>{item.quantity}</td>
                        <td>
                          {item.marketRecommended != null ? (
                            <button
                              type="button"
                              className={styles.priceAction}
                              onClick={() => {
                                setOpenMarketItemId((current) => current === item.id ? null : item.id);
                                setOpenCalculatorItemId(null);
                              }}
                              aria-expanded={openMarketItemId === item.id}
                              aria-label={`View competitors for ${item.brand} ${item.partNumber}`}
                            >
                              {money(item.marketRecommended, item.currency)}
                            </button>
                          ) : "—"}
                          {item.competitorCount > 0 ? (
                            <span className={styles.subtle}>{item.competitorCount} comps · med {item.median != null ? money(item.median, item.currency) : "—"}</span>
                          ) : null}
                        </td>
                        <td>
                          {editingItemId === item.id ? (
                            <div className={styles.inlineEditWrap}>
                              <div className={styles.inlineInputGroup}>
                                <span className={styles.currencyPrefix}>$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className={styles.inlinePriceInput}
                                  value={editingPriceValue}
                                  onChange={(e) => setEditingPriceValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      void saveItemSellingPrice(item.id, editingPriceValue);
                                    } else if (e.key === "Escape") {
                                      setEditingItemId(null);
                                    }
                                  }}
                                  autoFocus
                                />
                              </div>
                              {canEditPricing && <button
                                type="button"
                                className={styles.inlineSaveBtn}
                                disabled={savingItemId === item.id}
                                onClick={() => void saveItemSellingPrice(item.id, editingPriceValue)}
                                title="Save price"
                              >
                                ✓
                              </button>}
                              <button
                                type="button"
                                className={styles.inlineCancelBtn}
                                onClick={() => setEditingItemId(null)}
                                title="Cancel"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className={styles.sellingPriceCell}>
                              <button
                                type="button"
                                className={styles.priceAction}
                                onClick={() => {
                                  setOpenCalculatorItemId((current) => current === item.id ? null : item.id);
                                  setOpenMarketItemId(null);
                                }}
                                aria-expanded={openCalculatorItemId === item.id}
                                aria-label={`Open calculator for ${item.brand} ${item.partNumber}`}
                              >
                                {item.sellingPrice != null ? money(item.sellingPrice, item.currency) : "—"}
                              </button>
                              <button
                                type="button"
                                className={styles.inlineEditTrigger}
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingPriceValue(item.sellingPrice != null ? String(item.sellingPrice) : "");
                                }}
                                title="Edit selling price"
                                aria-label={`Edit selling price for ${item.brand} ${item.partNumber}`}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </td>
                        <td>{item.marginPercent != null ? `${item.marginPercent.toFixed(1)}%` : "—"}</td>
                        <td>
                          <span className={`${styles.pill} ${styles[`status_${item.status.toLowerCase()}`] || ""}`}>
                            {item.status.replaceAll("_", " ")}
                          </span>
                          {item.error ? (
                            <span className={styles.itemErrorText} title={item.error}>
                              {item.error.includes("429") ? "Rate limit reached (429)" : item.error}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                      {openMarketItemId === item.id ? (
                        <tr className={styles.expandedDetailRow}>
                          <td colSpan={7}>
                            <div className={styles.expandedDetail}>
                              <div className={styles.inlineDropdownHead}>
                                <div className={styles.drawerHeaderTitleGroup}>
                                  <div className={styles.drawerTitleBadgeRow}>
                                    <b>Competitor Evidence</b>
                                    <span className={styles.countBadge}>{item.competitorCount} Listings</span>
                                    {item.marketRecommended != null && (
                                      <span className={styles.marketBadge}>
                                        Market Median {money(item.marketRecommended, item.currency)}
                                      </span>
                                    )}
                                  </div>
                                  <span className={styles.drawerSubtitle}>
                                    Live market evidence collected from eBay listings for {item.brand} ({item.partNumber})
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className={styles.closeDrawerBtn}
                                  onClick={() => setOpenMarketItemId(null)}
                                  aria-label="Close competitor details"
                                >
                                  <span>Close</span>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                  </svg>
                                </button>
                              </div>
                              {(item.competitors ?? []).length ? (
                                <div className={styles.competitorTableWrap}>
                                  <div className={styles.competitorHeaderRow}>
                                    <span className={styles.colTitle}>Listing / Seller</span>
                                    <span className={styles.colSelling}>Selling</span>
                                    <span className={styles.colShipping}>Shipping</span>
                                    <span className={styles.colLanded}>Landed</span>
                                  </div>
                                  <div className={styles.competitorListSimple}>
                                    {(item.competitors ?? []).map((competitor) => {
                                      const totalLanded = landedAmount(competitor.price, competitor.shipping);
                                      return (
                                        <a
                                          key={`${item.id}-${competitor.listingId}`}
                                          href={competitor.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className={styles.competitorRowSimple}
                                        >
                                          <div className={styles.compMainCol}>
                                            <b className={styles.compTitle}>{competitor.title} ↗</b>
                                            <span className={styles.compSubtitle}>
                                              {competitor.seller} · {competitor.condition}
                                            </span>
                                          </div>
                                          <div className={styles.compSellingCol}>
                                            {money(competitor.price, competitor.currency)}
                                          </div>
                                          <div className={styles.compShippingCol}>
                                            {competitor.shipping === 0 ? <span className={styles.freeText}>Free</span> : money(competitor.shipping, competitor.currency)}
                                          </div>
                                          <div className={styles.compLandedCol}>
                                            <b>{money(totalLanded, competitor.currency)}</b>
                                          </div>
                                        </a>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div className={styles.inlineEmpty}>No competitor listings found for this part number.</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      {openCalculatorItemId === item.id ? (
                        <tr className={styles.expandedDetailRow}>
                          <td colSpan={7}>
                            <div className={styles.expandedDetail}>
                              <div className={styles.inlineDropdownHead}>
                                <div className={styles.drawerHeaderTitleGroup}>
                                  <div className={styles.drawerTitleBadgeRow}>
                                    <b>Selling Price Calculator</b>
                                    <span className={styles.countBadge}>{item.brand}</span>
                                    <span className={styles.partBadge}>{item.partNumber}</span>
                                  </div>
                                  <span className={styles.drawerSubtitle}>
                                    Interactive price breakdown and margin adjustment
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className={styles.closeDrawerBtn}
                                  onClick={() => setOpenCalculatorItemId(null)}
                                  aria-label="Close calculator details"
                                >
                                  <span>Close</span>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                  </svg>
                                </button>
                              </div>
                              <BulkSellingCalculator item={item} targetMarginPercent={bulkJob.targetMarginPercent} bufferPercent={bulkJob.bufferPercent} pricingFormula={bulkJob.pricingFormula} onSavePrice={saveItemSellingPrice} editable={canEditPricing} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination}>
                <span>
                  {totalBulkCount > 0
                    ? `Showing ${startIndex + 1} to ${endIndex} of ${totalBulkCount} results`
                    : "No listings match active filters"}
                </span>
                <div className={styles.pageSize}>
                  <span>Rows per page</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setCurrentPage(1);
                    }}
                    className={styles.pageSizeSelect}
                    aria-label="Rows per page"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={250}>250</option>
                  </select>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  <em className={styles.pageCurrent}>{safePage}</em>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              </div>
            </section>
          )}

          {!bulkJob && (
            <section className={styles.historyPanel}>
              <div className={styles.historyHead}>
                <div>
                  <span className={styles.eyebrow}>Pricing history</span>
                  <h3>Bulk pricing jobs</h3>
                  <p>Open a previous upload, monitor running jobs, or download completed pricing results.</p>
                </div>
                <button type="button" className={styles.ghostBtn} onClick={() => void loadBulkHistory()} disabled={historyBusy}>
                  {historyBusy ? "Refreshing…" : "Refresh history"}
                </button>
              </div>
              {bulkHistory.length ? (
                <div className={styles.historyList}>
                  {bulkHistory.map((job) => {
                    const processed = Math.min(
                      job.status === "COMPLETED" ? job.totalItems : job.completedItems + job.noMatchItems + job.failedItems,
                      job.totalItems,
                    );
                    const created = job.createdAt ? new Date(job.createdAt).toLocaleString() : "—";
                    return (
                      <article key={job.id}>
                        <div className={styles.historyMetaCol}>
                          <b className={styles.historyFilename}>{job.sourceFilename || job.id}</b>
                          <span className={styles.historyMetaInfo}>
                            {job.marketplace.replace("EBAY_", "eBay ")} · {job.defaultCondition} · {job.targetMarginPercent ?? 20}% margin
                          </span>
                        </div>
                        <div className={styles.historyRatioCol}>
                          <b className={styles.historyRatio}>{processed}/{job.totalItems}</b>
                          <span className={styles.historyRatioLabel}>
                            {job.noMatchItems ? `${job.noMatchItems} no match` : "All matched"}
                          </span>
                        </div>
                        <div className={styles.historyDateCol}>
                          <span className={styles.historyDate}>{created}</span>
                          <span className={`${styles.historyStatus} ${styles[`status_${job.status.toLowerCase()}`] || ""}`}>
                            {job.status.toLowerCase().replaceAll("_", " ")}
                          </span>
                        </div>
                        <div className={styles.historyActionsCol} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {job.status === "PAUSED" && (
                            <button
                              type="button"
                              className={styles.resumeJobBtn}
                              disabled={resumingJobId === job.id}
                              onClick={() => void resumeJob(job.id)}
                            >
                              {resumingJobId === job.id ? "Resuming…" : "Resume job"}
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.openJobBtn}
                            disabled={openingJobId === job.id}
                            onClick={() => void openBulkHistoryJob(job.id)}
                          >
                            {openingJobId === job.id ? "Opening…" : "Open job"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.historyEmpty}>No bulk pricing jobs yet. Start an upload and it will appear here.</div>
              )}
            </section>
          )}
        </>
      )}
      <CalculatorModal
        isOpen={showCalculatorModal}
        onClose={() => setShowCalculatorModal(false)}
        targetMarginPercent={targetMarginPercent}
        bufferPercent={bulkBufferPercent}
        onMarginChange={setTargetMarginPercent}
        onBufferChange={setBulkBufferPercent}
      />
    </div>
  );
}
