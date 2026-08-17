"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./dashboard.module.css";

type MetricFormat = "money" | "number" | "percent" | "multiple";
type RangeValue = "7d" | "30d" | "month" | "quarter";
type ConditionValue = "ALL" | "NEW" | "USED";

type ApiMetric = {
  current: number | null;
  previous: number | null;
  changePercent: number | null;
  format: MetricFormat;
  currency: string;
  note: string | null;
  available: boolean;
};

type DashboardAnalytics = {
  range: { value: RangeValue; label: string; start: string; end: string };
  generatedAt: string;
  filters: {
    accounts: Array<{ id: string; label: string; status: string; isDefault: boolean }>;
    marketplaces: string[];
    categories: Array<{ id: string; label: string; count: number }>;
    brands: string[];
  };
  connectedAccounts: { total: number; active: number; defaultAccountId: string | null };
  lastSynced: { inventory: string | null; orders: string | null };
  metrics: Record<string, ApiMetric>;
  insights: {
    awaitingShipment: number;
    shipped: number;
    cancelled: number;
    returned: number;
    newOrders: number;
    messages: number | null;
  };
  charts: {
    gmvTrend: Array<{ date: string; gmv: number; orders: number; units: number }>;
    marketplaceShare: Array<{ marketplace: string; value: number }>;
    categoryShare: Array<{ label: string; value: number }>;
    inventoryByMarketplace: Array<{ label: string; value: number }>;
    orderStatus: Array<{ label: string; value: number }>;
  };
  topProducts: Array<{ sku: string | null; title: string; revenue: number; units: number; orders: number }>;
  jobs: {
    pricing: Array<{ id: string; oem: string; marketplace: string; status: string; createdAt: string }>;
    bulkPricing: Array<{ id: string; fileName: string; marketplace: string; status: string; processedRows: number; totalRows: number; createdAt: string }>;
    fitment: Array<{ id: string; marketplace: string; status: string; processedRows: number; totalRows: number; createdAt: string }>;
    drafts: Array<{
      id: string;
      title: string;
      status: string;
      marketplace: string;
      price: number | string | null;
      currency: string;
      quantity: number;
      updatedAt: string;
      part: { sku: string; brand: string | null; primaryPartNumber: string | null };
    }>;
  };
  marketing: {
    configured: boolean;
    message: string;
    metrics: {
      roas: ApiMetric;
      adSpend: ApiMetric;
      adRevenue: ApiMetric;
      cpo: ApiMetric;
      ctr: ApiMetric;
      impressions: ApiMetric;
      clicks: ApiMetric;
      conversionRate: ApiMetric;
      adSpendToGmv: ApiMetric;
    };
    trend: Array<{ date: string; adSpend: number; roas: number | null; adRevenue: number; orders: number }>;
    quadrants: Array<{
      account: string;
      marketplace: string;
      spend: number;
      roas: number;
      orders: number;
      recommendation: "INVEST_MORE" | "SCALE" | "OPTIMIZE" | "PAUSE_RESTRUCTURE";
    }>;
    heatmap: Array<{ day: string; hours: Array<{ hour: string; roas: number | null; spend: number; revenue: number; orders: number }> }>;
    marketplaceComparison: Array<{ marketplace: string; spend: number; revenue: number; roas: number; ctr: number; conversionRate: number }>;
    accounts: Array<{
      account: string;
      marketplace: string;
      spend: number;
      adRevenue: number;
      roas: number;
      orders: number;
      cpo: number;
      impressions: number;
      clicks: number;
      ctr: number;
      conversionRate: number;
      spendTrend: number[];
      roasTrend: number[];
    }>;
  };
  profit: { configured: boolean; message: string; bridge: Array<{ label: string; value: number; type: string }> };
};

const tabs = ["Product research", "Executive summary", "Operations", "Sales analytics", "Profit analysis", "Marketing / Ads"];

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function money(value: number | null | undefined, currency = "USD", compact = false) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 2,
  }).format(value);
}

function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function formatMetric(metric: ApiMetric | undefined) {
  if (!metric || !metric.available || metric.current == null) return "-";
  if (metric.format === "money") return money(metric.current, metric.currency);
  if (metric.format === "percent") return pct(metric.current);
  if (metric.format === "multiple") return `${metric.current.toFixed(2)}x`;
  return formatNumber(metric.current);
}

function formatChange(metric: ApiMetric | undefined) {
  if (!metric) return { label: "No data", tone: "neutral" as const };
  if (!metric.available) return { label: metric.note ?? "Not configured", tone: "neutral" as const };
  if (metric.changePercent == null) return { label: "No comparison", tone: "neutral" as const };
  const positive = metric.changePercent >= 0;
  return {
    label: `${positive ? "+" : ""}${metric.changePercent.toFixed(1)}% vs previous period`,
    tone: positive ? ("good" as const) : ("bad" as const),
  };
}

function pathFrom(values: number[], width: number, height: number, pad = 18) {
  if (values.length === 0) return "";
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
  if (!path) return "";
  return `${path} L${width - pad} ${height - pad} L${pad} ${height - pad} Z`;
}

function lastSyncedLabel(value: string | null | undefined) {
  if (!value) return "Not synced yet";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Synced just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} hr ago`;
  return `Synced ${new Date(value).toLocaleDateString()}`;
}

function compactDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TrendSpark({ values, tone = "green" }: { values: number[]; tone?: "green" | "red" | "blue" }) {
  if (values.length === 0) return <span className={styles.metricUnavailable}>No trend</span>;
  return (
    <svg className={styles.spark} viewBox="0 0 78 30" aria-hidden="true">
      <path d={pathFrom(values, 78, 30, 3)} className={styles[`spark${tone}`]} />
    </svg>
  );
}

function GmvChart({ points, metric }: { points: DashboardAnalytics["charts"]["gmvTrend"]; metric: "gmv" | "orders" | "units" }) {
  const values = points.map((point) => point[metric]);
  const label = metric === "gmv" ? "GMV" : metric === "orders" ? "Orders" : "Units";
  if (values.length === 0 || values.every((value) => value === 0)) {
    return <div className={styles.emptyState}>No {label.toLowerCase()} data for the selected filters.</div>;
  }

  return (
    <div className={styles.chartShell}>
      <svg viewBox="0 0 920 280" className={styles.mainChart} role="img" aria-label={`${label} trend`}>
        {[0, 1, 2, 3, 4].map((line) => (
          <line key={line} x1="36" x2="900" y1={35 + line * 52} y2={35 + line * 52} className={styles.gridLine} />
        ))}
        <path d={areaFrom(values, 920, 280, 36)} className={styles.area} />
        <path d={pathFrom(values, 920, 280, 36)} className={styles.line} />
      </svg>
      <div className={styles.axisLabels}>
        <span>{points[0] ? compactDate(points[0].date) : ""}</span>
        <span>{points[Math.floor(points.length / 2)] ? compactDate(points[Math.floor(points.length / 2)].date) : ""}</span>
        <span>{points[points.length - 1] ? compactDate(points[points.length - 1].date) : ""}</span>
      </div>
    </div>
  );
}

function MarketingTrendChart({ points, currency }: { points: DashboardAnalytics["marketing"]["trend"]; currency: string }) {
  const spendValues = points.map((point) => point.adSpend);
  const roasValues = points.map((point) => point.roas ?? 0);
  const hasData = points.some((point) => point.adSpend > 0 || point.adRevenue > 0 || point.orders > 0 || point.roas != null);
  const maxSpend = Math.max(...spendValues, 1);

  if (!hasData) {
    return <EmptyPanel>No synced ad trend data yet. Once Marketing API reports are available, spend, ROAS, and ad revenue will render here.</EmptyPanel>;
  }

  return (
    <div className={styles.marketingTrend}>
      <svg viewBox="0 0 920 280" className={styles.mainChart} role="img" aria-label="ROAS and ad spend trend">
        {[0, 1, 2, 3, 4].map((line) => (
          <line key={line} x1="36" x2="900" y1={35 + line * 52} y2={35 + line * 52} className={styles.gridLine} />
        ))}
        {spendValues.map((value, index) => {
          const width = 14;
          const x = 40 + (index * 850) / Math.max(spendValues.length - 1, 1) - width / 2;
          const height = (value / maxSpend) * 190;
          return <rect key={`${points[index]?.date}-${index}`} x={x} y={244 - height} width={width} height={height} rx="5" className={styles.adSpendBar} />;
        })}
        <path d={pathFrom(roasValues, 920, 280, 36)} className={styles.line} />
      </svg>
      <div className={styles.axisLabels}>
        <span>{points[0] ? compactDate(points[0].date) : ""}</span>
        <span>Spend bars · ROAS line · {currency}</span>
        <span>{points[points.length - 1] ? compactDate(points[points.length - 1].date) : ""}</span>
      </div>
    </div>
  );
}

function MarketingQuadrants({ rows, currency }: { rows: DashboardAnalytics["marketing"]["quadrants"]; currency: string }) {
  if (rows.length === 0) {
    return <EmptyPanel>No campaign/account efficiency data yet. This will compare ad spend against ROAS and order volume.</EmptyPanel>;
  }

  const maxSpend = Math.max(...rows.map((row) => row.spend), 1);
  const maxRoas = Math.max(...rows.map((row) => row.roas), 1);

  return (
    <div className={styles.quadrantChart}>
      <span className={styles.quadrantLabelTopLeft}>Invest more</span>
      <span className={styles.quadrantLabelTopRight}>Scale</span>
      <span className={styles.quadrantLabelBottomLeft}>Pause / restructure</span>
      <span className={styles.quadrantLabelBottomRight}>Optimize</span>
      {rows.map((row) => {
        const left = 8 + (row.spend / maxSpend) * 84;
        const top = 88 - (row.roas / maxRoas) * 78;
        const size = Math.max(12, Math.min(34, 12 + row.orders));
        return (
          <span
            key={`${row.account}-${row.marketplace}`}
            className={styles.quadrantPoint}
            style={{ left: `${left}%`, top: `${top}%`, width: size, height: size }}
            title={`${row.account}: ${money(row.spend, currency)} spend, ${row.roas.toFixed(2)}x ROAS`}
          />
        );
      })}
    </div>
  );
}

function DayPartHeatmap({ rows }: { rows: DashboardAnalytics["marketing"]["heatmap"] }) {
  const hasData = rows.some((row) => row.hours.some((hour) => hour.roas != null));
  if (!hasData) {
    return <EmptyPanel>No day-part ROAS data yet. Hour/day performance will appear here after ad reports are synced.</EmptyPanel>;
  }

  const hours = rows[0]?.hours.map((hour) => hour.hour) ?? [];
  const max = Math.max(...rows.flatMap((row) => row.hours.map((hour) => hour.roas ?? 0)), 1);

  return (
    <div className={styles.heatmap}>
      <div className={styles.heatmapGrid} style={{ gridTemplateColumns: `64px repeat(${hours.length}, 1fr)` }}>
        <span />
        {hours.map((hour) => <b key={hour}>{hour}</b>)}
        {rows.map((row) => (
          <div className={styles.heatmapRow} key={row.day}>
            <strong>{row.day}</strong>
            {row.hours.map((hour) => {
              const intensity = hour.roas == null ? 0 : Math.max(0.12, hour.roas / max);
              return (
                <span
                  key={`${row.day}-${hour.hour}`}
                  className={styles.heatmapCell}
                  style={{ backgroundColor: hour.roas == null ? "#f4f7fb" : `rgba(18, 87, 255, ${Math.min(0.85, intensity)})` }}
                  title={`${row.day} ${hour.hour}: ${hour.roas == null ? "No data" : `${hour.roas.toFixed(1)}x ROAS`}`}
                >
                  {hour.roas == null ? "-" : hour.roas.toFixed(1)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketplaceAdComparison({ rows, currency }: { rows: DashboardAnalytics["marketing"]["marketplaceComparison"]; currency: string }) {
  if (rows.length === 0) {
    return <EmptyPanel>No marketplace ad comparison data yet.</EmptyPanel>;
  }

  return (
    <div className={styles.marketplaceAdCards}>
      {rows.map((row) => (
        <article key={row.marketplace}>
          <div>
            <b>{row.marketplace}</b>
            <span>{row.roas.toFixed(2)}x</span>
          </div>
          <dl>
            <dt>Spend</dt><dd>{money(row.spend, currency, true)}</dd>
            <dt>Ad revenue</dt><dd>{money(row.revenue, currency, true)}</dd>
            <dt>CTR</dt><dd>{pct(row.ctr)}</dd>
            <dt>Conv.</dt><dd>{pct(row.conversionRate)}</dd>
          </dl>
        </article>
      ))}
    </div>
  );
}

function AccountMarketingTable({ rows, currency }: { rows: DashboardAnalytics["marketing"]["accounts"]; currency: string }) {
  if (rows.length === 0) {
    return <EmptyPanel>No account-level marketing data connected yet. Sync ad reports to make this table sortable and exportable.</EmptyPanel>;
  }

  return (
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
            <th>Spend trend</th>
            <th>ROAS trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.account}-${row.marketplace}`}>
              <td><b>{row.account}</b><small>{row.marketplace}</small></td>
              <td>{money(row.spend, currency, true)}</td>
              <td>{money(row.adRevenue, currency, true)}</td>
              <td><span className={styles.roasBadge}>{row.roas.toFixed(1)}x</span></td>
              <td>{formatNumber(row.orders)}</td>
              <td>{money(row.cpo, currency)}</td>
              <td>{formatNumber(row.impressions)}</td>
              <td>{formatNumber(row.clicks)}</td>
              <td>{pct(row.ctr)}</td>
              <td>{pct(row.conversionRate)}</td>
              <td><TrendSpark values={row.spendTrend} tone="green" /></td>
              <td><TrendSpark values={row.roasTrend} tone="blue" /></td>
            </tr>
          ))}
        </tbody>
      </table>
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

function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className={styles.emptyState}>{children}</div>;
}

export default function DashboardWorkspace() {
  const { status, session, apiFetch } = useAuth();
  const [activeTab, setActiveTab] = useState("Executive summary");
  const [range, setRange] = useState<RangeValue>("30d");
  const [connectionId, setConnectionId] = useState("ALL");
  const [marketplace, setMarketplace] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [brand, setBrand] = useState("ALL");
  const [condition, setCondition] = useState<ConditionValue>("ALL");
  const [chartMetric, setChartMetric] = useState<"gmv" | "orders" | "units">("gmv");
  const [compare, setCompare] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);

  const loadDashboard = useCallback(async () => {
    if (status !== "ready") return;
    setRefreshing(true);
    setError("");
    try {
      const params = new URLSearchParams({ range, condition });
      if (connectionId !== "ALL") params.set("connectionId", connectionId);
      if (marketplace !== "ALL") params.set("marketplace", marketplace);
      if (category !== "ALL") params.set("category", category);
      if (brand !== "ALL") params.set("brand", brand);
      const response = await apiFetch(`/api/dashboard/analytics?${params.toString()}`) as DashboardAnalytics;
      setAnalytics(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load dashboard analytics");
    } finally {
      setRefreshing(false);
    }
  }, [apiFetch, brand, category, condition, connectionId, marketplace, range, status]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const chartValues = useMemo(() => analytics?.charts.gmvTrend.map((point) => point[chartMetric]) ?? [], [analytics, chartMetric]);
  const totalMarketplaceValue = useMemo(
    () => analytics?.charts.marketplaceShare.reduce((sum, item) => sum + item.value, 0) ?? 0,
    [analytics],
  );
  const dashboardCurrency = analytics?.metrics.grossGmv?.currency ?? "USD";

  const metricCards = analytics ? [
    { label: "Gross GMV", key: "grossGmv", icon: "$", accent: false },
    { label: "Total orders", key: "totalOrders", icon: "□", accent: false },
    { label: "AOV", key: "aov", icon: "◇", accent: false },
    { label: "Units sold", key: "unitsSold", icon: "▤", accent: false },
    { label: "Return rate", key: "returnRate", icon: "↻", accent: false },
    { label: "Cancellation rate", key: "cancellationRate", icon: "×", accent: false },
    { label: "Net profit", key: "netProfit", icon: "◎", accent: true },
    { label: "ROAS", key: "roas", icon: "↺", accent: false },
    { label: "Active listings", key: "activeListings", icon: "▣", accent: false },
    { label: "Ad spend", key: "adSpend", icon: "$", accent: false },
    { label: "Ad-attrib. revenue", key: "adRevenue", icon: "▥", accent: false },
    { label: "CPO", key: "cpo", icon: "⌑", accent: false },
    { label: "CTR", key: "ctr", icon: "%", accent: false },
    { label: "Impressions", key: "impressions", icon: "i", accent: false },
    { label: "Clicks", key: "clicks", icon: "+", accent: false },
    { label: "Conversion rate", key: "conversionRate", icon: "%", accent: false },
    { label: "Ad spend / GMV", key: "adSpendToGmv", icon: "%", accent: false },
  ] : [];

  const visibleMetricCards = [
    ...metricCards,
    { label: "Low stock", key: "lowStock", icon: "#", accent: false },
    { label: "Out of stock", key: "outOfStock", icon: "#", accent: false },
    { label: "Ready drafts", key: "readyDrafts", icon: "#", accent: false },
    { label: "Blocked drafts", key: "blockedDrafts", icon: "#", accent: false },
    { label: "Net margin", key: "netMargin", icon: "%", accent: false },
  ].filter((card) => {
    if (activeTab === "Executive summary") return ["grossGmv", "totalOrders", "aov", "unitsSold", "activeListings", "readyDrafts"].includes(card.key);
    if (activeTab === "Operations") return ["totalOrders", "unitsSold", "activeListings", "lowStock", "outOfStock", "blockedDrafts"].includes(card.key);
    if (activeTab === "Sales analytics") return ["grossGmv", "totalOrders", "aov", "unitsSold", "returnRate", "cancellationRate"].includes(card.key);
    if (activeTab === "Profit analysis") return ["grossGmv", "netProfit", "netMargin", "aov", "totalOrders", "unitsSold"].includes(card.key);
    if (activeTab === "Marketing / Ads") return ["roas", "adSpend", "adRevenue", "cpo", "ctr", "impressions", "clicks", "conversionRate", "adSpendToGmv"].includes(card.key);
    return false;
  });
  const showFilters = activeTab !== "Product research";
  const showExecutive = activeTab === "Executive summary";
  const showOperations = activeTab === "Operations";
  const showSales = activeTab === "Sales analytics";
  const showProfit = activeTab === "Profit analysis";
  const showMarketing = activeTab === "Marketing / Ads";

  if (status !== "ready") {
    return null;
  }

  const workspaceName = session?.organization.name ?? "Workspace";
  const userName = session?.user.name || session?.user.email || "there";

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>PartPulse analytics</p>
          <h1>Welcome, {userName}</h1>
          <p>Live operating dashboard for {workspaceName}: orders, inventory, catalog readiness, pricing, fitment, and connected eBay stores.</p>
          {analytics ? <span className={styles.syncPill}>Orders {lastSyncedLabel(analytics.lastSynced.orders)} · Inventory {lastSyncedLabel(analytics.lastSynced.inventory)}</span> : null}
        </div>
        <div className={styles.heroActions}>
          <button type="button" onClick={() => void loadDashboard()} disabled={refreshing}>{refreshing ? "Refreshing..." : "Refresh dashboard"}</button>
          <Link href="/channels">Manage accounts</Link>
        </div>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      <nav className={styles.tabs} aria-label="Dashboard sections">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? styles.activeTab : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === "Product research" ? <section className={styles.researchGrid}>
        <article className={styles.researchCard}>
          <div className={styles.panelHead}>
            <div>
              <h2>Search your products</h2>
              <p>Jump into PartPulse pricing or catalog review using live workspace data.</p>
            </div>
            <select value="ebay" aria-label="Product research source" onChange={() => undefined}>
              <option value="ebay">eBay</option>
            </select>
          </div>
          <div className={styles.searchLine}>
            <input placeholder="Search by SKU, part number, title, or brand" />
            <Link href="/pricing">Search</Link>
          </div>
        </article>

        <article className={styles.accountsCard}>
          <h2>Connected accounts</h2>
          <div className={styles.accountGrid}>
            {(analytics?.filters.accounts ?? []).slice(0, 4).map((account) => (
              <span key={account.id}>
                <b>{account.label}</b>
                <small>{account.status}{account.isDefault ? " · default" : ""}</small>
              </span>
            ))}
            {analytics && analytics.filters.accounts.length === 0 ? <small>No connected eBay accounts yet.</small> : null}
          </div>
          <Link href="/channels">View all</Link>
        </article>

        <article className={styles.connectCard}>
          <h2>Connect more accounts</h2>
          <div className={styles.logoGrid}>
            {["eBay", "Amazon", "Shopify", "Walmart", "Etsy", "Woo"].map((platform) => (
              <span key={platform}>{platform}</span>
            ))}
          </div>
          <Link href="/channels">Add account</Link>
        </article>
      </section> : null}

      {showFilters ? <section className={styles.filterBar}>
        <select value={range} onChange={(event) => setRange(event.target.value as RangeValue)} aria-label="Date range">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="quarter">This quarter</option>
        </select>
        <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} aria-label="Account">
          <option value="ALL">All accounts</option>
          {(analytics?.filters.accounts ?? []).map((account) => (
            <option key={account.id} value={account.id}>{account.label}</option>
          ))}
        </select>
        <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)} aria-label="Marketplace">
          <option value="ALL">All marketplaces</option>
          {(analytics?.filters.marketplaces ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
          <option value="ALL">All categories</option>
          {(analytics?.filters.categories ?? []).map((item) => <option key={item.id} value={item.id}>{item.label} ({item.count})</option>)}
        </select>
        <select value={brand} onChange={(event) => setBrand(event.target.value)} aria-label="Brand">
          <option value="ALL">All brands</option>
          {(analytics?.filters.brands ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <label className={styles.compare}>
          Compare
          <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
        <div className={styles.conditionFilter}>
          <span>Item condition:</span>
          {(["ALL", "NEW", "USED"] as const).map((item) => (
            <button key={item} type="button" className={condition === item ? styles.selectedSegment : ""} onClick={() => setCondition(item)}>
              {item === "ALL" ? "All" : item === "NEW" ? "New" : "Used"}
            </button>
          ))}
        </div>
      </section> : null}

      {!analytics ? (
        <section className={styles.panel}><EmptyPanel>Loading dashboard analytics...</EmptyPanel></section>
      ) : (
        <>
          {visibleMetricCards.length ? <section className={styles.metricGrid}>
            {visibleMetricCards.map((card) => {
              const marketingMetric = showMarketing ? analytics.marketing.metrics[card.key as keyof DashboardAnalytics["marketing"]["metrics"]] : undefined;
              const metricValue = marketingMetric ?? analytics.metrics[card.key];
              const change = formatChange(metricValue);
              return (
                <article key={card.key} className={`${styles.metricCard} ${card.accent ? styles.metricAccent : ""}`}>
                  <div>
                    <p>{card.label}</p>
                    <h3>{formatMetric(metricValue)}</h3>
                    <span className={change.tone === "good" ? styles.good : change.tone === "bad" ? styles.bad : styles.neutral}>{change.label}</span>
                  </div>
                  <i>{card.icon}</i>
                  <TrendSpark values={chartValues} tone={card.accent ? "blue" : change.tone === "bad" ? "red" : "green"} />
                </article>
              );
            })}
          </section> : null}

          {showExecutive || showSales || showOperations ? <section className={styles.analyticsGrid}>
            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>{showOperations ? "Order and unit trend" : "GMV trend"}</h2>
                  <p>{analytics.range.label} · real cached eBay order data</p>
                </div>
                <div className={styles.segmented}>
                  {(["gmv", "orders", "units"] as const).map((item) => (
                    <button key={item} type="button" className={chartMetric === item ? styles.selectedSegment : ""} onClick={() => setChartMetric(item)}>
                      {item.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <GmvChart points={analytics.charts.gmvTrend} metric={chartMetric} />
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Today&apos;s insights</h2>
                  <p>Operational counts from synced order cache.</p>
                </div>
              </div>
              <div className={styles.insights}>
                <Donut value={analytics.metrics.totalOrders.current ? (analytics.insights.awaitingShipment / analytics.metrics.totalOrders.current) * 100 : 0} label="Awaiting" sub={formatNumber(analytics.insights.awaitingShipment)} />
                <ul>
                  <li><b>{formatNumber(analytics.insights.newOrders)}</b><span>New / awaiting shipment orders</span></li>
                  <li><b>{formatNumber(analytics.insights.shipped)}</b><span>Shipped orders</span></li>
                  <li><b>{formatNumber(analytics.insights.returned)}</b><span>Returned / refunded orders</span></li>
                  <li><b>{formatNumber(analytics.insights.cancelled)}</b><span>Cancelled orders</span></li>
                </ul>
              </div>
            </article>
          </section> : null}

          {showExecutive || showSales ? <section className={styles.splitGrid}>
            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Marketplace share</h2>
                  <p>GMV by marketplace for the selected period.</p>
                </div>
              </div>
              {analytics.charts.marketplaceShare.length ? (
                <div className={styles.marketSplit}>
                  <Donut value={100} label="GMV" sub={money(totalMarketplaceValue, dashboardCurrency, true)} />
                  <div className={styles.splitRows}>
                    {analytics.charts.marketplaceShare.map((item, index) => {
                      const share = totalMarketplaceValue > 0 ? (item.value / totalMarketplaceValue) * 100 : 0;
                      return (
                        <div key={item.marketplace}>
                          <span><i className={styles[`dot${index % 4}`]} />{item.marketplace}</span>
                          <b>{share.toFixed(1)}%</b>
                          <small>{money(item.value, dashboardCurrency, true)}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : <EmptyPanel>No marketplace revenue for the selected filters.</EmptyPanel>}
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Listing share by category</h2>
                  <p>Synced inventory distribution.</p>
                </div>
              </div>
              {analytics.charts.categoryShare.length ? (
                <div className={styles.splitRows}>
                  {analytics.charts.categoryShare.map((item, index) => (
                    <div key={item.label}>
                      <span><i className={styles[`dot${index % 4}`]} />Category {item.label}</span>
                      <b>{formatNumber(item.value)}</b>
                    </div>
                  ))}
                </div>
              ) : <EmptyPanel>No category data in synced inventory yet.</EmptyPanel>}
            </article>
          </section> : null}

          {showExecutive || showProfit ? <section className={styles.splitGrid}>
            <article className={`${styles.panel} ${styles.bridgePanel}`}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Profit analysis</h2>
                  <p>{analytics.profit.configured ? "GMV to net profit bridge." : analytics.profit.message}</p>
                </div>
              </div>
              <div className={styles.bridge}>
                {analytics.profit.bridge.map((item) => (
                  <div key={item.label} className={styles.bridgeItem}>
                    <span>{item.label}</span>
                    <b>{money(item.value, dashboardCurrency, true)}</b>
                  </div>
                ))}
                {!analytics.profit.configured ? <p className={styles.metricUnavailable}>Connect cost, shipping, fee, tax, and ad spend sources to complete this section.</p> : null}
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Top selling products</h2>
                  <p>Ranked by order revenue in the selected period.</p>
                </div>
              </div>
              {analytics.topProducts.length ? (
                <div className={styles.productList}>
                  {analytics.topProducts.map((item) => (
                    <div key={`${item.sku ?? item.title}-${item.revenue}`}>
                      <span>
                        <b>{item.title}</b>
                        <small>{item.sku ?? "No SKU"} · {formatNumber(item.orders)} orders · {formatNumber(item.units)} units</small>
                      </span>
                      <strong>{money(item.revenue, dashboardCurrency, true)}</strong>
                    </div>
                  ))}
                </div>
              ) : <EmptyPanel>No product sales found for this period.</EmptyPanel>}
            </article>
          </section> : null}

          {showMarketing ? <section className={styles.marketingStack}>
            <article className={`${styles.panel} ${styles.marketingNotice}`}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Marketing / Ads</h2>
                  <p>{analytics.marketing.message}</p>
                </div>
                <Link href="/channels">Manage ad access</Link>
              </div>
            </article>

            <section className={styles.analyticsGrid}>
              <article className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>ROAS & spend trend</h2>
                    <p>Ad spend bars with ROAS line for the selected period.</p>
                  </div>
                  <div className={styles.segmented}>
                    <button type="button" className={styles.selectedSegment}>Day</button>
                    <button type="button">Week</button>
                    <button type="button">Month</button>
                  </div>
                </div>
                <MarketingTrendChart points={analytics.marketing.trend} currency={dashboardCurrency} />
              </article>

              <article className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Marketplace ad comparison</h2>
                    <p>Spend, revenue, and efficiency across marketplaces.</p>
                  </div>
                </div>
                <MarketplaceAdComparison rows={analytics.marketing.marketplaceComparison} currency={dashboardCurrency} />
              </article>
            </section>

            <section className={styles.splitGrid}>
              <article className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Ad efficiency quadrants</h2>
                    <p>Each bubble is one account-marketplace segment sized by orders.</p>
                  </div>
                </div>
                <MarketingQuadrants rows={analytics.marketing.quadrants} currency={dashboardCurrency} />
              </article>

              <article className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Day-part ROAS heatmap</h2>
                    <p>Hour of day by weekday for the selected period.</p>
                  </div>
                </div>
                <DayPartHeatmap rows={analytics.marketing.heatmap} />
              </article>
            </section>

            <article className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>Account-level marketing</h2>
                  <p>Sortable, export-ready advertising performance by connected account.</p>
                </div>
              </div>
              <AccountMarketingTable rows={analytics.marketing.accounts} currency={dashboardCurrency} />
            </article>
          </section> : null}

          {showExecutive || showOperations ? <section className={styles.opsFooter}>
            <article className={styles.panel}>
              <h2>Catalog readiness</h2>
              <div className={styles.productList}>
                <div><span><b>Catalog parts</b><small>All saved workspace parts</small></span><strong>{formatMetric(analytics.metrics.catalogParts)}</strong></div>
                <div><span><b>Ready drafts</b><small>Ready for publish review</small></span><strong>{formatMetric(analytics.metrics.readyDrafts)}</strong></div>
                <div><span><b>Blocked drafts</b><small>Need fixes before publishing</small></span><strong>{formatMetric(analytics.metrics.blockedDrafts)}</strong></div>
              </div>
            </article>
            <article className={styles.panel}>
              <h2>Recent automation</h2>
              <div className={styles.productList}>
                {analytics.jobs.bulkPricing.slice(0, 3).map((job) => (
                  <div key={job.id}>
                    <span><b>{job.fileName}</b><small>Bulk pricing · {job.marketplace}</small></span>
                    <strong>{job.processedRows}/{job.totalRows}</strong>
                  </div>
                ))}
                {analytics.jobs.bulkPricing.length === 0 ? <EmptyPanel>No recent bulk pricing jobs.</EmptyPanel> : null}
              </div>
            </article>
          </section> : null}
        </>
      )}
    </main>
  );
}
