"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { ebayConnectNotice } from "../../lib/ebay-connect";
import type { EbayConnection, EbaySellerResources } from "../catalog/types";
import styles from "./channels.module.css";

function humanStatus(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scopeLabel(scope: string) {
  const match = scope.match(/api_scope\/([a-z0-9._-]+)$/i);
  return match?.[1]?.replaceAll(".", " ") ?? scope;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function marketplaceLabel(value: string) {
  if (value === "EBAY_GB") return "eBay UK";
  if (value === "EBAY_DE") return "eBay Germany";
  return "eBay US";
}

const demoConnection: EbayConnection = {
  connected: false,
  status: "NOT_CONNECTED",
  setup: { configured: true, environment: "sandbox", ruNameLooksValid: true, scopes: [] },
};

const demoResources: EbaySellerResources = {
  marketplace: "EBAY_US",
  paymentPolicies: [{ type: "PAYMENT_POLICY", remoteId: "pay-1", name: "Immediate Pay", enabled: true, fetchedAt: new Date().toISOString() }],
  returnPolicies: [{ type: "RETURN_POLICY", remoteId: "ret-1", name: "30 Day Returns", enabled: true, fetchedAt: new Date().toISOString() }],
  fulfillmentPolicies: [
    { type: "FULFILLMENT_POLICY", remoteId: "ship-1", name: "Ground · 3–5 days", enabled: true, fetchedAt: new Date().toISOString() },
    { type: "FULFILLMENT_POLICY", remoteId: "ship-2", name: "Expedited · 1–2 days", enabled: true, fetchedAt: new Date().toISOString() },
  ],
  inventoryLocations: [{ type: "INVENTORY_LOCATION", remoteId: "main", name: "Main Warehouse", enabled: true, fetchedAt: new Date().toISOString() }],
};

const upcomingChannels = [
  { id: "amazon", name: "Amazon", description: "Seller Central listings and orders" },
  { id: "shopify", name: "Shopify", description: "Sync inventory to a Shopify storefront" },
];

function ResourcePanel({ title, items }: { title: string; items: Array<{ remoteId: string; name: string | null }> }) {
  return (
    <section className={styles.resourcePanel}>
      <header>
        <h3>{title}</h3>
        <span>{items.length}</span>
      </header>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.remoteId}>
              <strong>{item.name || item.remoteId}</strong>
              <small>{item.remoteId}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyResource}>None cached yet. Run sync to pull from eBay.</p>
      )}
    </section>
  );
}

export default function ChannelsWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [ebay, setEbay] = useState<EbayConnection>(demoConnection);
  const [resources, setResources] = useState<EbaySellerResources | null>(null);
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [ebayExpanded, setEbayExpanded] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const ebayConnected = ebay.connected && ebay.status === "ACTIVE";

  const loadConnection = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setEbay(demoConnection);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setEbay(await apiFetch("/api/ebay/connection") as EbayConnection);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load connected stores");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo]);

  const loadResources = useCallback(async (targetMarketplace: string) => {
    if (authStatus !== "ready" || !ebayConnected) return;
    if (demo) {
      setResources({ ...demoResources, marketplace: targetMarketplace });
      return;
    }
    try {
      setResources(await apiFetch(`/api/ebay/resources?marketplace=${encodeURIComponent(targetMarketplace)}`) as EbaySellerResources);
    } catch {
      setResources(null);
    }
  }, [apiFetch, authStatus, demo, ebayConnected]);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  useEffect(() => {
    if (ebay.registrationMarketplace) setMarketplace(ebay.registrationMarketplace);
  }, [ebay.registrationMarketplace]);

  useEffect(() => {
    if (ebayConnected) {
      setEbayExpanded(true);
      void loadResources(marketplace);
    } else {
      setEbayExpanded(false);
      setResources(null);
    }
  }, [ebayConnected, loadResources, marketplace]);

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("ebay");
    if (!result) return;
    setNotice(ebayConnectNotice(result, params.get("ebay_reason"), params.get("ebay_message")));
    window.history.replaceState({}, "", window.location.pathname);
    void loadConnection();
  }, [authStatus, demo, loadConnection]);

  async function connectEbay() {
    if (demo || busy) return;
    setBusy("connect");
    setError("");
    try {
      const response = await apiFetch("/api/ebay/connection/authorize", { method: "POST" }) as { authorizationUrl: string };
      window.location.assign(response.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start eBay authorization");
      setBusy("");
    }
  }

  async function disconnectEbay() {
    if (demo || busy || !window.confirm("Disconnect this eBay seller account? Publishing access will stop until it is reconnected.")) return;
    setBusy("disconnect");
    setError("");
    setNotice("");
    try {
      setEbay(await apiFetch("/api/ebay/connection", { method: "DELETE" }) as EbayConnection);
      setResources(null);
      setNotice("eBay seller account disconnected.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to disconnect eBay");
    } finally {
      setBusy("");
    }
  }

  async function syncSellerDetails() {
    if (demo) {
      setNotice("Seller sync is unavailable in development preview.");
      return;
    }
    if (!ebayConnected) {
      setError("Connect eBay before syncing seller details.");
      return;
    }
    setBusy("sync");
    setError("");
    setNotice("");
    try {
      setResources(await apiFetch("/api/ebay/resources/sync", {
        method: "POST",
        body: JSON.stringify({ marketplace }),
      }) as EbaySellerResources);
      setNotice(`Synced payment, return, shipping policies and inventory locations for ${marketplaceLabel(marketplace)}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sync seller details from eBay");
    } finally {
      setBusy("");
    }
  }

  const lastSyncedAt = useMemo(() => {
    const timestamps = [
      ...(resources?.paymentPolicies ?? []),
      ...(resources?.returnPolicies ?? []),
      ...(resources?.fulfillmentPolicies ?? []),
      ...(resources?.inventoryLocations ?? []),
    ].map((item) => item.fetchedAt);
    if (!timestamps.length) return null;
    return timestamps.reduce((latest, value) => (value > latest ? value : latest));
  }, [resources]);

  const ebayStatusClass = ebayConnected
    ? styles.statusConnected
    : ebay.status === "ERROR" || ebay.status === "EXPIRED"
      ? styles.statusError
      : styles.statusOffline;

  const paymentPolicies = resources?.paymentPolicies.filter((policy) => policy.enabled) ?? [];
  const returnPolicies = resources?.returnPolicies.filter((policy) => policy.enabled) ?? [];
  const shippingPolicies = resources?.fulfillmentPolicies.filter((policy) => policy.enabled) ?? [];
  const locations = resources?.inventoryLocations.filter((policy) => policy.enabled) ?? [];

  return (
    <section className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Channels</h1>
          <p>Connect marketplace seller accounts used for listing, pricing, fitment, and order sync.</p>
        </div>
        <button type="button" className={styles.ghostBtn} disabled={loading || demo} onClick={() => void loadConnection()}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {!ebay.setup?.configured && !demo && (
        <div className={styles.error}>{ebay.setup?.message ?? "eBay seller OAuth is not configured on the API service."}</div>
      )}

      <div className={styles.grid}>
        <article
          className={`${styles.card}${ebayExpanded && ebayConnected ? ` ${styles.cardExpanded}` : ""}${ebayConnected ? ` ${styles.cardInteractive}` : ""}`}
        >
          <button
            type="button"
            className={styles.cardToggle}
            disabled={!ebayConnected}
            aria-expanded={ebayExpanded}
            onClick={() => ebayConnected && setEbayExpanded((value) => !value)}
          >
            <div className={styles.cardHead}>
              <div className={styles.brand}>
                <div className={styles.logo}>eBay</div>
                <div>
                  <h2>eBay</h2>
                  <p>Seller inventory, offers, and business policies</p>
                </div>
              </div>
              <span className={`${styles.status} ${ebayStatusClass}`}>
                <i className={styles.dot} />
                {ebayConnected ? "Connected" : humanStatus(ebay.status)}
              </span>
            </div>
          </button>

          <div className={styles.meta}>
            <div className={styles.metaRow}>
              <span>Account</span>
              <strong>{ebay.username || ebay.ebayUserId || "Not connected"}</strong>
            </div>
            <div className={styles.metaRow}>
              <span>Environment</span>
              <strong>{ebay.environment ? humanStatus(ebay.environment) : ebay.setup?.environment ? humanStatus(ebay.setup.environment) : "—"}</strong>
            </div>
            <div className={styles.metaRow}>
              <span>Marketplace</span>
              <strong>{ebay.registrationMarketplace ?? "—"}</strong>
            </div>
            <div className={styles.metaRow}>
              <span>Token refreshed</span>
              <strong>{formatTime(ebay.lastRefreshedAt)}</strong>
            </div>
            {ebay.lastError && (
              <div className={styles.metaRow}>
                <span>Last error</span>
                <strong>{ebay.lastError}</strong>
              </div>
            )}
          </div>

          {ebay.scopes?.length ? (
            <div className={styles.scopes}>
              {ebay.scopes.map((scope) => (
                <span key={scope} className={styles.scope}>{scopeLabel(scope)}</span>
              ))}
            </div>
          ) : null}

          {ebayExpanded && ebayConnected && (
            <section className={styles.detailPanel}>
              <div className={styles.detailToolbar}>
                <label className={styles.marketplaceField}>
                  <span>Sync marketplace</span>
                  <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
                    <option value="EBAY_US">eBay US</option>
                    <option value="EBAY_GB">eBay UK</option>
                    <option value="EBAY_DE">eBay Germany</option>
                  </select>
                </label>
                <div className={styles.detailActions}>
                  <button type="button" className={styles.primary} disabled={!!busy || demo} onClick={() => void syncSellerDetails()}>
                    {busy === "sync" ? "Syncing..." : "Sync policies & locations"}
                  </button>
                  <Link href="/shipping" className={styles.secondaryLink}>Assign to drafts</Link>
                </div>
              </div>

              <div className={styles.syncSummary}>
                <article><span>Payment policies</span><strong>{paymentPolicies.length}</strong></article>
                <article><span>Return policies</span><strong>{returnPolicies.length}</strong></article>
                <article><span>Shipping policies</span><strong>{shippingPolicies.length}</strong></article>
                <article><span>Inventory locations</span><strong>{locations.length}</strong></article>
              </div>

              <p className={styles.syncHint}>
                Last synced {formatTime(lastSyncedAt)} · Used by listing drafts, shipping assignment, and live eBay validation.
              </p>

              <div className={styles.resourceGrid}>
                <ResourcePanel title="Payment policies" items={paymentPolicies} />
                <ResourcePanel title="Return policies" items={returnPolicies} />
                <ResourcePanel title="Shipping policies" items={shippingPolicies} />
                <ResourcePanel title="Inventory locations" items={locations} />
              </div>
            </section>
          )}

          <div className={styles.actions}>
            {ebayConnected
              ? <>
                  <button type="button" className={styles.ghostAction} disabled={!!busy || demo} onClick={() => setEbayExpanded(true)}>
                    {ebayExpanded ? "Details open" : "View details"}
                  </button>
                  <button type="button" className={styles.primary} disabled={!!busy || demo} onClick={() => void connectEbay()}>
                    {busy === "connect" ? "Opening..." : "Reconnect"}
                  </button>
                  <button type="button" className={styles.dangerBtn} disabled={!!busy || demo} onClick={() => void disconnectEbay()}>
                    {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                  </button>
                </>
              : <button type="button" className={styles.primary} disabled={!!busy || demo || !ebay.setup?.configured} onClick={() => void connectEbay()}>
                  {busy === "connect" ? "Opening eBay..." : "Connect eBay"}
                </button>}
          </div>
        </article>

        {upcomingChannels.map((channel) => (
          <article key={channel.id} className={`${styles.card} ${styles.cardMuted}`}>
            <div className={styles.cardHead}>
              <div className={styles.brand}>
                <div className={styles.logo}>{channel.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h2>{channel.name}</h2>
                  <p>{channel.description}</p>
                </div>
              </div>
              <span className={`${styles.status} ${styles.statusOffline}`}>
                <i className={styles.dot} />
                Coming soon
              </span>
            </div>
            <p className={styles.comingSoon}>This marketplace integration is not available yet.</p>
          </article>
        ))}
      </div>
    </section>
  );
}
