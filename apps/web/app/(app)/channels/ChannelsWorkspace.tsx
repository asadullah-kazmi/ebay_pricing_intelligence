"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { ebayConnectNotice } from "../../lib/ebay-connect";
import type { EbayConnection, EbaySellerResources } from "../catalog/types";
import styles from "./channels.module.css";

export interface EbayAccount {
  id: string;
  username: string;
  ebayUserId: string | null;
  status: "ACTIVE" | "NOT_CONNECTED" | "EXPIRED" | "ERROR" | "DISCONNECTED";
  isDefault: boolean;
  environment: string;
  registrationMarketplace: string;
  lastRefreshedAt: string | null;
  scopes: string[];
  lastError?: string | null;
}

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

const initialDemoAccounts: EbayAccount[] = [
  {
    id: "account-1",
    username: "PartPulse_Motors_US",
    ebayUserId: "partpulse_us_store",
    status: "ACTIVE",
    isDefault: true,
    environment: "production",
    registrationMarketplace: "EBAY_US",
    lastRefreshedAt: new Date().toISOString(),
    scopes: [
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.account",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    ],
  },
  {
    id: "account-2",
    username: "YardIntake_Parts_UK",
    ebayUserId: "yard_intake_uk",
    status: "ACTIVE",
    isDefault: false,
    environment: "production",
    registrationMarketplace: "EBAY_GB",
    lastRefreshedAt: new Date(Date.now() - 3600000).toISOString(),
    scopes: [
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.account",
    ],
  },
];

const demoResources: EbaySellerResources = {
  marketplace: "EBAY_US",
  paymentPolicies: [{ type: "PAYMENT_POLICY", remoteId: "pay-1", name: "Immediate Pay (PayPal/Managed)", enabled: true, fetchedAt: new Date().toISOString() }],
  returnPolicies: [{ type: "RETURN_POLICY", remoteId: "ret-1", name: "30 Day Returns (Seller Paid)", enabled: true, fetchedAt: new Date().toISOString() }],
  fulfillmentPolicies: [
    { type: "FULFILLMENT_POLICY", remoteId: "ship-1", name: "Standard Freight · 3–5 days", enabled: true, fetchedAt: new Date().toISOString() },
    { type: "FULFILLMENT_POLICY", remoteId: "ship-2", name: "Expedited Air · 1–2 days", enabled: true, fetchedAt: new Date().toISOString() },
  ],
  inventoryLocations: [{ type: "INVENTORY_LOCATION", remoteId: "main-wh", name: "Primary Yard & Warehouse", enabled: true, fetchedAt: new Date().toISOString() }],
};

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
  const [accounts, setAccounts] = useState<EbayAccount[]>(initialDemoAccounts);
  const [expandedId, setExpandedId] = useState<string | null>("account-1");
  const [resourcesMap, setResourcesMap] = useState<Record<string, EbaySellerResources>>({
    "account-1": demoResources,
    "account-2": { ...demoResources, marketplace: "EBAY_GB" },
  });
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadConnection = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setAccounts(initialDemoAccounts);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const conn = (await apiFetch("/api/ebay/connection")) as EbayConnection;
      if (conn.status === "ACTIVE" || conn.username || conn.ebayUserId) {
        const liveAcc: EbayAccount = {
          id: "live-account",
          username: conn.username || conn.ebayUserId || "Connected eBay Seller",
          ebayUserId: conn.ebayUserId ?? null,
          status: conn.status === "ACTIVE" ? "ACTIVE" : conn.status,
          isDefault: true,
          environment: conn.environment || conn.setup?.environment || "production",
          registrationMarketplace: conn.registrationMarketplace || "EBAY_US",
          lastRefreshedAt: conn.lastRefreshedAt ?? null,
          scopes: conn.scopes || [],
          lastError: conn.lastError,
        };
        setAccounts([liveAcc]);
      } else {
        setAccounts([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load connected seller accounts");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo]);

  const loadResources = useCallback(
    async (accountId: string, targetMarketplace: string) => {
      if (authStatus !== "ready") return;
      if (demo) {
        setResourcesMap((prev) => ({
          ...prev,
          [accountId]: { ...demoResources, marketplace: targetMarketplace },
        }));
        return;
      }
      try {
        const res = (await apiFetch(
          `/api/ebay/resources?marketplace=${encodeURIComponent(targetMarketplace)}`
        )) as EbaySellerResources;
        setResourcesMap((prev) => ({ ...prev, [accountId]: res }));
      } catch {
        // Keep fallback
      }
    },
    [apiFetch, authStatus, demo]
  );

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("ebay");
    if (!result) return;
    setNotice(ebayConnectNotice(result, params.get("ebay_reason"), params.get("ebay_message")));
    window.history.replaceState({}, "", window.location.pathname);
    void loadConnection();
  }, [authStatus, demo, loadConnection]);

  function setDefaultAccount(accountId: string) {
    setAccounts((prev) =>
      prev.map((acc) => ({
        ...acc,
        isDefault: acc.id === accountId,
      }))
    );
    const target = accounts.find((a) => a.id === accountId);
    setNotice(`Set "${target?.username || "Selected account"}" as default primary eBay account for listing sync.`);
  }

  async function connectEbay() {
    if (demo || busy) {
      if (demo) {
        setNotice("Mock OAuth redirect simulated. In production this opens eBay Authorization.");
      }
      return;
    }
    setBusy("connect");
    setError("");
    try {
      const response = (await apiFetch("/api/ebay/connection/authorize", { method: "POST" })) as {
        authorizationUrl: string;
      };
      window.location.assign(response.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start eBay authorization");
      setBusy("");
    }
  }

  async function disconnectAccount(accountId: string) {
    const acc = accounts.find((a) => a.id === accountId);
    if (
      !window.confirm(
        `Disconnect eBay seller account "${acc?.username || accountId}"? Publishing access for this store will stop.`
      )
    )
      return;

    if (!demo) {
      setBusy(`disconnect-${accountId}`);
      try {
        await apiFetch("/api/ebay/connection", { method: "DELETE" });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to disconnect eBay account");
        setBusy("");
        return;
      }
    }

    setAccounts((prev) => {
      const next = prev.filter((a) => a.id !== accountId);
      if (next.length && !next.some((a) => a.isDefault)) {
        next[0].isDefault = true;
      }
      return next;
    });
    setNotice(`eBay account "${acc?.username || accountId}" disconnected.`);
    setBusy("");
  }

  async function syncSellerDetails(accountId: string) {
    if (demo) {
      setNotice(`Synced policies and locations for ${marketplaceLabel(marketplace)}.`);
      return;
    }
    setBusy(`sync-${accountId}`);
    setError("");
    setNotice("");
    try {
      const result = (await apiFetch("/api/ebay/resources/sync", {
        method: "POST",
        body: JSON.stringify({ marketplace }),
      })) as EbaySellerResources;
      setResourcesMap((prev) => ({ ...prev, [accountId]: result }));
      setNotice(`Synced payment, return, shipping policies and inventory locations for ${marketplaceLabel(marketplace)}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sync seller details from eBay");
    } finally {
      setBusy("");
    }
  }

  const defaultAccount = useMemo(() => accounts.find((a) => a.isDefault), [accounts]);

  return (
    <section className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <div className={styles.eyebrow}>EXCLUSIVELY EBAY INTEGRATED</div>
          <h1>eBay Seller Accounts</h1>
          <p>
            Connect and manage multiple eBay seller accounts for your organization. Designate a default primary account for pricing, listing drafts, and inventory sync.
          </p>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={loading}
            onClick={() => void loadConnection()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!!busy}
            onClick={() => void connectEbay()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add eBay Account
          </button>
        </div>
      </header>

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {/* Account Overview Cards */}
      <div className={styles.accountStats}>
        <article>
          <span>Connected eBay Accounts</span>
          <b>{accounts.length}</b>
          <small>Active Seller Accounts</small>
        </article>
        <article>
          <span>Default Primary Account</span>
          <b style={{ fontSize: "20px", color: "#2563eb", marginTop: "12px" }}>
            {defaultAccount ? defaultAccount.username : "None Selected"}
          </b>
          <small>{defaultAccount ? marketplaceLabel(defaultAccount.registrationMarketplace) : "Select a default account"}</small>
        </article>
        <article>
          <span>API Connection Mode</span>
          <b style={{ fontSize: "20px", color: "#0c274d", marginTop: "12px" }}>
            REST &amp; Fulfillment API
          </b>
          <small>OAuth 2.0 PKCE Authorization</small>
        </article>
      </div>

      {accounts.length === 0 ? (
        <div className={styles.emptyStateCard}>
          <div className={styles.ebayLogoLarge}>eBay</div>
          <h2>No eBay Seller Accounts Connected</h2>
          <p>Connect your first eBay seller account to start syncing catalog items, fitment compatibility, pricing, and orders.</p>
          <button type="button" className={styles.primary} onClick={() => void connectEbay()}>
            Connect eBay Account
          </button>
        </div>
      ) : (
        <div className={styles.accountsList}>
          {accounts.map((acc) => {
            const isExpanded = expandedId === acc.id;
            const res = resourcesMap[acc.id] || demoResources;
            const paymentPolicies = res.paymentPolicies.filter((p) => p.enabled) ?? [];
            const returnPolicies = res.returnPolicies.filter((p) => p.enabled) ?? [];
            const shippingPolicies = res.fulfillmentPolicies.filter((p) => p.enabled) ?? [];
            const locations = res.inventoryLocations.filter((p) => p.enabled) ?? [];

            return (
              <article
                key={acc.id}
                className={`${styles.card} ${acc.isDefault ? styles.cardDefault : ""}`}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.brandRow}>
                    <div className={styles.ebayLogoBadge}>eBay</div>
                    <div>
                      <div className={styles.usernameRow}>
                        <h2>{acc.username}</h2>
                        {acc.isDefault ? (
                          <span className={styles.defaultBadge}>
                            ★ Default Account
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={styles.setDefaultBtn}
                            onClick={() => setDefaultAccount(acc.id)}
                          >
                            Set as Default
                          </button>
                        )}
                      </div>
                      <p>
                        User ID: <code>{acc.ebayUserId || acc.username}</code> · {marketplaceLabel(acc.registrationMarketplace)} ({acc.environment.toUpperCase()})
                      </p>
                    </div>
                  </div>

                  <div className={styles.statusGroup}>
                    <span className={`${styles.status} ${acc.status === "ACTIVE" ? styles.statusActive : styles.statusOffline}`}>
                      <i className={styles.dot} />
                      {acc.status === "ACTIVE" ? "Connected" : humanStatus(acc.status)}
                    </span>
                  </div>
                </div>

                <div className={styles.metaGrid}>
                  <div className={styles.metaItem}>
                    <span>Marketplace</span>
                    <strong>{acc.registrationMarketplace}</strong>
                  </div>
                  <div className={styles.metaItem}>
                    <span>Environment</span>
                    <strong>{humanStatus(acc.environment)}</strong>
                  </div>
                  <div className={styles.metaItem}>
                    <span>Token Refreshed</span>
                    <strong>{formatTime(acc.lastRefreshedAt)}</strong>
                  </div>
                  <div className={styles.metaItem}>
                    <span>Cached Policies</span>
                    <strong>{paymentPolicies.length + returnPolicies.length + shippingPolicies.length} Active Policies</strong>
                  </div>
                </div>

                {acc.scopes.length > 0 && (
                  <div className={styles.scopesRow}>
                    <span>Granted Permissions:</span>
                    {acc.scopes.map((scope) => (
                      <span key={scope} className={styles.scopeBadge}>
                        {scopeLabel(scope)}
                      </span>
                    ))}
                  </div>
                )}

                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => {
                      setExpandedId(isExpanded ? null : acc.id);
                      if (!isExpanded) void loadResources(acc.id, marketplace);
                    }}
                  >
                    {isExpanded ? "Hide Details" : "View Policies & Locations"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={!!busy}
                    onClick={() => void syncSellerDetails(acc.id)}
                  >
                    {busy === `sync-${acc.id}` ? "Syncing..." : "Sync Seller Details"}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    disabled={!!busy}
                    onClick={() => void connectEbay()}
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    disabled={!!busy}
                    onClick={() => void disconnectAccount(acc.id)}
                  >
                    Disconnect
                  </button>
                </div>

                {isExpanded && (
                  <section className={styles.detailPanel}>
                    <div className={styles.detailToolbar}>
                      <label className={styles.marketplaceField}>
                        <span>Sync marketplace region</span>
                        <select
                          value={marketplace}
                          onChange={(event) => {
                            setMarketplace(event.target.value);
                            void loadResources(acc.id, event.target.value);
                          }}
                        >
                          <option value="EBAY_US">eBay US</option>
                          <option value="EBAY_GB">eBay UK</option>
                          <option value="EBAY_DE">eBay Germany</option>
                        </select>
                      </label>
                      <Link href="/catalog" className={styles.primaryLink}>
                        Assign to Listings →
                      </Link>
                    </div>

                    <div className={styles.syncSummary}>
                      <article>
                        <span>Payment Policies</span>
                        <strong>{paymentPolicies.length}</strong>
                      </article>
                      <article>
                        <span>Return Policies</span>
                        <strong>{returnPolicies.length}</strong>
                      </article>
                      <article>
                        <span>Shipping Policies</span>
                        <strong>{shippingPolicies.length}</strong>
                      </article>
                      <article>
                        <span>Inventory Locations</span>
                        <strong>{locations.length}</strong>
                      </article>
                    </div>

                    <div className={styles.resourceGrid}>
                      <ResourcePanel title="Payment Policies" items={paymentPolicies} />
                      <ResourcePanel title="Return Policies" items={returnPolicies} />
                      <ResourcePanel title="Shipping Policies" items={shippingPolicies} />
                      <ResourcePanel title="Inventory Locations" items={locations} />
                    </div>
                  </section>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

