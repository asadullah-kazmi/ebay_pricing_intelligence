"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./orders.module.css";

type EbayConnection = {
  connected: boolean;
  status: string;
  username?: string | null;
  ebayUserId?: string | null;
};

export default function OrdersWorkspace() {
  const { status, apiFetch } = useAuth();
  const [ebay, setEbay] = useState<EbayConnection | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setEbay((await apiFetch("/api/ebay/connection")) as EbayConnection);
  }, [apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load store connection"));
  }, [status, load]);

  if (status !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Orders</h1>
          <p>Pull live orders, payments, and fulfillment status from connected storefronts in real time.</p>
        </div>
        <div className={styles.topActions}>
          <Link className={styles.secondary} href="/catalog">
            Manage stores
          </Link>
          <button type="button" className={styles.primary} disabled={!ebay?.connected}>
            Sync orders
          </button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

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
          <em>{ebay?.connected ? "Syncing" : "Offline"}</em>
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
          { label: "Open orders", value: "—" },
          { label: "Awaiting shipment", value: "—" },
          { label: "Shipped today", value: "—" },
          { label: "Returns / issues", value: "—" },
        ].map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <b>{item.value}</b>
            <small>Live from connected stores</small>
          </article>
        ))}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <h2>Order inbox</h2>
            <p>New, paid, and fulfillment-ready orders appear here as stores sync.</p>
          </div>
        </div>
        <div className={styles.empty}>
          <b>{ebay?.connected ? "Waiting for the first store order sync" : "Connect a store to start receiving orders"}</b>
          <span>
            PartPulse is built for more than listings — inventory, tool/parts orders, and marketplace events will stream into this workspace in real time.
          </span>
          <Link href="/catalog">{ebay?.connected ? "Open catalog" : "Connect eBay in Catalog"}</Link>
        </div>
      </section>
    </div>
  );
}
