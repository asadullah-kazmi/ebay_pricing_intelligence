"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./dashboard.module.css";

type CatalogSummary = {
  summary: { total: number; byStatus: Record<string, number> };
};

type EbayConnection = {
  connected: boolean;
  status: string;
  username?: string | null;
  ebayUserId?: string | null;
};

type PricingJobSummary = {
  id: string;
  status: string;
  marketplace: string;
  totalItems: number;
  completedItems: number;
  createdAt: string;
};

type DraftSummary = {
  id: string;
  title: string;
  status: string;
  marketplace: string;
  part: { sku: string };
  updatedAt: string;
};

type FitmentJobSummary = {
  id: string;
  status: string;
  totalItems: number;
  reviewedItems: number;
  createdAt: string;
};

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timeAgo(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DashboardWorkspace() {
  const { status, session, apiFetch } = useAuth();
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [ebay, setEbay] = useState<EbayConnection | null>(null);
  const [pricingJobs, setPricingJobs] = useState<PricingJobSummary[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [fitmentJobs, setFitmentJobs] = useState<FitmentJobSummary[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [catalogValue, ebayValue, pricingValue, draftsValue, fitmentValue] = await Promise.all([
      apiFetch("/api/parts?page=1&pageSize=1&sort=newest"),
      apiFetch("/api/ebay/connection"),
      apiFetch("/api/pricing/jobs?limit=4"),
      apiFetch("/api/listing-drafts?limit=4"),
      apiFetch("/api/fitment/jobs?limit=4"),
    ]);
    setCatalog(catalogValue as CatalogSummary);
    setEbay(ebayValue as EbayConnection);
    setPricingJobs(pricingValue as PricingJobSummary[]);
    setDrafts(draftsValue as DraftSummary[]);
    setFitmentJobs(fitmentValue as FitmentJobSummary[]);
  }, [apiFetch]);

  useEffect(() => {
    if (status !== "ready") return;
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load dashboard"));
  }, [status, load]);

  if (status !== "ready") return null;

  const byStatus = catalog?.summary.byStatus ?? {};
  const totalParts = catalog?.summary.total ?? 0;
  const needsImages = byStatus.NEEDS_IMAGES ?? 0;
  const ready = byStatus.READY_FOR_ENRICHMENT ?? 0;
  const imported = byStatus.IMPORTED ?? 0;
  const readyDrafts = drafts.filter((draft) => draft.status === "READY").length;
  const blockedDrafts = drafts.filter((draft) => draft.status === "BLOCKED").length;
  const firstName = session?.user.name?.split(/\s+/)[0] || "there";

  return (
    <>
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>OPERATIONS OVERVIEW</span>
          <h1>Welcome back, {firstName}</h1>
          <p>
            {session?.organization.name
              ? `${session.organization.name} · manage catalog, pricing, and listings from one place.`
              : "Manage catalog, pricing, and listings from one place."}
          </p>
        </div>
        <div className={styles.topActions}>
          <Link className={styles.secondary} href="/pipeline">
            Open pipeline
          </Link>
          <Link className={styles.primary} href="/catalog">
            Go to catalog
          </Link>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.metrics}>
        <article>
          <span>Total parts</span>
          <b>{totalParts}</b>
          <small>In your organization catalog</small>
        </article>
        <article>
          <span>Ready to enrich</span>
          <b>{ready}</b>
          <small>Next for pricing & fitment</small>
        </article>
        <article>
          <span>Needs images</span>
          <b>{needsImages}</b>
          <small>Action required</small>
        </article>
        <article>
          <span>Listing drafts</span>
          <b>{drafts.length}</b>
          <small>
            {readyDrafts} ready · {blockedDrafts} blocked
          </small>
        </article>
      </section>

      <section className={styles.mainGrid}>
        <div className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>QUICK ACTIONS</span>
                <h2>Keep operations moving</h2>
              </div>
            </div>
            <div className={styles.actionGrid}>
              <Link href="/pipeline" className={styles.actionCard}>
                <strong>Bulk upload</strong>
                <span>Stage CSV and photo imports into the pipeline.</span>
              </Link>
              <Link href="/catalog" className={styles.actionCard}>
                <strong>Review catalog</strong>
                <span>Search, filter, and enrich parts ready for market.</span>
              </Link>
              <Link href="/catalog#listing-drafts" className={styles.actionCard}>
                <strong>Listing drafts</strong>
                <span>Resolve readiness blockers before publication.</span>
              </Link>
              <Link href="/" className={styles.actionCard}>
                <strong>Market search</strong>
                <span>Check competitor landed prices for an OEM/MPN.</span>
              </Link>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>CATALOG HEALTH</span>
                <h2>Status mix</h2>
              </div>
              <Link href="/catalog">View all</Link>
            </div>
            <div className={styles.statusList}>
              {[
                { label: "Ready for enrichment", value: ready, tone: "success" },
                { label: "Newly imported", value: imported, tone: "info" },
                { label: "Needs images", value: needsImages, tone: "warn" },
                { label: "Import errors", value: byStatus.IMPORT_ERROR ?? 0, tone: "danger" },
                { label: "Archived", value: byStatus.ARCHIVED ?? 0, tone: "muted" },
              ].map((item) => (
                <div key={item.label} className={styles.statusRow}>
                  <span className={`${styles.dot} ${styles[item.tone]}`} />
                  <b>{item.label}</b>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>EBAY CONNECTION</span>
                <h2>Seller status</h2>
              </div>
            </div>
            <div className={styles.connectionBox}>
              <i className={ebay?.connected ? styles.online : styles.offline} />
              <div>
                <b>{ebay?.connected ? "Connected" : "Not connected"}</b>
                <span>
                  {ebay?.connected
                    ? ebay.username || ebay.ebayUserId || "Seller account linked"
                    : "Connect a seller account from Catalog to publish."}
                </span>
              </div>
              <Link className={styles.secondary} href="/catalog">
                Manage
              </Link>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>RECENT ACTIVITY</span>
                <h2>Jobs & drafts</h2>
              </div>
            </div>
            <div className={styles.activityList}>
              {pricingJobs.slice(0, 2).map((job) => (
                <article key={job.id}>
                  <div>
                    <b>Pricing job</b>
                    <span>
                      {job.completedItems}/{job.totalItems} · {job.marketplace.replace("EBAY_", "eBay ")}
                    </span>
                  </div>
                  <em className={styles.pill}>{human(job.status)}</em>
                  <small>{timeAgo(job.createdAt)}</small>
                </article>
              ))}
              {fitmentJobs.slice(0, 2).map((job) => (
                <article key={job.id}>
                  <div>
                    <b>Fitment job</b>
                    <span>
                      {job.reviewedItems}/{job.totalItems} reviewed
                    </span>
                  </div>
                  <em className={styles.pill}>{human(job.status)}</em>
                  <small>{timeAgo(job.createdAt)}</small>
                </article>
              ))}
              {drafts.slice(0, 2).map((draft) => (
                <article key={draft.id}>
                  <div>
                    <b>{draft.part.sku}</b>
                    <span>{draft.title}</span>
                  </div>
                  <em className={styles.pill}>{human(draft.status)}</em>
                  <small>{timeAgo(draft.updatedAt)}</small>
                </article>
              ))}
              {!pricingJobs.length && !fitmentJobs.length && !drafts.length && (
                <div className={styles.emptyActivity}>
                  <b>No recent activity yet</b>
                  <span>Import parts or start a pricing job to see progress here.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
