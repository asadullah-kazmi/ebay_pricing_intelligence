"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import { apiBase, refreshAccessSession } from "../../lib/auth-session";
import { generateFullCatalogExcel, generateQuickUpdateExcel } from "./excel-templates";
import styles from "./pipeline.module.css";

type QueueItem = {
  id: string;
  fileName: string;
  status: "UPLOADED" | "PROCESSING" | "FAILED" | "READY";
  condition: string;
  uploadedBy: string;
  createdAt: string;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
  finishedRows: number;
  remainingRows: number;
  percent: number;
};

type ListingTeam = {
  id: string;
  name: string;
  color: string;
};

type PipelineJob = {
  id: string;
  originalFilename: string;
  status: string;
  defaultCondition: string | null;
  createdAt: string;
  totalRows: number;
  processedRows: number;
  failedRows: number;
  invalidRows: number;
  progress: { finishedRows: number; percent: number };
  createdBy: { name: string | null; email: string };
};

type ImportPreview = {
  rows: Array<{
    rowNumber: number;
    errors: Array<{ message?: string }>;
  }>;
};

type ImportValidationResult = {
  id: string;
  status: string;
  invalidRows: number;
  reused: boolean;
  error?: string;
};

const demoQueue: QueueItem[] = [
  { id: "imp-7842", fileName: "catalog-intake-week-12.xlsx", status: "UPLOADED", condition: "USED", uploadedBy: "BA", createdAt: new Date().toISOString(), totalRows: 120, succeededRows: 0, failedRows: 0, skippedRows: 0, finishedRows: 0, remainingRows: 120, percent: 0 },
  { id: "imp-7841", fileName: "yard-photos-march.xlsx", status: "PROCESSING", condition: "USED", uploadedBy: "BA", createdAt: new Date(Date.now() - 3600000).toISOString(), totalRows: 80, succeededRows: 46, failedRows: 2, skippedRows: 0, finishedRows: 48, remainingRows: 32, percent: 60 },
  { id: "imp-7840", fileName: "interchange-batch.xlsx", status: "READY", condition: "NEW", uploadedBy: "OP", createdAt: new Date(Date.now() - 86400000).toISOString(), totalRows: 35, succeededRows: 34, failedRows: 1, skippedRows: 0, finishedRows: 35, remainingRows: 0, percent: 100 },
];

function toQueueItem(job: PipelineJob): QueueItem {
  const skippedRows = job.invalidRows;
  const finishedRows = Math.min(job.totalRows, job.processedRows + job.failedRows + skippedRows);
  return {
    id: job.id,
    fileName: job.originalFilename,
    status: job.status === "COMMITTING"
      ? "PROCESSING"
      : job.status === "COMPLETED"
        ? "READY"
        : job.status === "FAILED"
          ? "FAILED"
          : "UPLOADED",
    condition: job.defaultCondition || "—",
    uploadedBy: job.createdBy.name
      ? job.createdBy.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()
      : job.createdBy.email.slice(0, 2).toUpperCase(),
    createdAt: job.createdAt,
    totalRows: job.totalRows,
    succeededRows: job.processedRows,
    failedRows: job.failedRows,
    skippedRows,
    finishedRows,
    remainingRows: Math.max(0, job.totalRows - finishedRows),
    percent: job.totalRows ? Math.round((finishedRows / job.totalRows) * 100) : job.progress.percent,
  };
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function PipelineWorkspace() {
  const { status, demo, apiFetch } = useAuth();
  const [teams, setTeams] = useState<ListingTeam[]>([]);
  const [team, setTeam] = useState("");
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [condition, setCondition] = useState("USED");
  const [assignImages, setAssignImages] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    if (status !== "ready" || demo) return;
    const result = await apiFetch("/api/imports?limit=30") as { jobs: PipelineJob[] };
    const items = result.jobs.map(toQueueItem);
    setQueue(items);
    setActiveJobId((current) => current && items.some((item) => item.id === current)
      ? current
      : items.find((item) => item.status === "PROCESSING")?.id ?? null);
  }, [apiFetch, demo, status]);

  useEffect(() => {
    if (status !== "ready") return;
    if (demo) {
      const sampleTeams = [{ id: "demo-operations", name: "Operations", color: "#2563EB" }];
      setTeams(sampleTeams);
      setTeam(sampleTeams[0].id);
      setQueue(demoQueue);
      setTeamsLoading(false);
      return;
    }

    let cancelled = false;
    setTeamsLoading(true);
    void Promise.all([
      apiFetch("/api/listing-teams") as Promise<{ teams: ListingTeam[] }>,
      apiFetch("/api/imports?limit=30") as Promise<{ jobs: PipelineJob[] }>,
    ]).then(([teamResult, jobResult]) => {
      if (cancelled) return;
      setTeams(teamResult.teams);
      setTeam((current) => teamResult.teams.some((item) => item.id === current)
        ? current
        : teamResult.teams[0]?.id || "");
      const items = jobResult.jobs.map(toQueueItem);
      setQueue(items);
      setActiveJobId(items.find((item) => item.status === "PROCESSING")?.id ?? null);
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load teams and pipeline jobs");
    }).finally(() => {
      if (!cancelled) setTeamsLoading(false);
    });

    return () => { cancelled = true; };
  }, [apiFetch, demo, status]);

  useEffect(() => {
    if (status !== "ready" || demo || !queue.some((item) => item.status === "PROCESSING")) return;
    const timer = window.setInterval(() => {
      void loadQueue().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to refresh pipeline progress"));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [demo, loadQueue, queue, status]);

  async function handleDownloadQuickExcel() {
    setDownloading("quick");
    try {
      const blob = await generateQuickUpdateExcel();
      triggerBlobDownload(blob, "PartPulse_Quick_Update_Template.xlsx");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to generate Excel template");
    } finally {
      setDownloading(null);
    }
  }

  async function handleDownloadFullExcel() {
    setDownloading("full");
    try {
      const blob = await generateFullCatalogExcel();
      triggerBlobDownload(blob, "PartPulse_Full_Catalog_Template.xlsx");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to generate Excel template");
    } finally {
      setDownloading(null);
    }
  }

  async function uploadSpreadsheet(event: FormEvent) {
    event.preventDefault();
    if (!file || !team || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let access = await refreshAccessSession();
      const filename = file.name.replace(/[^A-Za-z0-9._ -]/g, "_");
      const send = async (accessToken: string) => {
        return fetch(`${apiBase}/api/imports/validate`, {
          method: "POST",
          credentials: "include",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": filename,
          },
          body: file,
        });
      };
      let response = await send(access.accessToken);
      if (response.status === 401) {
        access = await refreshAccessSession({ force: true });
        response = await send(access.accessToken);
      }
      const payload = await response.json().catch(() => ({})) as Partial<ImportValidationResult>;
      if (!response.ok) throw new Error(payload.error || "Upload failed");
      if (!payload.id || !payload.status) throw new Error("The pipeline returned an incomplete upload response");
      if (payload.invalidRows) {
        let details = "";
        try {
          const preview = await apiFetch(`/api/imports/${payload.id}/preview?page=1&pageSize=100`) as ImportPreview;
          const reasons = preview.rows
            .filter((row) => row.errors.length)
            .slice(0, 3)
            .map((row) => `Row ${row.rowNumber}: ${row.errors[0]?.message || "Invalid data"}`);
          if (reasons.length) details = ` ${reasons.join(" · ")}`;
        } catch {
          // The invalid-row count still gives the user a safe fallback if preview retrieval fails.
        }
        throw new Error(`${payload.invalidRows} invalid row(s) found.${details}`);
      }
      if (payload.reused && (payload.status === "COMMITTING" || payload.status === "COMPLETED")) {
        setActiveJobId(payload.id);
        setFile(null);
        await loadQueue();
        setNotice(payload.status === "COMPLETED"
          ? `${filename} was already processed. The completed job is shown below.`
          : `${filename} is already processing. Its current progress is shown below.`);
        return;
      }
      if (payload.reused && payload.status === "FAILED") {
        throw new Error("A previous job for this exact spreadsheet failed. Open it from the pipeline queue to review the failed rows before retrying.");
      }
      await apiFetch(`/api/imports/${payload.id}/start`, {
        method: "POST",
        body: JSON.stringify({ listingTeamId: team, condition, marketplace: "EBAY_US", assignImages }),
      });
      setActiveJobId(payload.id);
      setNotice(`${filename} is processing. Items will appear in Catalog as each row completes.`);
      setFile(null);
      await loadQueue();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to upload catalog file");
    } finally {
      setBusy(false);
    }
  }

  const activeJob = queue.find((item) => item.id === activeJobId)
    ?? queue.find((item) => item.status === "PROCESSING")
    ?? null;

  if (status !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>CATALOG & INVENTORY INTAKE</span>
          <h1>Pipeline</h1>
          <p>Bulk-upload spreadsheets and photo archives into the catalog intake queue.</p>
        </div>
        <div className={styles.topActions}>
          <Link className={styles.primary} href="/catalog">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            Open catalog
          </Link>
        </div>
      </header>

      {notice && (
        <div className={styles.notice}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {notice}
        </div>
      )}
      {error && (
        <div className={styles.error}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {error}
        </div>
      )}

      {activeJob && (
        <section className={styles.progressPanel} aria-live="polite">
          <div className={styles.progressHeader}>
            <div className={styles.progressTitle}>
              <span className={`${styles.progressIcon} ${styles[activeJob.status.toLowerCase() + "Icon"]} ${activeJob.status === "PROCESSING" ? styles.progressIconActive : ""}`}>
                {activeJob.status === "READY" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : activeJob.status === "FAILED" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                )}
              </span>
              <div>
                <span className={styles.eyebrow}>CURRENT PIPELINE JOB</span>
                <h2>{activeJob.fileName}</h2>
                <p>
                  {activeJob.status === "PROCESSING"
                    ? "Enriching listings and adding completed items to Catalog."
                    : activeJob.status === "READY"
                      ? "Processing finished. Catalog items are ready for review."
                      : activeJob.status === "FAILED"
                        ? "The job stopped before all rows could be processed."
                        : "The job is staged and waiting to begin."}
                </p>
              </div>
            </div>
            <span className={`${styles.status} ${styles[activeJob.status.toLowerCase()]}`}>
              <span className={styles.statusDot} />
              {activeJob.status}
            </span>
          </div>

          <div className={styles.progressTrack}>
            <span style={{ width: `${activeJob.percent}%` }} />
          </div>
          <div className={styles.progressMeta}>
            <span>{activeJob.percent}% complete</span>
            <span>{activeJob.remainingRows} remaining</span>
          </div>

          <div className={styles.progressStats}>
            <article>
              <span>Total listings</span>
              <strong>{activeJob.totalRows}</strong>
            </article>
            <article>
              <span>Completed</span>
              <strong>{activeJob.finishedRows}</strong>
            </article>
            <article className={styles.successMetric}>
              <span>Succeeded</span>
              <strong>{activeJob.succeededRows}</strong>
            </article>
            <article className={styles.failedMetric}>
              <span>Failed</span>
              <strong>{activeJob.failedRows}</strong>
            </article>
            <article className={styles.skippedMetric}>
              <span>Skipped</span>
              <strong>{activeJob.skippedRows}</strong>
            </article>
          </div>
        </section>
      )}

      {/* Template Download Buttons Row */}
      <div className={styles.templateButtonsRow}>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={downloading === "quick"}
          onClick={() => void handleDownloadQuickExcel()}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {downloading === "quick" ? "Generating..." : "Download Quick Template (.xlsx)"}
        </button>

        <button
          type="button"
          className={styles.ghostBtn}
          disabled={downloading === "full"}
          onClick={() => void handleDownloadFullExcel()}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {downloading === "full" ? "Generating..." : "Download Full Template (.xlsx)"}
        </button>
      </div>

      <section className={styles.uploadGrid}>
        <form className={styles.uploadCard} onSubmit={uploadSpreadsheet}>
          <div className={styles.cardHead}>
            <span className={styles.eyebrow}>BULK UPLOAD</span>
            <h2>Stage catalog intake</h2>
          </div>
          <div className={styles.uploadControls}>
            <label>
              <span>Team</span>
              <select value={team} onChange={(event) => setTeam(event.target.value)} disabled={teamsLoading} required>
                <option value="" disabled>
                  {teamsLoading ? "Loading teams..." : teams.length ? "Select team" : "No active teams"}
                </option>
                {teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              <span>Default condition</span>
              <select value={condition} onChange={(event) => setCondition(event.target.value)}>
                <option value="USED">Used</option>
                <option value="NEW">New</option>
              </select>
            </label>
          </div>
          <label className={styles.imageOption}>
            <input
              type="checkbox"
              checked={assignImages}
              onChange={(event) => setAssignImages(event.target.checked)}
            />
            <span>
              <strong>Assign images automatically</strong>
              <small>Find and attach up to 2 matching images from eBay Browse data. Listings remain catalog drafts and are not published.</small>
            </span>
          </label>
          <label className={styles.dropzone}>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <div className={styles.dropzoneIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                <path d="M12 12v9" />
                <path d="m16 16-4-4-4 4" />
              </svg>
            </div>
            <strong>{file ? file.name : "Drag & drop spreadsheet"}</strong>
            <span>Supports Basic &amp; Standard PartPulse Excel Workbooks (.xlsx)</span>
          </label>
          <div className={styles.formActions}>
            <button type="submit" className={styles.primary} disabled={!file || !team || busy || teamsLoading}>
              {busy ? "Uploading..." : "Upload to pipeline"}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.queuePanel}>
        <div className={styles.panelTitle}>
          <div>
            <span className={styles.eyebrow}>PIPELINE QUEUE</span>
            <h2>{queue.length} recent uploads</h2>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Condition</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Uploaded by</th>
                <th>Date</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className={styles.fileMeta}>
                      <span className={styles.fileName}>{item.fileName}</span>
                      <span className={styles.fileId}>{item.id}</span>
                    </div>
                  </td>
                  <td>
                    <span className={styles.pill}>{item.condition}</span>
                  </td>
                  <td>
                    <div className={styles.tableProgress}>
                      <span><i style={{ width: `${item.percent}%` }} /></span>
                      <small>{item.finishedRows}/{item.totalRows}</small>
                    </div>
                  </td>
                  <td>
                    <span className={`${styles.status} ${styles[item.status.toLowerCase()]}`}>{item.status}</span>
                  </td>
                  <td>
                    <span className={styles.avatar}>{item.uploadedBy}</span>
                  </td>
                  <td className={styles.dateCell}>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    <button type="button" className={styles.viewProgress} onClick={() => setActiveJobId(item.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
