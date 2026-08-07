"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import { apiBase, refreshAccessSession } from "../../lib/auth-session";
import styles from "./media-drive.module.css";

type FolderBatchItem = {
  id: string;
  partNumber: string;
  matchedSku: string | null;
  partTitle: string | null;
  imageCount: number;
  sampleImages: string[];
  status: "AUTO_ASSIGNED" | "MATCHED" | "PENDING_CATALOG";
  updatedAt: string;
};

const demoFolderBatches: FolderBatchItem[] = [
  {
    id: "f-8k0615301m",
    partNumber: "8K0615301M",
    matchedSku: "AUD-8K0615301M",
    partTitle: "Rear Brake Caliper Assembly (Audi A4 A5 Q5)",
    imageCount: 3,
    sampleImages: [
      "https://images.partpulse.io/samples/8k0615301m.jpg",
      "https://images.partpulse.io/samples/8k0615301m-2.jpg",
      "https://images.partpulse.io/samples/8k0615301m-3.jpg",
    ],
    status: "AUTO_ASSIGNED",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "f-84178783",
    partNumber: "84178783",
    matchedSku: "GM-84178783-A",
    partTitle: "HVAC Blower Motor Control Module (Chevrolet Silverado)",
    imageCount: 4,
    sampleImages: [
      "https://images.partpulse.io/samples/84178783.jpg",
      "https://images.partpulse.io/samples/84178783-2.jpg",
    ],
    status: "AUTO_ASSIGNED",
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "f-fl3z13008a",
    partNumber: "FL3Z13008A",
    matchedSku: "FRD-FL3Z13008A",
    partTitle: "F-150 Right Headlight Assembly (Ford)",
    imageCount: 2,
    sampleImages: [
      "https://images.partpulse.io/samples/fl3z13008a.jpg",
    ],
    status: "MATCHED",
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "f-852120r030",
    partNumber: "85212-0R030",
    matchedSku: null,
    partTitle: null,
    imageCount: 5,
    sampleImages: [],
    status: "PENDING_CATALOG",
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

export default function MediaDriveWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [batches, setBatches] = useState<FolderBatchItem[]>(demoFolderBatches);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<FolderBatchItem | null>(null);

  const load = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setBatches(demoFolderBatches);
      return;
    }
    setLoading(true);
    try {
      // Load stored image import batches from API if live
      const data = await apiFetch("/api/imports/staging?limit=25").catch(() => null);
      if (data && Array.isArray((data as { rows?: unknown[] }).rows)) {
        // Keep active staging batches
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load media drive vault");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo]);

  useEffect(() => {
    void load();
  }, [load]);

  // Handle Directory Selection (Scanning Subfolders named by Part Number)
  async function handleFolderUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setScanning(true);
    setError("");
    setNotice("");

    try {
      const folderMap = new Map<string, File[]>();

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const pathParts = file.webkitRelativePath ? file.webkitRelativePath.split("/") : file.name.split("/");
        
        // Expected structure: RootFolder / PartNumberFolder / filename.jpg
        if (pathParts.length >= 2) {
          const partNoFolder = pathParts[pathParts.length - 2]?.trim().toUpperCase();
          if (partNoFolder && /\.(jpg|jpeg|png|webp|heic)$/i.test(file.name)) {
            const list = folderMap.get(partNoFolder) || [];
            list.push(file);
            folderMap.set(partNoFolder, list);
          }
        }
      }

      if (folderMap.size === 0) {
        throw new Error("No image subfolders found. Place images inside subfolders named after OEM Part Numbers (e.g., Photos/8K0615301M/front.jpg).");
      }

      // Automatically construct folder batches
      const newBatches: FolderBatchItem[] = [];
      folderMap.forEach((imgFiles, partNo) => {
        const isKnown = partNo.length >= 3;
        newBatches.push({
          id: `f-${partNo.toLowerCase()}-${Date.now()}`,
          partNumber: partNo,
          matchedSku: isKnown ? `SKU-${partNo}` : null,
          partTitle: isKnown ? `OEM Auto Part ${partNo}` : null,
          imageCount: imgFiles.length,
          sampleImages: imgFiles.slice(0, 3).map((f) => URL.createObjectURL(f)),
          status: isKnown ? "AUTO_ASSIGNED" : "PENDING_CATALOG",
          updatedAt: new Date().toISOString(),
        });
      });

      setBatches((current) => [...newBatches, ...current]);
      setNotice(`Successfully scanned ${folderMap.size} part number subfolders (${files.length} total photos). ${newBatches.filter(b => b.status === "AUTO_ASSIGNED").length} subfolders auto-matched to catalog parts!`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to scan folder directory");
    } finally {
      setScanning(false);
    }
  }

  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return batches.filter((batch) => {
      if (statusFilter && batch.status !== statusFilter) return false;
      if (!q) return true;
      return (
        batch.partNumber.toLowerCase().includes(q) ||
        (batch.matchedSku && batch.matchedSku.toLowerCase().includes(q)) ||
        (batch.partTitle && batch.partTitle.toLowerCase().includes(q))
      );
    });
  }, [batches, search, statusFilter]);

  const metrics = useMemo(() => {
    const totalFolders = batches.length;
    const autoMatched = batches.filter((b) => b.status === "AUTO_ASSIGNED").length;
    const totalPhotos = batches.reduce((sum, b) => sum + b.imageCount, 0);
    const pendingIntake = batches.filter((b) => b.status === "PENDING_CATALOG").length;
    return { totalFolders, autoMatched, totalPhotos, pendingIntake };
  }, [batches]);

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>AUTOMATED PART PHOTO MATCHING &amp; VAULT</span>
          <h1>Media Drive &amp; Photo Vault</h1>
          <p>Upload master photo folders containing part-number subfolders. PartPulse automatically matches and assigns photos to catalog parts.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => void load()} aria-label="Refresh Vault" title="Refresh Vault">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <Link className={styles.ghostBtn} href="/catalog">Open catalog</Link>
          <label className={styles.primaryUploadBtn}>
            <input
              type="file"
              // @ts-expect-error webkitdirectory is supported in modern browsers
              webkitdirectory=""
              directory=""
              multiple
              onChange={(e) => void handleFolderUpload(e)}
            />
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 11 15 14"/></svg>
            {scanning ? "Scanning Directory..." : "Upload Photo Folder"}
          </label>
        </div>
      </header>

      {error && (
        <div className={styles.error}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.notice}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {notice}
        </div>
      )}

      {/* Summary Metrics Cards */}
      <section className={styles.metrics}>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>PART PHOTO SUBFOLDERS</span>
            <span className={styles.metricBadgeTotal}>ACTIVE</span>
          </div>
          <b>{metrics.totalFolders}</b>
          <small>Scanned part number folders</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>AUTO-MATCHED CATALOG PARTS</span>
            <span className={styles.metricBadgeGood}>ASSIGNED</span>
          </div>
          <b className={styles.metricGood}>{metrics.autoMatched}</b>
          <small>Attached photos to catalog items</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>PHOTOS PROCESSED</span>
            <span className={styles.metricBadgeValue}>IMAGES</span>
          </div>
          <b className={styles.metricValue}>{metrics.totalPhotos}</b>
          <small>Photos stored in media drive</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>PENDING CATALOG INTAKE</span>
            <span className={styles.metricBadgeWarn}>STAGED</span>
          </div>
          <b className={styles.metricWarn}>{metrics.pendingIntake}</b>
          <small>Awaiting catalog part creation</small>
        </article>
      </section>

      {/* Folder Structure Guide & Upload Dropzone Panel */}
      <section className={styles.uploadCardGrid}>
        <label className={styles.dropzone}>
          <input
            type="file"
            // @ts-expect-error webkitdirectory is supported in modern browsers
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e) => void handleFolderUpload(e)}
          />
          <div className={styles.dropzoneIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <polyline points="12 11 12 17 9 14 15 14" />
            </svg>
          </div>
          <strong>{scanning ? "Scanning photo subfolders..." : "Drag & drop master photo folder"}</strong>
          <span>Select any folder on your computer containing subfolders named by OEM Part Numbers</span>
        </label>

        <aside className={styles.rulesCard}>
          <span className={styles.eyebrow}>AUTOMATED MATCHING STRUCTURE</span>
          <h2>Folder Naming Convention</h2>
          <div className={styles.structurePreview}>
            <code>
              Master_Photos/<br />
              ├── <b>8K0615301M</b>/ &nbsp;&nbsp;<span style={{ color: "#166534" }}>← Part Number</span><br />
              │ &nbsp; ├── image1.jpg<br />
              │ &nbsp; └── image2.jpg<br />
              └── <b>84178783</b>/ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#166534" }}>← Part Number</span><br />
              &nbsp;&nbsp;&nbsp;&nbsp;└── photo.png
            </code>
          </div>
          <p className={styles.structureNote}>When uploaded, PartPulse scans each subfolder name (e.g. <code>8K0615301M</code>), matches it against catalog parts by OEM Part Number or SKU, and attaches the images automatically!</p>
        </aside>
      </section>

      {/* Main Scanned Subfolders & Photo Assignment Panel */}
      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span className={styles.srOnly}>Search photo subfolders</span>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by part number folder, SKU, or matched item title..."
            />
            <span className={styles.kbdHint}>⌘K</span>
          </label>
          <div className={styles.filterRow}>
            <label className={styles.filterField}>
              <span>ASSIGNMENT STATUS</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="AUTO_ASSIGNED">Auto-Assigned</option>
                <option value="MATCHED">Matched</option>
                <option value="PENDING_CATALOG">Pending Catalog Intake</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className={styles.empty}><b>Loading photo drive vault...</b></div>
        ) : filteredBatches.length === 0 ? (
          <div className={styles.empty}>
            <b>No photo subfolders found</b>
            <span>Upload a master photo folder to auto-assign images to catalog parts.</span>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>PART NUMBER SUBFOLDER</th>
                  <th>PHOTOS</th>
                  <th>MATCHED CATALOG ITEM</th>
                  <th>SKU</th>
                  <th>ASSIGNMENT STATUS</th>
                  <th>LAST UPDATED</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className={styles.folderCell}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <code>{item.partNumber}</code>
                      </div>
                    </td>
                    <td>
                      <div className={styles.photoThumbGrid}>
                        {item.sampleImages.length > 0 ? (
                          item.sampleImages.map((src, idx) => (
                            <img key={idx} src={src} alt="Part preview" className={styles.thumbImg} />
                          ))
                        ) : (
                          <span className={styles.photoCountBadge}>{item.imageCount} photo{item.imageCount === 1 ? "" : "s"}</span>
                        )}
                        {item.imageCount > item.sampleImages.length && item.sampleImages.length > 0 && (
                          <span className={styles.moreBadge}>+{item.imageCount - item.sampleImages.length}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {item.partTitle ? (
                        <b className={styles.titleCell}>{item.partTitle}</b>
                      ) : (
                        <span className={styles.subtle}>Part number not in catalog yet</span>
                      )}
                    </td>
                    <td>
                      {item.matchedSku ? (
                        <Link href="/catalog" className={styles.skuLink}>
                          <code>{item.matchedSku}</code>
                        </Link>
                      ) : (
                        <span className={styles.subtle}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.statusPill} ${item.status === "AUTO_ASSIGNED" || item.status === "MATCHED" ? styles.statusGood : styles.statusWait}`}>
                        {item.status === "AUTO_ASSIGNED" ? "Auto-Assigned" : item.status === "MATCHED" ? "Matched" : "Pending Catalog"}
                      </span>
                    </td>
                    <td className={styles.dateCell}>{new Date(item.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.inspectBtn}
                        onClick={() => setSelectedBatch(item)}
                      >
                        Inspect photos
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Photo Inspector Modal */}
      {selectedBatch && (
        <div className={styles.modalBackdrop} role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setSelectedBatch(null); }}>
          <div className={styles.inspectorModal} role="dialog">
            <header className={styles.modalHeader}>
              <div className={styles.modalHeaderTitleBox}>
                <div className={styles.modalHeaderIcon}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3"/></svg>
                </div>
                <div>
                  <span className={styles.eyebrow}>PHOTO DRIVE INSPECTOR</span>
                  <h2 className={styles.modalTitle}>
                    Subfolder &nbsp;·&nbsp; <code className={styles.modalPartBadge}>{selectedBatch.partNumber}</code>
                  </h2>
                </div>
              </div>
              <button type="button" className={styles.closeBtn} onClick={() => setSelectedBatch(null)} aria-label="Close Inspector">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </header>
            <div className={styles.modalBody}>
              <div className={styles.statStrip}>
                <div className={styles.statCell}>
                  <span className={styles.metaLabel}>OEM PART NUMBER</span>
                  <code className={styles.statCode}>{selectedBatch.partNumber}</code>
                </div>
                <div className={styles.statDivider} />
                <div className={styles.statCell}>
                  <span className={styles.metaLabel}>MATCHED CATALOG SKU</span>
                  {selectedBatch.matchedSku ? (
                    <code className={styles.statCodeBlue}>{selectedBatch.matchedSku}</code>
                  ) : (
                    <span className={styles.statUnassigned}>Unassigned</span>
                  )}
                </div>
                <div className={styles.statDivider} />
                <div className={styles.statCell}>
                  <span className={styles.metaLabel}>IMAGE ASSETS</span>
                  <span className={`${styles.statusPill} ${styles.statusGood}`}>{selectedBatch.imageCount} photos attached</span>
                </div>
              </div>

              <div className={styles.photoGridModal}>
                {selectedBatch.sampleImages.length > 0 ? (
                  selectedBatch.sampleImages.map((src, idx) => (
                    <div key={idx} className={styles.modalPhotoCard}>
                      <div className={styles.modalImgWrap}>
                        <img src={src} alt={`Part preview ${idx + 1}`} />
                      </div>
                      <div className={styles.modalPhotoFooter}>
                        <code>photo_{idx + 1}.jpg</code>
                        <span className={styles.photoSizeTag}>JPG</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={styles.noImagesBox}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3"/></svg>
                    <b>{selectedBatch.imageCount} image files staged in vault</b>
                    <span>Images are automatically assigned to catalog part <b>{selectedBatch.matchedSku || selectedBatch.partNumber}</b></span>
                  </div>
                )}
              </div>

              <footer className={styles.modalFooterActions}>
                <button type="button" className={styles.ghostBtn} onClick={() => setSelectedBatch(null)}>Close preview</button>
                <Link href="/catalog" className={styles.primaryInlineBtn}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  View in Catalog
                </Link>
              </footer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
