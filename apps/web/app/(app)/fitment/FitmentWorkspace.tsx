"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import type { FitmentJob, FitmentJobSummary } from "../catalog/types";
import styles from "./fitment.module.css";

type EbayConnection = {
  connected: boolean;
  username?: string | null;
  ebayUserId?: string | null;
};

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: string) {
  const key = status.toLowerCase();
  if (key.includes("complete") || key === "approved") return styles.statusGood;
  if (key.includes("review") || key.includes("queued") || key.includes("running")) return styles.statusWait;
  if (key.includes("fail") || key.includes("partial") || key.includes("no_candidate")) return styles.statusBad;
  return styles.statusWait;
}

const demoJobs: FitmentJobSummary[] = [
  {
    id: "fit-demo-1",
    marketplace: "EBAY_US",
    status: "REVIEW_REQUIRED",
    totalItems: 8,
    reviewedItems: 3,
    noCandidateItems: 1,
    failedItems: 0,
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    completedAt: null,
  },
  {
    id: "fit-demo-2",
    marketplace: "EBAY_US",
    status: "COMPLETED",
    totalItems: 12,
    reviewedItems: 12,
    noCandidateItems: 0,
    failedItems: 0,
    createdAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    startedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
    completedAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
  },
];

export default function FitmentWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [jobs, setJobs] = useState<FitmentJobSummary[]>([]);
  const [activeJob, setActiveJob] = useState<FitmentJob | null>(null);
  const [ebay, setEbay] = useState<EbayConnection | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setJobs(demoJobs);
      setEbay({ connected: false });
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [jobList, connection] = await Promise.all([
        apiFetch("/api/fitment/jobs?limit=25") as Promise<FitmentJobSummary[]>,
        apiFetch("/api/ebay/connection") as Promise<EbayConnection>,
      ]);
      setJobs(jobList);
      setEbay(connection);
      const latest = jobList[0];
      if (latest && ["QUEUED", "RUNNING", "REVIEW_REQUIRED"].includes(latest.status)) {
        setActiveJob(await apiFetch(`/api/fitment/jobs/${latest.id}`) as FitmentJob);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load fitment jobs");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!activeJob || demo || !["QUEUED", "RUNNING"].includes(activeJob.status)) return;
    const timer = window.setTimeout(() => {
      void apiFetch(`/api/fitment/jobs/${activeJob.id}`)
        .then((job) => setActiveJob(job as FitmentJob))
        .catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [activeJob, apiFetch, demo]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter && job.status !== statusFilter) return false;
      if (!q) return true;
      return job.id.toLowerCase().includes(q) || job.marketplace.toLowerCase().includes(q);
    });
  }, [jobs, search, statusFilter]);

  const metrics = useMemo(() => {
    const openReview = jobs.filter((job) => job.status === "REVIEW_REQUIRED").length;
    const running = jobs.filter((job) => ["QUEUED", "RUNNING"].includes(job.status)).length;
    const approved = jobs.reduce((sum, job) => sum + job.reviewedItems, 0);
    const noCandidate = jobs.reduce((sum, job) => sum + job.noCandidateItems, 0);
    return { openReview, running, approved, noCandidate };
  }, [jobs]);

  const reviewItems = useMemo(
    () => (activeJob?.items ?? []).filter((item) => item.status === "REVIEW_REQUIRED"),
    [activeJob],
  );

  async function openJob(id: string) {
    if (demo) {
      setError("Open Catalog to run live fitment discovery in development preview.");
      return;
    }
    setLoading(true);
    try {
      setActiveJob(await apiFetch(`/api/fitment/jobs/${id}`) as FitmentJob);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open fitment job");
    } finally {
      setLoading(false);
    }
  }

  async function approveCandidate(itemId: string, candidateId: string) {
    if (demo || !activeJob) return;
    setLoading(true);
    try {
      setActiveJob(await apiFetch(`/api/fitment/items/${itemId}/approve`, {
        method: "POST",
        body: JSON.stringify({ candidateId }),
      }) as FitmentJob);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to approve candidate");
    } finally {
      setLoading(false);
    }
  }

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Fitment</h1>
          <p>Review vehicle applications, approve catalog matches, and keep listings fitment-ready.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => void load()} aria-label="Refresh" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <Link className={styles.ghostBtn} href="/catalog">Open catalog</Link>
          <Link className={styles.primary} href="/catalog">Start discovery</Link>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {demo && <div className={styles.notice}>Development preview — sample fitment jobs shown. Live discovery runs from Catalog selection.</div>}

      <section className={styles.metrics}>
        <article><span>Needs review</span><b className={styles.metricWarn}>{metrics.openReview}</b><small>Jobs awaiting approval</small></article>
        <article><span>Running</span><b>{metrics.running}</b><small>Queued or in progress</small></article>
        <article><span>Applications approved</span><b className={styles.metricGood}>{metrics.approved}</b><small>Across recent jobs</small></article>
        <article><span>No candidates</span><b className={styles.metricBad}>{metrics.noCandidate}</b><small>Manual research needed</small></article>
      </section>

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <label className={styles.searchBox}>
              <span className={styles.srOnly}>Search jobs</span>
              <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fitment jobs..."/>
            </label>
            <label className={styles.filterField}>
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                <option value="REVIEW_REQUIRED">Needs review</option>
                <option value="RUNNING">Running</option>
                <option value="QUEUED">Queued</option>
                <option value="COMPLETED">Completed</option>
                <option value="PARTIAL">Partial</option>
                <option value="FAILED">Failed</option>
              </select>
            </label>
          </div>

          {loading && !jobs.length ? (
            <div className={styles.empty}><b>Loading fitment jobs...</b></div>
          ) : filteredJobs.length === 0 ? (
            <div className={styles.empty}>
              <b>No fitment jobs yet</b>
              <span>Select parts in Catalog and run fitment discovery to populate this queue.</span>
              <Link href="/catalog">Go to catalog</Link>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Marketplace</th>
                    <th>Progress</th>
                    <th>Created</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr key={job.id} className={activeJob?.id === job.id ? styles.rowActive : undefined}>
                      <td>
                        <button type="button" className={styles.linkBtn} onClick={() => void openJob(job.id)}>
                          #{job.id.slice(-8)}
                        </button>
                      </td>
                      <td>{job.marketplace.replace("EBAY_", "eBay ")}</td>
                      <td>
                        <b>{job.reviewedItems}</b>
                        <span className={styles.subtle}>of {job.totalItems} approved · {job.noCandidateItems} unmatched</span>
                      </td>
                      <td className={styles.dateCell}>{new Date(job.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                      <td><span className={`${styles.statusPill} ${statusClass(job.status)}`}>{human(job.status)}</span></td>
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
              <span className={styles.eyebrow}>Review queue</span>
              <h2>{activeJob ? `Job ${activeJob.id.slice(-8)}` : "Select a job"}</h2>
            </div>
            {activeJob && <span className={`${styles.statusPill} ${statusClass(activeJob.status)}`}>{human(activeJob.status)}</span>}
          </div>

          {!ebay?.connected && !demo && (
            <div className={styles.sideHint}>
              Connect eBay in Catalog to discover catalog product candidates for fitment.
            </div>
          )}

          {!activeJob ? (
            <div className={styles.empty}>
              <b>No job selected</b>
              <span>Open a fitment job to review candidates and approve vehicle applications.</span>
            </div>
          ) : reviewItems.length === 0 ? (
            <div className={styles.empty}>
              <b>Nothing waiting for review</b>
              <span>{activeJob.reviewedItems} approved · {activeJob.noCandidateItems} without candidates · {activeJob.failedItems} failed</span>
            </div>
          ) : (
            <div className={styles.reviewList}>
              {reviewItems.map((item) => (
                <article key={item.id} className={styles.reviewCard}>
                  <div className={styles.reviewHead}>
                    <div>
                      <b>{item.part.sku}</b>
                      <span>{item.part.partName || item.part.primaryPartNumber}{item.categoryName ? ` · ${item.categoryName}` : ""}</span>
                    </div>
                    <span className={`${styles.statusPill} ${styles.statusWait}`}>Needs review</span>
                  </div>
                  <div className={styles.candidateList}>
                    {item.candidates.map((candidate) => (
                      <div key={candidate.id} className={styles.candidate}>
                        <div>
                          <b>{candidate.title}</b>
                          <span>ePID {candidate.epid} · score {candidate.score}/100</span>
                          <small>{candidate.matchedOn.join(" · ") || "Weak catalog match"}</small>
                        </div>
                        <button type="button" className={styles.primary} disabled={loading || demo} onClick={() => void approveCandidate(item.id, candidate.id)}>
                          Approve
                        </button>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
