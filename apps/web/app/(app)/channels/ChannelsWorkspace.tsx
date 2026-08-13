"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  defaultMarketplace: string;
  defaultPaymentPolicyId: string | null;
  defaultReturnPolicyId: string | null;
  defaultShippingPolicyId: string | null;
  defaultMerchantLocationKey: string | null;
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

function marketplaceFlag(value: string) {
  if (value === "EBAY_GB") return "🇬🇧";
  if (value === "EBAY_DE") return "🇩🇪";
  return "🇺🇸";
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
    defaultMarketplace: "EBAY_US",
    defaultPaymentPolicyId: "pay-1",
    defaultReturnPolicyId: "ret-1",
    defaultShippingPolicyId: "ship-1",
    defaultMerchantLocationKey: "main-wh",
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
    defaultMarketplace: "EBAY_GB",
    defaultPaymentPolicyId: "pay-1",
    defaultReturnPolicyId: "ret-1",
    defaultShippingPolicyId: "ship-1",
    defaultMerchantLocationKey: "main-wh",
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

export default function ChannelsWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [accounts, setAccounts] = useState<EbayAccount[]>(initialDemoAccounts);
  const [expandedId, setExpandedId] = useState<string | null>("account-1");
  const [activeTabMap, setActiveTabMap] = useState<Record<string, "defaults" | "resources" | "security">>({});
  const [resourceSubTabMap, setResourceSubTabMap] = useState<Record<string, "payment" | "return" | "shipping" | "locations">>({});
  
  const [resourcesMap, setResourcesMap] = useState<Record<string, EbaySellerResources>>({
    "account-1": demoResources,
    "account-2": { ...demoResources, marketplace: "EBAY_GB" },
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [filterMarketplace, setFilterMarketplace] = useState<string>("ALL");
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
      const result = (await apiFetch("/api/ebay/connections")) as { connections: EbayConnection[] };
      const liveAccounts = result.connections
        .filter((connection): connection is EbayConnection & { id: string } => Boolean(connection.id))
        .map((connection): EbayAccount => ({
          id: connection.id,
          username: connection.username || connection.ebayUserId || "Connected eBay Seller",
          ebayUserId: connection.ebayUserId ?? null,
          status: connection.status,
          isDefault: Boolean(connection.isDefault),
          environment: connection.environment || "production",
          registrationMarketplace: connection.registrationMarketplace || connection.defaultMarketplace || "EBAY_US",
          lastRefreshedAt: connection.lastRefreshedAt ?? null,
          scopes: connection.scopes || [],
          lastError: connection.lastError,
          defaultMarketplace: connection.defaultMarketplace || "EBAY_US",
          defaultPaymentPolicyId: connection.defaultPaymentPolicyId ?? null,
          defaultReturnPolicyId: connection.defaultReturnPolicyId ?? null,
          defaultShippingPolicyId: connection.defaultShippingPolicyId ?? null,
          defaultMerchantLocationKey: connection.defaultMerchantLocationKey ?? null,
        }));
      setAccounts(liveAccounts);
      setExpandedId((current) => current && liveAccounts.some(({ id }) => id === current)
        ? current
        : liveAccounts.find(({ isDefault }) => isDefault)?.id || liveAccounts[0]?.id || null);
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
          `/api/ebay/resources?marketplace=${encodeURIComponent(targetMarketplace)}&connectionId=${encodeURIComponent(accountId)}`
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
    if (!expandedId || authStatus !== "ready") return;
    const account = accounts.find(({ id }) => id === expandedId);
    if (!account) return;
    const accountMarketplace = account.defaultMarketplace || account.registrationMarketplace || "EBAY_US";
    setMarketplace(accountMarketplace);
    void loadResources(account.id, accountMarketplace);
  }, [accounts, authStatus, expandedId, loadResources]);

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get("ebay");
    if (!result) return;
    setNotice(ebayConnectNotice(result, params.get("ebay_reason"), params.get("ebay_message")));
    window.history.replaceState({}, "", window.location.pathname);
    void loadConnection();
  }, [authStatus, demo, loadConnection]);

  function prepareDefaultAccount(accountId: string) {
    const target = accounts.find((account) => account.id === accountId);
    setExpandedId(accountId);
    setMarketplace(target?.defaultMarketplace || target?.registrationMarketplace || "EBAY_US");
    void loadResources(accountId, target?.defaultMarketplace || target?.registrationMarketplace || "EBAY_US");
    setNotice("Select this account's default policies and item location, enable Default eBay account, then save defaults.");
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
        await apiFetch(`/api/ebay/connection?connectionId=${encodeURIComponent(accountId)}`, { method: "DELETE" });
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
        body: JSON.stringify({ marketplace, connectionId: accountId }),
      })) as EbaySellerResources;
      setResourcesMap((prev) => ({ ...prev, [accountId]: result }));
      setNotice(`Synced payment, return, shipping policies and inventory locations for ${marketplaceLabel(marketplace)}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sync seller details from eBay");
    } finally {
      setBusy("");
    }
  }

  async function saveDefaults(accountId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(`save-${accountId}`);
    setError("");
    setNotice("");
    try {
      if (demo) {
        const wantsDefault = accounts.some((account) => account.id === accountId && account.isDefault) || form.get("isDefault") === "on";
        setAccounts((current) => current.map((account) => ({
          ...account,
          isDefault: wantsDefault ? account.id === accountId : account.isDefault,
        })));
      } else {
        await apiFetch(`/api/ebay/connections/${encodeURIComponent(accountId)}/defaults`, {
          method: "PATCH",
          body: JSON.stringify({
            isDefault: accounts.some((account) => account.id === accountId && account.isDefault) || form.get("isDefault") === "on",
            defaultMarketplace: marketplace,
            defaultPaymentPolicyId: String(form.get("paymentPolicyId") || ""),
            defaultReturnPolicyId: String(form.get("returnPolicyId") || ""),
            defaultShippingPolicyId: String(form.get("shippingPolicyId") || ""),
            defaultMerchantLocationKey: String(form.get("merchantLocationKey") || ""),
          }),
        });
        await loadConnection();
      }
      setNotice("Default eBay account, policies, and item location saved. New Quick SKU and Pipeline drafts will inherit them.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save eBay account defaults");
    } finally {
      setBusy("");
    }
  }

  const defaultAccount = useMemo(() => accounts.find((a) => a.isDefault), [accounts]);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchSearch =
        !searchQuery ||
        acc.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (acc.ebayUserId && acc.ebayUserId.toLowerCase().includes(searchQuery.toLowerCase())) ||
        acc.registrationMarketplace.toLowerCase().includes(searchQuery.toLowerCase());

      const matchMarketplace =
        filterMarketplace === "ALL"
          ? true
          : filterMarketplace === "DEFAULT"
          ? acc.isDefault
          : acc.registrationMarketplace === filterMarketplace;

      return matchSearch && matchMarketplace;
    });
  }, [accounts, searchQuery, filterMarketplace]);

  return (
    <section className={styles.page}>
      {/* Top Header */}
      <header className={styles.topbar}>
        <div>
          <div className={styles.eyebrow}>Exclusively eBay Integrated</div>
          <h1>eBay Seller Accounts</h1>
          <p>
            Manage and configure multiple connected eBay stores for your organization. Designate default policies and merchant inventory locations.
          </p>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={loading}
            onClick={() => void loadConnection()}
            title="Refresh connection status"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add eBay Account
          </button>
        </div>
      </header>

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {/* Streamlined Horizontal Summary Bar */}
      <div className={styles.summaryBar}>
        <div className={styles.summaryMetric}>
          <span className={styles.summaryDotActive} />
          <div>
            <strong>{accounts.length} Connected {accounts.length === 1 ? "Store" : "Stores"}</strong>
            <small>Active eBay accounts</small>
          </div>
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.summaryMetric}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <div>
            <strong>{defaultAccount ? defaultAccount.username : "No Primary Default"}</strong>
            <small>{defaultAccount ? `${marketplaceLabel(defaultAccount.registrationMarketplace)} · Primary Store` : "Select a default account"}</small>
          </div>
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.summaryMetric}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div>
            <strong>REST &amp; Fulfillment API</strong>
            <small>OAuth 2.0 PKCE Authorization</small>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      {accounts.length > 0 && (
        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search store name, User ID, or marketplace..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" className={styles.clearSearch} onClick={() => setSearchQuery("")}>
                ✕
              </button>
            )}
          </div>

          <div className={styles.filterPills}>
            <button
              type="button"
              className={`${styles.filterPill} ${filterMarketplace === "ALL" ? styles.filterPillActive : ""}`}
              onClick={() => setFilterMarketplace("ALL")}
            >
              All ({accounts.length})
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${filterMarketplace === "DEFAULT" ? styles.filterPillActive : ""}`}
              onClick={() => setFilterMarketplace("DEFAULT")}
            >
              ★ Primary
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${filterMarketplace === "EBAY_US" ? styles.filterPillActive : ""}`}
              onClick={() => setFilterMarketplace("EBAY_US")}
            >
              🇺🇸 US
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${filterMarketplace === "EBAY_GB" ? styles.filterPillActive : ""}`}
              onClick={() => setFilterMarketplace("EBAY_GB")}
            >
              🇬🇧 UK
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${filterMarketplace === "EBAY_DE" ? styles.filterPillActive : ""}`}
              onClick={() => setFilterMarketplace("EBAY_DE")}
            >
              🇩🇪 DE
            </button>
          </div>
        </div>
      )}

      {/* Account Cards Container */}
      {accounts.length === 0 ? (
        <div className={styles.emptyStateCard}>
          <div className={styles.ebayLogoBadgeLarge}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>eBay</span>
          </div>
          <h2>No eBay Seller Accounts Connected</h2>
          <p>Connect your first eBay seller account to start syncing catalog items, fitment compatibility, pricing, and orders.</p>
          <button type="button" className={styles.primary} disabled={!!busy} onClick={() => void connectEbay()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Connect eBay Account
          </button>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className={styles.emptySearchCard}>
          <p>No seller accounts match your search filter <strong>"{searchQuery || filterMarketplace}"</strong>.</p>
          <button type="button" className={styles.ghostBtn} onClick={() => { setSearchQuery(""); setFilterMarketplace("ALL"); }}>
            Clear Filters
          </button>
        </div>
      ) : (
        <div className={styles.accountsList}>
          {filteredAccounts.map((acc) => {
            const isExpanded = expandedId === acc.id;
            const activeTab = activeTabMap[acc.id] || "defaults";
            const resourceSubTab = resourceSubTabMap[acc.id] || "payment";

            const res = resourcesMap[acc.id] || demoResources;
            const paymentPolicies = res.paymentPolicies?.filter((p) => p.enabled) ?? [];
            const returnPolicies = res.returnPolicies?.filter((p) => p.enabled) ?? [];
            const shippingPolicies = res.fulfillmentPolicies?.filter((p) => p.enabled) ?? [];
            const locations = res.inventoryLocations?.filter((p) => p.enabled) ?? [];
            const totalPoliciesCount = paymentPolicies.length + returnPolicies.length + shippingPolicies.length + locations.length;

            return (
              <article
                key={acc.id}
                className={`${styles.card} ${acc.isDefault ? styles.cardDefault : ""} ${isExpanded ? styles.cardExpanded : ""}`}
              >
                {/* Compact Row Header */}
                <div className={styles.rowHeader}>
                  <div className={styles.rowLeft}>
                    <div className={styles.ebayBadge}>
                      <span>eBay</span>
                    </div>

                    <div className={styles.accountInfo}>
                      <div className={styles.nameRow}>
                        <h2>{acc.username}</h2>
                        {acc.isDefault ? (
                          <span className={styles.defaultBadge}>
                            ★ Primary Account
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={styles.setDefaultBtn}
                            onClick={() => prepareDefaultAccount(acc.id)}
                            title="Set as organization default primary store"
                          >
                            Make Primary
                          </button>
                        )}
                      </div>
                      <div className={styles.subMetaRow}>
                        <span className={styles.marketBadge}>
                          {marketplaceFlag(acc.registrationMarketplace)} {marketplaceLabel(acc.registrationMarketplace)}
                        </span>
                        <code className={styles.userCode}>{acc.ebayUserId || acc.username}</code>
                        <span className={styles.envTag}>{acc.environment.toUpperCase()}</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.rowRight}>
                    <div className={styles.statusPill}>
                      <span className={`${styles.statusDot} ${acc.status === "ACTIVE" ? styles.statusActive : styles.statusOffline}`} />
                      <span>{acc.status === "ACTIVE" ? "Connected" : humanStatus(acc.status)}</span>
                    </div>

                    <div className={styles.policySummaryChip}>
                      <strong>{totalPoliciesCount}</strong> Synced Policies
                    </div>

                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.syncBtn}
                        disabled={busy === `sync-${acc.id}`}
                        onClick={() => void syncSellerDetails(acc.id)}
                        title="Sync seller policies and locations from eBay"
                      >
                        <svg className={busy === `sync-${acc.id}` ? styles.spinIcon : ""} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="M23 4v6h-6M1 20v-6h6" />
                          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                        </svg>
                        {busy === `sync-${acc.id}` ? "Syncing..." : "Sync"}
                      </button>

                      <button
                        type="button"
                        className={`${styles.manageBtn} ${isExpanded ? styles.manageBtnActive : ""}`}
                        onClick={() => {
                          setExpandedId(isExpanded ? null : acc.id);
                          if (!isExpanded) {
                            const accountMarketplace = acc.defaultMarketplace || acc.registrationMarketplace || "EBAY_US";
                            setMarketplace(accountMarketplace);
                            void loadResources(acc.id, accountMarketplace);
                          }
                        }}
                      >
                        <span>{isExpanded ? "Close" : "Manage"}</span>
                        <svg
                          className={`${styles.chevronIcon} ${isExpanded ? styles.chevronOpen : ""}`}
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Collapsible Tabbed Drawer */}
                {isExpanded && (
                  <section className={styles.detailDrawer}>
                    {/* Drawer Tab Navigation */}
                    <nav className={styles.drawerNav}>
                      <button
                        type="button"
                        className={`${styles.drawerTab} ${activeTab === "defaults" ? styles.drawerTabActive : ""}`}
                        onClick={() => setActiveTabMap((prev) => ({ ...prev, [acc.id]: "defaults" }))}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        Listing Defaults
                      </button>

                      <button
                        type="button"
                        className={`${styles.drawerTab} ${activeTab === "resources" ? styles.drawerTabActive : ""}`}
                        onClick={() => setActiveTabMap((prev) => ({ ...prev, [acc.id]: "resources" }))}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        Synced Policies ({totalPoliciesCount})
                      </button>

                      <button
                        type="button"
                        className={`${styles.drawerTab} ${activeTab === "security" ? styles.drawerTabActive : ""}`}
                        onClick={() => setActiveTabMap((prev) => ({ ...prev, [acc.id]: "security" }))}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        Account &amp; OAuth
                      </button>
                    </nav>

                    {/* Tab 1: Listing Defaults Form */}
                    {activeTab === "defaults" && (
                      <form className={styles.defaultsForm} onSubmit={(event) => void saveDefaults(acc.id, event)}>
                        <div className={styles.formHeader}>
                          <div>
                            <h4>Default Account Policies &amp; Location</h4>
                            <p>Automatically assigned to new Quick SKU and Pipeline listing drafts for this seller account.</p>
                          </div>
                          <Link href="/catalog" className={styles.primaryLink}>
                            Catalog Workspace →
                          </Link>
                        </div>

                        <div className={styles.defaultsGrid}>
                          <label>
                            <span>Target Marketplace</span>
                            <select
                              value={marketplace}
                              onChange={(event) => {
                                setMarketplace(event.target.value);
                                void loadResources(acc.id, event.target.value);
                              }}
                            >
                              <option value="EBAY_US">🇺🇸 eBay US</option>
                              <option value="EBAY_GB">🇬🇧 eBay UK</option>
                              <option value="EBAY_DE">🇩🇪 eBay Germany</option>
                            </select>
                          </label>

                          <label>
                            <span>Default Payment Policy</span>
                            <select name="paymentPolicyId" required defaultValue={acc.defaultPaymentPolicyId || ""}>
                              <option value="">Select payment policy...</option>
                              {paymentPolicies.map((item) => (
                                <option key={item.remoteId} value={item.remoteId}>
                                  {item.name || item.remoteId}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Default Return Policy</span>
                            <select name="returnPolicyId" required defaultValue={acc.defaultReturnPolicyId || ""}>
                              <option value="">Select return policy...</option>
                              {returnPolicies.map((item) => (
                                <option key={item.remoteId} value={item.remoteId}>
                                  {item.name || item.remoteId}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Default Shipping Policy</span>
                            <select name="shippingPolicyId" required defaultValue={acc.defaultShippingPolicyId || ""}>
                              <option value="">Select shipping policy...</option>
                              {shippingPolicies.map((item) => (
                                <option key={item.remoteId} value={item.remoteId}>
                                  {item.name || item.remoteId}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Default Item Location</span>
                            <select name="merchantLocationKey" required defaultValue={acc.defaultMerchantLocationKey || ""}>
                              <option value="">Select merchant location...</option>
                              {locations.map((item) => (
                                <option key={item.remoteId} value={item.remoteId}>
                                  {item.name || item.remoteId}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className={styles.defaultsFooter}>
                          <label className={styles.defaultCheck}>
                            <input
                              type="checkbox"
                              name="isDefault"
                              defaultChecked={acc.isDefault}
                              disabled={acc.isDefault}
                            />
                            <span>
                              <strong>Primary Default Account</strong>
                              <small>{acc.isDefault ? "This is currently your organization's primary default store." : "Set as primary default for newly generated catalog drafts."}</small>
                            </span>
                          </label>

                          <button
                            type="submit"
                            className={styles.primary}
                            disabled={busy === `save-${acc.id}` || !resourcesMap[acc.id]}
                          >
                            {busy === `save-${acc.id}` ? "Saving..." : "Save Defaults"}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Tab 2: Synced Policies & Locations */}
                    {activeTab === "resources" && (
                      <div className={styles.resourcesTabContent}>
                        <div className={styles.subTabNav}>
                          <button
                            type="button"
                            className={`${styles.subTab} ${resourceSubTab === "payment" ? styles.subTabActive : ""}`}
                            onClick={() => setResourceSubTabMap((prev) => ({ ...prev, [acc.id]: "payment" }))}
                          >
                            Payment Policies ({paymentPolicies.length})
                          </button>
                          <button
                            type="button"
                            className={`${styles.subTab} ${resourceSubTab === "return" ? styles.subTabActive : ""}`}
                            onClick={() => setResourceSubTabMap((prev) => ({ ...prev, [acc.id]: "return" }))}
                          >
                            Return Policies ({returnPolicies.length})
                          </button>
                          <button
                            type="button"
                            className={`${styles.subTab} ${resourceSubTab === "shipping" ? styles.subTabActive : ""}`}
                            onClick={() => setResourceSubTabMap((prev) => ({ ...prev, [acc.id]: "shipping" }))}
                          >
                            Shipping Policies ({shippingPolicies.length})
                          </button>
                          <button
                            type="button"
                            className={`${styles.subTab} ${resourceSubTab === "locations" ? styles.subTabActive : ""}`}
                            onClick={() => setResourceSubTabMap((prev) => ({ ...prev, [acc.id]: "locations" }))}
                          >
                            Inventory Locations ({locations.length})
                          </button>
                        </div>

                        <div className={styles.subTabBody}>
                          {resourceSubTab === "payment" && (
                            <ResourceList items={paymentPolicies} emptyText="No payment policies cached yet. Click Sync to refresh from eBay." />
                          )}
                          {resourceSubTab === "return" && (
                            <ResourceList items={returnPolicies} emptyText="No return policies cached yet. Click Sync to refresh from eBay." />
                          )}
                          {resourceSubTab === "shipping" && (
                            <ResourceList items={shippingPolicies} emptyText="No shipping policies cached yet. Click Sync to refresh from eBay." />
                          )}
                          {resourceSubTab === "locations" && (
                            <ResourceList items={locations} emptyText="No merchant inventory locations cached yet. Click Sync to refresh from eBay." />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tab 3: Security & Connection Details */}
                    {activeTab === "security" && (
                      <div className={styles.securityTabContent}>
                        <div className={styles.securityGrid}>
                          <div className={styles.securityCard}>
                            <span>User ID / eBay Store</span>
                            <strong><code>{acc.ebayUserId || acc.username}</code></strong>
                          </div>
                          <div className={styles.securityCard}>
                            <span>Environment</span>
                            <strong>{acc.environment.toUpperCase()}</strong>
                          </div>
                          <div className={styles.securityCard}>
                            <span>Token Last Refreshed</span>
                            <strong>{formatTime(acc.lastRefreshedAt)}</strong>
                          </div>
                          <div className={styles.securityCard}>
                            <span>Registration Marketplace</span>
                            <strong>{marketplaceLabel(acc.registrationMarketplace)} ({acc.registrationMarketplace})</strong>
                          </div>
                        </div>

                        {acc.scopes.length > 0 && (
                          <div className={styles.scopesContainer}>
                            <h4>Granted OAuth Scope Permissions</h4>
                            <div className={styles.scopesBadges}>
                              {acc.scopes.map((scope) => (
                                <span key={scope} className={styles.scopeBadge}>
                                  ✓ {scopeLabel(scope)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className={styles.securityActions}>
                          <button
                            type="button"
                            className={styles.ghostBtn}
                            disabled={!!busy}
                            onClick={() => void connectEbay()}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M23 4v6h-6M1 20v-6h6" />
                              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                            </svg>
                            Reconnect Account
                          </button>
                          <button
                            type="button"
                            className={styles.dangerBtn}
                            disabled={!!busy}
                            onClick={() => void disconnectAccount(acc.id)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            Disconnect Store
                          </button>
                        </div>
                      </div>
                    )}
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

function ResourceList({ items, emptyText }: { items: Array<{ remoteId: string; name: string | null }>; emptyText: string }) {
  if (!items.length) {
    return <p className={styles.emptyResource}>{emptyText}</p>;
  }

  return (
    <div className={styles.resourceListGrid}>
      {items.map((item) => (
        <div key={item.remoteId} className={styles.resourceItem}>
          <div className={styles.resourceDot} />
          <div>
            <strong>{item.name || item.remoteId}</strong>
            <small>Remote ID: <code>{item.remoteId}</code></small>
          </div>
        </div>
      ))}
    </div>
  );
}

