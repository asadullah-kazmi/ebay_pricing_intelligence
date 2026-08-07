"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./inventory.module.css";

type InventoryPart = {
  id: string;
  sku: string;
  primaryPartNumber: string;
  brand: string | null;
  partName: string | null;
  condition: "NEW" | "USED";
  status: string;
  updatedAt: string;
  inventoryItem: {
    quantity: number;
    cost: string | number;
    currency: string;
    warehouse: { id: string; code: string; name: string } | null;
    binLocation: { id: string; code: string } | null;
  } | null;
};

type CatalogResponse = {
  parts: InventoryPart[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { total: number; byStatus: Record<string, number> };
  warehouses: Array<{ id: string; code: string; name: string }>;
};

const empty: CatalogResponse = {
  parts: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
  summary: { total: 0, byStatus: {} },
  warehouses: [],
};

const demoParts: InventoryPart[] = [
  {
    id: "d1",
    sku: "GM-84178783-A",
    primaryPartNumber: "84178783",
    brand: "ACDelco",
    partName: "HVAC Blower Motor Control Module",
    condition: "USED",
    status: "READY_FOR_ENRICHMENT",
    updatedAt: new Date().toISOString(),
    inventoryItem: { quantity: 14, cost: 28, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main Yard Warehouse" }, binLocation: { id: "b1", code: "A-14" } },
  },
  {
    id: "d2",
    sku: "AUD-8K0615301M",
    primaryPartNumber: "8K0615301M",
    brand: "Audi",
    partName: "Rear Brake Caliper Assembly",
    condition: "USED",
    status: "NEEDS_IMAGES",
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    inventoryItem: { quantity: 3, cost: 46.5, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main Yard Warehouse" }, binLocation: { id: "b2", code: "C-08" } },
  },
  {
    id: "d3",
    sku: "BMW-64119355981",
    primaryPartNumber: "64119355981",
    brand: "BMW",
    partName: "Air Conditioning Control Panel Unit",
    condition: "USED",
    status: "IMPORTED",
    updatedAt: new Date(Date.now() - 172800000).toISOString(),
    inventoryItem: { quantity: 0, cost: 65, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main Yard Warehouse" }, binLocation: null },
  },
  {
    id: "d4",
    sku: "FRD-FL3Z13008A",
    primaryPartNumber: "FL3Z13008A",
    brand: "Ford",
    partName: "F-150 Right Headlight Assembly",
    condition: "USED",
    status: "READY_FOR_ENRICHMENT",
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    inventoryItem: { quantity: 1, cost: 95, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main Yard Warehouse" }, binLocation: { id: "b3", code: "B-02" } },
  },
];

function money(value: string | number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));
}

function stockTone(qty: number) {
  if (qty <= 0) return { label: "Out of Stock", tone: "bad" };
  if (qty <= 5) return { label: "Low Stock", tone: "warn" };
  return { label: "In Stock", tone: "good" };
}

export default function InventoryWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [catalog, setCatalog] = useState<CatalogResponse>(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [condition, setCondition] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort: "updated" });
    if (search.trim()) query.set("q", search.trim());
    if (condition) query.set("condition", condition);
    if (warehouseId) query.set("warehouseId", warehouseId);
    if (stockFilter === "in") { query.set("minQuantity", "6"); }
    if (stockFilter === "low") { query.set("minQuantity", "1"); query.set("maxQuantity", "5"); }
    if (stockFilter === "out") { query.set("maxQuantity", "0"); }
    return query.toString();
  }, [condition, page, pageSize, search, stockFilter, warehouseId]);

  const load = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setCatalog({
        parts: demoParts,
        pagination: { page: 1, pageSize: 25, total: demoParts.length, totalPages: 1 },
        summary: { total: demoParts.length, byStatus: {} },
        warehouses: [{ id: "w1", code: "MAIN", name: "Main Yard Warehouse" }],
      });
      return;
    }
    setLoading(true);
    setError("");
    try {
      setCatalog((await apiFetch(`/api/parts?${queryString}`)) as CatalogResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load inventory records");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo, queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => {
    const parts = catalog.parts;
    const totalSkus = catalog.pagination.total || parts.length;
    const inStock = parts.filter((part) => (part.inventoryItem?.quantity ?? 0) > 5).length;
    const low = parts.filter((part) => {
      const qty = part.inventoryItem?.quantity ?? 0;
      return qty > 0 && qty <= 5;
    }).length;
    const out = parts.filter((part) => (part.inventoryItem?.quantity ?? 0) <= 0).length;
    const value = parts.reduce((sum, part) => sum + Number(part.inventoryItem?.cost ?? 0) * (part.inventoryItem?.quantity ?? 0), 0);
    return { totalSkus, inStock, low, out, value };
  }, [catalog.pagination.total, catalog.parts]);

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>WAREHOUSE &amp; INVENTORY OPERATIONS</span>
          <h1>Inventory Control &amp; Valuation</h1>
          <p>Monitor stock levels, bin locations, on-hand valuation, and warehouse replenishment across seller accounts.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => void load()} aria-label="Refresh Inventory" title="Refresh Inventory">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <Link className={styles.ghostBtn} href="/catalog">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Open catalog
          </Link>
          <Link className={styles.primary} href="/pipeline">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14"/></svg>
            Receive stock
          </Link>
        </div>
      </header>

      {error && (
        <div className={styles.error}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {error}
        </div>
      )}

      {/* Executive Summary Metrics Grid */}
      <section className={styles.metrics}>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>TOTAL INVENTORY SKUs</span>
            <span className={styles.metricBadgeTotal}>ACTIVE</span>
          </div>
          <b>{metrics.totalSkus}</b>
          <small>Tracked across warehouses</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>IN STOCK</span>
            <span className={styles.metricBadgeGood}>HEALTHY</span>
          </div>
          <b className={styles.metricGood}>{metrics.inStock}</b>
          <small>&gt; 5 available units</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>LOW STOCK</span>
            <span className={styles.metricBadgeWarn}>REORDER</span>
          </div>
          <b className={styles.metricWarn}>{metrics.low}</b>
          <small>1–5 units remaining</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>OUT OF STOCK</span>
            <span className={styles.metricBadgeBad}>CRITICAL</span>
          </div>
          <b className={styles.metricBad}>{metrics.out}</b>
          <small>Needs stock replenishment</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>ON-HAND VALUATION</span>
            <span className={styles.metricBadgeValue}>USD</span>
          </div>
          <b className={styles.metricValue}>{money(metrics.value, "USD")}</b>
          <small>Cost × quantity (page)</small>
        </article>
      </section>

      {/* Primary Inventory Data Panel */}
      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span className={styles.srOnly}>Search inventory</span>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Filter inventory by SKU, OEM part number, brand, or title..."
            />
            <span className={styles.kbdHint}>⌘K</span>
          </label>
          <div className={styles.filterRow}>
            <label className={styles.filterField}>
              <span>STOCK LEVEL</span>
              <select value={stockFilter} onChange={(event) => { setStockFilter(event.target.value); setPage(1); }}>
                <option value="">All Stock Levels</option>
                <option value="in">In Stock (&gt;5)</option>
                <option value="low">Low Stock (1–5)</option>
                <option value="out">Out of Stock (0)</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>WAREHOUSE</span>
              <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPage(1); }}>
                <option value="">All Locations</option>
                {catalog.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>CONDITION</span>
              <select value={condition} onChange={(event) => { setCondition(event.target.value); setPage(1); }}>
                <option value="">All Conditions</option>
                <option value="NEW">New</option>
                <option value="USED">Used</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className={styles.empty}>
            <div className={styles.spinner} />
            <b>Refreshing inventory control records...</b>
          </div>
        ) : catalog.parts.length === 0 ? (
          <div className={styles.empty}>
            <b>No inventory records found</b>
            <span>Import catalog parts from Pipeline or adjust your stock filters.</span>
            <Link href="/pipeline" className={styles.primaryInline}>Go to pipeline</Link>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>SKU &amp; PART NO</th>
                  <th>PART DETAILS</th>
                  <th>CONDITION</th>
                  <th>QTY</th>
                  <th>STOCK STATUS</th>
                  <th>LOCATION</th>
                  <th>UNIT COST</th>
                  <th>ON-HAND VALUE</th>
                  <th>LAST UPDATED</th>
                </tr>
              </thead>
              <tbody>
                {catalog.parts.map((part) => {
                  const qty = part.inventoryItem?.quantity ?? 0;
                  const stock = stockTone(qty);
                  const cost = Number(part.inventoryItem?.cost ?? 0);
                  const currency = part.inventoryItem?.currency || "USD";
                  return (
                    <tr key={part.id}>
                      <td>
                        <Link className={styles.skuLink} href="/catalog">
                          <code>{part.sku}</code>
                        </Link>
                        <span className={styles.subtle}>{part.primaryPartNumber}</span>
                      </td>
                      <td>
                        <b className={styles.titleCell}>{part.partName || "Unnamed catalog item"}</b>
                        <span className={styles.subtle}>{part.brand || "Brand unavailable"}</span>
                      </td>
                      <td>
                        <span className={styles.conditionTag}>{part.condition === "NEW" ? "New" : "Used"}</span>
                      </td>
                      <td>
                        <b className={styles.qtyNumber}>{qty}</b>
                      </td>
                      <td>
                        <span className={`${styles.statusPill} ${styles[`tone_${stock.tone}`]}`}>
                          {stock.label}
                        </span>
                      </td>
                      <td>
                        <span className={styles.locationCode}>{part.inventoryItem?.warehouse?.code || "—"}</span>
                        <span className={styles.subtle}>{part.inventoryItem?.binLocation?.code ? `Bin: ${part.inventoryItem.binLocation.code}` : "Unassigned bin"}</span>
                      </td>
                      <td className={styles.costCell}>{money(cost, currency)}</td>
                      <td className={styles.valueCell}>{money(cost * qty, currency)}</td>
                      <td className={styles.dateCell}>{new Date(part.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.pagination}>
          <span>
            Showing <b>{catalog.parts.length ? ((catalog.pagination.page - 1) * catalog.pagination.pageSize) + 1 : 0}</b> to <b>{Math.min(catalog.pagination.page * catalog.pagination.pageSize, catalog.pagination.total)}</b> of <b>{catalog.pagination.total}</b> inventory items
          </span>
          <div className={styles.pageSize}>
            <span>Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <div className={styles.pageButtons}>
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page">‹</button>
              <em className={styles.pageCurrent}>{catalog.pagination.page}</em>
              <button type="button" disabled={page >= catalog.pagination.totalPages} onClick={() => setPage((value) => value + 1)} aria-label="Next page">›</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
