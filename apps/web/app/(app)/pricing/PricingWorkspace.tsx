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
    <div className={styles.simpleCalculator}>
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

      <div className={styles.costBreakdownSimple}>
        <div className={styles.breakdownRow}>
          <span>Part cost</span>
          <b>{money(item.costPrice, item.currency)}</b>
        </div>
        <div className={styles.breakdownRow}>
          <span>Target profit ({targetMargin.toFixed(1).replace(/\.0$/, "")}% of selling price)</span>
          <b>{money(breakdown.targetProfit, item.currency)}</b>
        </div>
        <div className={styles.breakdownRow}>
          <span>eBay FVF fee</span>
          <b>{money(breakdown.ebayFeeTotal, item.currency)}</b>
        </div>
        <div className={styles.breakdownRow}>
          <span>Export & payment fees (1.3% exp + 2% pay + 1% buf + {money(0.4, item.currency)})</span>
          <b>{money(breakdown.exportPayoneerBufferFee, item.currency)}</b>
        </div>
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
          <b>{money(breakdown.grossProfitBeforeShipping, item.currency)} ({item.marginPercent === null ? "—" : `${item.marginPercent.toFixed(1)}% margin`})</b>
        </div>
        <div className={styles.breakdownRow}>
          <span>Shipping (estimate)</span>
          <b>{money(breakdown.shippingEstimate, item.currency)}</b>
        </div>
        <div className={`${styles.breakdownRow} ${styles.landedRow}`}>
          <span>Total landed cost <small>(Cost + Platform Fees + Shipping)</small></span>
          <b>{money(breakdown.totalLandedCost, item.currency)}</b>
        </div>
      </div>
    </div>
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
            if (price !== null && price > 0) {
              const breakdown = feeBreakdown(price, cost, it.currency, prev.targetMarginPercent ?? 20);
              marginPercent = Math.round(((breakdown.grossProfitBeforeShipping / price) * 100 + Number.EPSILON) * 100) / 100;
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

function getDemoHistoryJobs(): BulkPricingJob[] {
  return [
    {
      id: "bulk-job-demo-3",
      marketplace: "EBAY_US",
      defaultCondition: "NEW",
      targetMarginPercent: 20,
      status: "COMPLETED",
      totalItems: 249,
      completedItems: 249,
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
      status: "COMPLETED",
      totalItems: 112,
      completedItems: 112,
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
      status: "COMPLETED",
      totalItems: 16,
      completedItems: 16,
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
      status: "COMPLETED",
      totalItems: 16,
      completedItems: 16,
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
      status: "COMPLETED",
      totalItems: 16,
      completedItems: 16,
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
        setBulkHistory(getDemoHistoryJobs());
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
          setBulkHistory(jobs);
        } else {
          setBulkHistory(getDemoHistoryJobs());
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

function createDemoJobWithItems(jobId: string, histJob?: BulkPricingJob): BulkPricingJob {
  return {
    id: jobId,
    marketplace: histJob?.marketplace ?? "EBAY_US",
    defaultCondition: histJob?.defaultCondition ?? "USED",
    targetMarginPercent: histJob?.targetMarginPercent ?? 20,
    status: histJob?.status ?? "COMPLETED",
    totalItems: histJob?.totalItems ?? 6,
    completedItems: histJob?.completedItems ?? 5,
    noMatchItems: histJob?.noMatchItems ?? 1,
    failedItems: histJob?.failedItems ?? 0,
    sourceFilename: histJob?.sourceFilename ?? "partpulse-bulk-pricing-template.csv",
    lastError: null,
    items: [
      {
        id: `${jobId}-item-1`,
        rowNumber: 1,
        sku: "FEBEST-0282-F15R",
        partNumber: "0282-F15R",
        brand: "Febest",
        costPrice: 135.00,
        quantity: 3,
        currency: "USD",
        condition: "NEW",
        notes: "Wheel Hub-Nismo, FWD, Std Trans fits 12-13 Nissan Juke",
        catalogMatch: true,
        status: "COMPLETED",
        competitorCount: 4,
        lowest: 100.95,
        median: 120.70,
        highest: 180.77,
        marketRecommended: 118.28,
        sellingPrice: 180.00,
        floorPrice: 161.42,
        marginPercent: 12.2,
        competitors: [
          { listingId: "336012345678", title: "Wheel Hub-Nismo, FWD, Std Trans Febest 0282-F15R fits 12-13 Nissan Juke", seller: "thefinestautoparts", price: 100.95, shipping: 0, currency: "USD", condition: "NEW", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["OE/OEM Part Number"] },
          { listingId: "336098765432", title: "REAR WHEEL HUB FEBEST 0282-F15R OEM 43202-1KA0A", seller: "febestautoparts-usa", price: 128.20, shipping: 0, currency: "USD", condition: "NEW", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["Manufacturer Part Number"] },
          { listingId: "336098765433", title: "Febest 0282-F15R Rear Wheel Hub Fits Infiniti Nissan Esq Juke Leaf Nv200 Evalia", seller: "hfxparts24", price: 113.19, shipping: 67.58, currency: "USD", condition: "NEW", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["Manufacturer Part Number"] },
        ],
        error: null,
      },
      {
        id: `${jobId}-item-2`,
        rowNumber: 2,
        sku: "FEBEST-0176-ACU30F",
        partNumber: "0176-ACU30F",
        brand: "Febest",
        costPrice: 21.48,
        quantity: 1,
        currency: "USD",
        condition: "NEW",
        notes: "Front axle hub assembly",
        catalogMatch: false,
        status: "COMPLETED",
        competitorCount: 4,
        lowest: 14.44,
        median: 14.73,
        highest: 31.48,
        marketRecommended: 14.44,
        sellingPrice: 31.48,
        floorPrice: 26.25,
        marginPercent: 31.8,
        competitors: [
          { listingId: "335511223344", title: "Febest 0176-ACU30F Front Axle Hub Assembly", seller: "febestautoparts-usa", price: 14.44, shipping: 0, currency: "USD", condition: "NEW", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["OE/OEM Part Number"] },
        ],
        error: null,
      },
      {
        id: `${jobId}-item-3`,
        rowNumber: 3,
        sku: "FEBEST-KSB-PICF",
        partNumber: "KSB-PICF",
        brand: "Febest",
        costPrice: 2.31,
        quantity: 0,
        currency: "USD",
        condition: "NEW",
        notes: "Stabilizer bush kit",
        catalogMatch: false,
        status: "NO_MATCHES",
        competitorCount: 0,
        lowest: null,
        median: null,
        highest: null,
        marketRecommended: null,
        sellingPrice: null,
        floorPrice: 3.20,
        marginPercent: null,
        competitors: [],
        error: null,
      },
      {
        id: `${jobId}-item-4`,
        rowNumber: 4,
        sku: "FEBEST-FDAB-035",
        partNumber: "FDAB-035",
        brand: "Febest",
        costPrice: 14.41,
        quantity: 8,
        currency: "USD",
        condition: "NEW",
        notes: "Control arm bushing",
        catalogMatch: true,
        status: "COMPLETED",
        competitorCount: 4,
        lowest: 13.66,
        median: 13.93,
        highest: 24.41,
        marketRecommended: 13.66,
        sellingPrice: 24.41,
        floorPrice: 17.80,
        marginPercent: 41.0,
        competitors: [
          { listingId: "335511223355", title: "Febest FDAB-035 Control Arm Bushing OEM Replacement", seller: "fordparts_direct", price: 13.66, shipping: 0, currency: "USD", condition: "NEW", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["OE/OEM Part Number"] },
        ],
        error: null,
      },
      {
        id: `${jobId}-item-5`,
        rowNumber: 5,
        sku: "FEBEST-MM-N43ARR",
        partNumber: "MM-N43ARR",
        brand: "Febest",
        costPrice: 37.15,
        quantity: 4,
        currency: "USD",
        condition: "NEW",
        notes: "Engine mount rear",
        catalogMatch: false,
        status: "COMPLETED",
        competitorCount: 2,
        lowest: 32.96,
        median: 33.63,
        highest: 47.15,
        marketRecommended: 32.96,
        sellingPrice: 47.15,
        floorPrice: 44.20,
        marginPercent: 21.2,
        competitors: [
          { listingId: "335511223366", title: "Febest MM-N43ARR Rear Engine Mount Assembly", seller: "mitsubishiparts_us", price: 32.96, shipping: 0, currency: "USD", condition: "NEW", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["OE/OEM Part Number"] },
        ],
        error: null,
      },
      {
        id: `${jobId}-item-6`,
        rowNumber: 6,
        sku: "FEBEST-0217-C24",
        partNumber: "0217-C24",
        brand: "Febest",
        costPrice: 14.54,
        quantity: 10,
        currency: "USD",
        condition: "NEW",
        notes: "Ball joint boot kit",
        catalogMatch: false,
        status: "COMPLETED",
        competitorCount: 4,
        lowest: 21.64,
        median: 22.08,
        highest: 35.00,
        marketRecommended: 21.64,
        sellingPrice: 25.97,
        floorPrice: 24.54,
        marginPercent: 44.0,
        competitors: [
          { listingId: "222332154638", title: "Rear Upper Arm Ball Joint Boot FEBEST 0217-C24 OEM 48790-30052", seller: "febestautoparts-usa", price: 21.64, shipping: 0, currency: "USD", condition: "NEW", marketplace: "EBAY_US", url: "https://www.ebay.com", matchedOn: ["Manufacturer Part Number"] },
        ],
        error: null,
      },
    ],
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
          )}

          {error && <div className={styles.error}>{error}</div>}
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
                    {bulkJob.completedItems + bulkJob.noMatchItems + bulkJob.failedItems}/{bulkJob.totalItems} rows
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
                  <button type="button" className={styles.ghostBtn} onClick={() => setBulkJob(null)}>
                    Close job view
                  </button>
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
                              >
                                ✓
                              </button>
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
                          <span className={styles.pill}>{item.status.replaceAll("_", " ")}</span>
                          {item.error ? <span className={styles.subtle}>{item.error}</span> : null}
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
                    const processed = job.completedItems + job.noMatchItems + job.failedItems;
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
                        <button
                          type="button"
                          className={styles.openJobBtn}
                          disabled={openingJobId === job.id}
                          onClick={() => void openBulkHistoryJob(job.id)}
                        >
                          {openingJobId === job.id ? "Opening…" : "Open job"}
                        </button>
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
    </div>
  );
}
