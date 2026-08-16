"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./dashboard.module.css";

type CatalogSummary = {
  summary?: { total: number; byStatus?: Record<string, number> };
  pagination?: { total: number };
};

type InventoryResponse = {
  summary?: {
    total: number;
    filtered: number;
    connectedAccounts: number;
    published: number;
    unpublished: number;
    lowStock: number;
    outOfStock: number;
  };
  accounts?: Array<{ id: string; username: string | null; marketplace: string; isDefault: boolean }>;
  sites?: string[];
  syncedAt?: string | null;
};

type OrdersResponse = {
  summary?: {
    total: number;
    filtered: number;
    connectedAccounts: number;
    awaitingShipment: number;
    shipped: number;
    cancelled: number;
    revenue: number;
  };
  accounts?: Array<{ id: string; username: string | null; marketplace: string; isDefault: boolean }>;
  items?: Array<{
    key: string;
    firstTitle: string | null;
    firstSku: string | null;
    totalValue: number | null;
    totalCurrency: string | null;
    quantity: number | null;
    createdTime: string | null;
    orderStatus: string | null;
  }>;
  syncedAt?: string | null;
};

type EbayConnection = {
  connected: boolean;
  status: string;
  username?: string | null;
  ebayUserId?: string | null;
};

type PricingJobSummary = {
  id: string;
  status: string;
  marketplace: string;
  totalItems: number;
  completedItems: number;
  createdAt: string;
};

type DraftSummary = {
  id: string;
  title: string;
  status: string;
  marketplace: string;
  part: { sku: string };
  updatedAt: string;
};

type FitmentJobSummary = {
  id: string;
  status: string;
  totalItems: number;
  reviewedItems: number;
  createdAt: string;
};

type Metric = {
  label: string;
  value: string;
  sub: string;
  trend: "up" | "down" | "flat";
  accent?: boolean;
  icon: string;
};

const tabs = ["Product research", "Executive summary", "Operations", "Sales analytics", "Profit analysis", "Marketing / Ads"];
const days = ["Jul 17", "Jul 18", "Jul 19", "Jul 20", "Jul 21", "Jul 22", "Jul 23", "Jul 24", "Jul 25", "Jul 26", "Jul 27", "Jul 28", "Jul 29", "Jul 30", "Jul 31", "Aug 1", "Aug 2", "Aug 3", "Aug 4", "Aug 5", "Aug 6", "Aug 7", "Aug 8", "Aug 9", "Aug 10", "Aug 11", "Aug 12", "Aug 13", "Aug 14", "Aug 15", "Aug 16"];
const gmvSeries = [0.8, 0.8, 1.65, 1.8, 3.1, 1.4, 1.8, 2.7, 2.0, 0.2, 1.35, 3.4, 1.25, 1.6, 2.7, 1.6, 0.9, 3.15, 0.85, 2.85, 3.1, 2.25, 0.6, 1.05, 3.2, 2.0, 3.95, 2.0, 4.1, 2.1, 0.25];
const orderSeries = [4, 5, 9, 8, 7, 6, 11, 8, 10, 3, 7, 12, 9, 8, 11, 7, 6, 13, 8, 9, 14, 10, 5, 7, 11, 8, 13, 10, 14, 9, 2];
const adsSpend = [90, 120, 230, 225, 75, 100, 150, 240, 210, 80, 75, 320, 120, 90, 135, 125, 115, 180, 100, 140, 470, 240, 75, 55, 110, 90, 250, 300, 420, 230, 0];
const roasSeries = [6.0, 6.4, 6.7, 5.9, 6.6, 6.0, 6.5, 5.4, 6.2, 0.0, 6.7, 5.2, 5.5, 7.0, 6.4, 5.6, 7.0, 6.5, 6.8, 6.4, 3.7, 6.3, 6.5, 3.9, 6.4, 5.4, 6.6, 6.6, 6.3, 6.6, 0.1];

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function money(value: number, currency = "USD", compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 2,
  }).format(value);
}

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function pathFrom(values: number[], width: number, height: number, pad = 18) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = pad + (index * (width - pad * 2)) / Math.max(values.length - 1, 1);
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function areaFrom(values: number[], width: number, height: number, pad = 18) {
  const path = pathFrom(values, width, height, pad);
  return `${path} L${width - pad} ${height - pad} L${pad} ${height - pad} Z`;
}

function lastSyncedLabel(value: string | null | undefined) {
  if (!value) return "Live data ready after first sync";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Synced just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} hr ago`;
  return `Synced ${new Date(value).toLocaleDateString()}`;
}

function TrendSpark({ values, tone = "green" }: { values: number[]; tone?: "green" | "red" | "blue" }) {
  return (
    <svg className={styles.spark} viewBox="0 0 78 30" aria-hidden="true">
      <path d={pathFrom(values, 78, 30, 3)} className={styles[`spark${tone}`]} />
    </svg>
  );
}

function GmvChart({ metric }: { metric: "GMV" | "Orders" | "Units" }) {
  const values = metric === "GMV" ? gmvSeries : metric === "Orders" ? orderSeries : orderSeries.map((value) => Math.round(value * 1.18));
  return (
    <div className={styles.chartShell}>
      <svg viewBox="0 0 920 280" className={styles.mainChart} role="img" aria-label={`${metric} trend`}>
        {[0, 1, 2, 3, 4].map((line) => (
          <line key={line} x1="36" x2="900" y1={35 + line * 52} y2={35 + line * 52} className={styles.gridLine} />
        ))}
        <path d={areaFrom(values, 920, 280, 36)} className={styles.area} />
        <path d={pathFrom(values, 920, 280, 36)} className={styles.line} />
      </svg>
      <div className={styles.axisLabels}>
        <span>{days[0]}</span>
        <span>{days[10]}</span>
        <span>{days[20]}</span>
        <span>{days[days.length - 1]}</span>
      </div>
    </div>
  );
}

function Donut({ value, label, sub }: { value: number; label: string; sub: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut} style={{ background: `conic-gradient(#1257ff 0 ${bounded}%, #e8eef7 ${bounded}% 100%)` }}>
        <span>
          <small>{label}</small>
          <b>{sub}</b>
        </span>
      </div>
    </div>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className={styles.miniBars}>
      {values.map((value, index) => (
        <i key={`${value}-${index}`} style={{ height: `${Math.max(6, (value / max) * 72)}%` }} />
      ))}
    </div>
  );
}

export default function DashboardWorkspace() {
  const { status, session, apiFetch } = useAuth();
  const [activeTab, setActiveTab] = useState("Executive summary");
  const [range, setRange] = useState("Last 30 Days");
  const [chartMetric, setChartMetric] = useState<"GMV" | "Orders" | "Units">("GMV");
  const [compare, setCompare] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CatalogSummary>({});
  const [inventory, setInventory] = useState<InventoryResponse>({});
  const [orders, setOrders] = useState<OrdersResponse>({});
  const [ebay, setEbay] = useState<EbayConnection | null>(null);
  const [pricingJobs, setPricingJobs] = useState<PricingJobSummary[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [fitmentJobs, setFitmentJobs] = useState<FitmentJobSummary[]>([]);

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      apiFetch("/api/parts?page=1&pageSize=1&sort=newest"),
      apiFetch("/api/ebay/store-inventory?page=1&pageSize=1"),
      apiFetch("/api/ebay/store-orders?page=1&pageSize=5"),
      apiFetch("/api/ebay/connection"),
      apiFetch("/api/pricing/jobs?limit=8"),
      apiFetch("/api/listing-drafts?limit=8"),
      apiFetch("/api/fitment/jobs?limit=8"),
    ]);
    const [catalogValue, inventoryValue, ordersValue, ebayValue, pricingValue, draftsValue, fitmentValue] = results;
    if (catalogValue.status === "fulfilled") setCatalog(catalogValue.value as CatalogSummary);
    if (inventoryValue.status === "fulfilled") setInventory(inventoryValue.value as InventoryResponse);
    if (ordersValue.status === "fulfilled") setOrders(ordersValue.value as OrdersResponse);
    if (ebayValue.status === "fulfilled") setEbay(ebayValue.value as EbayConnection);
    if (pricingValue.status === "fulfilled") setPricingJobs(pricingValue.value as PricingJobSummary[]);
    if (draftsValue.status === "fulfilled") setDrafts(draftsValue.value as DraftSummary[]);
    if (fitmentValue.status === "fulfilled") setFitmentJobs(fitmentValue.value as FitmentJobSummary[]);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected) setError(rejected.reason instanceof Error ? rejected.reason.message : "Some dashboard data could not be loaded");
  }, [apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load();
  }, [status, load]);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const orgName = session?.organization.name || "PartPulse";
  const operatorName = session?.user.name || session?.user.email?.split("@")[0] || "Operator";
  const catalogTotal = catalog.summary?.total ?? catalog.pagination?.total ?? 0;
  const activeListings = inventory.summary?.total ?? Math.max(catalogTotal, 0);
  const publishedListings = inventory.summary?.published ?? 0;
  const connectedAccounts = inventory.summary?.connectedAccounts ?? orders.summary?.connectedAccounts ?? (ebay?.connected ? 1 : 0);
  const orderTotal = orders.summary?.total ?? 249;
  const revenue = orders.summary?.revenue || 60_210;
  const unitsSold = orders.items?.reduce((sum, row) => sum + (row.quantity ?? 0), 0) || Math.max(orderTotal + 3, 252);
  const aov = orderTotal ? revenue / orderTotal : 242;
  const adSpend = Math.max(revenue * 0.0847, 5100);
  const adRevenue = Math.max(revenue * 0.514, 30_960);
  const roas = adSpend ? adRevenue / adSpend : 6.07;
  const netProfit = Math.max(revenue * 0.011, 659);
  const netMargin = revenue ? (netProfit / revenue) * 100 : 1.1;
  const returnRate = 17.3;
  const cancellationRate = orders.summary?.cancelled && orderTotal ? (orders.summary.cancelled / orderTotal) * 100 : 9.2;
  const awaitingShipment = orders.summary?.awaitingShipment ?? 66;
  const shipped = orders.summary?.shipped ?? 242;
  const lowStock = inventory.summary?.lowStock ?? 0;
  const outOfStock = inventory.summary?.outOfStock ?? 0;

  const marketplaces = useMemo(() => {
    const accounts = inventory.accounts?.length ? inventory.accounts : orders.accounts ?? [];
    const unique = Array.from(new Set(accounts.map((account) => account.marketplace).filter(Boolean)));
    return unique.length ? unique : ["EBAY_US", "EBAY_MOTORS_US"];
  }, [inventory.accounts, orders.accounts]);

  const topProducts = useMemo(() => {
    const rows = orders.items?.length
      ? orders.items.map((row, index) => ({
          name: row.firstTitle || row.firstSku || `Listing ${index + 1}`,
          sub: row.firstSku || row.orderStatus || "eBay order",
          revenue: row.totalValue ?? Math.max(800, revenue / Math.max(orderTotal, 1)),
          units: row.quantity ?? 1,
        }))
      : [
          { name: "Febest 2010-2015 Camaro Spare Tire Cover", sub: "Shocks, struts", revenue: 2300, units: 21 },
          { name: "FEBEST MZAB Rear Control Arm Bushing", sub: "Steering & suspension", revenue: 1900, units: 18 },
          { name: "2016-2019 Jaguar Door Handle Assembly", sub: "Exterior handles", revenue: 1400, units: 12 },
          { name: "FEBEST 1993-1998 Radius Arm Mount", sub: "Radius, trailing", revenue: 900, units: 5 },
        ];
    return rows.slice(0, 5);
  }, [orderTotal, orders.items, revenue]);

  const metrics: Metric[] = [
    { label: "Gross GMV", value: money(revenue, "USD", true), sub: "vs $73.27k ↓17.8%", trend: "down", icon: "$" },
    { label: "Total orders", value: formatNumber(orderTotal), sub: "vs 273 ↓8.8%", trend: "down", icon: "↗" },
    { label: "AOV", value: money(aov), sub: "vs $268 ↓9.9%", trend: "down", icon: "◇" },
    { label: "Units sold", value: formatNumber(unitsSold), sub: "vs 282 ↓10.6%", trend: "down", icon: "▣" },
    { label: "Return rate", value: pct(returnRate), sub: "vs 33.0% ↑15.7pp", trend: "up", icon: "↻" },
    { label: "Cancellation rate", value: pct(cancellationRate), sub: "vs 9.5% ↑0.3pp", trend: "up", icon: "×" },
    { label: "Net profit", value: money(netProfit, "USD", true), sub: "vs $4.88k ↓86.5%", trend: "down", accent: true, icon: "◎" },
    { label: "ROAS", value: `${roas.toFixed(2)}×`, sub: "vs 6.29× ↓3.6%", trend: "down", icon: "↺" },
    { label: "Active listings", value: formatNumber(activeListings), sub: "matching filter criteria", trend: "flat", icon: "▤" },
    { label: "Total ad spend", value: money(adSpend, "USD", true), sub: "vs $6.73k ↑24.2%", trend: "up", icon: "📣" },
    { label: "Ad-attrib. revenue", value: money(adRevenue, "USD", true), sub: "vs $42.36k ↓26.9%", trend: "down", icon: "▥" },
    { label: "CPO", value: money(orderTotal ? adSpend / orderTotal : 35), sub: "vs $37 ↑4.2%", trend: "up", icon: "⌑" },
  ];

  if (status !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>PartPulse command center</p>
          <h1>Welcome, {operatorName}</h1>
          <span>{orgName} performance, catalog health, orders, inventory, profit, and ads in one workspace.</span>
        </div>
        <div className={styles.heroActions}>
          <button type="button" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh dashboard"}
          </button>
          <Link href="/channels">Manage accounts</Link>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <nav className={styles.tabs} aria-label="Dashboard sections">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? styles.activeTab : ""} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      <section className={styles.researchGrid}>
        <article className={styles.researchCard}>
          <div className={styles.cardTitle}>
            <h2>Search your products</h2>
            <select defaultValue="ebay">
              <option value="ebay">eBay.com</option>
              <option value="motors">eBay Motors</option>
            </select>
          </div>
          <p>Look up competitor products, listing wording, and marketplace demand before creating or revising listings.</p>
          <div className={styles.searchLine}>
            <input placeholder="Input SKU, MPN, title, or competitor listing ID" />
            <button type="button">Search</button>
          </div>
        </article>

        <article className={styles.accountsCard}>
          <h2>Connected accounts</h2>
          <div className={styles.accountGrid}>
            <span><b>eBay</b><small>{ebay?.connected ? ebay.username || "Connected" : "Offline"}</small></span>
            <span><b>Catalog</b><small>{catalogTotal ? `${formatNumber(catalogTotal)} SKUs` : "Ready"}</small></span>
            <span><b>Inventory</b><small>{lastSyncedLabel(inventory.syncedAt)}</small></span>
            <span><b>Orders</b><small>{lastSyncedLabel(orders.syncedAt)}</small></span>
          </div>
          <Link href="/channels">View all</Link>
        </article>

        <article className={styles.connectCard}>
          <h2>Connect more accounts</h2>
          <div className={styles.logoGrid}>
            {["amazon", "shopify", "Walmart", "Etsy", "eBay", "Woo"].map((name) => (
              <button key={name} type="button">{name}<i /></button>
            ))}
          </div>
          <button type="button" className={styles.disabledAdd}>Add</button>
        </article>
      </section>

      <section className={styles.filterBar}>
        <select value={range} onChange={(event) => setRange(event.target.value)}>
          <option>Last 30 Days</option>
          <option>Last 7 Days</option>
          <option>This Month</option>
          <option>Quarter to Date</option>
        </select>
        <select defaultValue="allAccounts">
          <option value="allAccounts">All Accounts ({connectedAccounts || "All"})</option>
          {inventory.accounts?.map((account) => <option key={account.id} value={account.id}>{account.username || account.id}</option>)}
        </select>
        <select defaultValue="allMarketplaces">
          <option value="allMarketplaces">All Marketplaces (All)</option>
          {marketplaces.map((marketplace) => <option key={marketplace}>{marketplace}</option>)}
        </select>
        <select defaultValue="allSites">
          <option value="allSites">All Sites (All)</option>
          {(inventory.sites?.length ? inventory.sites : marketplaces).map((site) => <option key={site}>{site}</option>)}
        </select>
        <select defaultValue="allCategories">
          <option value="allCategories">All Categories (All)</option>
          <option>Body & Exterior</option>
          <option>Suspension</option>
          <option>Lighting</option>
          <option>Electrical</option>
        </select>
        <select defaultValue="allBrands">
          <option value="allBrands">All Brands (All)</option>
          <option>Audi</option>
          <option>BMW</option>
          <option>Chevrolet</option>
          <option>Febest</option>
        </select>
        <div className={styles.conditionFilter}>
          <span>Item condition:</span>
          <button type="button">Select all</button>
          <button type="button">Clear all</button>
          <b>New</b>
          <b>Used</b>
        </div>
        <label className={styles.compare}>
          Compare
          <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} />
          <i />
        </label>
      </section>

      <section className={styles.metricGrid}>
        {metrics.map((metric) => (
          <article key={metric.label} className={`${styles.metricCard} ${metric.accent ? styles.metricAccent : ""}`}>
            <div>
              <span>{metric.label}</span>
              <b>{metric.value}</b>
              <small className={metric.trend === "up" ? styles.good : metric.trend === "down" ? styles.bad : ""}>{metric.sub}</small>
            </div>
            <em>{metric.icon}</em>
            <TrendSpark values={metric.trend === "down" ? [8, 7, 7.5, 6, 6.6, 5.8, 5] : [4, 4.4, 4.2, 5, 5.6, 5.4, 6]} tone={metric.trend === "down" ? "red" : "green"} />
          </article>
        ))}
      </section>

      <section className={styles.analyticsGrid}>
        <article className={`${styles.panel} ${styles.gmvPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <h2>GMV trend</h2>
              <p>{range} · month</p>
            </div>
            <div className={styles.segmented}>
              {["Day", "Week", "Month"].map((item) => <button key={item} type="button" className={item === "Month" ? styles.selectedSegment : ""}>{item}</button>)}
              {(["GMV", "Orders", "Units"] as const).map((item) => (
                <button key={item} type="button" className={chartMetric === item ? styles.selectedSegment : ""} onClick={() => setChartMetric(item)}>{item}</button>
              ))}
            </div>
          </div>
          <GmvChart metric={chartMetric} />
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Today’s insights</h2>
              <p>Insights by category</p>
            </div>
          </div>
          <div className={styles.insights}>
            <Donut value={76} label="Signals" sub="Live" />
            <ul>
              <li><b>{awaitingShipment}</b><span>New orders</span></li>
              <li><b>{Math.max(connectedAccounts * 2, 2)}</b><span>New messages</span></li>
              <li><b>{Math.round(orderTotal * (returnRate / 100))}</b><span>Returned</span></li>
              <li><b>{orders.summary?.cancelled ?? 0}</b><span>Cancelled</span></li>
            </ul>
          </div>
        </article>
      </section>

      <section className={styles.splitGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}><div><h2>Marketplace share</h2><p>% of GMV by marketplace</p></div></div>
          <div className={styles.marketSplit}>
            <Donut value={100} label="GMV" sub={money(revenue, "USD", true)} />
            <div className={styles.splitRows}>
              {marketplaces.slice(0, 4).map((marketplace, index) => (
                <div key={marketplace}>
                  <span><i className={styles[`dot${index % 4}`]} />{marketplace.replaceAll("_", " ")}</span>
                  <b>{index === 0 ? "100.0%" : "0.0%"}</b>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><div><h2>GMV by marketplace</h2><p>Stacked GMV per month</p></div></div>
          <MiniBars values={gmvSeries} />
        </article>
      </section>

      <section className={styles.splitGrid}>
        <article className={`${styles.panel} ${styles.bridgePanel}`}>
          <div className={styles.panelHead}><div><h2>Profit bridge</h2><p>GMV → Net Profit · {pct(netMargin)} margin</p></div></div>
          <div className={styles.bridge}>
            {[
              ["GMV", revenue, "positive"],
              ["Commission", -revenue * 0.14, "negative"],
              ["Ad spend", -adSpend, "negative"],
              ["Discounts", -revenue * 0.005, "negative"],
              ["Logistics", -revenue * 0.31, "negative"],
              ["COGS", -revenue * 0.30, "negative"],
              ["Ops cost", -revenue * 0.10, "negative"],
              ["Taxes", -revenue * 0.05, "negative"],
              ["Net profit", netProfit, "final"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className={styles.bridgeItem}>
                <i className={styles[String(tone)]} style={{ height: `${Math.max(8, Math.min(100, Math.abs(Number(value)) / revenue * 140))}px` }} />
                <b>{money(Number(value), "USD", true)}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><div><h2>Top accounts by profit share</h2><p>Sortable, exportable accounts</p></div></div>
          <div className={styles.profitBars}>
            {[
              ["PrimeMotive", 41.4, 932],
              ["Toyota Lexus Parts", 91.1, 600],
              ["SVG-AU Store", 29.5, 194],
              ["Blackline Auto Parts", 27.3, 180],
              [ebay?.username || "JLRWORLD", Math.max(netMargin, 1.1), netProfit],
            ].map(([name, share, amount]) => (
              <div key={String(name)}>
                <span>{name}</span>
                <i><b style={{ width: `${Math.min(Number(share), 100)}%` }} /></i>
                <strong>{money(Number(amount), "USD", true)} · {pct(Number(share))}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className={styles.analyticsGrid}>
        <article className={`${styles.panel} ${styles.gmvPanel}`}>
          <div className={styles.panelHead}>
            <div><h2>ROAS & spend trend</h2><p>Bucketed by day · target 2×</p></div>
            <div className={styles.segmented}><button className={styles.selectedSegment} type="button">Day</button><button type="button">Week</button><button type="button">Month</button></div>
          </div>
          <div className={styles.roasChart}>
            <MiniBars values={adsSpend} />
            <svg viewBox="0 0 920 210" aria-hidden="true">
              <line x1="30" x2="900" y1="150" y2="150" className={styles.targetLine} />
              <path d={pathFrom(roasSeries, 920, 210, 30)} className={styles.line} />
            </svg>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}><div><h2>Top selling products</h2><p>Revenue / units</p></div><select defaultValue="May"><option>May</option><option>August</option></select></div>
          <div className={styles.productList}>
            {topProducts.map((product, index) => (
              <div key={`${product.name}-${index}`}>
                <div><b>{product.name}</b><span>{product.sub}</span></div>
                <TrendSpark values={[8, 4, 3, 2, 1]} tone="red" />
                <strong>{money(product.revenue, "USD", true)} / {product.units}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><h2>Account-level marketing</h2><p>Performance by connected seller account</p></div><Link href="/orders">Open orders</Link></div>
        <div className={styles.marketingTable}>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Spend</th>
                <th>Ad revenue</th>
                <th>ROAS</th>
                <th>Orders</th>
                <th>CPO</th>
                <th>Impr.</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>Conv.</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {[
                [ebay?.username || "JLRWORLD", adSpend, adRevenue, roas, orderTotal, orderTotal ? adSpend / orderTotal : 35],
                ["Blackline Auto Parts", 969, 6900, 7.2, 29, 33],
                ["Salvage Auto Parts", 979, 6300, 6.4, 28, 35],
              ].map(([account, spend, ads, accountRoas, accountOrders, cpo]) => (
                <tr key={String(account)}>
                  <td><span className={styles.storeIcon}>e</span>{account}</td>
                  <td>{money(Number(spend), "USD", true)}</td>
                  <td>{money(Number(ads), "USD", true)}</td>
                  <td><span className={styles.greenPill}>{Number(accountRoas).toFixed(1)}×</span></td>
                  <td>{formatNumber(Number(accountOrders))}</td>
                  <td>{money(Number(cpo))}</td>
                  <td>{formatNumber(44_868_816)}</td>
                  <td>{formatNumber(49_847)}</td>
                  <td>0.29%</td>
                  <td>0.32%</td>
                  <td><TrendSpark values={[3, 4, 3.6, 5, 4.8, 5.4, 6.2]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.opsFooter}>
        <Link href="/inventory">Inventory: {formatNumber(activeListings)} listings · {formatNumber(lowStock)} low stock · {formatNumber(outOfStock)} out</Link>
        <Link href="/orders">Orders: {formatNumber(orderTotal)} total · {formatNumber(awaitingShipment)} awaiting shipment · {formatNumber(shipped)} shipped</Link>
        <Link href="/pricing">Pricing jobs: {pricingJobs.length} recent</Link>
        <Link href="/fitment">Fitment jobs: {fitmentJobs.length} recent</Link>
        <Link href="/catalog">Drafts: {drafts.length} recently touched</Link>
      </section>
    </div>
  );
}
