"use client";

import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
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
  const targetProfit = landedAmount(cost * (targetMarginPercent / 100), 0);
  const grossProfitBeforeShipping = landedAmount(sale - cost - ebayFeeTotal - exportPayoneerBufferFee, 0);
  const shippingEstimate = 0;
  const totalExpenses = landedAmount(ebayFeeTotal + exportPayoneerBufferFee + shippingEstimate, 0);

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
    totalExpenses,
    breakEvenShipping: grossProfitBeforeShipping,
    currency,
  };
}

function visibleSellingFormula(item: BulkPricingItem, targetMarginPercent: number) {
  if (item.sellingPrice === null) return null;
  const breakdown = feeBreakdown(item.sellingPrice, item.costPrice, item.currency, targetMarginPercent);
  return [
    money(item.costPrice, item.currency),
    money(breakdown.targetProfit, item.currency),
    money(breakdown.ebayFeeTotal, item.currency),
    money(breakdown.exportPayoneerBufferFee, item.currency),
  ].join(" + ") + ` = ${money(item.sellingPrice, item.currency)}`;
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
  onSavePrice,
}: {
  item: BulkPricingItem;
  targetMarginPercent: number | null;
  onSavePrice: (itemId: string, newPrice: number | string | null) => Promise<void>;
}) {
  const targetMargin = targetMarginPercent ?? 20;
  const breakdown = feeBreakdown(item.sellingPrice, item.costPrice, item.currency, targetMargin);
  const [customPrice, setCustomPrice] = useState(item.sellingPrice !== null ? String(item.sellingPrice) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCustomPrice(item.sellingPrice !== null ? String(item.sellingPrice) : "");
  }, [item.sellingPrice]);

  const isCustom = item.floorPrice != null && item.sellingPrice !== null && Math.abs(item.sellingPrice - item.floorPrice) > 0.001;

  return (
    <>
      <div className={styles.calculatorEditHeader}>
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
      </div>
      <div className={styles.costBreakdown}>
        <span className={styles.breakdownEyebrow}>Cost breakdown</span>
        <div className={styles.breakdownLine}>
          <span>Part cost</span>
          <b>{money(item.costPrice, item.currency)}</b>
        </div>
        <div className={styles.breakdownLine}>
          <span>
            Shipping (DHL/FedEx avg)
            <small>Not included until courier API is connected</small>
          </span>
          <b>{money(breakdown.shippingEstimate, item.currency)}</b>
        </div>
        <div className={styles.breakdownLine}>
          <span>
            Target profit selected on upload
            <small>{targetMargin.toFixed(1).replace(/\.0$/, "")}% of part cost</small>
          </span>
          <b>{money(breakdown.targetProfit, item.currency)}</b>
        </div>
        <div className={styles.breakdownLine}>
          <span>
            Subtotal before fees
            <small>Part cost + selected profit</small>
          </span>
          <b>{money(item.costPrice + breakdown.targetProfit, item.currency)}</b>
        </div>
        <div className={styles.breakdownLine}>
          <span>Formula selling price</span>
          <b>{item.floorPrice === null ? "—" : money(item.floorPrice, item.currency)}</b>
        </div>
        <div className={styles.breakdownLine}>
          <span>Active selling price</span>
          <b>{item.sellingPrice === null ? "—" : money(item.sellingPrice, item.currency)}</b>
        </div>
        <div className={styles.breakdownLine}>
          <span>Actual profit percent after fees</span>
          <b>{item.marginPercent === null ? "—" : `${item.marginPercent.toFixed(1)}%`}</b>
        </div>
        <div className={styles.breakdownSubLine}>
          <span>FVF 11.35% on first {money(1000, item.currency)}</span>
          <b>{money(breakdown.ebayFirstTierFee, item.currency)}</b>
        </div>
        <div className={styles.breakdownSubLine}>
          <span>FVF 2.35% on {money(breakdown.secondTierBase, item.currency)} over {money(1000, item.currency)}</span>
          <b>{money(breakdown.ebaySecondTierFee, item.currency)}</b>
        </div>
        <div className={styles.breakdownLine}>
          <span>eBay FVF total</span>
          <b>{money(breakdown.ebayFeeTotal, item.currency)}</b>
        </div>
        <div className={styles.breakdownLine}>
          <span>Export 1.3% + Payoneer 2% + buffer 1% + {money(0.4, item.currency)}</span>
          <b>{money(breakdown.exportPayoneerBufferFee, item.currency)}</b>
        </div>
        <div className={`${styles.breakdownLine} ${styles.profitLine}`}>
          <span>Gross profit before shipping</span>
          <b>{money(breakdown.grossProfitBeforeShipping, item.currency)}</b>
        </div>
        <div className={styles.totalLanded}>
          <span>Total expenses</span>
          <b>{money(breakdown.totalExpenses, item.currency)}</b>
        </div>
        <p className={styles.breakEvenNote}>
          Stays profitable while your real shipping is ≤ <b>{money(breakdown.breakEvenShipping, item.currency)}</b>.
        </p>
      </div>
      <div className={styles.formulaBox}>
        <b>Selling price decision</b>
        <p>
          Simple formula: part cost + your selected profit + eBay FVF + export/payment expenses. Market competitors are kept as evidence only and do not change this selling price.
        </p>
        {visibleSellingFormula(item, targetMargin) ? <span>{visibleSellingFormula(item, targetMargin)}</span> : null}
      </div>
    </>
  );
}

export default function PricingWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [oem, setOem] = useState("8K0615301M");
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [condition, setCondition] = useState<"ANY" | "NEW" | "USED">("ANY");
  const [bulkCurrency, setBulkCurrency] = useState("USD");
  const [targetMarginPercent, setTargetMarginPercent] = useState("20");
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
  const [openMarketItemId, setOpenMarketItemId] = useState<string | null>(null);
  const [openCalculatorItemId, setOpenCalculatorItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState<string>("");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkResultsRef = useRef<HTMLElement>(null);

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
            if (price !== null && cost > 0) {
              const breakdown = feeBreakdown(price, cost, it.currency, prev.targetMarginPercent ?? 20);
              marginPercent = Math.round(((breakdown.grossProfitBeforeShipping / cost) * 100 + Number.EPSILON) * 100) / 100;
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

  useEffect(() => {
    if (!bulkJob || demo) return;
    if (!["QUEUED", "RUNNING"].includes(bulkJob.status)) return;
    const timer = window.setInterval(() => {
      void apiFetch(`/api/pricing/bulk/${bulkJob.id}`)
        .then((value) => setBulkJob(value as BulkPricingJob))
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [apiFetch, bulkJob, demo]);

  async function loadBulkHistory() {
    setHistoryBusy(true);
    try {
      if (demo) {
        setBulkHistory([{
          id: "demo-bulk-previous",
          marketplace: "EBAY_US",
          defaultCondition: "USED",
          targetMarginPercent: 20,
          status: "COMPLETED",
          totalItems: 16,
          completedItems: 12,
          noMatchItems: 4,
          failedItems: 0,
          sourceFilename: "partpulse-bulk-pricing-template.csv",
          lastError: null,
          createdAt: new Date(Date.now() - 86_400_000).toISOString(),
          startedAt: new Date(Date.now() - 86_390_000).toISOString(),
          completedAt: new Date(Date.now() - 86_000_000).toISOString(),
        }]);
        return;
      }
      const jobs = await apiFetch("/api/pricing/bulk/jobs?limit=20") as BulkPricingJob[];
      setBulkHistory(jobs);
    } catch {
      // History is helpful, not blocking.
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
    setBulkBusy(true);
    setError("");
    try {
      if (demo) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        setBulkJob({
          id: "demo-bulk-1",
          marketplace,
          defaultCondition: condition,
          targetMarginPercent: Number(targetMarginPercent) || 20,
          status: "COMPLETED",
          totalItems: 2,
          completedItems: 2,
          noMatchItems: 0,
          failedItems: 0,
          sourceFilename: bulkFile.name,
          lastError: null,
          items: [
            {
              id: "1",
              rowNumber: 1,
              sku: "AUDI-8K0615301M",
              partNumber: "8K0615301M",
              brand: "Audi",
              costPrice: 45,
              quantity: 3,
              currency: "USD",
              condition: "USED",
              notes: "Demo row",
              catalogMatch: false,
              status: "COMPLETED",
              competitorCount: 12,
              lowest: 74.99,
              median: 94.5,
              highest: 139,
              marketRecommended: 92,
              sellingPrice: 92,
              floorPrice: 66.25,
              marginPercent: 51.09,
              competitors: [
                { listingId: "336012345678", title: "Audi A4 A5 Q5 Rear Brake Caliper 8K0615301M Left Driver Side Used", seller: "euroautoparts_us", price: 79.99, shipping: 12.5, currency: "USD", condition: "USED", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["OE/OEM Part Number"] },
                { listingId: "336098765432", title: "OEM Audi Rear Caliper Assembly 8K0615301M Tested", seller: "germanparts_direct", price: 89, shipping: 0, currency: "USD", condition: "USED", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["Manufacturer Part Number"] },
              ],
              error: null,
            },
            {
              id: "2",
              rowNumber: 2,
              sku: "BMW-34116791244",
              partNumber: "34116791244",
              brand: "BMW",
              costPrice: 62.5,
              quantity: 1,
              currency: "USD",
              condition: "USED",
              notes: null,
              catalogMatch: true,
              status: "COMPLETED",
              competitorCount: 8,
              lowest: 89,
              median: 118,
              highest: 160,
              marketRecommended: 115.64,
              sellingPrice: 115.64,
              floorPrice: 88.13,
              marginPercent: 45.95,
              competitors: [
                { listingId: "335511223344", title: "BMW Brake Caliper 34116791244 OEM Used", seller: "bmw_parts_house", price: 109.95, shipping: 8.99, currency: "USD", condition: "USED", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["OE/OEM Part Number"] },
              ],
              error: null,
            },
          ],
        });
        return;
      }

      const bytes = await bulkFile.arrayBuffer();
      const job = await apiFetch(
        `/api/pricing/bulk?marketplace=${encodeURIComponent(marketplace)}&condition=${encodeURIComponent(condition)}&currency=${encodeURIComponent(bulkCurrency)}&targetMarginPercent=${encodeURIComponent(targetMarginPercent)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/csv",
            "X-File-Name": bulkFile.name,
          },
          body: bytes,
        },
      ) as BulkPricingJob;
      setBulkJob(job);
      void loadBulkHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start bulk pricing");
      void loadBulkHistory();
    } finally {
      setBulkBusy(false);
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
      const header = "PartNumber,Brand,CostPrice,Quantity,Currency,Condition,Marketplace,MatchCount,Lowest,Median,Highest,MarketRecommended,SellingPrice,FormulaPrice,ProfitPercent,Status,Error,CatalogMatch,Notes";
      const lines = getVisibleBulkItems().map((item) => [
        item.partNumber, item.brand, item.costPrice, item.quantity, item.currency, item.condition, bulkJob.marketplace,
        item.competitorCount, item.lowest, item.median, item.highest, item.marketRecommended, item.sellingPrice,
        item.floorPrice, item.marginPercent, item.status, item.error ?? "", item.catalogMatch ? "Yes" : "No", item.notes ?? "",
      ].map(csvCell).join(","));
      downloadTextFile(`partpulse-bulk-pricing-${bulkJob.id}.csv`, [header, ...lines].join("\n"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to export results");
    }
  }

  async function openBulkHistoryJob(jobId: string) {
    setError("");
    setOpenMarketItemId(null);
    setOpenCalculatorItemId(null);
    try {
      if (demo) {
        setBulkJob((current) => current ?? {
          id: jobId,
          marketplace: "EBAY_US",
          defaultCondition: "USED",
          targetMarginPercent: 20,
          status: "COMPLETED",
          totalItems: 0,
          completedItems: 0,
          noMatchItems: 0,
          failedItems: 0,
          sourceFilename: "demo-history.csv",
          lastError: null,
          items: [],
        });
        window.setTimeout(() => bulkResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        return;
      }
      const job = await apiFetch(`/api/pricing/bulk/${jobId}`) as BulkPricingJob;
      setBulkJob(job);
      window.setTimeout(() => bulkResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open pricing job");
    }
  }

  if (authStatus !== "ready") return null;

  const bulkDone = bulkJob ? !["QUEUED", "RUNNING"].includes(bulkJob.status) : false;
  const bulkProgress = bulkJob
    ? Math.round(((bulkJob.completedItems + bulkJob.noMatchItems + bulkJob.failedItems) / Math.max(bulkJob.totalItems, 1)) * 100)
    : 0;
  const visibleBulkItems = getVisibleBulkItems();
  const totalBulkItems = bulkJob?.items?.length ?? 0;
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
              <label className={styles.oemField}>
                <span>Pricing sheet (.csv)</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setBulkFile(event.target.files?.[0] ?? null)}
                  required={!bulkFile}
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
                  <input
                    value={bulkCurrency}
                    onChange={(event) => setBulkCurrency(event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                    placeholder="USD"
                    maxLength={3}
                    required
                  />
                </label>
                <label>
                  <span>Profit margin %</span>
                  <input
                    type="number"
                    min="0"
                    max="95"
                    step="0.1"
                    value={targetMarginPercent}
                    onChange={(event) => setTargetMarginPercent(event.currentTarget.value)}
                    placeholder="20"
                    required
                  />
                </label>
                <button type="submit" className={styles.primary} disabled={bulkBusy || !bulkFile}>
                  {bulkBusy ? "Uploading…" : "Run bulk pricing"}
                </button>
              </div>
              <p className={styles.bulkHint}>
                Required columns: PartNumber, Brand, CostPrice, Quantity. Optional: Notes. Currency and condition are applied from this upload form.
              </p>
            </form>
          </section>

          {error && <div className={styles.error}>{error}</div>}
          {demo && !bulkJob && (
            <div className={styles.notice}>Development preview — upload any CSV to see sample bulk results.</div>
          )}

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
                  const processed = job.completedItems + job.noMatchItems + job.failedItems;
                  const created = job.createdAt ? new Date(job.createdAt).toLocaleString() : "—";
                  return (
                    <article key={job.id} className={bulkJob?.id === job.id ? styles.historyActive : undefined}>
                      <div>
                        <b>{job.sourceFilename || job.id}</b>
                        <span>{job.marketplace.replace("EBAY_", "eBay ")} · {job.defaultCondition} · {job.targetMarginPercent ?? 20}% margin</span>
                      </div>
                      <div>
                        <b>{processed}/{job.totalItems}</b>
                        <span>{job.noMatchItems ? `${job.noMatchItems} no match` : "All matched so far"}</span>
                      </div>
                      <div>
                        <span className={styles.historyDate}>{created}</span>
                        <span className={styles.historyStatus}>{job.status.toLowerCase().replaceAll("_", " ")}</span>
                      </div>
                      <button type="button" onClick={() => void openBulkHistoryJob(job.id)}>
                        {bulkJob?.id === job.id ? "Opened" : "Open job"}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={styles.historyEmpty}>No bulk pricing jobs yet. Start an upload and it will appear here.</div>
            )}
          </section>

          {bulkJob && (
            <section ref={bulkResultsRef} className={styles.results} aria-live="polite">
              <div className={styles.resultHead}>
                <div>
                  <span className={styles.eyebrow}>Bulk job</span>
                  <h3>{bulkJob.sourceFilename || bulkJob.id}</h3>
                  <p>
                    {bulkJob.marketplace.replace("EBAY_", "eBay ")} · {bulkJob.status.toLowerCase()} ·{" "}
                    {bulkJob.completedItems + bulkJob.noMatchItems + bulkJob.failedItems}/{bulkJob.totalItems} rows
                    {bulkJob.noMatchItems ? ` · ${bulkJob.noMatchItems} no match` : ""}
                    {bulkJob.failedItems ? ` · ${bulkJob.failedItems} failed` : ""}
                  </p>
	                  <div className={styles.filteredSummary}>
	                    <b>{visibleBulkItems.length}</b>
	                    <span>
	                      listings after filters
	                      {totalBulkItems ? ` of ${totalBulkItems} total` : ""}
	                      {activeBulkFilterCount ? ` · ${activeBulkFilterCount} filter${activeBulkFilterCount === 1 ? "" : "s"} applied` : ""}
	                    </span>
	                  </div>
	                  {!bulkDone && (
                    <div className={styles.bulkProgressTrack} aria-hidden="true">
                      <span style={{ width: `${bulkProgress}%` }} />
                    </div>
                  )}
                </div>
                <div className={styles.bulkActions}>
                  <button type="button" className={styles.primary} disabled={!bulkDone} onClick={() => void exportBulkResults()}>
                    Download priced CSV
                  </button>
                </div>
              </div>
              {bulkJob.lastError && <div className={styles.error}>{bulkJob.lastError}</div>}

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
	                    {visibleBulkItems.map((item) => (
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
                              <button
                                type="button"
                                className={styles.inlineSaveBtn}
                                disabled={savingItemId === item.id}
                                onClick={() => void saveItemSellingPrice(item.id, editingPriceValue)}
                                title="Save price"
                                aria-label="Save price"
                              >
                                ✓
                              </button>
                              <button
                                type="button"
                                className={styles.inlineCancelBtn}
                                disabled={savingItemId === item.id}
                                onClick={() => setEditingItemId(null)}
                                title="Cancel"
                                aria-label="Cancel"
                              >
                                ✕
                              </button>
                              {item.floorPrice != null && item.sellingPrice !== null && Math.abs(item.sellingPrice - item.floorPrice) > 0.001 && (
                                <button
                                  type="button"
                                  className={styles.inlineResetBtn}
                                  onClick={() => void saveItemSellingPrice(item.id, null)}
                                  title={`Reset to formula (${money(item.floorPrice, item.currency)})`}
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className={styles.priceCellWrap}>
                              <div className={styles.priceMainLine}>
                                {item.sellingPrice != null ? (
                                  <button
                                    type="button"
                                    className={`${styles.priceAction} ${styles.sellingPriceAction}`}
                                    onClick={() => {
                                      setOpenCalculatorItemId((current) => current === item.id ? null : item.id);
                                      setOpenMarketItemId(null);
                                    }}
                                    aria-expanded={openCalculatorItemId === item.id}
                                    aria-label={`View selling price calculation for ${item.brand} ${item.partNumber}`}
                                  >
                                    {money(item.sellingPrice, item.currency)}
                                  </button>
                                ) : "—"}
                                <button
                                  type="button"
                                  className={styles.editPriceBtn}
                                  onClick={() => {
                                    setEditingItemId(item.id);
                                    setEditingPriceValue(item.sellingPrice != null ? String(item.sellingPrice) : "");
                                  }}
                                  title="Edit selling price"
                                  aria-label={`Edit selling price for ${item.brand} ${item.partNumber}`}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                  </svg>
                                </button>
                              </div>
                              {item.floorPrice != null ? (
                                <div className={styles.subtlePriceLine}>
                                  <span className={styles.subtle}>
                                    {item.sellingPrice !== null && Math.abs(item.sellingPrice - item.floorPrice) > 0.001 ? (
                                      <span className={styles.customPriceBadge}>Custom · Formula {money(item.floorPrice, item.currency)}</span>
                                    ) : (
                                      `Formula ${money(item.floorPrice, item.currency)}`
                                    )}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td>{item.marginPercent != null ? `${item.marginPercent.toFixed(1)}%` : "—"}</td>
                        <td>
                          <span className={styles.pill}>{item.status.replaceAll("_", " ")}</span>
                          {item.error ? <span className={styles.subtle}>{item.error}</span> : null}
                        </td>
                      </tr>
                      {openMarketItemId === item.id ? (
                        <tr className={styles.expandedDetailRow}>
	                          <td colSpan={7}>
                            <div className={styles.expandedDetail}>
                              <div className={styles.inlineDropdownHead}>
                                <div>
                                  <b>Competitor evidence</b>
                                  <span>{item.competitorCount} competitors · Market {item.marketRecommended != null ? money(item.marketRecommended, item.currency) : "—"}</span>
                                </div>
                                <button type="button" onClick={() => setOpenMarketItemId(null)} aria-label="Close competitor details">Close</button>
                              </div>
                              {(item.competitors ?? []).length ? (
                                <div className={styles.competitorList}>
                                  {(item.competitors ?? []).map((competitor) => (
                                    <a key={`${item.id}-${competitor.listingId}`} href={competitor.url} target="_blank" rel="noreferrer" className={styles.competitorCard}>
                                      <div className={styles.competitorInfo}>
                                        <b>{competitor.title}</b>
                                        <small>ID {competitor.listingId} · {competitor.seller} · {competitor.condition}</small>
                                        {competitor.matchedOn.length ? <small>Matched: {competitor.matchedOn.join(", ")}</small> : null}
                                      </div>
                                      <div className={styles.priceBreakdown}>
                                        <span>Selling <b>{money(competitor.price, competitor.currency)}</b></span>
                                        <span>Shipping <b>{money(competitor.shipping, competitor.currency)}</b></span>
                                        <span>Landing <b>{money(landedAmount(competitor.price, competitor.shipping), competitor.currency)}</b></span>
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <div className={styles.inlineEmpty}>No competitors stored for this row.</div>
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
                                <div>
                                  <b>Selling price calculator</b>
                                  <span>{item.brand} · {item.partNumber}</span>
                                </div>
                                <button type="button" onClick={() => setOpenCalculatorItemId(null)} aria-label="Close calculator details">Close</button>
                              </div>
                              <BulkSellingCalculator item={item} targetMarginPercent={bulkJob.targetMarginPercent} onSavePrice={saveItemSellingPrice} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
