"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import { apiBase, refreshAccessSession } from "../../lib/auth-session";
import { generateFullCatalogExcel, generateQuickUpdateExcel } from "./excel-templates";
import styles from "./pipeline.module.css";

type Team = { id: string; name: string; color: string };
type Job = {
  id: string; originalFilename: string; status: string; totalRows: number; processedRows: number; failedRows: number;
  defaultCondition: string | null; marketplace: string; createdAt: string; updatedAt: string;
  progress: { finishedRows: number; percent: number };
  listingTeam: Team | null;
  createdBy: { name: string | null; email: string };
};
type PipelineRow = {
  id: string; rowNumber: number; status: string; pipelineStage: string; pipelineError: string | null;
  normalizedData: { sku?: string; primaryPartNumber?: string; brand?: string } | null;
  enrichmentData: { title?: string; fitmentCount?: number; identificationSource?: string } | null;
  committedPart: null | {
    id: string; sku: string; primaryPartNumber: string; brand: string | null; partName: string | null; status: string;
    fitmentApplications: Array<{ id: string }>;
    listingDrafts: Array<{ id: string; title: string; status: string; marketplace: string }>;
  };
};
type JobDetail = Job & { rows: PipelineRow[] };

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function friendlyStage(stage: string) {
  return ({
    QUEUED: "Queued",
    IDENTIFYING: "Identifying part",
    FITMENT: "Finding fitment",
    BUILDING_LISTING: "Building listing",
    CATALOG: "Adding to catalog",
    COMPLETED: "Completed",
    FAILED: "Needs attention"
  } as Record<string, string>)[stage] ?? stage;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PipelineWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [condition, setCondition] = useState("USED");
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openedId, setOpenedId] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [busy, setBusy] = useState("");
  const [downloading, setDownloading] = useState<"basic" | "standard" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadJobs = useCallback(async () => {
    if (authStatus !== "ready" || demo) return;
    try {
      const result = await apiFetch("/api/imports?limit=30") as { jobs: Job[] };
      setJobs(result.jobs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load jobs");
    }
  }, [apiFetch, authStatus, demo]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id || demo) return;
    const result = await apiFetch(`/api/imports/${id}`) as JobDetail;
    setDetail(result);
  }, [apiFetch, demo]);

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (demo) {
      const sampleTeams = [{ id: "demo-team", name: "Operations", color: "#2563EB" }];
      setTeams(sampleTeams);
      setTeamId(sampleTeams[0].id);
      return;
    }
    void Promise.all([
      apiFetch("/api/listing-teams") as Promise<{ teams: Team[] }>,
      apiFetch("/api/imports?limit=30") as Promise<{ jobs: Job[] }>,
    ]).then(([teamResult, jobResult]) => {
      setTeams(teamResult.teams);
      setTeamId((current) => current || teamResult.teams[0]?.id || "");
      setJobs(jobResult.jobs);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load pipeline"));
  }, [apiFetch, authStatus, demo]);

  const hasRunningJobs = useMemo(() => jobs.some((job) => job.status === "COMMITTING"), [jobs]);

  useEffect(() => {
    if (!hasRunningJobs || demo) return;
    const timer = window.setInterval(() => {
      void loadJobs();
      if (openedId) void loadDetail(openedId);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [demo, hasRunningJobs, loadDetail, loadJobs, openedId]);

  async function downloadTemplate(kind: "basic" | "standard") {
    setDownloading(kind);
    setError("");
    try {
      const blob = kind === "basic" ? await generateQuickUpdateExcel() : await generateFullCatalogExcel();
      triggerBlobDownload(blob, kind === "basic" ? "PartPulse_Basic_Pipeline_Template.xlsx" : "PartPulse_Standard_Pipeline_Template.xlsx");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to generate template");
    } finally {
      setDownloading("");
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && (droppedFile.name.endsWith(".csv") || droppedFile.name.endsWith(".xlsx"))) {
      setFile(droppedFile);
      setError("");
    } else if (droppedFile) {
      setError("Please select a valid .csv or .xlsx spreadsheet.");
    }
  };

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !teamId || busy) return;
    setBusy("upload");
    setError("");
    setNotice("");
    try {
      let access = await refreshAccessSession();
      const filename = file.name.replace(/[^A-Za-z0-9._ -]/g, "_");
      const send = (token: string) => fetch(`${apiBase}/api/imports/validate`, {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": filename
        },
        body: file,
      });
      let response = await send(access.accessToken);
      if (response.status === 401) {
        access = await refreshAccessSession({ force: true });
        response = await send(access.accessToken);
      }
      const staged = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(staged.error || "Unable to validate spreadsheet");
      if (staged.invalidRows) throw new Error(`${staged.invalidRows} invalid row(s) found. Correct the spreadsheet and upload it again.`);
      await apiFetch(`/api/imports/${staged.id}/start`, {
        method: "POST",
        body: JSON.stringify({ listingTeamId: teamId, condition, marketplace })
      });
      setFile(null);
      setOpenedId(staged.id);
      setNotice(`${filename} is processing. Items will appear in Catalog as each row completes.`);
      await loadJobs();
      await loadDetail(staged.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start pipeline");
    } finally {
      setBusy("");
    }
  }

  async function openJob(id: string) {
    if (openedId === id) {
      setOpenedId("");
      setDetail(null);
      return;
    }
    setOpenedId(id);
    setBusy(`open-${id}`);
    setError("");
    try {
      await loadDetail(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open pipeline job");
    } finally {
      setBusy("");
    }
  }

  async function retry(id: string) {
    setBusy(`retry-${id}`);
    setError("");
    try {
      await apiFetch(`/api/imports/${id}/retry`, { method: "POST" });
      setNotice("Failed rows were requeued.");
      await loadJobs();
      await loadDetail(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to retry failed rows");
    } finally {
      setBusy("");
    }
  }

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      {/* Top Header */}
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>CATALOG AUTOMATION &amp; INGESTION</span>
          <h1>Pipeline</h1>
          <p>Bulk upload inventory spreadsheets, automatically enrich parts with eBay Motors catalog metadata, fitment applications, and generate ready-to-publish listing drafts.</p>
        </div>
        <div className={styles.topActions}>
          <Link className={styles.primaryBtn} href="/catalog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            Open Catalog
          </Link>
        </div>
      </header>

      {/* Notice & Error Banners */}
      {notice && (
        <div className={styles.notice}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4"/>
            <path d="M12 8h.01"/>
          </svg>
          <span>{notice}</span>
          <button type="button" className={styles.bannerClose} onClick={() => setNotice("")}>×</button>
        </div>
      )}
      {error && (
        <div className={styles.error}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>{error}</span>
          <button type="button" className={styles.bannerClose} onClick={() => setError("")}>×</button>
        </div>
      )}

      {/* Main Ingestion & Setup Layout */}
      <section className={styles.pipelineSetup}>
        {/* Left Column: Template Hub & Pipeline Workflow */}
        <div className={styles.setupIntro}>
          <div className={styles.cardHeader}>
            <span className={styles.cardEyebrow}>CATALOG TEMPLATES &amp; SCHEMAS</span>
            <h2>Download Excel Templates</h2>
            <p>Use pre-formatted Excel files for fast catalog creation. Ingest inventory values, images, and let AI build complete listing drafts.</p>
          </div>

          <div className={styles.templateChoiceGrid}>
            <article className={styles.templateCard}>
              <div className={styles.templateCardInfo}>
                <div className={styles.templateTitleRow}>
                  <b>Basic Inventory Template</b>
                  <span className={styles.badgeBasic}>Quick Start</span>
                </div>
                <p>Ideal for rapid stock ingestion with essential price and quantity fields.</p>
                <div className={styles.columnsPreview}>
                  <span>PartNumber</span>
                  <span>SellingPrice</span>
                  <span>Quantity</span>
                </div>
              </div>
              <button
                type="button"
                className={styles.templateDownloadBtn}
                onClick={() => void downloadTemplate("basic")}
                disabled={Boolean(downloading)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                {downloading === "basic" ? "Generating..." : "Download Basic (.xlsx)"}
              </button>
            </article>

            <article className={styles.templateCard}>
              <div className={styles.templateCardInfo}>
                <div className={styles.templateTitleRow}>
                  <b>Standard Full Catalog Template</b>
                  <span className={styles.badgeStandard}>Full Automation</span>
                </div>
                <p>Includes brand, custom descriptions, image URLs, and SKU mapping for max enrichment.</p>
                <div className={styles.columnsPreview}>
                  <span>SKU</span>
                  <span>PartNumber</span>
                  <span>Brand</span>
                  <span>Description</span>
                  <span>PicsURL</span>
                </div>
              </div>
              <button
                type="button"
                className={styles.templateDownloadBtnPrimary}
                onClick={() => void downloadTemplate("standard")}
                disabled={Boolean(downloading)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                {downloading === "standard" ? "Generating..." : "Download Standard (.xlsx)"}
              </button>
            </article>
          </div>

          <div className={styles.workflowSteps}>
            <span className={styles.workflowTitle}>AUTOMATED INGESTION FLOW</span>
            <ul className={styles.pipelineBenefits}>
              <li>
                <b>1. Bulk Ingestion</b> — Parse spreadsheet rows &amp; validate headers automatically.
              </li>
              <li>
                <b>2. AI &amp; eBay Enrichment</b> — Retrieve eBay Motors titles, item specifics, and vehicle fitment.
              </li>
              <li>
                <b>3. Ready Drafts</b> — Create editable catalog parts with ready-to-publish listing drafts.
              </li>
            </ul>
          </div>
        </div>

        {/* Right Column: Execution Form & Interactive Dropzone */}
        <form className={styles.pipelineForm} onSubmit={upload}>
          <div className={styles.formHeader}>
            <span className={styles.formEyebrow}>INGESTION CONTROL &amp; UPLOAD</span>
            <h2>Run Catalog Pipeline</h2>
            <p>Upload your catalog spreadsheet to launch real-time background processing.</p>
          </div>

          {/* Interactive Dropzone */}
          <div className={styles.sheetField}>
            <label
              className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""} ${file ? styles.dropzoneHasFile : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0] ?? null;
                  setFile(selectedFile);
                  if (selectedFile) setError("");
                }}
              />

              {file ? (
                <div className={styles.fileSelectedBox}>
                  <div className={styles.fileIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <path d="M9 15l2 2 4-4"/>
                    </svg>
                  </div>
                  <div className={styles.fileDetails}>
                    <b>{file.name}</b>
                    <span>{formatFileSize(file.size)} · Spreadsheet ready</span>
                  </div>
                  <button
                    type="button"
                    className={styles.fileRemoveBtn}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFile(null);
                    }}
                    title="Remove file"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className={styles.dropzonePrompt}>
                  <div className={styles.dropzoneIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  <strong>Choose a file or drag &amp; drop it here</strong>
                  <span>Supports Microsoft Excel (.xlsx) and CSV (.csv) spreadsheets</span>
                </div>
              )}
            </label>
          </div>

          {/* Configuration Fields */}
          <div className={styles.uploadControls}>
            <label>
              <span>Listing Team *</span>
              <select value={teamId} onChange={(event) => setTeamId(event.target.value)} required>
                <option value="" disabled>Select team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Default Condition</span>
              <select value={condition} onChange={(event) => setCondition(event.target.value)}>
                <option value="USED">Used (Pre-owned)</option>
                <option value="NEW">New (Brand New)</option>
              </select>
            </label>

            <label>
              <span>Target Marketplace</span>
              <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
                <option value="EBAY_US">eBay US (ebay.com)</option>
                <option value="EBAY_GB">eBay UK (ebay.co.uk)</option>
                <option value="EBAY_DE">eBay Germany (ebay.de)</option>
              </select>
            </label>
          </div>

          {!teams.length && (
            <div className={styles.inlineWarning}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>Create an active team in Settings → Teams before launching a pipeline job.</span>
            </div>
          )}

          <p className={styles.formHint}>
            The selected team, default condition, and marketplace apply to every row in the spreadsheet.
          </p>

          <div className={styles.formActions}>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={!file || !teamId || busy === "upload"}
            >
              {busy === "upload" ? (
                <>
                  <span className={styles.btnSpinner} />
                  Starting Ingestion…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Run Catalog Pipeline
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Pipeline History & Jobs Table */}
      <section className={styles.queuePanel}>
        <div className={styles.panelTitle}>
          <div>
            <span className={styles.eyebrow}>PIPELINE HISTORY &amp; QUEUE</span>
            <h2>Recent Catalog Jobs</h2>
          </div>
          <button className={styles.ghostBtn} type="button" onClick={() => void loadJobs()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Refresh Queue
          </button>
        </div>

        {!jobs.length ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <h3>No pipeline jobs launched yet</h3>
            <p>Upload a CSV or Excel spreadsheet using the form above to start your first bulk catalog ingestion.</p>
          </div>
        ) : (
          <div className={styles.jobList}>
            {jobs.map((job) => {
              const isCommitting = job.status === "COMMITTING";
              const isCompleted = job.status === "COMPLETED";
              const isFailed = job.status === "FAILED";

              return (
                <article className={styles.jobCard} key={job.id}>
                  <div className={styles.jobSummary}>
                    {/* Job Details */}
                    <div className={styles.jobFile}>
                      <b>{job.originalFilename}</b>
                      <span>
                        {job.marketplace.replace("EBAY_", "eBay ")} · {job.defaultCondition || "Standard"}
                        {job.listingTeam ? ` · ${job.listingTeam.name}` : ""}
                      </span>
                    </div>

                    {/* Job Progress Bar */}
                    <div className={styles.jobProgress}>
                      <div className={styles.progressTextRow}>
                        <span>{job.progress.finishedRows} of {job.totalRows} rows processed</span>
                        <strong>{job.progress.percent}%</strong>
                      </div>
                      <div className={styles.progressBarBg}>
                        <div
                          className={`${styles.progressBarFill} ${isCommitting ? styles.progressAnimated : ""}`}
                          style={{ width: `${job.progress.percent}%` }}
                        />
                      </div>
                      <small>
                        {job.processedRows} added to catalog · {job.failedRows} failed
                      </small>
                    </div>

                    {/* Status Pill */}
                    <div>
                      <span
                        className={`${styles.statusPill} ${
                          isCommitting ? styles.statusProcessing : isCompleted ? styles.statusCompleted : isFailed ? styles.statusFailed : styles.statusQueued
                        }`}
                      >
                        {isCommitting ? (
                          <>
                            <span className={styles.statusPulse} />
                            PROCESSING
                          </>
                        ) : (
                          job.status.replaceAll("_", " ")
                        )}
                      </span>
                    </div>

                    {/* Open Rows CTA */}
                    <div>
                      <button
                        type="button"
                        className={openedId === job.id ? styles.secondaryBtnActive : styles.secondaryBtn}
                        onClick={() => void openJob(job.id)}
                      >
                        {busy === `open-${job.id}` ? "Opening…" : openedId === job.id ? "Close Rows" : "View Details"}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Row Detail Table */}
                  {openedId === job.id && detail?.id === job.id && (
                    <div className={styles.rowDetail}>
                      <div className={styles.rowDetailHead}>
                        <div>
                          <b>Row-by-Row Ingestion Details</b>
                          <span>Total {detail.rows.length} rows processed in job</span>
                        </div>
                        {detail.failedRows > 0 && (
                          <button
                            type="button"
                            className={styles.retryBtn}
                            disabled={busy === `retry-${job.id}`}
                            onClick={() => void retry(job.id)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M23 4v6h-6"/>
                              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                            {busy === `retry-${job.id}` ? "Requeuing…" : `Retry ${detail.failedRows} Failed Rows`}
                          </button>
                        )}
                      </div>

                      <div className={styles.rowTable}>
                        <div className={styles.rowTableHead}>
                          <span>Row / Part Info</span>
                          <span>Generated Title &amp; Source</span>
                          <span>Fitment Vehicles</span>
                          <span>Pipeline Stage</span>
                          <span>Catalog Item</span>
                        </div>

                        {detail.rows.map((row) => {
                          const source = row.normalizedData;
                          const draft = row.committedPart?.listingDrafts[0];
                          const fitmentCount = row.committedPart?.fitmentApplications.length ?? row.enrichmentData?.fitmentCount ?? 0;
                          const isRowDone = row.pipelineStage === "COMPLETED";
                          const isRowFailed = row.pipelineStage === "FAILED";

                          return (
                            <div className={styles.rowItem} key={row.id}>
                              <div>
                                <b>#{row.rowNumber} · {source?.sku || "No SKU"}</b>
                                <span>{source?.brand || "Unbranded"} · {source?.primaryPartNumber || "—"}</span>
                              </div>

                              <div>
                                <b>{draft?.title || row.enrichmentData?.title || "Enriching part details..."}</b>
                                <span>Source: {row.enrichmentData?.identificationSource || "eBay Motors Catalog"}</span>
                              </div>

                              <div>
                                <b>{fitmentCount} vehicle{fitmentCount === 1 ? "" : "s"}</b>
                                <span>{fitmentCount > 0 ? "Fitment linked" : "No fitment"}</span>
                              </div>

                              <div>
                                <span
                                  className={`${styles.rowStage} ${
                                    isRowFailed ? styles.rowFailed : isRowDone ? styles.rowDone : styles.rowInFlight
                                  }`}
                                >
                                  {friendlyStage(row.pipelineStage)}
                                </span>
                                {row.pipelineError && (
                                  <small className={styles.rowErrorText} title={row.pipelineError}>
                                    {row.pipelineError}
                                  </small>
                                )}
                              </div>

                              <div>
                                {row.committedPart ? (
                                  <Link className={styles.openCatalogLink} href={`/catalog?highlight=${row.committedPart.id}`}>
                                    Open Item →
                                  </Link>
                                ) : (
                                  <span className={styles.mutedText}>—</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
