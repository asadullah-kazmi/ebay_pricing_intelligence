"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import type { EbaySellerResources, ListingDraft } from "../catalog/types";
import styles from "./shipping.module.css";

type EbayConnection = {
  connected: boolean;
  username?: string | null;
  ebayUserId?: string | null;
};

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function policyLabel(draft: ListingDraft) {
  if (draft.shippingPolicyId) return "Assigned";
  return "Unassigned";
}

const demoDrafts: ListingDraft[] = [
  {
    id: "d1",
    partId: "p1",
    marketplace: "EBAY_US",
    status: "BLOCKED",
    title: "2014 Chevy Silverado Right Headlight Assembly",
    description: null,
    categoryId: null,
    condition: "USED",
    ebayCondition: null,
    price: 129.99,
    currency: "USD",
    quantity: 1,
    aspects: {},
    paymentPolicyId: "pay-1",
    returnPolicyId: "ret-1",
    shippingPolicyId: null,
    merchantLocationKey: null,
    validationIssues: [{ code: "SHIPPING", severity: "BLOCKER", field: "shippingPolicyId", message: "Shipping policy required" }],
    validatedAt: null,
    liveValidatedAt: null,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    part: { sku: "GM-HL-14-R", primaryPartNumber: "84178783", partName: "Right Headlight Assembly" },
  },
  {
    id: "d2",
    partId: "p2",
    marketplace: "EBAY_US",
    status: "READY",
    title: "Audi A4 Rear Brake Caliper",
    description: null,
    categoryId: null,
    condition: "USED",
    ebayCondition: null,
    price: 89.5,
    currency: "USD",
    quantity: 2,
    aspects: {},
    paymentPolicyId: "pay-1",
    returnPolicyId: "ret-1",
    shippingPolicyId: "ship-ground",
    merchantLocationKey: "main",
    validationIssues: [],
    validatedAt: null,
    liveValidatedAt: null,
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    part: { sku: "AUD-8K0615301M", primaryPartNumber: "8K0615301M", partName: "Rear Brake Caliper" },
  },
];

const demoResources: EbaySellerResources = {
  marketplace: "EBAY_US",
  paymentPolicies: [{ type: "PAYMENT_POLICY", remoteId: "pay-1", name: "Immediate Pay", enabled: true, fetchedAt: new Date().toISOString() }],
  returnPolicies: [{ type: "RETURN_POLICY", remoteId: "ret-1", name: "30 Day Returns", enabled: true, fetchedAt: new Date().toISOString() }],
  fulfillmentPolicies: [
    { type: "FULFILLMENT_POLICY", remoteId: "ship-ground", name: "Ground · 3–5 days", enabled: true, fetchedAt: new Date().toISOString() },
    { type: "FULFILLMENT_POLICY", remoteId: "ship-expedited", name: "Expedited · 1–2 days", enabled: true, fetchedAt: new Date().toISOString() },
    { type: "FULFILLMENT_POLICY", remoteId: "ship-freight", name: "Freight · oversized", enabled: true, fetchedAt: new Date().toISOString() },
  ],
  inventoryLocations: [{ type: "INVENTORY_LOCATION", remoteId: "main", name: "Main Warehouse", enabled: true, fetchedAt: new Date().toISOString() }],
};

export default function ShippingWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [drafts, setDrafts] = useState<ListingDraft[]>([]);
  const [resources, setResources] = useState<EbaySellerResources | null>(null);
  const [ebay, setEbay] = useState<EbayConnection | null>(null);
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [policyFilter, setPolicyFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setDrafts(demoDrafts);
      setResources(demoResources);
      setEbay({ connected: false });
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [draftList, connection] = await Promise.all([
        apiFetch("/api/listing-drafts?limit=50") as Promise<ListingDraft[]>,
        apiFetch("/api/ebay/connection") as Promise<EbayConnection>,
      ]);
      setDrafts(draftList);
      setEbay(connection);
      if (connection.connected) {
        setResources(await apiFetch(`/api/ebay/resources?marketplace=${encodeURIComponent(marketplace)}`) as EbaySellerResources);
      } else {
        setResources(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load shipping data");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo, marketplace]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drafts.filter((draft) => {
      if (policyFilter === "assigned" && !draft.shippingPolicyId) return false;
      if (policyFilter === "unassigned" && draft.shippingPolicyId) return false;
      if (!q) return true;
      return (
        draft.title.toLowerCase().includes(q) ||
        draft.part.sku.toLowerCase().includes(q) ||
        draft.part.primaryPartNumber.toLowerCase().includes(q)
      );
    });
  }, [drafts, policyFilter, search]);

  const metrics = useMemo(() => {
    const unassigned = drafts.filter((draft) => !draft.shippingPolicyId).length;
    const assigned = drafts.filter((draft) => Boolean(draft.shippingPolicyId)).length;
    const blocked = drafts.filter((draft) => draft.status === "BLOCKED").length;
    const policies = resources?.fulfillmentPolicies.filter((policy) => policy.enabled).length ?? 0;
    return { unassigned, assigned, blocked, policies };
  }, [drafts, resources]);

  const allSelected = filtered.length > 0 && filtered.every((draft) => selected.has(draft.partId));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((draft) => draft.partId)));
  }

  function toggleOne(partId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });
  }

  async function syncPolicies() {
    if (demo) {
      setNotice("Policy sync is unavailable in development preview.");
      return;
    }
    if (!ebay?.connected) {
      setError("Connect eBay before syncing shipping policies.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setResources(await apiFetch("/api/ebay/resources/sync", {
        method: "POST",
        body: JSON.stringify({ marketplace }),
      }) as EbaySellerResources);
      setNotice("eBay shipping policies and locations refreshed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sync policies");
    } finally {
      setBusy(false);
    }
  }

  async function assignPolicies(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected.size) return;
    if (demo) {
      setNotice("Bulk policy assignment runs against live listing drafts outside preview mode.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiFetch("/api/listing-drafts/bulk-policies", {
        method: "POST",
        body: JSON.stringify({
          partIds: [...selected],
          marketplace,
          paymentPolicyId: String(form.get("paymentPolicyId")),
          returnPolicyId: String(form.get("returnPolicyId")),
          shippingPolicyId: String(form.get("shippingPolicyId")),
          merchantLocationKey: String(form.get("merchantLocationKey")),
        }),
      });
      setSelected(new Set());
      setNotice(`Shipping policies assigned to ${selected.size} draft${selected.size === 1 ? "" : "s"}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to assign shipping policies");
    } finally {
      setBusy(false);
    }
  }

  if (authStatus !== "ready") return null;

  const shippingPolicies = resources?.fulfillmentPolicies.filter((policy) => policy.enabled) ?? [];
  const paymentPolicies = resources?.paymentPolicies.filter((policy) => policy.enabled) ?? [];
  const returnPolicies = resources?.returnPolicies.filter((policy) => policy.enabled) ?? [];
  const locations = resources?.inventoryLocations.filter((policy) => policy.enabled) ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Shipping</h1>
          <p>Assign eBay fulfillment policies and merchant locations to listing drafts before publish.</p>
        </div>
        <div className={styles.topActions}>
          <label className={styles.inlineField}>
            <span>Marketplace</span>
            <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
              <option value="EBAY_US">eBay US</option>
              <option value="EBAY_GB">eBay UK</option>
              <option value="EBAY_DE">eBay DE</option>
            </select>
          </label>
          <button type="button" className={styles.ghostBtn} disabled={busy} onClick={() => void syncPolicies()}>
            {busy ? "Syncing..." : "Sync policies"}
          </button>
          <Link className={styles.primary} href="/catalog">Open drafts</Link>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      {demo && <div className={styles.notice}>Development preview — sample drafts and shipping policies shown.</div>}

      <section className={styles.metrics}>
        <article><span>Unassigned shipping</span><b className={styles.metricWarn}>{metrics.unassigned}</b><small>Drafts missing fulfillment policy</small></article>
        <article><span>Assigned</span><b className={styles.metricGood}>{metrics.assigned}</b><small>Ready for shipping setup</small></article>
        <article><span>Blocked drafts</span><b className={styles.metricBad}>{metrics.blocked}</b><small>Need readiness fixes</small></article>
        <article><span>Cached policies</span><b>{metrics.policies}</b><small>{ebay?.connected ? "From connected seller" : "Connect eBay to refresh"}</small></article>
      </section>

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <label className={styles.searchBox}>
              <span className={styles.srOnly}>Search drafts</span>
              <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search drafts by SKU or title..."/>
            </label>
            <label className={styles.filterField}>
              <span>Shipping</span>
              <select value={policyFilter} onChange={(event) => setPolicyFilter(event.target.value)}>
                <option value="">All drafts</option>
                <option value="unassigned">Unassigned</option>
                <option value="assigned">Assigned</option>
              </select>
            </label>
          </div>

          {selected.size > 0 && (
            <form className={styles.bulkBar} onSubmit={assignPolicies}>
              <b>{selected.size} selected</b>
              <select name="paymentPolicyId" required defaultValue="">
                <option value="" disabled>Payment policy</option>
                {paymentPolicies.map((policy) => <option key={policy.remoteId} value={policy.remoteId}>{policy.name}</option>)}
              </select>
              <select name="returnPolicyId" required defaultValue="">
                <option value="" disabled>Return policy</option>
                {returnPolicies.map((policy) => <option key={policy.remoteId} value={policy.remoteId}>{policy.name}</option>)}
              </select>
              <select name="shippingPolicyId" required defaultValue="">
                <option value="" disabled>Shipping policy</option>
                {shippingPolicies.map((policy) => <option key={policy.remoteId} value={policy.remoteId}>{policy.name}</option>)}
              </select>
              <select name="merchantLocationKey" required defaultValue="">
                <option value="" disabled>Location</option>
                {locations.map((policy) => <option key={policy.remoteId} value={policy.remoteId}>{policy.name}</option>)}
              </select>
              <button type="submit" className={styles.bulkPrimary} disabled={busy || (!demo && (!paymentPolicies.length || !shippingPolicies.length))}>
                Assign
              </button>
              <button type="button" className={styles.bulkClose} onClick={() => setSelected(new Set())} aria-label="Clear">×</button>
            </form>
          )}

          {loading && !drafts.length ? (
            <div className={styles.empty}><b>Loading drafts...</b></div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>
              <b>No listing drafts found</b>
              <span>Create drafts from Catalog, then assign shipping policies here.</span>
              <Link href="/catalog">Go to catalog</Link>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll}/></th>
                    <th>SKU</th>
                    <th>Title</th>
                    <th>Marketplace</th>
                    <th>Shipping</th>
                    <th>Location</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((draft) => (
                    <tr key={draft.id}>
                      <td><input type="checkbox" aria-label={`Select ${draft.part.sku}`} checked={selected.has(draft.partId)} onChange={() => toggleOne(draft.partId)}/></td>
                      <td>
                        <b className={styles.sku}>{draft.part.sku}</b>
                        <span className={styles.subtle}>{draft.part.primaryPartNumber}</span>
                      </td>
                      <td>
                        <b className={styles.titleCell}>{draft.title}</b>
                      </td>
                      <td>{draft.marketplace.replace("EBAY_", "eBay ")}</td>
                      <td>
                        <span className={`${styles.statusPill} ${draft.shippingPolicyId ? styles.statusGood : styles.statusWait}`}>
                          {policyLabel(draft)}
                        </span>
                        {draft.shippingPolicyId && (
                          <span className={styles.subtle}>
                            {shippingPolicies.find((policy) => policy.remoteId === draft.shippingPolicyId)?.name || draft.shippingPolicyId}
                          </span>
                        )}
                      </td>
                      <td className={styles.subtle}>
                        {locations.find((policy) => policy.remoteId === draft.merchantLocationKey)?.name || draft.merchantLocationKey || "—"}
                      </td>
                      <td><span className={`${styles.statusPill} ${draft.status === "READY" ? styles.statusGood : draft.status === "BLOCKED" ? styles.statusBad : styles.statusWait}`}>{human(draft.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.sidePanel}>
          <div className={styles.sideHead}>
            <div>
              <span className={styles.eyebrow}>Fulfillment policies</span>
              <h2>{marketplace.replace("EBAY_", "eBay ")}</h2>
            </div>
          </div>
          {!resources ? (
            <div className={styles.empty}>
              <b>No cached policies</b>
              <span>Connect eBay and sync seller policies to manage shipping templates.</span>
            </div>
          ) : shippingPolicies.length === 0 ? (
            <div className={styles.empty}>
              <b>No shipping policies found</b>
              <span>Create fulfillment policies in eBay Seller Hub, then sync here.</span>
            </div>
          ) : (
            <div className={styles.policyList}>
              {shippingPolicies.map((policy) => (
                <article key={policy.remoteId} className={styles.policyCard}>
                  <div>
                    <b>{policy.name || policy.remoteId}</b>
                    <span>ID {policy.remoteId}</span>
                  </div>
                  <em>Enabled</em>
                </article>
              ))}
              <div className={styles.locations}>
                <span className={styles.eyebrow}>Merchant locations</span>
                {locations.map((location) => (
                  <div key={location.remoteId} className={styles.locationRow}>
                    <b>{location.name || location.remoteId}</b>
                    <span>{location.remoteId}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
