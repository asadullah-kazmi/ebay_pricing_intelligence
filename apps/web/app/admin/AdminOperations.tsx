"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./admin.module.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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
  driftIssues: unknown;
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

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function time(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
}

function listingUrl(marketplace: string, listingId: string) {
  const host = marketplace === "EBAY_GB" ? "www.ebay.co.uk" : marketplace === "EBAY_DE" ? "www.ebay.de" : "www.ebay.com";
  return `https://${host}/itm/${listingId}`;
}

export default function AdminOperations() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authState, setAuthState] = useState<"loading" | "required" | "ready">("loading");
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

  useEffect(() => {
    fetch(`${apiBase}/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((data: { accessToken: string }) => { setToken(data.accessToken); setAuthState("ready"); })
      .catch(() => setAuthState("required"));
  }, []);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: "include",
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers, Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }, [token]);

  const load = useCallback(async () => {
    if (authState !== "ready") return;
    setLoading(true);
    setError("");
    try {
      const publishQuery = publishingStatus ? `?status=${publishingStatus}&limit=50` : "?limit=50";
      const auditQuery = severity ? `?severity=${severity}&limit=50` : "?limit=50";
      const [overviewResult, jobsResult, publishingResult, auditResult, retentionPolicyResult, retentionRunsResult] = await Promise.all([
        request("/api/admin/overview"),
        request("/api/admin/failed-jobs?limit=50"),
        request(`/api/admin/publishing${publishQuery}`),
        request(`/api/admin/audit-events${auditQuery}`),
        request("/api/admin/retention-policy"),
        request("/api/admin/retention-runs?limit=20"),
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
  }, [authState, publishingStatus, request, severity]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!retentionRuns.some(({ status }) => status === "QUEUED" || status === "RUNNING")) return;
    const timer = window.setTimeout(() => void load(), 2000);
    return () => window.clearTimeout(timer);
  }, [load, retentionRuns]);

  function connectToken(event: FormEvent) {
    event.preventDefault();
    setToken(tokenInput.trim());
    setAuthState("ready");
  }

  async function retry(job: FailedJob) {
    if (!job.retryAllowed) return;
    setRetrying(job.id);
    setError("");
    setNotice("");
    try {
      await request(`/api/admin/jobs/${job.jobType}/${job.id}/retry`, { method: "POST" });
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
    const form = new FormData(event.currentTarget);
    setRetentionBusy("policy"); setError(""); setNotice("");
    try {
      setRetentionPolicy(await request("/api/admin/retention-policy", {
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
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save retention policy"); }
    finally { setRetentionBusy(""); }
  }

  async function queueRetention(mode: "PREVIEW" | "APPLY") {
    let confirmation: string | undefined;
    if (mode === "APPLY") {
      confirmation = window.prompt('This permanently deletes only eligible derived/operational records. Type "DELETE EXPIRED DATA" to continue:') ?? undefined;
      if (confirmation !== "DELETE EXPIRED DATA") return;
    }
    setRetentionBusy(mode); setError(""); setNotice("");
    try {
      await request("/api/admin/retention-runs", { method: "POST", body: JSON.stringify({ mode, confirmation }) });
      setNotice(mode === "PREVIEW" ? "Retention preview queued." : "Retention cleanup queued with immutable audit evidence.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to queue retention run"); }
    finally { setRetentionBusy(""); }
  }

  if (authState === "loading") return <main className={styles.center}>Loading secure operations console…</main>;
  if (authState === "required") return <main className={styles.center}><section className={styles.authCard}><span>PARTPULSE ADMIN</span><h1>Operations access required</h1><p>Sign in as an organization owner or administrator. A short-lived access token can be used during development.</p><form onSubmit={connectToken}><label htmlFor="admin-token">Development access token</label><textarea id="admin-token" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} required/><button>Open console</button></form>{error && <div className={styles.error}>{error}</div>}<a href="/catalog">Return to catalog</a></section></main>;

  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="/"><b>Part</b>Pulse<span>Operations control</span></a>
      <nav><a href="/catalog"><span>01</span>Catalog</a><a className={styles.active} href="/admin"><span>02</span>Admin</a><a href="/admin/team"><span>03</span>Team</a><a href="/notifications"><span>04</span>Notifications</a></nav>
      <div className={styles.worker}><i className={overview?.worker.status === "ok" ? styles.ok : styles.bad}/><div><b>Worker {overview ? human(overview.worker.status) : "Unknown"}</b><span>{overview?.worker.activeJobs ?? 0} active jobs</span></div></div>
    </aside>
    <section className={styles.content}>
      <header><div><span className={styles.eyebrow}>TENANT OPERATIONS</span><h1>Control room</h1><p>Publishing oversight, delivery health, recovery controls, and an immutable activity trail.</p></div><button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></header>
      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      {overview && <section className={styles.metrics}>
        <article><span>Catalog parts</span><strong>{overview.catalog.parts}</strong><small>{overview.catalog.readyDrafts} drafts ready</small></article>
        <article><span>Published</span><strong>{overview.publishing.published}</strong><small>{overview.publishing.drifted} drifted · {overview.publishing.withdrawn} withdrawn</small></article>
        <article className={overview.failedJobs ? styles.attention : ""}><span>Failed jobs</span><strong>{overview.failedJobs}</strong><small>{overview.delivery.openDeadLetters} open dead letters</small></article>
        <article><span>Delivery queue</span><strong>{overview.delivery.pendingOutbox}</strong><small>{overview.delivery.failedOutbox} failed events</small></article>
      </section>}

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.eyebrow}>RECOVERY</span><h2>Failed jobs</h2></div><p>External mutations are never silently repeated.</p></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Workflow</th><th>Listing / scope</th><th>Error</th><th>Attempts</th><th>Updated</th><th/></tr></thead><tbody>
          {jobs.map((job) => <tr key={`${job.jobType}-${job.id}`}><td><b>{human(job.jobType)}</b><span>{job.action ? human(job.action) : "Job"}</span></td><td>{job.label}</td><td title={job.lastError ?? ""}>{job.lastError || "No error detail"}</td><td>{job.attemptCount}</td><td>{time(job.updatedAt)}</td><td><button title={job.retryReason} disabled={!job.retryAllowed || retrying === job.id} onClick={() => void retry(job)}>{retrying === job.id ? "Queuing…" : job.retryAllowed ? "Retry safely" : "Review workflow"}</button></td></tr>)}
          {!jobs.length && <tr><td colSpan={6} className={styles.empty}>No failed jobs.</td></tr>}
        </tbody></table></div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.eyebrow}>EBAY OVERSIGHT</span><h2>Publishing state</h2></div><select aria-label="Filter publishing status" value={publishingStatus} onChange={(event) => setPublishingStatus(event.target.value)}><option value="">All states</option><option value="PUBLISHED">Published</option><option value="DRIFTED">Drifted</option><option value="WITHDRAWN">Withdrawn</option><option value="FAILED">Failed</option></select></div>
        <div className={styles.tableWrap}><table><thead><tr><th>SKU / listing</th><th>Title</th><th>Local state</th><th>Remote state</th><th>Updated</th></tr></thead><tbody>
          {publishing.map((offer) => <tr key={offer.id}><td><b>{offer.sku}</b>{offer.ebayListingId ? <a href={listingUrl(offer.marketplace, offer.ebayListingId)} target="_blank" rel="noreferrer">{offer.ebayListingId} ↗</a> : <span>No listing ID</span>}</td><td>{offer.listingDraft.title}<span>Draft v{offer.listingDraft.version}</span></td><td><i className={`${styles.pill} ${offer.status === "DRIFTED" || offer.status === "FAILED" ? styles.warn : ""}`}>{human(offer.status)}</i></td><td>{offer.remoteListingStatus ? human(offer.remoteListingStatus) : "Unknown"}</td><td>{time(offer.updatedAt)}</td></tr>)}
          {!publishing.length && <tr><td colSpan={5} className={styles.empty}>No offers match this filter.</td></tr>}
        </tbody></table></div>
      </section>

      {retentionPolicy && <section className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.eyebrow}>DATA LIFECYCLE</span><h2>Retention and cleanup</h2></div><p>Preview first. Audit events are reported for archival and never deleted here.</p></div>
        <form className={styles.retentionForm} key={JSON.stringify(retentionPolicy)} onSubmit={saveRetentionPolicy}>
          <label><span>Read notifications</span><input name="readNotificationDays" type="number" min="30" max="3650" defaultValue={retentionPolicy.readNotificationDays}/><small>days</small></label>
          <label><span>Competitor snapshots</span><input name="competitorSnapshotDays" type="number" min="30" max="3650" defaultValue={retentionPolicy.competitorSnapshotDays}/><small>days</small></label>
          <label><span>Published outbox</span><input name="publishedOutboxDays" type="number" min="7" max="3650" defaultValue={retentionPolicy.publishedOutboxDays}/><small>days</small></label>
          <label><span>Resolved dead letters</span><input name="resolvedDeadLetterDays" type="number" min="30" max="3650" defaultValue={retentionPolicy.resolvedDeadLetterDays}/><small>days</small></label>
          <label><span>Audit archive threshold</span><input name="auditArchiveAfterDays" type="number" min="365" max="3650" defaultValue={retentionPolicy.auditArchiveAfterDays}/><small>days · report only</small></label>
          <button disabled={retentionBusy === "policy"}>{retentionBusy === "policy" ? "Saving…" : "Save policy"}</button>
        </form>
        <div className={styles.retentionActions}><div><b>Controlled execution</b><span>Cutoffs are frozen when queued. Apply deletes only eligible derived and operational records.</span></div><button disabled={Boolean(retentionBusy) || retentionRuns.some(({ status }) => status === "QUEUED" || status === "RUNNING")} onClick={() => void queueRetention("PREVIEW")}>Preview eligible data</button><button className={styles.dangerButton} disabled={Boolean(retentionBusy) || retentionRuns.some(({ status }) => status === "QUEUED" || status === "RUNNING")} onClick={() => void queueRetention("APPLY")}>Apply cleanup</button></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Run</th><th>Mode / status</th><th>Result</th><th>Requested by</th><th>Completed</th></tr></thead><tbody>
          {retentionRuns.map((run) => <tr key={run.id}><td><b>{run.id.slice(-8)}</b><span>{time(run.createdAt)}</span></td><td><i className={`${styles.pill} ${run.status === "FAILED" || run.mode === "APPLY" ? styles.warn : ""}`}>{human(run.mode)} · {human(run.status)}</i></td><td>{run.result ? Object.entries(run.result).map(([name, count]) => `${human(name)}: ${count}`).join(" · ") : run.lastError || "Waiting for worker"}</td><td>{run.createdBy.name || run.createdBy.email}</td><td>{time(run.completedAt)}</td></tr>)}
          {!retentionRuns.length && <tr><td colSpan={5} className={styles.empty}>No retention runs yet. Start with a preview.</td></tr>}
        </tbody></table></div>
      </section>}

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span className={styles.eyebrow}>AUDIT TRAIL</span><h2>Recent activity</h2></div><select aria-label="Filter audit severity" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">All severities</option><option value="INFO">Info</option><option value="WARNING">Warning</option><option value="CRITICAL">Critical</option></select></div>
        <div className={styles.timeline}>{audit.map((event) => <article key={event.id}><i className={`${styles.eventDot} ${styles[event.severity.toLowerCase()]}`}/><div><b>{event.summary}</b><span>{human(event.action)} · {event.actorUser?.name || event.actorUser?.email || event.actorType}</span></div><time>{time(event.occurredAt)}</time></article>)}{!audit.length && <p className={styles.empty}>No audit events match this filter.</p>}</div>
      </section>
    </section>
  </main>;
}
