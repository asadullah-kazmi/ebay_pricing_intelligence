"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./orders.module.css";

type OrderRow = {
  key: string;
  account: { id: string; username: string | null; isDefault: boolean; marketplace: string };
  orderId: string;
  legacyOrderId: string | null;
  buyerUsername: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  orderStatus: string | null;
  checkoutStatus: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  paidTime: string | null;
  createdTime: string | null;
  shippedTime: string | null;
  totalValue: number | null;
  totalCurrency: string | null;
  quantity: number | null;
  itemCount: number | null;
  firstSku: string | null;
  firstTitle: string | null;
  shippingService: string | null;
  shippingValue: number | null;
  shippingCurrency: string | null;
  shippingAddress: Record<string, unknown> | null;
  transactions: Array<Record<string, unknown>>;
  syncedAt: string;
};

type OrdersSyncProgress = {
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
  percent: number;
  message: string;
  accountsTotal: number;
  accountsCompleted: number;
  currentAccount: string | null;
  totalOrders: number;
  ordersFetched: number;
  cacheSaved: number;
  errors: number;
  errorMessages?: string[];
  startedAt: string | null;
  finishedAt: string | null;
};

type OrdersResponse = {
  accounts: Array<{ id: string; username: string | null; isDefault: boolean; marketplace: string }>;
  items: OrderRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    filtered: number;
    connectedAccounts: number;
    awaitingShipment: number;
    shipped: number;
    cancelled: number;
    revenue: number;
  };
  errors: Array<{ connectionId: string; username: string | null; message: string }>;
  syncedAt: string | null;
  sync?: { started: boolean; running: boolean; progress?: OrdersSyncProgress };
};

const emptyOrders: OrdersResponse = {
  accounts: [],
  items: [],
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
  summary: { total: 0, filtered: 0, connectedAccounts: 0, awaitingShipment: 0, shipped: 0, cancelled: 0, revenue: 0 },
  errors: [],
  syncedAt: null,
};

function startingSyncProgress(): OrdersSyncProgress {
  return {
    status: "RUNNING",
    percent: 1,
    message: "Starting order sync...",
    accountsTotal: 0,
    accountsCompleted: 0,
    currentAccount: null,
    totalOrders: 0,
    ordersFetched: 0,
    cacheSaved: 0,
    errors: 0,
    errorMessages: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

function money(value: number | null, currency: string | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(value);
}

function shortDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function lastSyncedLabel(value: string | null) {
  if (!value) return "Not synced yet";
  const syncedAt = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - syncedAt.getTime()) / 1000));
  if (seconds < 60) return "Synced just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} hr ago`;
  return `Synced ${syncedAt.toLocaleDateString()}`;
}

function label(value: string | null | undefined) {
  if (!value) return "—";
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(row: OrderRow) {
  const status = `${row.orderStatus ?? ""} ${row.fulfillmentStatus ?? ""}`.toUpperCase();
  if (status.includes("CANCEL")) return "bad";
  if (status.includes("SHIPPED")) return "good";
  if (status.includes("AWAITING")) return "warn";
  return "info";
}

export default function OrdersWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [orders, setOrders] = useState<OrdersResponse>(emptyOrders);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<OrdersSyncProgress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewing, setViewing] = useState<OrderRow | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status: statusFilter });
    if (search.trim()) params.set("q", search.trim());
    if (connectionId) params.set("connectionId", connectionId);
    return params.toString();
  }, [connectionId, page, pageSize, search, statusFilter]);

  const load = useCallback(async () => {
    if (authStatus !== "ready" || demo) return;
    setLoading(true);
    setError("");
    try {
      setOrders((await apiFetch(`/api/ebay/store-orders?${query}`)) as OrdersResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load cached eBay orders");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    const params = new URLSearchParams();
    if (connectionId) params.set("connectionId", connectionId);
    void apiFetch(`/api/ebay/store-orders/sync-status${params.toString() ? `?${params.toString()}` : ""}`)
      .then((progress) => {
        const next = progress as OrdersSyncProgress;
        if (next.status === "RUNNING") {
          setSyncProgress(next);
          setSyncing(true);
        }
      })
      .catch(() => undefined);
  }, [apiFetch, authStatus, connectionId, demo]);

  useEffect(() => {
    if (authStatus !== "ready" || demo || syncProgress?.status !== "RUNNING") return undefined;
    const params = new URLSearchParams();
    if (connectionId) params.set("connectionId", connectionId);
    const interval = window.setInterval(async () => {
      try {
        const progress = await apiFetch(`/api/ebay/store-orders/sync-status${params.toString() ? `?${params.toString()}` : ""}`) as OrdersSyncProgress;
        setSyncProgress(progress);
        setSyncing(progress.status === "RUNNING");
        if (progress.status === "COMPLETED" || progress.status === "FAILED") {
          window.clearInterval(interval);
          await load();
          if (progress.status === "COMPLETED") setNotice("Order cache updated.");
          if (progress.status === "FAILED") setError(progress.message || progress.errorMessages?.[0] || "Order sync failed. Check API logs or try again.");
        }
      } catch {
        // Keep the current progress visible.
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [apiFetch, authStatus, connectionId, demo, load, syncProgress?.status]);

  async function syncOrders() {
    if (authStatus !== "ready" || demo) return;
    const optimisticProgress = startingSyncProgress();
    setSyncing(true);
    setSyncProgress(optimisticProgress);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/ebay/store-orders/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, pageSize, status: statusFilter, ...(search.trim() ? { q: search.trim() } : {}), ...(connectionId ? { connectionId } : {}) }),
      }) as OrdersResponse;
      setOrders(response);
      const progress = response.sync?.progress;
      setSyncProgress(progress && progress.status !== "IDLE" ? progress : optimisticProgress);
      setSyncing(response.sync?.running ?? true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start eBay order sync");
      setSyncProgress(null);
      setSyncing(false);
      await load();
    }
  }

  if (authStatus !== "ready") return null;

  if (demo) {
    return (
      <div className={styles.page}>
        <section className={styles.emptyState}>
          <b>Orders need a connected eBay account</b>
          <span>Demo mode does not load seller orders.</span>
          <Link className={styles.primaryBtn} href="/channels">Open channels</Link>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>EBAY STORE ORDERS</span>
          <h1>Orders</h1>
          <p>Sync buyer orders from every connected eBay seller account and marketplace site.</p>
          <span className={styles.syncMeta}>{lastSyncedLabel(orders.syncedAt)}</span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={() => void syncOrders()} disabled={syncing || loading}>
            {syncing ? "Syncing..." : "Sync all stores"}
          </button>
          <Link className={styles.primaryBtn} href="/channels">Manage stores</Link>
        </div>
      </header>

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {syncProgress && syncProgress.status !== "IDLE" && (
        <section className={styles.syncProgress}>
          <div className={styles.syncProgressHeader}>
            <div>
              <b>{syncProgress.status === "RUNNING" ? "Syncing eBay orders" : syncProgress.status === "COMPLETED" ? "Order sync completed" : "Order sync failed"}</b>
              <span>{syncProgress.message}</span>
            </div>
            <strong>{syncProgress.percent}%</strong>
          </div>
          <div className={styles.progressTrack} aria-label="Order sync progress" aria-valuenow={syncProgress.percent} aria-valuemin={0} aria-valuemax={100} role="progressbar">
            <span style={{ width: `${syncProgress.percent}%` }} />
          </div>
          <div className={styles.syncProgressStats}>
            <span>{syncProgress.accountsCompleted}/{syncProgress.accountsTotal} site checks</span>
            <span>{syncProgress.totalOrders} orders found</span>
            <span>{syncProgress.ordersFetched}/{syncProgress.totalOrders} orders fetched</span>
            <span>{syncProgress.cacheSaved} rows cached</span>
            {syncProgress.errors > 0 && <span>{syncProgress.errors} warnings</span>}
          </div>
          {syncProgress.errorMessages && syncProgress.errorMessages.length > 0 && (
            <div className={styles.syncProgressErrors}>
              {syncProgress.errorMessages.slice(0, 3).map((message) => <span key={message}>{message}</span>)}
            </div>
          )}
        </section>
      )}
      {orders.errors.length > 0 && (
        <div className={styles.warning}>
          <b>{orders.errors.length} sync warning{orders.errors.length === 1 ? "" : "s"}</b>
          <span>{orders.errors.slice(0, 3).map((item) => `${item.username ?? "eBay account"}: ${item.message}`).join(" · ")}</span>
        </div>
      )}

      <section className={styles.metrics}>
        <article><span>Accounts</span><b>{orders.summary.connectedAccounts}</b></article>
        <article><span>Orders cached</span><b>{orders.summary.total}</b></article>
        <article><span>Awaiting shipment</span><b>{orders.summary.awaitingShipment}</b></article>
        <article><span>Shipped</span><b>{orders.summary.shipped}</b></article>
        <article><span>Revenue</span><b>{money(orders.summary.revenue, "USD")}</b></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <span>Search</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Order ID, buyer, SKU, title, seller account" />
          </label>
          <label>
            <span>Store</span>
            <select value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setPage(1); }}>
              <option value="">All connected stores</option>
              {orders.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.username ?? "eBay account"}{account.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
              <option value="ALL">All orders</option>
              <option value="PAID">Paid</option>
              <option value="AWAITING_SHIPMENT">Awaiting shipment</option>
              <option value="SHIPPED">Shipped</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <div className={styles.filterCount}>{orders.summary.filtered} shown</div>
        </div>

        {loading && orders.items.length === 0 ? (
          <div className={styles.loadingContainer}><div className={styles.spinner} /></div>
        ) : orders.items.length === 0 ? (
          <div className={styles.emptyState}>
            <b>No synced order records</b>
            <span>Click <strong>Sync all stores</strong> to pull recent orders directly from all connected eBay seller accounts.</span>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th className={styles.colStore}>Store</th>
                  <th className={styles.colOrder}>Order</th>
                  <th className={styles.colBuyer}>Buyer</th>
                  <th className={styles.colProduct}>Item</th>
                  <th className={styles.colQty}>Qty</th>
                  <th className={styles.colTotal}>Total</th>
                  <th className={styles.colDate}>Created</th>
                  <th className={styles.colStatus}>Status</th>
                  <th className={styles.colActions}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.items.map((row) => (
                  <tr key={row.key}>
                    <td className={styles.colStore}>
                      <span className={styles.storeName}>{row.account.username ?? "eBay"}</span>
                      <span className={styles.muted}>{row.account.marketplace}{row.account.isDefault ? " · default" : ""}</span>
                    </td>
                    <td className={styles.colOrder}>
                      <span className={styles.orderCode}>{row.orderId}</span>
                      {row.legacyOrderId && <span className={styles.muted}>{row.legacyOrderId}</span>}
                    </td>
                    <td className={styles.colBuyer}>
                      <b>{row.buyerUsername || row.buyerName || "Buyer"}</b>
                      {row.buyerEmail && <span className={styles.muted}>{row.buyerEmail}</span>}
                    </td>
                    <td className={styles.colProduct}>
                      <b>{row.firstTitle || "Order item"}</b>
                      <span className={styles.muted}>{row.firstSku || `${row.itemCount ?? 0} line item${row.itemCount === 1 ? "" : "s"}`}</span>
                    </td>
                    <td className={styles.colQty}>{row.quantity ?? "—"}</td>
                    <td className={styles.colTotal}><b>{money(row.totalValue, row.totalCurrency)}</b></td>
                    <td className={styles.colDate}>{shortDate(row.createdTime)}</td>
                    <td className={styles.colStatus}>
                      <span className={`${styles.statusText} ${styles[statusTone(row)]}`}>{label(row.fulfillmentStatus ?? row.orderStatus)}</span>
                    </td>
                    <td className={styles.colActions}>
                      <button type="button" onClick={() => setViewing(row)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className={styles.pagination}>
          <span>Page {orders.pagination.page} of {orders.pagination.totalPages} · {orders.pagination.total} records</span>
          <div>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
            </select>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <button type="button" disabled={page >= orders.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        </footer>
      </section>

      {viewing && (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Order details">
            <header>
              <div>
                <span className={styles.eyebrow}>ORDER DETAILS</span>
                <h2>{viewing.orderId}</h2>
                <p>{viewing.account.username ?? "eBay"} · {viewing.account.marketplace} · {shortDate(viewing.createdTime)}</p>
              </div>
              <button type="button" onClick={() => setViewing(null)} aria-label="Close">×</button>
            </header>
            <div className={styles.detailGrid}>
              <article><span>Buyer</span><b>{viewing.buyerUsername || viewing.buyerName || "—"}</b></article>
              <article><span>Total</span><b>{money(viewing.totalValue, viewing.totalCurrency)}</b></article>
              <article><span>Status</span><b>{label(viewing.fulfillmentStatus ?? viewing.orderStatus)}</b></article>
              <article><span>Shipping</span><b>{viewing.shippingService || "—"}</b></article>
            </div>
            <div className={styles.lines}>
              <h3>Line items</h3>
              {(viewing.transactions.length ? viewing.transactions : [{ title: viewing.firstTitle, sku: viewing.firstSku, quantityPurchased: viewing.quantity }]).map((line, index) => (
                <div className={styles.lineItem} key={`${String(line.orderLineItemId ?? line.transactionId ?? index)}`}>
                  <div>
                    <b>{String(line.title ?? "Order item")}</b>
                    <span>{String(line.sku ?? "No SKU")}</span>
                  </div>
                  <strong>Qty {String(line.quantityPurchased ?? 1)}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
