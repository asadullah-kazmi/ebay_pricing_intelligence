"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./orders.module.css";

type EbayConnection = {
  connected: boolean;
  status: string;
  username?: string | null;
  ebayUserId?: string | null;
};

type OrderStatus = "AWAITING_PAYMENT" | "PAID" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "RETURN";

type OrderRow = {
  id: string;
  orderNumber: string;
  buyer: string;
  marketplace: "EBAY_US" | "EBAY_GB" | "EBAY_DE";
  sku: string;
  title: string;
  qty: number;
  total: number;
  currency: string;
  status: OrderStatus;
  placedAt: string;
};

const demoOrders: OrderRow[] = [
  {
    id: "o1",
    orderNumber: "14-12847-39201",
    buyer: "mike.auto.parts",
    marketplace: "EBAY_US",
    sku: "GM-84178783-A",
    title: "HVAC Blower Motor Control Module",
    qty: 1,
    total: 129.99,
    currency: "USD",
    status: "READY_TO_SHIP",
    placedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    id: "o2",
    orderNumber: "14-12846-88112",
    buyer: "northside_yard",
    marketplace: "EBAY_US",
    sku: "AUD-8K0615301M",
    title: "Rear Brake Caliper Assembly",
    qty: 2,
    total: 214.5,
    currency: "USD",
    status: "PAID",
    placedAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
  },
  {
    id: "o3",
    orderNumber: "03-99211-44002",
    buyer: "uk.parts.hub",
    marketplace: "EBAY_GB",
    sku: "BMW-64119355981",
    title: "Air Conditioning Control Panel",
    qty: 1,
    total: 89.0,
    currency: "GBP",
    status: "SHIPPED",
    placedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
  },
  {
    id: "o4",
    orderNumber: "14-12840-10088",
    buyer: "silverado_fix",
    marketplace: "EBAY_US",
    sku: "FRD-FL3Z13008A",
    title: "2015 F-150 Right Headlight Assembly",
    qty: 1,
    total: 189.99,
    currency: "USD",
    status: "AWAITING_PAYMENT",
    placedAt: new Date(Date.now() - 30 * 3600_000).toISOString(),
  },
  {
    id: "o5",
    orderNumber: "14-12822-77331",
    buyer: "midwest.salvage",
    marketplace: "EBAY_US",
    sku: "TYT-85212-0R030",
    title: "Camry Front Bumper Cover",
    qty: 1,
    total: 245.0,
    currency: "USD",
    status: "RETURN",
    placedAt: new Date(Date.now() - 72 * 3600_000).toISOString(),
  },
  {
    id: "o6",
    orderNumber: "14-12790-55210",
    buyer: "coastal.motors",
    marketplace: "EBAY_US",
    sku: "HON-33100-T2A",
    title: "Accord Left Headlight",
    qty: 1,
    total: 156.25,
    currency: "USD",
    status: "DELIVERED",
    placedAt: new Date(Date.now() - 96 * 3600_000).toISOString(),
  },
];

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

function humanStatus(status: OrderStatus) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function marketplaceLabel(value: OrderRow["marketplace"]) {
  if (value === "EBAY_GB") return "eBay UK";
  if (value === "EBAY_DE") return "eBay DE";
  return "eBay US";
}

function statusClass(status: OrderStatus) {
  if (status === "READY_TO_SHIP" || status === "PAID") return styles.statusReady;
  if (status === "SHIPPED" || status === "DELIVERED") return styles.statusShipped;
  if (status === "AWAITING_PAYMENT") return styles.statusWait;
  if (status === "RETURN" || status === "CANCELLED") return styles.statusIssue;
  return styles.statusWait;
}

export default function OrdersWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [ebay, setEbay] = useState<EbayConnection | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orders] = useState<OrderRow[]>(demoOrders);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setEbay((await apiFetch("/api/ebay/connection")) as EbayConnection);
  }, [apiFetch]);

  useEffect(() => {
    if (authStatus !== "ready") return;
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load store connection"));
  }, [authStatus, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter && order.status !== statusFilter) return false;
      if (marketplaceFilter && order.marketplace !== marketplaceFilter) return false;
      if (!q) return true;
      return (
        order.orderNumber.toLowerCase().includes(q) ||
        order.buyer.toLowerCase().includes(q) ||
        order.sku.toLowerCase().includes(q) ||
        order.title.toLowerCase().includes(q)
      );
    });
  }, [marketplaceFilter, orders, search, statusFilter]);

  const metrics = useMemo(() => {
    const open = orders.filter((order) => !["DELIVERED", "CANCELLED"].includes(order.status)).length;
    const awaiting = orders.filter((order) => ["PAID", "READY_TO_SHIP"].includes(order.status)).length;
    const shippedToday = orders.filter((order) => order.status === "SHIPPED").length;
    const issues = orders.filter((order) => ["RETURN", "CANCELLED"].includes(order.status)).length;
    return { open, awaiting, shippedToday, issues };
  }, [orders]);

  const allSelected = filtered.length > 0 && filtered.every((order) => selected.has(order.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((order) => order.id)));
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function syncOrders() {
    setNotice(ebay?.connected
      ? "Order sync is queued. Live eBay order import will populate this inbox next."
      : "Connect your primary eBay account in Channels to enable live order sync.");
  }

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>MARKETPLACE ORDER &amp; FULFILLMENT</span>
          <h1>Orders &amp; Dispatch</h1>
          <p>Track customer payments, print pick lists, and manage order fulfillment across connected sales channels.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => void load()} aria-label="Refresh Orders" title="Refresh Orders">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <button type="button" className={styles.ghostBtn}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export orders
          </button>
          <Link className={styles.ghostBtn} href="/channels">Manage stores</Link>
          <button type="button" className={styles.primary} onClick={syncOrders} disabled={!ebay?.connected && !demo}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Sync orders
          </button>
        </div>
      </header>

      {error && (
        <div className={styles.error}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.notice}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {notice}
        </div>
      )}

      {/* Connected Channel Stores Strip */}
      <section className={styles.storeRow}>
        <article className={styles.storeCard}>
          <div className={styles.storeHeader}>
            <span className={ebay?.connected ? styles.onlineDot : styles.offlineDot} />
            <b>eBay US</b>
          </div>
          <span>
            {ebay?.connected
              ? `Connected · ${ebay.username || ebay.ebayUserId || "Primary Account"}`
              : "Connected · Ready to stream orders"}
          </span>
          <em className={styles.badgeReady}>STREAMING</em>
        </article>
        <article className={`${styles.storeCard} ${styles.soon}`}>
          <div className={styles.storeHeader}>
            <span className={styles.offlineDot} />
            <b>Shopify Store</b>
          </div>
          <span>Catalog &amp; order fulfillment sync</span>
          <em className={styles.badgeSoon}>SOON</em>
        </article>
        <article className={`${styles.storeCard} ${styles.soon}`}>
          <div className={styles.storeHeader}>
            <span className={styles.offlineDot} />
            <b>Amazon FBA</b>
          </div>
          <span>Merchant &amp; FBA order processing</span>
          <em className={styles.badgeSoon}>SOON</em>
        </article>
      </section>

      {/* Summary Metrics */}
      <section className={styles.metrics}>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>OPEN ORDERS</span>
            <span className={styles.metricBadgeTotal}>ACTIVE</span>
          </div>
          <b>{metrics.open}</b>
          <small>Active unfulfilled orders</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>AWAITING SHIPMENT</span>
            <span className={styles.metricBadgeWarn}>ACTION</span>
          </div>
          <b className={styles.metricWarn}>{metrics.awaiting}</b>
          <small>Paid &amp; ready for pick list</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>SHIPPED IN TRANSIT</span>
            <span className={styles.metricBadgeGood}>TRANSIT</span>
          </div>
          <b className={styles.metricGood}>{metrics.shippedToday}</b>
          <small>Carrier tracking active</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>RETURNS &amp; ISSUES</span>
            <span className={styles.metricBadgeBad}>ATTENTION</span>
          </div>
          <b className={styles.metricBad}>{metrics.issues}</b>
          <small>Returns or cancellations</small>
        </article>
      </section>

      {/* Main Orders Table Panel */}
      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span className={styles.srOnly}>Search orders</span>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter orders by order #, buyer username, SKU, or part title..."/>
            <span className={styles.kbdHint}>⌘K</span>
          </label>
          <div className={styles.filterRow}>
            <label className={styles.filterField}>
              <span>ORDER STATUS</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All Order Statuses</option>
                <option value="AWAITING_PAYMENT">Awaiting Payment</option>
                <option value="PAID">Paid</option>
                <option value="READY_TO_SHIP">Ready to Ship</option>
                <option value="SHIPPED">Shipped</option>
                <option value="DELIVERED">Delivered</option>
                <option value="RETURN">Return</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>MARKETPLACE</span>
              <select value={marketplaceFilter} onChange={(event) => setMarketplaceFilter(event.target.value)}>
                <option value="">All Marketplaces</option>
                <option value="EBAY_US">eBay US</option>
                <option value="EBAY_GB">eBay UK</option>
                <option value="EBAY_DE">eBay DE</option>
              </select>
            </label>
          </div>
        </div>

        {selected.size > 0 && (
          <div className={styles.bulkBar}>
            <b>{selected.size} order{selected.size === 1 ? "" : "s"} selected</b>
            <div className={styles.bulkActions}>
              <button type="button" className={styles.bulkBtn}>Print packing slips</button>
              <button type="button" className={styles.bulkBtnPrimary}>Mark shipped &amp; add tracking</button>
              <button type="button" className={styles.bulkClose} onClick={() => setSelected(new Set())} aria-label="Clear selection">×</button>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <b>No orders match your search filters</b>
            <span>Adjust status or marketplace dropdowns to inspect order history.</span>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll}/></th>
                  <th>ORDER #</th>
                  <th>BUYER</th>
                  <th>PART ITEM</th>
                  <th>QTY</th>
                  <th>ORDER TOTAL</th>
                  <th>MARKETPLACE</th>
                  <th>PLACED DATE</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.id}>
                    <td><input type="checkbox" aria-label={`Select ${order.orderNumber}`} checked={selected.has(order.id)} onChange={() => toggleOne(order.id)}/></td>
                    <td>
                      <button type="button" className={styles.orderLink}>
                        <code>{order.orderNumber}</code>
                      </button>
                    </td>
                    <td>
                      <b className={styles.buyerName}>{order.buyer}</b>
                    </td>
                    <td>
                      <b className={styles.titleCell}>{order.title}</b>
                      <span className={styles.subtle}>{order.sku}</span>
                    </td>
                    <td><b className={styles.qtyNum}>{order.qty}</b></td>
                    <td><b className={styles.totalNum}>{money(order.total, order.currency)}</b></td>
                    <td>
                      <span className={styles.marketTag}>{marketplaceLabel(order.marketplace)}</span>
                    </td>
                    <td className={styles.dateCell}>{new Date(order.placedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td><span className={`${styles.statusPill} ${statusClass(order.status)}`}>{humanStatus(order.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.pagination}>
          <span>Showing <b>{filtered.length ? 1 : 0}</b> to <b>{filtered.length}</b> of <b>{filtered.length}</b> orders</span>
          <div className={styles.pageSize}>
            <span>Rows per page</span>
            <strong>25</strong>
            <em className={styles.pageCurrent}>1</em>
          </div>
        </div>
      </section>
    </div>
  );
}
