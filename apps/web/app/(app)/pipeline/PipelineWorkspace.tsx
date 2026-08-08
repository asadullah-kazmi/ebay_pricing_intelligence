"use client";

import { FormEvent, useState } from "react";
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
};

const demoQueue: QueueItem[] = [
  { id: "imp-7842", fileName: "catalog-intake-week-12.xlsx", status: "UPLOADED", condition: "USED", uploadedBy: "BA", createdAt: new Date().toISOString() },
  { id: "imp-7841", fileName: "yard-photos-march.zip", status: "PROCESSING", condition: "USED", uploadedBy: "BA", createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "imp-7840", fileName: "interchange-batch.xlsx", status: "READY", condition: "NEW", uploadedBy: "OP", createdAt: new Date(Date.now() - 86400000).toISOString() },
];

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
  const { status } = useAuth();
  const [team, setTeam] = useState("default");
  const [condition, setCondition] = useState("USED");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>(demoQueue);

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
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let access = await refreshAccessSession();
      const send = async (accessToken: string) => {
        const body = new FormData();
        body.append("file", file);
        return fetch(`${apiBase}/api/imports/validate`, {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}` },
          body,
        });
      };
      let response = await send(access.accessToken);
      if (response.status === 401) {
        access = await refreshAccessSession({ force: true });
        response = await send(access.accessToken);
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Upload failed");
      setQueue((current) => [
        {
          id: payload.id || `imp-${Math.floor(1000 + Math.random() * 9000)}`,
          fileName: file.name,
          status: "UPLOADED",
          condition,
          uploadedBy: "YOU",
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      setNotice(`Import staged successfully${payload.id ? ` as ${payload.id}` : ""}. Continue review from the API preview workflow.`);
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to upload catalog file");
    } finally {
      setBusy(false);
    }
  }

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

      <section className={styles.stats}>
        <article>
          <span>Total Batches</span>
          <b>{queue.length}</b>
          <small>In Pipeline History</small>
        </article>
        <article>
          <span>Ready for Catalog</span>
          <b style={{ color: "#16a34a" }}>{queue.filter((q) => q.status === "READY").length}</b>
          <small>Validated &amp; Stage Ready</small>
        </article>
        <article>
          <span>Processing</span>
          <b style={{ color: "#d97706" }}>{queue.filter((q) => q.status === "PROCESSING").length}</b>
          <small>Parsing &amp; Enriching</small>
        </article>
        <article>
          <span>Uploaded Staged</span>
          <b style={{ color: "#2563eb" }}>{queue.filter((q) => q.status === "UPLOADED").length}</b>
          <small>Awaiting Processing</small>
        </article>
      </section>

      {/* Official Intake Templates Section */}
      <section className={styles.templatesPanel}>
        <div className={styles.panelTitle}>
          <div>
            <span className={styles.eyebrow}>EXCEL TEMPLATES</span>
            <h2>Download Pipeline Intake Workbooks</h2>
          </div>
        </div>
        <div className={styles.templatesGrid}>
          <div className={styles.templateCard}>
            <div className={styles.templateCardHead}>
              <span className={styles.badgeBasic}>BASIC</span>
              <h3>Quick Price &amp; Quantity Update</h3>
            </div>
            <div className={styles.columnsPreview}>
              <span>Part no</span>
              <span>Selling Price</span>
              <span>Quantity</span>
            </div>
            <button
              type="button"
              className={styles.templateDownloadBtn}
              disabled={downloading === "quick"}
              onClick={() => void handleDownloadQuickExcel()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {downloading === "quick" ? "Generating..." : "Download Quick Template (.xlsx)"}
            </button>
          </div>

          <div className={styles.templateCard}>
            <div className={styles.templateCardHead}>
              <span className={styles.badgeStandard}>STANDARD</span>
              <h3>Full Catalog Listing Intake</h3>
            </div>
            <div className={styles.columnsPreview}>
              <span>Part Number</span>
              <span>Selling Price</span>
              <span>Quantity</span>
              <span>Brand</span>
              <span>Description</span>
              <span>PicsURL</span>
              <span>SKU</span>
            </div>
            <button
              type="button"
              className={styles.templateDownloadBtnPrimary}
              disabled={downloading === "full"}
              onClick={() => void handleDownloadFullExcel()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {downloading === "full" ? "Generating..." : "Download Full Template (.xlsx)"}
            </button>
          </div>
        </div>
      </section>

      <section className={styles.uploadGrid}>
        <form className={styles.uploadCard} onSubmit={uploadSpreadsheet}>
          <div className={styles.cardHead}>
            <span className={styles.eyebrow}>BULK UPLOAD</span>
            <h2>Stage catalog intake</h2>
          </div>
          <div className={styles.uploadControls}>
            <label>
              <span>Team</span>
              <select value={team} onChange={(event) => setTeam(event.target.value)}>
                <option value="default">Operations</option>
                <option value="yard">Yard intake</option>
                <option value="pricing">Pricing desk</option>
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
            <button type="submit" className={styles.primary} disabled={!file || busy}>
              {busy ? "Uploading..." : "Upload to pipeline"}
            </button>
          </div>
        </form>

        <aside className={styles.rulesCard}>
          <span className={styles.eyebrow}>BULK UPLOAD RULES</span>
          <h2>Before you upload</h2>
          <ul className={styles.rulesList}>
            <li>
              <span className={styles.ruleCheck}>✓</span>
              <span>Switch to Tab 2 (Intake Sheet) in the downloaded Excel workbook to paste parts.</span>
            </li>
            <li>
              <span className={styles.ruleCheck}>✓</span>
              <span>Keep Row 1 headers intact in the intake sheet.</span>
            </li>
            <li>
              <span className={styles.ruleCheck}>✓</span>
              <span>Image ZIP uploads happen after spreadsheet validation.</span>
            </li>
            <li>
              <span className={styles.ruleCheck}>✓</span>
              <span>Review blockers in preview before confirming into the live catalog.</span>
            </li>
          </ul>
          <div className={styles.infoBox}>
            <span className={styles.infoIcon}>i</span>
            <span>Tip: confirm imports only after image matches and required fields are complete.</span>
          </div>
        </aside>
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
                <th>Status</th>
                <th>Uploaded by</th>
                <th>Date</th>
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
                    <span className={`${styles.status} ${styles[item.status.toLowerCase()]}`}>{item.status}</span>
                  </td>
                  <td>
                    <span className={styles.avatar}>{item.uploadedBy}</span>
                  </td>
                  <td className={styles.dateCell}>{new Date(item.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
