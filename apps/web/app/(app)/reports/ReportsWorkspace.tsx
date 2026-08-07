"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./reports.module.css";

interface Overview {
  catalog: { parts: number; readyDrafts: number };
  organization: { members: number };
  publishing: { published: number; withdrawn: number; drifted: number };
  delivery: { openDeadLetters: number; pendingOutbox: number; failedOutbox: number };
  failedJobs: number;
  worker: { status: string; lastSeenAt: string | null; ageMs: number | null; activeJobs: number };
}

interface FailedJob {
  jobType: string;
  id: string;
  action: string | null;
  label: string;
  lastError: string | null;
  attemptCount: number;
  updatedAt: string;
  retryAllowed: boolean;
  retryReason: string;
}

interface PublishingOperation {
  id: string;
  sku: string;
  marketplace: string;
  ebayListingId: string | null;
  status: string;
  remoteListingStatus: string | null;
  lastError: string | null;
  updatedAt: string;
  listingDraft: { title: string; version: number };
}

interface AuditEvent {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  summary: string;
  occurredAt: string;
  actorType: string;
  actorUser: { name: string | null; email: string } | null;
}

interface RetentionPolicy {
  readNotificationDays: number;
  competitorSnapshotDays: number;
  publishedOutboxDays: number;
  resolvedDeadLetterDays: number;
  auditArchiveAfterDays: number;
}

interface RetentionRun {
  id: string;
  mode: "PREVIEW" | "APPLY";
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  result: Record<string, number> | null;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
  createdBy: { email: string; name: string | null };
}

const demoOverview: Overview = {
  catalog: { parts: 1284, readyDrafts: 46 },
  organization: { members: 6 },
  publishing: { published: 312, withdrawn: 18, drifted: 7 },
  delivery: { openDeadLetters: 2, pendingOutbox: 5, failedOutbox: 1 },
  failedJobs: 3,
  worker: { status: "ok", lastSeenAt: new Date().toISOString(), ageMs: 1200, activeJobs: 1 },
};

const demoJobs: FailedJob[] = [
  {
    id: "job-1",
    jobType: "PUBLISH_OFFER",
    action: "PUBLISH",
    label: "GM-84178783-A · EBAY_US",
    lastError: "eBay policy validation failed: shipping policy inactive",
    attemptCount: 2,
    updatedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    retryAllowed: true,
    retryReason: "Safe to retry after policy fix",
  },
  {
    id: "job-2",
    jobType: "INVENTORY_SYNC",
    action: "SYNC",
    label: "AUD-8K0615301M · EBAY_US",
    lastError: "Remote offer not found",
    attemptCount: 4,
    updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    retryAllowed: false,
    retryReason: "Review listing state before retry",
  },
];

const demoPublishing: PublishingOperation[] = [
  {
    id: "pub-1",
    sku: "GM-84178783-A",
    marketplace: "EBAY_US",
    ebayListingId: "336012345678",
    status: "PUBLISHED",
    remoteListingStatus: "ACTIVE",
    lastError: null,
    updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    listingDraft: { title: "HVAC Blower Motor Control Module", version: 3 },
  },
  {
    id: "pub-2",
    sku: "AUD-8K0615301M",
    marketplace: "EBAY_US",
    ebayListingId: "336098765432",
    status: "DRIFTED",
    remoteListingStatus: "ACTIVE",
    lastError: null,
    updatedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    listingDraft: { title: "Audi Rear Brake Caliper", version: 5 },
  },
];

const demoAudit: AuditEvent[] = [
  {
    id: "a1",
    action: "LISTING_PUBLISHED",
    resourceType: "EbayOffer",
    resourceId: "pub-1",
    severity: "INFO",
    summary: "Published GM-84178783-A to eBay US",
    occurredAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    actorType: "USER",
    actorUser: { name: "Demo Operator", email: "demo@partpulse.local" },
  },
  {
    id: "a2",
    action: "JOB_FAILED",
    resourceType: "Job",
    resourceId: "job-1",
    severity: "WARNING",
    summary: "Publish job failed policy validation",
    occurredAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    actorType: "SYSTEM",
    actorUser: null,
  },
];

const demoRetention: RetentionPolicy = {
  readNotificationDays: 90,
  competitorSnapshotDays: 180,
  publishedOutboxDays: 30,
  resolvedDeadLetterDays: 90,
  auditArchiveAfterDays: 730,
};

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function time(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Never";
}

function listingUrl(marketplace: string, listingId: string) {
  const host = marketplace === "EBAY_GB" ? "www.ebay.co.uk" : marketplace === "EBAY_DE" ? "www.ebay.de" : "www.ebay.com";
  return `https://${host}/itm/${listingId}`;
}

export default function ReportsWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [jobs, setJobs] = useState<FailedJob[]>([]);
  const [publishing, setPublishing] = useState<PublishingOperation[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicy | null>(null);
  const [retentionRuns, setRetentionRuns] = useState<RetentionRun[]>([]);
  const [retentionBusy, setRetentionBusy] = useState("");
  const [publishingStatus, setPublishingStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setOverview(demoOverview);
      setJobs(demoJobs);
      setPublishing(demoPublishing);
      setAudit(demoAudit);
      setRetentionPolicy(demoRetention);
      setRetentionRuns([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const publishQuery = publishingStatus ? `?status=${publishingStatus}&limit=50` : "?limit=50";
      const auditQuery = severity ? `?severity=${severity}&limit=50` : "?limit=50";
      const [overviewResult, jobsResult, publishingResult, auditResult, retentionPolicyResult, retentionRunsResult] = await Promise.all([
        apiFetch("/api/admin/overview"),
        apiFetch("/api/admin/failed-jobs?limit=50"),
        apiFetch(`/api/admin/publishing${publishQuery}`),
        apiFetch(`/api/admin/audit-events${auditQuery}`),
        apiFetch("/api/admin/retention-policy"),
        apiFetch("/api/admin/retention-runs?limit=20"),
      ]);
      setOverview(overviewResult as Overview);
      setJobs(jobsResult as FailedJob[]);
      setPublishing(publishingResult as PublishingOperation[]);
      setAudit(auditResult as AuditEvent[]);
      setRetentionPolicy(retentionPolicyResult as RetentionPolicy);
      setRetentionRuns(retentionRunsResult as RetentionRun[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load operations data");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo, publishingStatus, severity]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (demo || !retentionRuns.some(({ status }) => status === "QUEUED" || status === "RUNNING")) return;
    const timer = window.setTimeout(() => void load(), 2000);
    return () => window.clearTimeout(timer);
  }, [demo, load, retentionRuns]);

  async function retry(job: FailedJob) {
    if (!job.retryAllowed || demo) {
      if (demo) setNotice("Job retry runs against live operations outside preview mode.");
      return;
    }
    setRetrying(job.id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/admin/jobs/${job.jobType}/${job.id}/retry`, { method: "POST" });
      setNotice(`${human(job.jobType)} job queued safely.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to retry job");
    } finally {
      setRetrying("");
    }
  }

  async function saveRetentionPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) {
      setNotice("Retention policy updates require a live admin session.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setRetentionBusy("policy");
    setError("");
    setNotice("");
    try {
      setRetentionPolicy(await apiFetch("/api/admin/retention-policy", {
        method: "PUT",
        body: JSON.stringify({
          readNotificationDays: Number(form.get("readNotificationDays")),
          competitorSnapshotDays: Number(form.get("competitorSnapshotDays")),
          publishedOutboxDays: Number(form.get("publishedOutboxDays")),
          resolvedDeadLetterDays: Number(form.get("resolvedDeadLetterDays")),
          auditArchiveAfterDays: Number(form.get("auditArchiveAfterDays")),
        }),
      }) as RetentionPolicy);
      setNotice("Retention policy saved. Existing queued runs keep their original cutoff snapshot.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save retention policy");
    } finally {
      setRetentionBusy("");
    }
  }

  async function queueRetention(mode: "PREVIEW" | "APPLY") {
    if (demo) {
      setNotice("Retention runs require a live admin session.");
      return;
    }
    let confirmation: string | undefined;
    if (mode === "APPLY") {
      confirmation = window.prompt('This permanently deletes only eligible derived/operational records. Type "DELETE EXPIRED DATA" to continue:') ?? undefined;
      if (confirmation !== "DELETE EXPIRED DATA") return;
    }
    setRetentionBusy(mode);
    setError("");
    setNotice("");
    try {
      await apiFetch("/api/admin/retention-runs", { method: "POST", body: JSON.stringify({ mode, confirmation }) });
      setNotice(mode === "PREVIEW" ? "Retention preview queued." : "Retention cleanup queued with immutable audit evidence.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to queue retention run");
    } finally {
      setRetentionBusy("");
    }
  }

  if (authStatus !== "ready") return null;

  const workerOk = overview?.worker.status === "ok";

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>Operations & Publishing Reports</span>
          <h1>Reports</h1>
          <p>Publishing oversight, delivery health, recovery controls, and an immutable activity trail.</p>
        </div>
        <div className={styles.topActions}>
          <div className={`${styles.workerChip} ${workerOk ? styles.workerOk : styles.workerBad}`}>
            <i />
            <div>
              <b>Worker {overview ? human(overview.worker.status) : "Unknown"}</b>
              <span>{overview?.worker.activeJobs ?? 0} active jobs</span>
            </div>
          </div>
          <Link className={styles.ghostBtn} href="/admin/team">Team</Link>
          <button type="button" className={styles.primary} disabled={loading} onClick={() => void load()}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      {demo && <div className={styles.notice}>Development preview — sample operations data shown.</div>}

      {overview && (
        <section className={styles.metrics}>
          <article>
            <span>Catalog parts</span>
            <b>{overview.catalog.parts}</b>
            <small>{overview.catalog.readyDrafts} drafts ready</small>
          </article>
          <article>
            <span>Published</span>
            <b className={styles.metricGood}>{overview.publishing.published}</b>
            <small>{overview.publishing.drifted} drifted · {overview.publishing.withdrawn} withdrawn</small>
          </article>
          <article>
            <span>Failed jobs</span>
            <b className={overview.failedJobs ? styles.metricBad : undefined}>{overview.failedJobs}</b>
            <small>{overview.delivery.openDeadLetters} open dead letters</small>
          </article>
          <article>
            <span>Delivery queue</span>
            <b className={styles.metricWarn}>{overview.delivery.pendingOutbox}</b>
            <small>{overview.delivery.failedOutbox} failed events</small>
          </article>
        </section>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <span className={styles.eyebrow}>Recovery</span>
            <h2>Failed jobs</h2>
          </div>
          <p>External mutations are never silently repeated.</p>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Listing / scope</th>
                <th>Error</th>
                <th>Attempts</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={`${job.jobType}-${job.id}`}>
                  <td>
                    <b>{human(job.jobType)}</b>
                    <span className={styles.subtle}>{job.action ? human(job.action) : "Job"}</span>
                  </td>
                  <td>{job.label}</td>
                  <td className={styles.errorCell} title={job.lastError ?? ""}>{job.lastError || "No error detail"}</td>
                  <td>{job.attemptCount}</td>
                  <td>{time(job.updatedAt)}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.tableBtn}
                      title={job.retryReason}
                      disabled={!job.retryAllowed || retrying === job.id}
                      onClick={() => void retry(job)}
                    >
                      {retrying === job.id ? "Queuing…" : job.retryAllowed ? "Retry safely" : "Review"}
                    </button>
                  </td>
                </tr>
              ))}
              {!jobs.length && (
                <tr><td colSpan={6} className={styles.emptyCell}>No failed jobs.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <span className={styles.eyebrow}>eBay oversight</span>
            <h2>Publishing state</h2>
          </div>
          <select
            aria-label="Filter publishing status"
            value={publishingStatus}
            onChange={(event) => setPublishingStatus(event.target.value)}
          >
            <option value="">All states</option>
            <option value="PUBLISHED">Published</option>
            <option value="DRIFTED">Drifted</option>
            <option value="WITHDRAWN">Withdrawn</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>SKU / listing</th>
                <th>Title</th>
                <th>Local state</th>
                <th>Remote state</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {publishing.map((offer) => (
                <tr key={offer.id}>
                  <td>
                    <b className={styles.sku}>{offer.sku}</b>
                    {offer.ebayListingId ? (
                      <a href={listingUrl(offer.marketplace, offer.ebayListingId)} target="_blank" rel="noreferrer">
                        {offer.ebayListingId} ↗
                      </a>
                    ) : (
                      <span className={styles.subtle}>No listing ID</span>
                    )}
                  </td>
                  <td>
                    {offer.listingDraft.title}
                    <span className={styles.subtle}>Draft v{offer.listingDraft.version}</span>
                  </td>
                  <td>
                    <span className={`${styles.pill} ${offer.status === "DRIFTED" || offer.status === "FAILED" ? styles.pillWarn : styles.pillGood}`}>
                      {human(offer.status)}
                    </span>
                  </td>
                  <td>{offer.remoteListingStatus ? human(offer.remoteListingStatus) : "Unknown"}</td>
                  <td>{time(offer.updatedAt)}</td>
                </tr>
              ))}
              {!publishing.length && (
                <tr><td colSpan={5} className={styles.emptyCell}>No offers match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {retentionPolicy && (
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <span className={styles.eyebrow}>Data lifecycle</span>
              <h2>Retention and cleanup</h2>
            </div>
            <p>Preview first. Audit events are reported for archival and never deleted here.</p>
          </div>
          <form className={styles.retentionForm} key={JSON.stringify(retentionPolicy)} onSubmit={saveRetentionPolicy}>
            <label>
              <span>Read notifications</span>
              <input name="readNotificationDays" type="number" min={30} max={3650} defaultValue={retentionPolicy.readNotificationDays} />
              <small>days</small>
            </label>
            <label>
              <span>Competitor snapshots</span>
              <input name="competitorSnapshotDays" type="number" min={30} max={3650} defaultValue={retentionPolicy.competitorSnapshotDays} />
              <small>days</small>
            </label>
            <label>
              <span>Published outbox</span>
              <input name="publishedOutboxDays" type="number" min={7} max={3650} defaultValue={retentionPolicy.publishedOutboxDays} />
              <small>days</small>
            </label>
            <label>
              <span>Resolved dead letters</span>
              <input name="resolvedDeadLetterDays" type="number" min={30} max={3650} defaultValue={retentionPolicy.resolvedDeadLetterDays} />
              <small>days</small>
            </label>
            <label>
              <span>Audit archive threshold</span>
              <input name="auditArchiveAfterDays" type="number" min={365} max={3650} defaultValue={retentionPolicy.auditArchiveAfterDays} />
              <small>days · report only</small>
            </label>
            <button type="submit" className={styles.primary} disabled={retentionBusy === "policy"}>
              {retentionBusy === "policy" ? "Saving…" : "Save policy"}
            </button>
          </form>
          <div className={styles.retentionActions}>
            <div>
              <b>Controlled execution</b>
              <span>Cutoffs are frozen when queued. Apply deletes only eligible derived and operational records.</span>
            </div>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={Boolean(retentionBusy) || retentionRuns.some(({ status }) => status === "QUEUED" || status === "RUNNING")}
              onClick={() => void queueRetention("PREVIEW")}
            >
              Preview eligible data
            </button>
            <button
              type="button"
              className={styles.dangerBtn}
              disabled={Boolean(retentionBusy) || retentionRuns.some(({ status }) => status === "QUEUED" || status === "RUNNING")}
              onClick={() => void queueRetention("APPLY")}
            >
              Apply cleanup
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Mode / status</th>
                  <th>Result</th>
                  <th>Requested by</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {retentionRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <b>{run.id.slice(-8)}</b>
                      <span className={styles.subtle}>{time(run.createdAt)}</span>
                    </td>
                    <td>
                      <span className={`${styles.pill} ${run.status === "FAILED" || run.mode === "APPLY" ? styles.pillWarn : ""}`}>
                        {human(run.mode)} · {human(run.status)}
                      </span>
                    </td>
                    <td>
                      {run.result
                        ? Object.entries(run.result).map(([name, count]) => `${human(name)}: ${count}`).join(" · ")
                        : run.lastError || "Waiting for worker"}
                    </td>
                    <td>{run.createdBy.name || run.createdBy.email}</td>
                    <td>{time(run.completedAt)}</td>
                  </tr>
                ))}
                {!retentionRuns.length && (
                  <tr><td colSpan={5} className={styles.emptyCell}>No retention runs yet. Start with a preview.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <span className={styles.eyebrow}>Audit trail</span>
            <h2>Recent activity</h2>
          </div>
          <select aria-label="Filter audit severity" value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="">All severities</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
        <div className={styles.timeline}>
          {audit.map((event) => (
            <article key={event.id}>
              <i className={`${styles.eventDot} ${styles[`sev_${event.severity.toLowerCase()}`]}`} />
              <div>
                <b>{event.summary}</b>
                <span>{human(event.action)} · {event.actorUser?.name || event.actorUser?.email || event.actorType}</span>
              </div>
              <time>{time(event.occurredAt)}</time>
            </article>
          ))}
          {!audit.length && <p className={styles.emptyCell}>No audit events match this filter.</p>}
        </div>
      </section>
    </div>
  );
}
