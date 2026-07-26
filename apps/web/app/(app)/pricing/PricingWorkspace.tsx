"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { apiBase } from "../../lib/auth-session";
import styles from "./pricing.module.css";

type SearchResult = {
  oem: string;
  marketplace: string;
  conditionFilter: "ANY" | "NEW" | "USED";
  searchedAt: string;
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

const demoResult: SearchResult = {
  oem: "8K0615301M",
  marketplace: "EBAY_US",
  conditionFilter: "ANY",
  searchedAt: new Date().toISOString(),
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

export default function PricingWorkspace() {
  const { status: authStatus, token, demo } = useAuth();
  const [oem, setOem] = useState("8K0615301M");
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [condition, setCondition] = useState<"ANY" | "NEW" | "USED">("ANY");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      const response = await fetch(`${apiBase}/api/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ oem, marketplace, condition }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Search failed");
      setResult(data as SearchResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Pricing</h1>
          <p>Validate exact automotive part matches and turn active eBay listings into a clear pricing decision.</p>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Competitor price search</span>
          <h2>Know the market.<br />Price with confidence.</h2>
          <ul className={styles.trustList}>
            <li>Exact item-specific verification</li>
            <li>Own sellers excluded</li>
            <li>Shipping included</li>
          </ul>
        </div>

        <form className={styles.searchForm} onSubmit={search}>
          <label className={styles.oemField}>
            <span>OEM / MPN / Interchange number</span>
            <input
              value={oem}
              onChange={(event) => setOem(event.target.value)}
              placeholder="e.g. 8K0615301M"
              required
              autoComplete="off"
            />
          </label>
          <div className={styles.searchRow}>
            <label>
              <span>Marketplace</span>
              <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
                <option value="EBAY_US">eBay US</option>
                <option value="EBAY_GB">eBay UK</option>
                <option value="EBAY_DE">eBay DE</option>
              </select>
            </label>
            <label>
              <span>Condition</span>
              <select
                value={condition}
                onChange={(event) => setCondition(event.target.value as "ANY" | "NEW" | "USED")}
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
            <p>Landed low, median, and recommended price give you a clear decision.</p>
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
                  ["Lowest landed", result.analytics.lowest],
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
                      <th>Landed price</th>
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
                        <td><b className={styles.landed}>{money(item.landedPrice, item.currency)}</b></td>
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
    </div>
  );
}
