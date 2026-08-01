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
  status: string;
  totalItems: number;
  completedItems: number;
  noMatchItems: number;
  failedItems: number;
  sourceFilename: string | null;
  lastError: string | null;
  items: BulkPricingItem[];
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

function visibleSellingFormula(item: BulkPricingItem) {
  if (item.marketRecommended === null || item.floorPrice === null || item.sellingPrice === null) return null;
  const visibleResult = Math.max(item.marketRecommended, item.floorPrice);
  if (Math.abs(visibleResult - item.sellingPrice) < 0.01) {
    return `Result: max(${money(item.marketRecommended, item.currency)}, ${money(item.floorPrice, item.currency)}) = ${money(item.sellingPrice, item.currency)}`;
  }
  return `Result: pricing rule output = ${money(item.sellingPrice, item.currency)} after market adjustment and margin-floor checks.`;
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

export default function PricingWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [oem, setOem] = useState("8K0615301M");
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [condition, setCondition] = useState<"ANY" | "NEW" | "USED">("ANY");
  const [bulkCurrency, setBulkCurrency] = useState("USD");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkJob, setBulkJob] = useState<BulkPricingJob | null>(null);
  const [openMarketItemId, setOpenMarketItemId] = useState<string | null>(null);
  const [openCalculatorItemId, setOpenCalculatorItemId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          ["PartNumber,Brand,CostPrice,Notes", "8K0615301M,Audi,45.00,Example rear caliper"].join("\n"),
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
        `/api/pricing/bulk?marketplace=${encodeURIComponent(marketplace)}&condition=${encodeURIComponent(condition)}&currency=${encodeURIComponent(bulkCurrency)}`,
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start bulk pricing");
    } finally {
      setBulkBusy(false);
    }
  }

  async function exportBulkResults() {
    if (!bulkJob) return;
    setError("");
    try {
      if (demo) {
        const header = "SKU,PartNumber,Brand,CostPrice,Currency,Condition,Marketplace,MatchCount,Lowest,Median,Highest,MarketRecommended,SellingPrice,FloorPrice,MarginPercent,Status,Error,CatalogMatch,Notes";
        const lines = bulkJob.items.map((item) => [
          item.sku, item.partNumber, item.brand, item.costPrice, item.currency, item.condition, bulkJob.marketplace,
          item.competitorCount, item.lowest, item.median, item.highest, item.marketRecommended, item.sellingPrice,
          item.floorPrice, item.marginPercent, item.status, item.error ?? "", item.catalogMatch ? "Yes" : "No", item.notes ?? "",
        ].join(","));
        downloadTextFile(`partpulse-bulk-pricing-${bulkJob.id}.csv`, [header, ...lines].join("\n"));
        return;
      }
      const csv = await apiFetch(`/api/pricing/bulk/${bulkJob.id}/export`) as string;
      downloadTextFile(`partpulse-bulk-pricing-${bulkJob.id}.csv`, csv);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to export results");
    }
  }

  if (authStatus !== "ready") return null;

  const bulkDone = bulkJob ? !["QUEUED", "RUNNING"].includes(bulkJob.status) : false;
  const bulkProgress = bulkJob
    ? Math.round(((bulkJob.completedItems + bulkJob.noMatchItems + bulkJob.failedItems) / Math.max(bulkJob.totalItems, 1)) * 100)
    : 0;

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
                <li>Upload SKU, part number, brand, and cost</li>
                <li>Exact eBay comps + org margin rules</li>
                <li>Download selling prices (max 50 rows)</li>
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
                <button type="submit" className={styles.primary} disabled={bulkBusy || !bulkFile}>
                  {bulkBusy ? "Uploading…" : "Run bulk pricing"}
                </button>
              </div>
              <p className={styles.bulkHint}>
                Required columns: PartNumber, Brand, CostPrice. Optional: Notes. Currency and condition are applied from this upload form.
              </p>
            </form>
          </section>

          {error && <div className={styles.error}>{error}</div>}
          {demo && !bulkJob && (
            <div className={styles.notice}>Development preview — upload any CSV to see sample bulk results.</div>
          )}

          {bulkJob && (
            <section className={styles.results} aria-live="polite">
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

              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Part</th>
                      <th>Cost</th>
                      <th>Market</th>
                      <th>Selling price</th>
                      <th>Margin</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkJob.items.map((item) => (
                      <Fragment key={item.id}>
                      <tr className={openMarketItemId === item.id || openCalculatorItemId === item.id ? styles.expandedSourceRow : undefined}>
                        <td>
                          <b>{item.sku}</b>
                          {item.catalogMatch ? <span className={styles.subtle}>Catalog match</span> : null}
                        </td>
                        <td>
                          {item.brand} · {item.partNumber}
                          <span className={styles.subtle}>{item.condition}</span>
                        </td>
                        <td>{money(item.costPrice, item.currency)}</td>
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
                              aria-label={`View competitors for ${item.sku}`}
                            >
                              {money(item.marketRecommended, item.currency)}
                            </button>
                          ) : "—"}
                          {item.competitorCount > 0 ? (
                            <span className={styles.subtle}>{item.competitorCount} comps · med {item.median != null ? money(item.median, item.currency) : "—"}</span>
                          ) : null}
                        </td>
                        <td>
                          {item.sellingPrice != null ? (
                            <button
                              type="button"
                              className={`${styles.priceAction} ${styles.sellingPriceAction}`}
                              onClick={() => {
                                setOpenCalculatorItemId((current) => current === item.id ? null : item.id);
                                setOpenMarketItemId(null);
                              }}
                              aria-expanded={openCalculatorItemId === item.id}
                              aria-label={`View selling price calculation for ${item.sku}`}
                            >
                              {money(item.sellingPrice, item.currency)}
                            </button>
                          ) : "—"}
                          {item.floorPrice != null ? (
                            <span className={styles.subtle}>Floor {money(item.floorPrice, item.currency)}</span>
                          ) : null}
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
                                  <span>{item.sku} · {item.partNumber}</span>
                                </div>
                                <button type="button" onClick={() => setOpenCalculatorItemId(null)} aria-label="Close calculator details">Close</button>
                              </div>
                              <div className={styles.calculatorPanel}>
                                <div className={styles.calculatorRow}><span>Cost</span><b>{money(item.costPrice, item.currency)}</b></div>
                                <div className={styles.calculatorRow}><span>Market estimate</span><b>{item.marketRecommended != null ? money(item.marketRecommended, item.currency) : "—"}</b></div>
                                <div className={styles.calculatorRow}><span>Margin floor price</span><b>{item.floorPrice != null ? money(item.floorPrice, item.currency) : "—"}</b></div>
                                <div className={styles.calculatorRow}><span>Selected selling price</span><b>{item.sellingPrice != null ? money(item.sellingPrice, item.currency) : "—"}</b></div>
                                <div className={styles.calculatorRow}>
                                  <span>Estimated gross profit</span>
                                  <b>{item.sellingPrice != null ? money(Math.round((item.sellingPrice - item.costPrice) * 100) / 100, item.currency) : "—"}</b>
                                </div>
                                <div className={styles.calculatorRow}><span>Estimated margin</span><b>{item.marginPercent != null ? `${item.marginPercent.toFixed(1)}%` : "—"}</b></div>
                              </div>
                              <div className={styles.formulaBox}>
                                <b>How PartPulse chose it</b>
                                <p>Market uses competitor selling prices only. Shipping is visible for review, but not included in the recommended selling price.</p>
                                {visibleSellingFormula(item) ? <span>{visibleSellingFormula(item)}</span> : null}
                              </div>
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
