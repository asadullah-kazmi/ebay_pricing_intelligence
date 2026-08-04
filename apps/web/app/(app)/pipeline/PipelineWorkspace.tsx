"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import { apiBase, refreshAccessSession } from "../../lib/auth-session";
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
  { id: "imp-7842", fileName: "catalog-intake-week-12.csv", status: "UPLOADED", condition: "USED", uploadedBy: "BA", createdAt: new Date().toISOString() },
  { id: "imp-7841", fileName: "yard-photos-march.zip", status: "PROCESSING", condition: "USED", uploadedBy: "BA", createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "imp-7840", fileName: "interchange-batch.xlsx", status: "READY", condition: "NEW", uploadedBy: "OP", createdAt: new Date(Date.now() - 86400000).toISOString() },
];

export default function PipelineWorkspace() {
  const { status } = useAuth();
  const [team, setTeam] = useState("default");
  const [condition, setCondition] = useState("USED");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>(demoQueue);

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
          <h1>Pipeline</h1>
          <p>Bulk-upload spreadsheets and photo archives into the catalog intake queue.</p>
        </div>
        <div className={styles.topActions}>
          <a
            className={styles.secondary}
            href="/api/imports/template"
            onClick={(event) => {
              event.preventDefault();
              window.open(`${apiBase}/api/imports/template`, "_blank");
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download template
          </a>
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
            <span>CSV or XLSX · PartPulse intake template v1</span>
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
              <span>Use the current PartPulse catalog intake spreadsheet template.</span>
            </li>
            <li>
              <span className={styles.ruleCheck}>✓</span>
              <span>Keep one SKU per row and map photo folders to those SKUs.</span>
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
