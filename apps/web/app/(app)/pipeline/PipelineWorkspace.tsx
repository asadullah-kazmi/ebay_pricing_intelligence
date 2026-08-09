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
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function friendlyStage(stage: string) {
  return ({ QUEUED: "Queued", IDENTIFYING: "Identifying part", FITMENT: "Finding fitment", BUILDING_LISTING: "Building listing", CATALOG: "Adding to catalog", COMPLETED: "Completed", FAILED: "Needs attention" } as Record<string, string>)[stage] ?? stage;
}

export default function PipelineWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [condition, setCondition] = useState("USED");
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [file, setFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openedId, setOpenedId] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [busy, setBusy] = useState("");
  const [downloading, setDownloading] = useState<"basic" | "standard" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadJobs = useCallback(async () => {
    if (authStatus !== "ready" || demo) return;
    const result = await apiFetch("/api/imports?limit=30") as { jobs: Job[] };
    setJobs(result.jobs);
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
      setTeams(sampleTeams); setTeamId(sampleTeams[0].id); return;
    }
    void Promise.all([
      apiFetch("/api/listing-teams") as Promise<{ teams: Team[] }>,
      apiFetch("/api/imports?limit=30") as Promise<{ jobs: Job[] }>,
    ]).then(([teamResult, jobResult]) => {
      setTeams(teamResult.teams); setTeamId((current) => current || teamResult.teams[0]?.id || ""); setJobs(jobResult.jobs);
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
    setDownloading(kind); setError("");
    try {
      const blob = kind === "basic" ? await generateQuickUpdateExcel() : await generateFullCatalogExcel();
      triggerBlobDownload(blob, kind === "basic" ? "PartPulse_Basic_Pipeline_Template.xlsx" : "PartPulse_Standard_Pipeline_Template.xlsx");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to generate template"); }
    finally { setDownloading(""); }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !teamId || busy) return;
    setBusy("upload"); setError(""); setNotice("");
    try {
      let access = await refreshAccessSession();
      const filename = file.name.replace(/[^A-Za-z0-9._ -]/g, "_");
      const send = (token: string) => fetch(`${apiBase}/api/imports/validate`, {
        method: "POST", credentials: "include",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream", "X-File-Name": filename },
        body: file,
      });
      let response = await send(access.accessToken);
      if (response.status === 401) { access = await refreshAccessSession({ force: true }); response = await send(access.accessToken); }
      const staged = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(staged.error || "Unable to validate spreadsheet");
      if (staged.invalidRows) throw new Error(`${staged.invalidRows} invalid row(s) found. Correct the spreadsheet and upload it again.`);
      await apiFetch(`/api/imports/${staged.id}/start`, { method: "POST", body: JSON.stringify({ listingTeamId: teamId, condition, marketplace }) });
      setFile(null); setOpenedId(staged.id); setNotice(`${filename} is processing. Items will appear in Catalog as each row completes.`);
      await loadJobs(); await loadDetail(staged.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start pipeline"); }
    finally { setBusy(""); }
  }

  async function openJob(id: string) {
    if (openedId === id) { setOpenedId(""); setDetail(null); return; }
    setOpenedId(id); setBusy(`open-${id}`); setError("");
    try { await loadDetail(id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to open pipeline job"); }
    finally { setBusy(""); }
  }

  async function retry(id: string) {
    setBusy(`retry-${id}`); setError("");
    try { await apiFetch(`/api/imports/${id}/retry`, { method: "POST" }); setNotice("Failed rows were requeued."); await loadJobs(); await loadDetail(id); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to retry failed rows"); }
    finally { setBusy(""); }
  }

  if (authStatus !== "ready") return null;
  return <div className={styles.page}>
    <header className={styles.topbar}><div><span className={styles.eyebrow}>CATALOG AUTOMATION</span><h1>Pipeline</h1><p>Upload inventory, enrich every part through eBay, and create catalog listing drafts automatically.</p></div><Link className={styles.primary} href="/catalog">Open catalog</Link></header>
    {notice && <div className={styles.notice}>{notice}</div>}{error && <div className={styles.error}>{error}</div>}

    <section className={styles.pipelineSetup}>
      <div className={styles.setupIntro}>
        <span className={styles.eyebrow}>CATALOG PIPELINE</span>
        <h2>Build a full catalog in one pass.</h2>
        <ul className={styles.pipelineBenefits}><li>Upload parts and inventory values</li><li>Automatic eBay title, specifics, and fitment</li><li>Create editable catalog drafts row by row</li></ul>
        <div className={styles.templateChoiceGrid}>
          <article><div><b>Basic template</b><span>Part Number · Selling Price · Quantity</span></div><button type="button" onClick={() => void downloadTemplate("basic")} disabled={Boolean(downloading)}>{downloading === "basic" ? "Generating..." : "Download"}</button></article>
          <article><div><b>Standard template</b><span>Basic fields + Brand · Description · PicsURL · SKU</span></div><button type="button" onClick={() => void downloadTemplate("standard")} disabled={Boolean(downloading)}>{downloading === "standard" ? "Generating..." : "Download"}</button></article>
        </div>
      </div>
      <form className={styles.pipelineForm} onSubmit={upload}>
        <label className={styles.sheetField}><span>CATALOG SHEET (.CSV / .XLSX)</span><span className={styles.filePicker}><input type="file" accept=".csv,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><b>{file?.name || "Choose a file"}</b><small>Browse</small></span></label>
        <div className={styles.uploadControls}>
          <label><span>Listing team</span><select value={teamId} onChange={(event) => setTeamId(event.target.value)} required><option value="" disabled>Select team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label><span>Default condition</span><select value={condition} onChange={(event) => setCondition(event.target.value)}><option value="USED">Used</option><option value="NEW">New</option></select></label>
          <label><span>Marketplace</span><select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}><option value="EBAY_US">eBay US</option><option value="EBAY_GB">eBay UK</option><option value="EBAY_DE">eBay Germany</option></select></label>
        </div>
        {!teams.length && <div className={styles.inlineWarning}>Create an active team in Settings → Teams before starting a pipeline job.</div>}
        <p className={styles.formHint}>The selected team and condition apply to every row. Both Basic and Standard templates are accepted.</p>
        <div className={styles.formActions}><button className={styles.primary} disabled={!file || !teamId || busy === "upload"}>{busy === "upload" ? "Starting pipeline…" : "Run catalog pipeline"}</button></div>
      </form>
    </section>

    <section className={styles.queuePanel}>
      <div className={styles.panelTitle}><div><span className={styles.eyebrow}>PIPELINE HISTORY</span><h2>Recent catalog jobs</h2></div><button className={styles.ghostBtn} type="button" onClick={() => void loadJobs()}>Refresh</button></div>
      {!jobs.length ? <div className={styles.emptyState}>No pipeline jobs yet.</div> : <div className={styles.jobList}>{jobs.map((job) => <article className={styles.jobCard} key={job.id}>
        <div className={styles.jobSummary}>
          <div className={styles.jobFile}><b>{job.originalFilename}</b><span>{job.marketplace.replace("EBAY_", "eBay ")} · {job.defaultCondition || "Not started"}{job.listingTeam ? ` · ${job.listingTeam.name}` : ""}</span></div>
          <div className={styles.jobProgress}><div><span>{job.progress.finishedRows}/{job.totalRows} processed</span><strong>{job.progress.percent}%</strong></div><i><b style={{ width: `${job.progress.percent}%` }} /></i><small>{job.processedRows} added · {job.failedRows} failed</small></div>
          <span className={`${styles.status} ${styles[job.status.toLowerCase()] || ""}`}>{job.status === "COMMITTING" ? "PROCESSING" : job.status.replaceAll("_", " ")}</span>
          <button type="button" className={styles.secondary} onClick={() => void openJob(job.id)}>{busy === `open-${job.id}` ? "Opening…" : openedId === job.id ? "Close" : "View rows"}</button>
        </div>
        {openedId === job.id && detail?.id === job.id && <div className={styles.rowDetail}>
          <div className={styles.rowDetailHead}><b>Row processing</b>{detail.failedRows > 0 && <button type="button" className={styles.secondary} disabled={busy === `retry-${job.id}`} onClick={() => void retry(job.id)}>{busy === `retry-${job.id}` ? "Requeuing…" : `Retry ${detail.failedRows} failed`}</button>}</div>
          <div className={styles.rowTable}><div className={styles.rowTableHead}><span>Row / item</span><span>Generated listing</span><span>Fitment</span><span>Stage</span><span>Result</span></div>{detail.rows.map((row) => {
            const source = row.normalizedData; const draft = row.committedPart?.listingDrafts[0];
            return <div className={styles.rowItem} key={row.id}><div><b>#{row.rowNumber} · {source?.sku || "No SKU"}</b><span>{source?.brand || "Unbranded"} · {source?.primaryPartNumber || "—"}</span></div><div><b>{draft?.title || row.enrichmentData?.title || "Waiting for title"}</b><span>{row.enrichmentData?.identificationSource || "—"}</span></div><div><b>{row.committedPart?.fitmentApplications.length ?? row.enrichmentData?.fitmentCount ?? 0}</b><span>vehicles</span></div><div><span className={`${styles.rowStage} ${row.pipelineStage === "FAILED" ? styles.rowFailed : row.pipelineStage === "COMPLETED" ? styles.rowDone : ""}`}>{friendlyStage(row.pipelineStage)}</span>{row.pipelineError && <small title={row.pipelineError}>{row.pipelineError}</small>}</div><div>{row.committedPart ? <Link href={`/catalog?highlight=${row.committedPart.id}`}>Open item</Link> : <span>—</span>}</div></div>;
          })}</div>
        </div>}
      </article>)}</div>}
    </section>
  </div>;
}
