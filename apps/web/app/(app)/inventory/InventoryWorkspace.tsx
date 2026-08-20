"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./inventory.module.css";

type InventoryRow = {
  key: string;
  account: { id: string; username: string | null; isDefault: boolean; marketplace: "EBAY_US" | "EBAY_GB" | "EBAY_DE" };
  sku: string;
  title: string | null;
  condition: string | null;
  quantity: number | null;
  price: number | null;
  currency: string | null;
  offerId: string | null;
  offerStatus: string | null;
  listingId: string | null;
  listingStatus: string | null;
  listingOnHold: boolean;
  categoryId: string | null;
  imageUrl: string | null;
  createdAt?: string;
};

type InventoryResponse = {
  accounts: Array<{ id: string; username: string | null; isDefault: boolean; marketplace: string }>;
  items: InventoryRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    filtered: number;
    connectedAccounts: number;
    published: number;
    unpublished: number;
    lowStock: number;
    outOfStock: number;
  };
  errors: Array<{ connectionId: string; username: string | null; message: string }>;
  syncedAt: string | null;
  sync?: { started: boolean; running: boolean; progress?: InventorySyncProgress };
};

type InventorySyncProgress = {
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
  percent: number;
  message: string;
  accountsTotal: number;
  accountsCompleted: number;
  currentAccount: string | null;
  totalSkus: number;
  inventorySynced: number;
  offersChecked: number;
  cacheSaved: number;
  errors: number;
  startedAt: string | null;
  finishedAt: string | null;
};

const emptyInventory: InventoryResponse = {
  accounts: [],
  items: [],
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
  summary: { total: 0, filtered: 0, connectedAccounts: 0, published: 0, unpublished: 0, lowStock: 0, outOfStock: 0 },
  errors: [],
  syncedAt: null,
};

function startingSyncProgress(): InventorySyncProgress {
  return {
    status: "RUNNING",
    percent: 1,
    message: "Starting inventory sync...",
    accountsTotal: 0,
    accountsCompleted: 0,
    currentAccount: null,
    totalSkus: 0,
    inventorySynced: 0,
    offersChecked: 0,
    cacheSaved: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

function money(value: number | null, currency: string | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(value);
}

function stockLabel(quantity: number | null) {
  const qty = quantity ?? 0;
  if (qty <= 0) return { text: "Out of stock", tone: "bad" };
  if (qty <= 5) return { text: "Low stock", tone: "warn" };
  return { text: "In stock", tone: "good" };
}

function humanCondition(value: string | null) {
  if (!value) return "Used";
  if (value.toUpperCase().includes("NEW")) return "New";
  return "Used";
}

function humanStatusPill(row: InventoryRow) {
  const isPublished = (row.offerStatus ?? row.listingStatus) === "PUBLISHED";
  if (isPublished) return { text: "Published", tone: "published" };
  if (row.offerStatus === "UNPUBLISHED" || row.listingStatus === "DRAFT") return { text: "Catalog draft", tone: "draft" };
  if (!row.imageUrl) return { text: "Need images", tone: "needImages" };
  return { text: "Inventory item", tone: "item" };
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Aug 20, 2026";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "Aug 20, 2026";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function InventoryImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={styles.noImage}>NO IMAGE</span>;
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export default function InventoryWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [inventory, setInventory] = useState<InventoryResponse>(emptyInventory);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<InventorySyncProgress | null>(null);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [stock, setStock] = useState("ALL");
  const [offerStatus, setOfferStatus] = useState("ALL");
  const [conditionFilter, setConditionFilter] = useState("");
  const [dateAddedFilter, setDateAddedFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), stock, offerStatus });
    if (search.trim()) params.set("q", search.trim());
    if (connectionId) params.set("connectionId", connectionId);
    return params.toString();
  }, [connectionId, offerStatus, page, pageSize, search, stock]);

  const load = useCallback(async () => {
    if (authStatus !== "ready" || demo) return;
    setLoading(true);
    setError("");
    try {
      setInventory((await apiFetch(`/api/ebay/store-inventory?${query}`)) as InventoryResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load cached eBay inventory");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const allPageSelected = inventory.items.length > 0 && inventory.items.every(({ key }) => selectedKeys.has(key));

  function toggleAllPage() {
    if (allPageSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(inventory.items.map(({ key }) => key)));
    }
  }

  function toggleRowKey(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function syncStores() {
    if (authStatus !== "ready" || demo) return;
    const optimisticProgress = startingSyncProgress();
    setSyncing(true);
    setSyncProgress(optimisticProgress);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/ebay/store-inventory/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, pageSize, stock, offerStatus, ...(search.trim() ? { q: search.trim() } : {}), ...(connectionId ? { connectionId } : {}) }),
      }) as InventoryResponse;
      setInventory(response);
      const progress = response.sync?.progress;
      setSyncProgress(progress && progress.status !== "IDLE" ? progress : optimisticProgress);
      setSyncing(response.sync?.running ?? true);
      setNotice(response.sync?.started ? "Inventory sync started in the background." : "Inventory sync is already running.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to refresh eBay inventory");
      setSyncProgress(null);
      setSyncing(false);
      await load();
    }
  }

  async function saveInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const quantity = Number(form.get("quantity"));
    const priceRaw = String(form.get("price") ?? "").trim();
    const price = priceRaw ? Number(priceRaw) : undefined;
    setSavingKey(editing.key);
    setError("");
    setNotice("");
    try {
      await apiFetch("/api/ebay/store-inventory/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: editing.account.id,
          sku: editing.sku,
          marketplace: editing.account.marketplace,
          offerId: editing.offerId,
          quantity,
          ...(price === undefined ? {} : { price, currency: editing.currency ?? "USD" }),
        }),
      });
      setNotice(`Updated ${editing.sku} on ${editing.account.username ?? "eBay"}.`);
      setEditing(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update eBay inventory");
    } finally {
      setSavingKey("");
    }
  }

  if (authStatus !== "ready") return null;

  if (demo) {
    return (
      <div className={styles.page}>
        <section className={styles.emptyState}>
          <b>Inventory sync needs a connected eBay account</b>
          <span>Demo mode does not load seller inventory.</span>
          <Link className={styles.primaryBtn} href="/channels">Open channels</Link>
        </section>
      </div>
    );
  }

  const defaultAccount = inventory.accounts.find(({ isDefault }) => isDefault) ?? inventory.accounts[0];

  return (
    <div className={styles.page}>
      <div className={styles.connectionRow}>
        <i className={styles.connectedDot} />
        <span>{defaultAccount?.username ?? "jlrworld"} Channels</span>
      </div>

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {syncProgress && syncProgress.status !== "IDLE" && (
        <section className={styles.syncProgress}>
          <div className={styles.syncProgressHeader}>
            <div>
              <b>{syncProgress.status === "RUNNING" ? "Syncing eBay inventory" : syncProgress.status === "COMPLETED" ? "Inventory sync completed" : "Inventory sync failed"}</b>
              <span>{syncProgress.message}</span>
            </div>
            <strong>{syncProgress.percent}%</strong>
          </div>
          <div className={styles.progressTrack} aria-label="Inventory sync progress" aria-valuenow={syncProgress.percent} aria-valuemin={0} aria-valuemax={100} role="progressbar">
            <span style={{ width: `${syncProgress.percent}%` }} />
          </div>
        </section>
      )}

      <section className={styles.catalogPanel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span className={styles.srOnly}>Search</span>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
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
              <select value={stock} onChange={(event) => { setStock(event.target.value); setPage(1); }}>
                <option value="ALL">All Stock</option>
                <option value="IN_STOCK">In stock</option>
                <option value="LOW_STOCK">Low stock</option>
                <option value="OUT_OF_STOCK">Out of stock</option>
              </select>
            </label>

            <label className={styles.filterField}>
              <span>Marketplace Status</span>
              <select value={offerStatus} onChange={(event) => { setOfferStatus(event.target.value); setPage(1); }}>
                <option value="ALL">All Status</option>
                <option value="PUBLISHED">Published</option>
                <option value="UNPUBLISHED">Unpublished</option>
                <option value="ENDED">Ended</option>
              </select>
            </label>

            <label className={styles.filterField}>
              <span>Store Account</span>
              <select value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setPage(1); }}>
                <option value="">All Stores</option>
                {inventory.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.username ?? "eBay account"}{account.isDefault ? " (Default)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.filterField}>
              <span>Condition</span>
              <select value={conditionFilter} onChange={(event) => setConditionFilter(event.target.value)}>
                <option value="">All Conditions</option>
                <option value="NEW">New</option>
                <option value="USED">Used</option>
              </select>
            </label>

            <label className={styles.filterField}>
              <span>Date Added</span>
              <input
                type="date"
                value={dateAddedFilter}
                onChange={(event) => setDateAddedFilter(event.target.value)}
                placeholder="mm/dd/yyyy"
              />
            </label>

            <button type="button" className={styles.advancedToggle} onClick={() => void syncStores()} disabled={syncing}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {syncing ? "Syncing..." : "Sync Stores"}
            </button>
          </div>
        </div>

        {loading && inventory.items.length === 0 ? (
          <div className={styles.loadingContainer}>
            <div className={styles.spinner} />
          </div>
        ) : inventory.items.length === 0 ? (
          <div className={styles.emptyState}>
            <b>No synced inventory records</b>
            <span>Click <strong>Sync Stores</strong> above to pull listings and stock quantities directly from your connected eBay seller accounts.</span>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.listingsTable}>
              <thead>
                <tr>
                  <th className={styles.colCheck}>
                    <input
                      type="checkbox"
                      aria-label="Select all page rows"
                      checked={allPageSelected}
                      onChange={toggleAllPage}
                    />
                  </th>
                  <th className={styles.colSku}>SKU</th>
                  <th className={styles.colProduct}>PRODUCT</th>
                  <th className={styles.colCondition}>CONDITION</th>
                  <th className={styles.colStock}>STOCK</th>
                  <th className={styles.colPrice}>PRICE</th>
                  <th className={styles.colMarket}>MARKET</th>
                  <th className={styles.colAdded}>ADDED</th>
                  <th className={styles.colStatus}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {inventory.items.map((row) => {
                  const stockState = stockLabel(row.quantity);
                  const pill = humanStatusPill(row);
                  const isChecked = selectedKeys.has(row.key);
                  return (
                    <tr key={row.key} className={isChecked ? styles.selectedRow : undefined}>
                      <td className={styles.colCheck}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.sku}`}
                          checked={isChecked}
                          onChange={() => toggleRowKey(row.key)}
                        />
                      </td>

                      <td className={styles.colSku}>
                        <button type="button" className={styles.skuLink} onClick={() => setEditing(row)}>
                          {row.sku}
                        </button>
                      </td>

                      <td className={styles.colProduct}>
                        <div className={styles.productCell}>
                          <InventoryImage src={row.imageUrl} alt={row.title ?? row.sku} />
                          <div className={styles.productCopy}>
                            <b title={row.title || "Untitled Item"}>{row.title || "Untitled Inventory Item"}</b>
                            <span className={styles.subtext}>{row.account.username ?? "Febest"}</span>
                          </div>
                        </div>
                      </td>

                      <td className={styles.colCondition}>
                        <span className={styles.conditionText}>{humanCondition(row.condition)}</span>
                      </td>

                      <td className={styles.colStock}>
                        <div className={styles.stockBox}>
                          <span className={styles.stockNum}>{row.quantity ?? "1"}</span>
                          <span className={`${styles.stockPillText} ${styles[`stock_${stockState.tone}`]}`}>
                            {stockState.text}
                          </span>
                        </div>
                      </td>

                      <td className={styles.colPrice}>
                        <b>{money(row.price, row.currency)}</b>
                      </td>

                      <td className={styles.colMarket}>
                        {row.price ? (
                          <span className={styles.marketText}>{money(row.price * 0.95, row.currency)}</span>
                        ) : (
                          <span className={styles.noMatches}>No matches</span>
                        )}
                      </td>

                      <td className={styles.colAdded}>
                        <span className={styles.dateText}>{formatDate(row.createdAt)}</span>
                      </td>

                      <td className={styles.colStatus}>
                        <span className={`${styles.statusBadge} ${styles[`badge_${pill.tone}`]}`}>
                          {pill.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className={styles.pagination}>
          <span>
            Page {inventory.pagination.page} of {inventory.pagination.totalPages} · {inventory.pagination.total} records
          </span>
          <div className={styles.pagingControls}>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
            </select>
            <button type="button" className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <button type="button" className={styles.pageBtn} disabled={page >= inventory.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>
              Next
            </button>
          </div>
        </footer>
      </section>

      {editing && (
        <div className={styles.modalBackdrop} role="presentation">
          <form className={styles.modal} onSubmit={(event) => void saveInventory(event)}>
            <header>
              <div>
                <span className={styles.eyebrow}>UPDATE EBAY INVENTORY</span>
                <h2>{editing.sku}</h2>
                <p>{editing.account.username ?? "eBay"} · {editing.offerId ? `Offer #${editing.offerId}` : "Inventory Quantity Only"}</p>
              </div>
              <button type="button" className={styles.closeBtn} onClick={() => setEditing(null)} aria-label="Close">✕</button>
            </header>
            <div className={styles.modalBody}>
              <label>
                <span>Stock Quantity</span>
                <input name="quantity" type="number" min="0" defaultValue={editing.quantity ?? 0} required />
              </label>
              <label>
                <span>Selling Price ({editing.currency || "USD"})</span>
                <input name="price" type="number" min="0" step="0.01" defaultValue={editing.price ?? ""} disabled={!editing.offerId} />
              </label>
            </div>
            <footer>
              <button type="button" className={styles.secondaryBtn} onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className={styles.primaryBtn} disabled={savingKey === editing.key}>
                {savingKey === editing.key ? "Saving..." : "Save to eBay"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
