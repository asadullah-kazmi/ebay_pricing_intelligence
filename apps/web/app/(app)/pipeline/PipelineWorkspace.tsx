"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import { apiBase } from "../../lib/auth-session";
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
  { id: "1", fileName: "catalog-intake-week-12.csv", status: "UPLOADED", condition: "USED", uploadedBy: "BA", createdAt: new Date().toISOString() },
  { id: "2", fileName: "yard-photos-march.zip", status: "PROCESSING", condition: "USED", uploadedBy: "BA", createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "3", fileName: "interchange-batch.xlsx", status: "READY", condition: "NEW", uploadedBy: "OP", createdAt: new Date(Date.now() - 86400000).toISOString() },
];

export default function PipelineWorkspace() {
  const { status, token } = useAuth();
  const [team, setTeam] = useState("default");
  const [condition, setCondition] = useState("USED");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>(demoQueue);

  async function uploadSpreadsheet(event: FormEvent) {
    event.preventDefault();
    if (!file || !token || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`${apiBase}/api/imports/validate`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Upload failed");
      setQueue((current) => [
        {
          id: payload.id || crypto.randomUUID(),
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
    <>
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
            Download template
          </a>
          <Link className={styles.primary} href="/catalog">
            Open catalog
          </Link>
        </div>
      </header>

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.uploadGrid}>
        <form className={styles.uploadCard} onSubmit={uploadSpreadsheet}>
          <div className={styles.cardHead}>
            <div>
              <span className={styles.eyebrow}>BULK UPLOAD</span>
              <h2>Stage catalog intake</h2>
            </div>
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
          <ul>
            <li>Use the current PartPulse catalog intake spreadsheet template.</li>
            <li>Keep one SKU per row and map photo folders to those SKUs.</li>
            <li>Image ZIP uploads happen after spreadsheet validation.</li>
            <li>Review blockers in preview before confirming into the live catalog.</li>
          </ul>
          <div className={styles.infoBox}>
            Tip: confirm imports only after image matches and required fields are complete.
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
                    <b>{item.fileName}</b>
                    <span>{item.id}</span>
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
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
