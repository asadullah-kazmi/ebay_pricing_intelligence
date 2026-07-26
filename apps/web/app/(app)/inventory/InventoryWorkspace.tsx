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
    inventoryItem: { quantity: 4, cost: 28, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b1", code: "A-14" } },
  },
  {
    id: "d2",
    sku: "AUD-8K0615301M",
    primaryPartNumber: "8K0615301M",
    brand: "Audi",
    partName: "Rear Brake Caliper",
    condition: "USED",
    status: "NEEDS_IMAGES",
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    inventoryItem: { quantity: 2, cost: 46.5, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b2", code: "C-08" } },
  },
  {
    id: "d3",
    sku: "BMW-64119355981",
    primaryPartNumber: "64119355981",
    brand: "BMW",
    partName: "Air Conditioning Control Panel",
    condition: "USED",
    status: "IMPORTED",
    updatedAt: new Date(Date.now() - 172800000).toISOString(),
    inventoryItem: { quantity: 0, cost: 65, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: null },
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
    inventoryItem: { quantity: 1, cost: 95, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b3", code: "B-02" } },
  },
];

function money(value: string | number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value));
}

function stockTone(qty: number) {
  if (qty <= 0) return { label: "Out of Stock", className: styles.stockOut };
  if (qty <= 5) return { label: "Low Stock", className: styles.stockLow };
  return { label: "In Stock", className: styles.stockIn };
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

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25", sort: "updated" });
    if (search.trim()) query.set("q", search.trim());
    if (condition) query.set("condition", condition);
    if (warehouseId) query.set("warehouseId", warehouseId);
    if (stockFilter === "in") { query.set("minQuantity", "1"); }
    if (stockFilter === "low") { query.set("minQuantity", "1"); query.set("maxQuantity", "5"); }
    if (stockFilter === "out") { query.set("maxQuantity", "0"); }
    return query.toString();
  }, [condition, page, search, stockFilter, warehouseId]);

  const load = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setCatalog({
        parts: demoParts,
        pagination: { page: 1, pageSize: 25, total: demoParts.length, totalPages: 1 },
        summary: { total: demoParts.length, byStatus: {} },
        warehouses: [{ id: "w1", code: "MAIN", name: "Main" }],
      });
      return;
    }
    setLoading(true);
    setError("");
    try {
      setCatalog((await apiFetch(`/api/parts?${queryString}`)) as CatalogResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load inventory");
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
          <h1>Inventory</h1>
          <p>Monitor stock levels, bin locations, and on-hand value across warehouses.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => void load()} aria-label="Refresh" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <Link className={styles.ghostBtn} href="/catalog">Open catalog</Link>
          <Link className={styles.primary} href="/pipeline">+ Receive stock</Link>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.metrics}>
        <article>
          <span>Total SKUs</span>
          <b>{metrics.totalSkus}</b>
          <small>In this inventory view</small>
        </article>
        <article>
          <span>In stock</span>
          <b className={styles.metricGood}>{metrics.inStock}</b>
          <small>More than 5 units</small>
        </article>
        <article>
          <span>Low stock</span>
          <b className={styles.metricWarn}>{metrics.low}</b>
          <small>1–5 units left</small>
        </article>
        <article>
          <span>Out of stock</span>
          <b className={styles.metricBad}>{metrics.out}</b>
          <small>Needs replenishment</small>
        </article>
        <article>
          <span>On-hand value</span>
          <b>{money(metrics.value, "USD")}</b>
          <small>Cost × quantity (page)</small>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span className={styles.srOnly}>Search inventory</span>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search by SKU, title, or part number..."
            />
            <span className={styles.kbdHint}>⌘K</span>
          </label>
          <div className={styles.filterRow}>
            <label className={styles.filterField}>
              <span>Stock Level</span>
              <select value={stockFilter} onChange={(event) => { setStockFilter(event.target.value); setPage(1); }}>
                <option value="">All Stock</option>
                <option value="in">In stock</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Warehouse</span>
              <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPage(1); }}>
                <option value="">All Locations</option>
                {catalog.warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Condition</span>
              <select value={condition} onChange={(event) => { setCondition(event.target.value); setPage(1); }}>
                <option value="">All Conditions</option>
                <option value="NEW">New</option>
                <option value="USED">Used</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className={styles.empty}><b>Refreshing inventory...</b></div>
        ) : catalog.parts.length === 0 ? (
          <div className={styles.empty}>
            <b>No inventory records found</b>
            <span>Import parts from Pipeline or adjust stock filters.</span>
            <Link href="/pipeline">Go to pipeline</Link>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Title</th>
                  <th>Condition</th>
                  <th>Qty</th>
                  <th>Stock</th>
                  <th>Location</th>
                  <th>Unit cost</th>
                  <th>On-hand</th>
                  <th>Updated</th>
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
                        <Link className={styles.skuLink} href="/catalog">{part.sku}</Link>
                        <span className={styles.subtle}>{part.primaryPartNumber}</span>
                      </td>
                      <td>
                        <b className={styles.titleCell}>{part.partName || "Unnamed part"}</b>
                        <span className={styles.subtle}>{part.brand || "Brand not set"}</span>
                      </td>
                      <td>{part.condition === "NEW" ? "New" : "Used"}</td>
                      <td><b>{qty}</b></td>
                      <td><span className={stock.className}>{stock.label}</span></td>
                      <td>
                        {part.inventoryItem?.warehouse?.code || "—"}
                        <span className={styles.subtle}>{part.inventoryItem?.binLocation?.code || "Unassigned bin"}</span>
                      </td>
                      <td>{money(cost, currency)}</td>
                      <td><b>{money(cost * qty, currency)}</b></td>
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
            Showing {catalog.parts.length ? ((catalog.pagination.page - 1) * catalog.pagination.pageSize) + 1 : 0}
            {" "}to {Math.min(catalog.pagination.page * catalog.pagination.pageSize, catalog.pagination.total)} of {catalog.pagination.total} results
          </span>
          <div className={styles.pageSize}>
            <span>Rows per page</span>
            <strong>25</strong>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous">‹</button>
            <em className={styles.pageCurrent}>{catalog.pagination.page}</em>
            <button type="button" disabled={page >= catalog.pagination.totalPages} onClick={() => setPage((value) => value + 1)} aria-label="Next">›</button>
          </div>
        </div>
      </section>
    </div>
  );
}
