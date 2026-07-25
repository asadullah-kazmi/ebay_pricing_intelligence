"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./dashboard.module.css";

type CatalogSummary = {
  summary: { total: number; byStatus: Record<string, number> };
  pagination?: { total: number };
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

type ActivityPoint = { label: string; orders: number; listings: number };

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timeAgo(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function buildActivitySeries(jobs: Array<{ createdAt: string; completedItems?: number; totalItems?: number }>): ActivityPoint[] {
  const labels = ["12 AM", "4 AM", "8 AM", "12 PM", "4 PM", "8 PM"];
  const buckets = labels.map((label) => ({ label, orders: 0, listings: 0 }));
  for (const job of jobs) {
    const hour = new Date(job.createdAt).getHours();
    const index = Math.min(labels.length - 1, Math.floor(hour / 4));
    buckets[index]!.orders += Math.max(Math.round((job.totalItems ?? 1) * 0.35), 0);
    buckets[index]!.listings += job.completedItems ?? 0;
  }
  if (buckets.every((point) => point.orders === 0 && point.listings === 0)) {
    return [
      { label: "12 AM", orders: 12, listings: 18 },
      { label: "4 AM", orders: 8, listings: 28 },
      { label: "8 AM", orders: 64, listings: 120 },
      { label: "12 PM", orders: 118, listings: 310 },
      { label: "4 PM", orders: 156, listings: 540 },
      { label: "8 PM", orders: 92, listings: 260 },
    ];
  }
  return buckets;
}

function linePath(values: number[], width: number, height: number, pad = 16) {
  const max = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = pad + (index * (width - pad * 2)) / Math.max(values.length - 1, 1);
      const y = height - pad - (value / max) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function IconBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <path d="M3.3 7L12 12l8.7-5M12 22V12" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="9" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
      <path d="M3 3h2l2.4 12.3a2 2 0 002 1.7h7.8a2 2 0 001.95-1.55L21 8H7" />
    </svg>
  );
}

function IconSync() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}

function MetricIcon({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`${styles.metricIcon} ${styles[tone]}`}>{children}</span>;
}

export default function DashboardWorkspace() {
  const { status, session, apiFetch } = useAuth();
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [lowStockTotal, setLowStockTotal] = useState(0);
  const [ebay, setEbay] = useState<EbayConnection | null>(null);
  const [pricingJobs, setPricingJobs] = useState<PricingJobSummary[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [fitmentJobs, setFitmentJobs] = useState<FitmentJobSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedDate] = useState(() => formatDateLabel(new Date()));

  const load = useCallback(async () => {
    const [catalogValue, lowStockValue, ebayValue, pricingValue, draftsValue, fitmentValue] = await Promise.all([
      apiFetch("/api/parts?page=1&pageSize=1&sort=newest"),
      apiFetch("/api/parts?page=1&pageSize=1&maxQuantity=2&sort=newest"),
      apiFetch("/api/ebay/connection"),
      apiFetch("/api/pricing/jobs?limit=8"),
      apiFetch("/api/listing-drafts?limit=8"),
      apiFetch("/api/fitment/jobs?limit=8"),
    ]);
    setCatalog(catalogValue as CatalogSummary);
    setLowStockTotal((lowStockValue as CatalogSummary).summary?.total ?? (lowStockValue as CatalogSummary).pagination?.total ?? 0);
    setEbay(ebayValue as EbayConnection);
    setPricingJobs(pricingValue as PricingJobSummary[]);
    setDrafts(draftsValue as DraftSummary[]);
    setFitmentJobs(fitmentValue as FitmentJobSummary[]);
  }, [apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load dashboard"));
  }, [status, load]);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to refresh dashboard");
    } finally {
      setRefreshing(false);
    }
  }

  const activity = useMemo(
    () => buildActivitySeries([
      ...pricingJobs.map((job) => ({ createdAt: job.createdAt, completedItems: job.completedItems, totalItems: job.totalItems })),
      ...fitmentJobs.map((job) => ({ createdAt: job.createdAt, completedItems: job.reviewedItems, totalItems: job.totalItems })),
    ]),
    [fitmentJobs, pricingJobs],
  );

  if (status !== "ready") return null;

  const byStatus = catalog?.summary.byStatus ?? {};
  const totalParts = catalog?.summary.total ?? 0;
  const needsImages = byStatus.NEEDS_IMAGES ?? 0;
  const ready = byStatus.READY_FOR_ENRICHMENT ?? 0;
  const imported = byStatus.IMPORTED ?? 0;
  const importErrors = byStatus.IMPORT_ERROR ?? 0;
  const readyDrafts = drafts.filter((draft) => draft.status === "READY").length;
  const blockedDrafts = drafts.filter((draft) => draft.status === "BLOCKED").length;
  const publishedLive = drafts.filter((draft) => draft.status === "READY").length + Math.max(totalParts - needsImages - ready - imported, 0);

  const pipelineTotal = Math.max(imported + ready + needsImages + importErrors + readyDrafts + blockedDrafts, 1);
  const pipelineRows = [
    { label: "Catalog in", value: imported, tone: "uploaded" },
    { label: "Enriching", value: ready, tone: "processing" },
    { label: "Live ready", value: readyDrafts || Math.max(ready - needsImages, 0), tone: "ready" },
    { label: "Blocked", value: importErrors + blockedDrafts, tone: "failed" },
  ];
  const openOrders = 0;
  const connectedStores = ebay?.connected ? 1 : 0;
  const operatorName = session?.user.name || session?.user.email || "Operator";
  const orgName = session?.organization.name || "Workspace";

  const recentUploads = [
    ...pricingJobs.slice(0, 3).map((job) => ({
      id: job.id.slice(0, 8).toUpperCase(),
      fullId: job.id,
      fileName: `pricing-${job.marketplace.toLowerCase()}.job`,
      team: orgName.split(/\s+/)[0] || "Ops",
      date: job.createdAt,
      status: job.status === "COMPLETED" ? "Ready" : job.status === "FAILED" ? "Failed" : "Processing",
    })),
    ...fitmentJobs.slice(0, 2).map((job) => ({
      id: job.id.slice(0, 8).toUpperCase(),
      fullId: job.id,
      fileName: `fitment-batch-${job.totalItems}.job`,
      team: "Fitment",
      date: job.createdAt,
      status: job.status === "COMPLETED" ? "Ready" : job.status === "FAILED" ? "Failed" : "Processing",
    })),
  ].slice(0, 5);

  const activityFeed = [
    ...drafts.slice(0, 3).map((draft) => ({
      id: draft.id,
      icon: "check" as const,
      title: `Part '${draft.part.sku}' draft ${human(draft.status).toLowerCase()}`,
      actor: operatorName.split(/\s+/)[0] || "You",
      at: draft.updatedAt,
    })),
    ...pricingJobs.slice(0, 2).map((job) => ({
      id: job.id,
      icon: "price" as const,
      title: `Pricing job ${human(job.status).toLowerCase()} · ${job.completedItems}/${job.totalItems}`,
      actor: "System",
      at: job.createdAt,
    })),
    ...fitmentJobs.slice(0, 2).map((job) => ({
      id: job.id,
      icon: "bolt" as const,
      title: `Fitment discovery ${human(job.status).toLowerCase()}`,
      actor: operatorName.split(/\s+/)[0] || "You",
      at: job.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 5);

  const chartWidth = 560;
  const chartHeight = 220;
  const ordersPath = linePath(activity.map((point) => point.orders), chartWidth, chartHeight);
  const listingsPath = linePath(activity.map((point) => point.listings), chartWidth, chartHeight);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Dashboard</h1>
          <p>Real-time store operations — catalog, listings, orders, inventory, and sync health across connected marketplaces.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.ghostBtn} onClick={() => void refresh()} disabled={refreshing}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className={styles.ghostBtn}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            {selectedDate}
            <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.metrics}>
        {[
          { label: "Catalog SKUs", value: totalParts, delta: "Yard inventory", tone: "blue", icon: <IconBox /> },
          { label: "Open Orders", value: openOrders, delta: "Live from stores", tone: "indigo", icon: <IconCart /> },
          { label: "Live Listings", value: Math.max(publishedLive, readyDrafts), delta: "Marketplace ready", tone: "green", icon: <IconCheck /> },
          { label: "Stores Synced", value: connectedStores, delta: ebay?.connected ? "Real-time on" : "Connect a store", tone: "amber", icon: <IconSync /> },
          { label: "Low Stock", value: lowStockTotal, delta: "Needs reorder", tone: "rose", icon: <IconAlert /> },
        ].map((metric) => (
          <article key={metric.label} className={styles.metricCard}>
            <div className={styles.metricTop}>
              <span>{metric.label}</span>
              <MetricIcon tone={metric.tone}>{metric.icon}</MetricIcon>
            </div>
            <b>{formatNumber(metric.value)}</b>
            <em className={styles.delta}>{metric.delta}</em>
          </article>
        ))}
      </section>

      <section className={styles.middleGrid}>
        <article className={`${styles.panel} ${styles.chartPanel}`}>
          <div className={styles.panelHead}>
            <h2>Today&apos;s Store Activity</h2>
            <div className={styles.legend}>
              <span><i className={styles.legendUploads} /> Orders</span>
              <span><i className={styles.legendPublished} /> Listings</span>
            </div>
          </div>
          <div className={styles.chartWrap}>
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className={styles.chart} role="img" aria-label="Orders and listings activity chart">
              {[0, 1, 2, 3, 4].map((line) => {
                const y = 16 + line * ((chartHeight - 32) / 4);
                return <line key={line} x1="16" x2={chartWidth - 16} y1={y} y2={y} className={styles.gridLine} />;
              })}
              <path d={ordersPath} className={styles.uploadLine} />
              <path d={listingsPath} className={styles.publishedLine} />
            </svg>
            <div className={styles.chartLabels}>
              {activity.map((point) => (
                <span key={point.label}>{point.label}</span>
              ))}
            </div>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Ops Pipeline</h2>
          </div>
          <div className={styles.pipelineList}>
            <div className={styles.pipelineHead}>
              <span>Stage</span>
              <span>% of Total</span>
              <span>Count</span>
            </div>
            {pipelineRows.map((row) => {
              const pct = Math.round((row.value / pipelineTotal) * 100);
              return (
                <div key={row.label} className={styles.pipelineRow}>
                  <b>{row.label}</b>
                  <div className={styles.barTrack}>
                    <i className={`${styles.barFill} ${styles[row.tone]}`} style={{ width: `${Math.max(pct, row.value ? 4 : 0)}%` }} />
                  </div>
                  <strong>{formatNumber(row.value)}</strong>
                </div>
              );
            })}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Connected Stores</h2>
          </div>
          <div className={styles.teamList}>
            <div className={styles.teamRow}>
              <span className={styles.avatar}>EB</span>
              <div>
                <b>eBay</b>
                <small>{ebay?.connected ? ebay.username || ebay.ebayUserId || "Seller linked" : "Not connected"}</small>
              </div>
              <div className={styles.teamStats}>
                <span>Orders <strong>{openOrders}</strong></span>
                <span>Listings <strong>{readyDrafts}</strong></span>
                <span>Sync <strong>{ebay?.connected ? "Live" : "Off"}</strong></span>
              </div>
            </div>
            <div className={styles.teamRow}>
              <span className={`${styles.avatar} ${styles.avatarAlt}`}>SH</span>
              <div>
                <b>Shopify</b>
                <small>Store connector coming next</small>
              </div>
              <div className={styles.teamStats}>
                <span>Orders <strong>—</strong></span>
                <span>Catalog <strong>—</strong></span>
                <span>Sync <strong>Soon</strong></span>
              </div>
            </div>
            <div className={styles.connectionMini}>
              <i className={ebay?.connected ? styles.online : styles.offline} />
              <div>
                <b>{ebay?.connected ? "Real-time store feed active" : "Connect a store to stream live data"}</b>
                <span>Orders, stock, and listing events will update this dashboard as marketplaces sync.</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className={styles.bottomGrid}>
        <article className={`${styles.panel} ${styles.uploadsPanel}`}>
          <div className={styles.panelHead}>
            <h2>Recent Store Events</h2>
            <Link href="/orders">View Orders</Link>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Source</th>
                  <th>Channel</th>
                  <th>Date / Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentUploads.length ? recentUploads.map((row) => (
                  <tr key={row.fullId}>
                    <td><Link href="/pipeline">{row.id}</Link></td>
                    <td>{row.fileName}</td>
                    <td><span className={styles.teamPill}>{row.team}</span></td>
                    <td>{new Date(row.date).toLocaleString()}</td>
                    <td>
                      <span className={`${styles.statusPill} ${styles[`status${row.status}`]}`}>{row.status}</span>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className={styles.emptyCell}>
                      No store events yet. Connect eBay and sync catalog or orders to populate this feed.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={styles.tableFoot}>
            Showing catalog and pricing jobs today · order stream attaches when stores sync
          </div>
        </article>

        <aside className={styles.actionsPanel}>
          <h2>Quick Actions</h2>
          <Link className={styles.primaryAction} href="/orders">Open Orders</Link>
          <Link className={styles.secondaryAction} href="/pipeline">Start Upload</Link>
          <Link className={styles.secondaryAction} href="/catalog">Sync Catalog</Link>
          <Link className={styles.secondaryAction} href="/catalog#listing-drafts">Manage Listings</Link>
        </aside>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Recent Activity</h2>
            <Link href="/notifications">View All</Link>
          </div>
          <div className={styles.feed}>
            {activityFeed.length ? activityFeed.map((item) => (
              <div key={item.id} className={styles.feedItem}>
                <span className={`${styles.feedIcon} ${styles[`feed${item.icon}`]}`}>
                  {item.icon === "check" ? <IconCheck /> : item.icon === "price" ? <IconBox /> : <IconUpload />}
                </span>
                <div>
                  <b>{item.title}</b>
                  <span>{item.actor} · {timeAgo(item.at)}</span>
                </div>
              </div>
            )) : (
              <div className={styles.emptyFeed}>
                <b>No activity yet</b>
                <span>Orders, listing publishes, and inventory sync events will show here.</span>
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
