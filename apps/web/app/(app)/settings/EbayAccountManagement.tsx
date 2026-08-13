"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import type { EbayConnection, EbaySellerResources } from "../catalog/types";
import styles from "./settings.module.css";

type ConnectionList = { connections: EbayConnection[] };

export default function EbayAccountManagement() {
  const { apiFetch, demo } = useAuth();
  const [connections, setConnections] = useState<EbayConnection[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [resources, setResources] = useState<EbaySellerResources | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAccounts = useCallback(async () => {
    if (demo) return;
    const value = await apiFetch("/api/ebay/connections") as ConnectionList;
    setConnections(value.connections);
    setSelectedId((current) => current || value.connections.find((item) => item.isDefault)?.id || value.connections[0]?.id || "");
  }, [apiFetch, demo]);

  useEffect(() => { void loadAccounts().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load eBay accounts")); }, [loadAccounts]);

  useEffect(() => {
    if (!selectedId || demo) { setResources(null); return; }
    const selected = connections.find((item) => item.id === selectedId);
    setMarketplace(selected?.defaultMarketplace || "EBAY_US");
  }, [connections, demo, selectedId]);

  const loadResources = useCallback(async (targetMarketplace = marketplace) => {
    if (!selectedId || demo) return;
    setResources(await apiFetch(`/api/ebay/resources?marketplace=${encodeURIComponent(targetMarketplace)}&connectionId=${encodeURIComponent(selectedId)}`) as EbaySellerResources);
  }, [apiFetch, demo, marketplace, selectedId]);

  useEffect(() => { void loadResources().catch(() => setResources(null)); }, [loadResources]);

  async function connect() {
    if (demo) return;
    setBusy("connect"); setError("");
    try {
      const result = await apiFetch("/api/ebay/connection/authorize", { method: "POST" }) as { authorizationUrl: string };
      window.location.assign(result.authorizationUrl);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start eBay authorization"); setBusy(""); }
  }

  async function sync() {
    if (!selectedId || demo) return;
    setBusy("sync"); setError(""); setNotice("");
    try {
      setResources(await apiFetch("/api/ebay/resources/sync", {
        method: "POST",
        body: JSON.stringify({ marketplace, connectionId: selectedId }),
      }) as EbaySellerResources);
      setNotice("Policies and item locations refreshed from this eBay account.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to sync seller policies"); }
    finally { setBusy(""); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || demo) return;
    const form = new FormData(event.currentTarget);
    setBusy("save"); setError(""); setNotice("");
    try {
      await apiFetch(`/api/ebay/connections/${encodeURIComponent(selectedId)}/defaults`, {
        method: "PATCH",
        body: JSON.stringify({
          isDefault: form.get("isDefault") === "on",
          defaultMarketplace: marketplace,
          defaultPaymentPolicyId: String(form.get("paymentPolicyId")),
          defaultReturnPolicyId: String(form.get("returnPolicyId")),
          defaultShippingPolicyId: String(form.get("shippingPolicyId")),
          defaultMerchantLocationKey: String(form.get("merchantLocationKey")),
        }),
      });
      await loadAccounts();
      setNotice("Default eBay account and listing policies saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save eBay defaults"); }
    finally { setBusy(""); }
  }

  const selected = connections.find((item) => item.id === selectedId);
  const option = (row: { remoteId: string; name: string | null }) => <option key={row.remoteId} value={row.remoteId}>{row.name || row.remoteId}</option>;

  return <section className={`${styles.panel} ${styles.marketplacePanel}`}>
    <div className={styles.panelHead}>
      <div><span className={styles.eyebrow}>Marketplace accounts</span><h2>eBay accounts &amp; defaults</h2></div>
      <p>Connect multiple seller accounts. New Quick SKU and Pipeline drafts inherit the default account, policies, and item location.</p>
    </div>
    {error && <div className={styles.inlineError}>{error}</div>}
    {notice && <div className={styles.inlineNotice}>{notice}</div>}
    <div className={styles.accountToolbar}>
      <label><span>Seller account</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        {!connections.length && <option value="">No accounts connected</option>}
        {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.username || connection.ebayUserId || "eBay seller"}{connection.isDefault ? " — Default" : ""}</option>)}
      </select></label>
      <button type="button" className={styles.ghostBtn} disabled={busy === "connect"} onClick={() => void connect()}>{connections.length ? "Connect another account" : "Connect eBay account"}</button>
    </div>
    {selected && <form key={`${selectedId}-${marketplace}`} className={styles.accountDefaultsForm} onSubmit={save}>
      <div className={styles.accountIdentity}><div><b>{selected.username || "eBay seller"}</b><span>{selected.registrationMarketplace || selected.environment}</span></div><span className={selected.status === "ACTIVE" ? styles.accountActive : styles.accountInactive}>{selected.status}</span></div>
      <div className={styles.accountFields}>
        <label><span>Marketplace</span><select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}><option value="EBAY_US">eBay US</option><option value="EBAY_GB">eBay UK</option><option value="EBAY_DE">eBay Germany</option></select></label>
        <label><span>Payment policy</span><select name="paymentPolicyId" required defaultValue={selected.defaultPaymentPolicyId || ""}><option value="">Select payment policy</option>{resources?.paymentPolicies.filter((item) => item.enabled).map(option)}</select></label>
        <label><span>Return policy</span><select name="returnPolicyId" required defaultValue={selected.defaultReturnPolicyId || ""}><option value="">Select return policy</option>{resources?.returnPolicies.filter((item) => item.enabled).map(option)}</select></label>
        <label><span>Shipping policy</span><select name="shippingPolicyId" required defaultValue={selected.defaultShippingPolicyId || ""}><option value="">Select shipping policy</option>{resources?.fulfillmentPolicies.filter((item) => item.enabled).map(option)}</select></label>
        <label><span>Item location</span><select name="merchantLocationKey" required defaultValue={selected.defaultMerchantLocationKey || ""}><option value="">Select item location</option>{resources?.inventoryLocations.filter((item) => item.enabled).map(option)}</select></label>
      </div>
      <label className={styles.defaultAccountCheck}><input type="checkbox" name="isDefault" defaultChecked={selected.isDefault}/><span><b>Default eBay account</b><small>Automatically assign this seller account to newly created listing drafts.</small></span></label>
      <div className={styles.accountActions}><button type="button" className={styles.ghostBtn} disabled={busy === "sync"} onClick={() => void sync()}>{busy === "sync" ? "Syncing…" : "Sync policies"}</button><button type="submit" className={styles.primary} disabled={!resources || busy === "save"}>{busy === "save" ? "Saving…" : "Save defaults"}</button></div>
    </form>}
  </section>;
}
