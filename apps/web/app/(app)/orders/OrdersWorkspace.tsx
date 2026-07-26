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
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
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
      : "Connect eBay in Catalog to enable live order sync.");
  }

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Orders</h1>
          <p>Track payments, pick lists, and fulfillment across connected marketplaces.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => void load()} aria-label="Refresh" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <button type="button" className={styles.ghostBtn}>
            Export
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <Link className={styles.ghostBtn} href="/catalog">Manage stores</Link>
          <button type="button" className={styles.primary} onClick={syncOrders} disabled={!ebay?.connected && !demo}>
            Sync orders
          </button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      <div className={styles.previewBanner}>Preview order inbox — live marketplace order sync is coming next.</div>

      <section className={styles.storeRow}>
        <article className={styles.storeCard}>
          <i className={ebay?.connected ? styles.online : styles.offline} />
          <div>
            <b>eBay</b>
            <span>
              {ebay?.connected
                ? `Live · ${ebay.username || ebay.ebayUserId || "seller connected"}`
                : "Not connected · connect to stream orders"}
            </span>
          </div>
          <em>{ebay?.connected ? "Ready" : "Offline"}</em>
        </article>
        <article className={`${styles.storeCard} ${styles.soon}`}>
          <i className={styles.offline} />
          <div>
            <b>Shopify</b>
            <span>Coming next · catalog + order sync</span>
          </div>
          <em>Soon</em>
        </article>
        <article className={`${styles.storeCard} ${styles.soon}`}>
          <i className={styles.offline} />
          <div>
            <b>Amazon</b>
            <span>Coming next · FBA / seller orders</span>
          </div>
          <em>Soon</em>
        </article>
      </section>

      <section className={styles.metrics}>
        {[
          { label: "Open orders", value: metrics.open, hint: "Not delivered / cancelled" },
          { label: "Awaiting shipment", value: metrics.awaiting, hint: "Paid & ready to ship" },
          { label: "Shipped", value: metrics.shippedToday, hint: "In transit" },
          { label: "Returns / issues", value: metrics.issues, hint: "Needs attention" },
        ].map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <b>{item.value}</b>
            <small>{item.hint}</small>
          </article>
        ))}
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span className={styles.srOnly}>Search orders</span>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by order #, buyer, SKU, or title..."/>
            <span className={styles.kbdHint}>⌘K</span>
          </label>
          <div className={styles.filterRow}>
            <label className={styles.filterField}>
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                <option value="AWAITING_PAYMENT">Awaiting payment</option>
                <option value="PAID">Paid</option>
                <option value="READY_TO_SHIP">Ready to ship</option>
                <option value="SHIPPED">Shipped</option>
                <option value="DELIVERED">Delivered</option>
                <option value="RETURN">Return</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Marketplace</span>
              <select value={marketplaceFilter} onChange={(event) => setMarketplaceFilter(event.target.value)}>
                <option value="">All marketplaces</option>
                <option value="EBAY_US">eBay US</option>
                <option value="EBAY_GB">eBay UK</option>
                <option value="EBAY_DE">eBay DE</option>
              </select>
            </label>
          </div>
        </div>

        {selected.size > 0 && (
          <div className={styles.bulkBar}>
            <b>{selected.size} selected</b>
            <div className={styles.bulkActions}>
              <button type="button">Print packing slips</button>
              <button type="button">Mark shipped</button>
              <button type="button" className={styles.bulkClose} onClick={() => setSelected(new Set())} aria-label="Clear">×</button>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <b>No orders match these filters</b>
            <span>Adjust status or marketplace filters, or sync stores when live order import is enabled.</span>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll}/></th>
                  <th>Order</th>
                  <th>Buyer</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Total</th>
                  <th>Marketplace</th>
                  <th>Placed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.id}>
                    <td><input type="checkbox" aria-label={`Select ${order.orderNumber}`} checked={selected.has(order.id)} onChange={() => toggleOne(order.id)}/></td>
                    <td>
                      <button type="button" className={styles.orderLink}>{order.orderNumber}</button>
                    </td>
                    <td>{order.buyer}</td>
                    <td>
                      <b className={styles.titleCell}>{order.title}</b>
                      <span className={styles.subtle}>{order.sku}</span>
                    </td>
                    <td>{order.qty}</td>
                    <td><b>{money(order.total, order.currency)}</b></td>
                    <td>{marketplaceLabel(order.marketplace)}</td>
                    <td className={styles.dateCell}>{new Date(order.placedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td><span className={`${styles.statusPill} ${statusClass(order.status)}`}>{humanStatus(order.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.pagination}>
          <span>Showing {filtered.length ? 1 : 0} to {filtered.length} of {filtered.length} results</span>
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
