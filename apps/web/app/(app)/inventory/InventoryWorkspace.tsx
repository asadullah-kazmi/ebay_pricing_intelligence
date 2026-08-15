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

function money(value: number | null, currency: string | null) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(value);
}

function stockLabel(quantity: number | null) {
  const qty = quantity ?? 0;
  if (qty <= 0) return { text: "Out", tone: "bad" };
  if (qty <= 5) return { text: "Low", tone: "warn" };
  return { text: "In stock", tone: "good" };
}

function statusLabel(row: InventoryRow) {
  const status = row.offerStatus ?? row.listingStatus ?? "Inventory item";
  return status.replace(/_/g, " ").toLowerCase();
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

export default function InventoryWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [inventory, setInventory] = useState<InventoryResponse>(emptyInventory);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<InventorySyncProgress | null>(null);
  const [savingKey, setSavingKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [stock, setStock] = useState("ALL");
  const [offerStatus, setOfferStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [editing, setEditing] = useState<InventoryRow | null>(null);

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

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    const params = new URLSearchParams();
    if (connectionId) params.set("connectionId", connectionId);
    void apiFetch(`/api/ebay/store-inventory/sync-status${params.toString() ? `?${params.toString()}` : ""}`)
      .then((progress) => {
        const next = progress as InventorySyncProgress;
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
        const progress = await apiFetch(`/api/ebay/store-inventory/sync-status${params.toString() ? `?${params.toString()}` : ""}`) as InventorySyncProgress;
        setSyncProgress(progress);
        setSyncing(progress.status === "RUNNING");
        if (progress.status === "COMPLETED" || progress.status === "FAILED") {
          window.clearInterval(interval);
          await load();
          if (progress.status === "COMPLETED") setNotice("Inventory cache refreshed from eBay.");
          if (progress.status === "FAILED") setError("Inventory sync failed. Check API logs or try again.");
        }
      } catch {
        // Keep the current progress visible; the next poll may recover.
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [apiFetch, authStatus, connectionId, demo, load, syncProgress?.status]);

  async function syncStores() {
    if (authStatus !== "ready" || demo) return;
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/ebay/store-inventory/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, pageSize, stock, offerStatus, ...(search.trim() ? { q: search.trim() } : {}), ...(connectionId ? { connectionId } : {}) }),
      }) as InventoryResponse;
      setInventory(response);
      setSyncProgress(response.sync?.progress ?? null);
      setNotice(response.sync?.started ? "Inventory sync started in the background. Cached rows will update as eBay responds." : "Inventory sync is already running in the background.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to refresh eBay inventory");
      await load();
    } finally {
      setSyncing(false);
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

  async function withdraw(row: InventoryRow) {
    if (!row.offerId) return;
    if (!window.confirm(`Withdraw eBay offer ${row.offerId} for SKU ${row.sku}? This can end the live listing.`)) return;
    setSavingKey(row.key);
    setError("");
    setNotice("");
    try {
      await apiFetch("/api/ebay/store-inventory/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: row.account.id,
          marketplace: row.account.marketplace,
          offerId: row.offerId,
          confirmWithdraw: true,
        }),
      });
      setNotice(`Withdrawal queued by eBay for ${row.sku}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to withdraw eBay offer");
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>EBAY STORE INVENTORY</span>
          <h1>Inventory</h1>
          <p>Sync stock and offer status from every connected eBay seller account.</p>
          <span className={styles.syncMeta}>{lastSyncedLabel(inventory.syncedAt)}</span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={() => void syncStores()} disabled={syncing || loading}>
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
              <b>{syncProgress.status === "RUNNING" ? "Syncing eBay inventory" : syncProgress.status === "COMPLETED" ? "Inventory sync completed" : "Inventory sync failed"}</b>
              <span>{syncProgress.message}</span>
            </div>
            <strong>{syncProgress.percent}%</strong>
          </div>
          <div className={styles.progressTrack} aria-label="Inventory sync progress" aria-valuenow={syncProgress.percent} aria-valuemin={0} aria-valuemax={100} role="progressbar">
            <span style={{ width: `${syncProgress.percent}%` }} />
          </div>
          <div className={styles.syncProgressStats}>
            <span>{syncProgress.accountsCompleted}/{syncProgress.accountsTotal} accounts</span>
            <span>{syncProgress.inventorySynced} SKUs found</span>
            <span>{syncProgress.offersChecked}/{syncProgress.totalSkus} offers checked</span>
            <span>{syncProgress.cacheSaved} rows cached</span>
            {syncProgress.errors > 0 && <span>{syncProgress.errors} warnings</span>}
          </div>
        </section>
      )}
      {inventory.errors.length > 0 && (
        <div className={styles.warning}>
          <b>{inventory.errors.length} sync warning{inventory.errors.length === 1 ? "" : "s"}</b>
          <span>{inventory.errors.slice(0, 3).map((item) => `${item.username ?? "eBay account"}: ${item.message}`).join(" · ")}</span>
        </div>
      )}

      <section className={styles.metrics}>
        <article><span>Accounts</span><b>{inventory.summary.connectedAccounts}</b></article>
        <article><span>Synced SKUs</span><b>{inventory.summary.total}</b></article>
        <article><span>Published offers</span><b>{inventory.summary.published}</b></article>
        <article><span>Low stock</span><b>{inventory.summary.lowStock}</b></article>
        <article><span>Out of stock</span><b>{inventory.summary.outOfStock}</b></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <span>Search</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="SKU, title, listing ID, seller account" />
          </label>
          <label>
            <span>Store</span>
            <select value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setPage(1); }}>
              <option value="">All connected stores</option>
              {inventory.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.username ?? "eBay account"}{account.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Stock</span>
            <select value={stock} onChange={(event) => { setStock(event.target.value); setPage(1); }}>
              <option value="ALL">All stock</option>
              <option value="IN_STOCK">In stock</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="OUT_OF_STOCK">Out of stock</option>
            </select>
          </label>
          <label>
            <span>Offer status</span>
            <select value={offerStatus} onChange={(event) => { setOfferStatus(event.target.value); setPage(1); }}>
              <option value="ALL">All offers</option>
              <option value="PUBLISHED">Published</option>
              <option value="UNPUBLISHED">Unpublished</option>
              <option value="ENDED">Ended</option>
            </select>
          </label>
          <div className={styles.filterCount}>{inventory.summary.filtered} shown</div>
        </div>

        {loading && inventory.items.length === 0 ? (
          <div className={styles.emptyState}><b>Loading cached inventory...</b><span>Use Sync all stores when you want fresh eBay data.</span></div>
        ) : inventory.items.length === 0 ? (
          <div className={styles.emptyState}>
            <b>No eBay inventory found</b>
            <span>Click Sync all stores to build the cache, connect a store, or adjust your filters.</span>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>SKU and listing</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Category</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.items.map((row) => {
                  const stockState = stockLabel(row.quantity);
                  return (
                    <tr key={row.key}>
                      <td>
                        <b>{row.account.username ?? "eBay"}</b>
                        <span className={styles.muted}>{row.account.marketplace}{row.account.isDefault ? " · default" : ""}</span>
                      </td>
                      <td>
                        <code>{row.sku}</code>
                        <span className={styles.muted}>{row.listingId ? `Listing ${row.listingId}` : row.offerId ? `Offer ${row.offerId}` : "Inventory item only"}</span>
                      </td>
                      <td className={styles.productCell}>
                        {row.imageUrl ? <img src={row.imageUrl} alt="" /> : <span className={styles.noImage}>No image</span>}
                        <div>
                          <b>{row.title || "Untitled inventory item"}</b>
                          <span className={styles.muted}>{row.condition || "Condition not set"}</span>
                        </div>
                      </td>
                      <td>
                        <b>{row.quantity ?? "-"}</b>
                        <span className={`${styles.pill} ${styles[stockState.tone]}`}>{stockState.text}</span>
                      </td>
                      <td><b>{money(row.price, row.currency)}</b></td>
                      <td>
                        <span className={styles.status}>{statusLabel(row)}</span>
                        {row.listingOnHold && <span className={styles.muted}>On hold</span>}
                      </td>
                      <td>{row.categoryId ?? "-"}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <button type="button" onClick={() => setEditing(row)} disabled={Boolean(savingKey)}>Edit</button>
                          <button type="button" className={styles.dangerBtn} onClick={() => void withdraw(row)} disabled={!row.offerId || Boolean(savingKey)}>
                            {savingKey === row.key ? "Working..." : "Withdraw"}
                          </button>
                        </div>
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
          <div>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
            </select>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <button type="button" disabled={page >= inventory.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
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
                <p>{editing.account.username ?? "eBay"} · {editing.offerId ? `Offer ${editing.offerId}` : "inventory quantity only"}</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close">x</button>
            </header>
            <label>
              <span>Quantity</span>
              <input name="quantity" type="number" min="0" defaultValue={editing.quantity ?? 0} required />
            </label>
            <label>
              <span>Selling price</span>
              <input name="price" type="number" min="0" step="0.01" defaultValue={editing.price ?? ""} disabled={!editing.offerId} />
            </label>
            {!editing.offerId && <p className={styles.helpText}>This SKU has no offer yet, so only quantity can be updated from Inventory.</p>}
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
