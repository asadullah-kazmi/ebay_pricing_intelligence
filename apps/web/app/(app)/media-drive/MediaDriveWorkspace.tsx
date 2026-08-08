"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { zipSync } from "fflate";
import { useAuth } from "../../components/AuthProvider";
import { apiRequest } from "../../lib/auth-session";
import styles from "./media-drive.module.css";

type MediaDriveStatus = "AUTO_ASSIGNED" | "MATCHED" | "PENDING_CATALOG";

type MediaDriveSampleImage = {
  mediaAssetId: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  sourcePath: string;
  createdAt: string;
  url?: string;
};

type MatchedPart = {
  id: string;
  sku: string;
  primaryPartNumber: string;
  partName: string | null;
};

type FolderBatchItem = {
  partNumber: string;
  folderPath: string | null;
  imageCount: number;
  sampleImages: MediaDriveSampleImage[];
  matchedPart: MatchedPart | null;
  linkedCount: number;
  status: MediaDriveStatus;
  createdAt: string;
  updatedAt: string;
};

type MediaDriveSummary = {
  totalFolders: number;
  matchedFolders: number;
  pendingFolders: number;
  totalPhotos: number;
  linkedPhotos: number;
};

type FolderListResponse = {
  folders: FolderBatchItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: MediaDriveSummary;
};

type FolderDetailResponse = {
  partNumber: string;
  folderPath: string | null;
  imageCount: number;
  matchedPart: MatchedPart | null;
  images: MediaDriveSampleImage[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type IngestResponse = {
  folders: FolderBatchItem[];
  summary: MediaDriveSummary;
  issues: Array<{ code: string; severity: string; message: string; sourcePath?: string }>;
};

type UploadProgress = {
  phase: "reading" | "packing" | "uploading";
  percent: number;
  filesRead: number;
  totalFiles: number;
};

const emptySummary: MediaDriveSummary = { totalFolders: 0, matchedFolders: 0, pendingFolders: 0, totalPhotos: 0, linkedPhotos: 0 };

const demoBatches: FolderBatchItem[] = [
  {
    partNumber: "8K0615301M",
    folderPath: "Photos/8K0615301M",
    matchedPart: { id: "demo-part-1", sku: "AUD-8K0615301M", primaryPartNumber: "8K0615301M", partName: "Rear Brake Caliper Assembly (Audi A4 A5 Q5)" },
    imageCount: 3,
    linkedCount: 3,
    sampleImages: [
      { mediaAssetId: "demo-1", originalFilename: "front.jpg", mimeType: "image/jpeg", byteSize: 0, checksum: "demo", sourcePath: "front.jpg", createdAt: new Date().toISOString(), url: "https://images.partpulse.io/samples/8k0615301m.jpg" },
      { mediaAssetId: "demo-2", originalFilename: "side.jpg", mimeType: "image/jpeg", byteSize: 0, checksum: "demo", sourcePath: "side.jpg", createdAt: new Date().toISOString(), url: "https://images.partpulse.io/samples/8k0615301m-2.jpg" },
      { mediaAssetId: "demo-3", originalFilename: "rear.jpg", mimeType: "image/jpeg", byteSize: 0, checksum: "demo", sourcePath: "rear.jpg", createdAt: new Date().toISOString(), url: "https://images.partpulse.io/samples/8k0615301m-3.jpg" },
    ],
    status: "AUTO_ASSIGNED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    partNumber: "84178783",
    folderPath: "Photos/84178783",
    matchedPart: { id: "demo-part-2", sku: "GM-84178783-A", primaryPartNumber: "84178783", partName: "HVAC Blower Motor Control Module (Chevrolet Silverado)" },
    imageCount: 4,
    linkedCount: 2,
    sampleImages: [
      { mediaAssetId: "demo-4", originalFilename: "module.jpg", mimeType: "image/jpeg", byteSize: 0, checksum: "demo", sourcePath: "module.jpg", createdAt: new Date().toISOString(), url: "https://images.partpulse.io/samples/84178783.jpg" },
      { mediaAssetId: "demo-5", originalFilename: "connector.jpg", mimeType: "image/jpeg", byteSize: 0, checksum: "demo", sourcePath: "connector.jpg", createdAt: new Date().toISOString(), url: "https://images.partpulse.io/samples/84178783-2.jpg" },
    ],
    status: "AUTO_ASSIGNED",
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    partNumber: "FL3Z13008A",
    folderPath: "Photos/FL3Z13008A",
    matchedPart: { id: "demo-part-3", sku: "FRD-FL3Z13008A", primaryPartNumber: "FL3Z13008A", partName: "F-150 Right Headlight Assembly (Ford)" },
    imageCount: 2,
    linkedCount: 2,
    sampleImages: [
      { mediaAssetId: "demo-6", originalFilename: "headlight.jpg", mimeType: "image/jpeg", byteSize: 0, checksum: "demo", sourcePath: "headlight.jpg", createdAt: new Date().toISOString(), url: "https://images.partpulse.io/samples/fl3z13008a.jpg" },
    ],
    status: "MATCHED",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    partNumber: "852120R030",
    folderPath: "Photos/852120R030",
    matchedPart: null,
    imageCount: 5,
    linkedCount: 0,
    sampleImages: [],
    status: "PENDING_CATALOG",
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

const mediaUrlCache = new Map<string, string>();
const mediaUrlWaiters = new Map<string, Array<(url: string | null) => void>>();
let mediaUrlFlushTimer: ReturnType<typeof setTimeout> | null = null;
const mediaUrlPending = new Set<string>();

function flushMediaUrlBatch() {
  mediaUrlFlushTimer = null;
  const ids = [...mediaUrlPending];
  mediaUrlPending.clear();
  if (!ids.length) return;
  void apiRequest("/api/media/download-urls", {
    method: "POST",
    body: JSON.stringify({ ids }),
  })
    .then((data) => {
      const urls = (data as { urls?: Array<{ id: string; downloadUrl: string }> }).urls ?? [];
      const found = new Set<string>();
      for (const item of urls) {
        found.add(item.id);
        mediaUrlCache.set(item.id, item.downloadUrl);
        const waiters = mediaUrlWaiters.get(item.id) ?? [];
        mediaUrlWaiters.delete(item.id);
        for (const resolve of waiters) resolve(item.downloadUrl);
      }
      for (const id of ids) {
        if (found.has(id)) continue;
        const waiters = mediaUrlWaiters.get(id) ?? [];
        mediaUrlWaiters.delete(id);
        for (const resolve of waiters) resolve(null);
      }
    })
    .catch(() => {
      for (const id of ids) {
        const waiters = mediaUrlWaiters.get(id) ?? [];
        mediaUrlWaiters.delete(id);
        for (const resolve of waiters) resolve(null);
      }
    });
}

function requestMediaDownloadUrl(mediaId: string): Promise<string | null> {
  const cached = mediaUrlCache.get(mediaId);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const waiters = mediaUrlWaiters.get(mediaId) ?? [];
    waiters.push(resolve);
    mediaUrlWaiters.set(mediaId, waiters);
    mediaUrlPending.add(mediaId);
    if (!mediaUrlFlushTimer) mediaUrlFlushTimer = setTimeout(flushMediaUrlBatch, 24);
  });
}

async function resolveImageUrls(images: MediaDriveSampleImage[]): Promise<MediaDriveSampleImage[]> {
  const resolved = await Promise.all(
    images.map(async (image) => {
      if (image.url || image.mediaAssetId.startsWith("demo-")) return image;
      const url = await requestMediaDownloadUrl(image.mediaAssetId);
      return url ? { ...image, url } : image;
    }),
  );
  return resolved;
}

function statusLabel(status: MediaDriveStatus) {
  if (status === "AUTO_ASSIGNED") return "Auto-Assigned";
  if (status === "MATCHED") return "Matched";
  return "Pending Catalog";
}

function humanBytes(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function imageExt(mimeType: string) {
  if (mimeType.includes("png")) return "PNG";
  if (mimeType.includes("webp")) return "WEBP";
  if (mimeType.includes("jpeg")) return "JPG";
  return (mimeType.split("/").pop() ?? "IMG").toUpperCase();
}

function Thumb({ image, className }: { image: MediaDriveSampleImage; className?: string }) {
  if (image.url) return <img src={image.url} alt={image.originalFilename} className={className} />;
  return (
    <span className={styles.thumbPlaceholder}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </span>
  );
}

export default function MediaDriveWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [batches, setBatches] = useState<FolderBatchItem[]>([]);
  const [summary, setSummary] = useState<MediaDriveSummary>(emptySummary);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<FolderBatchItem | null>(null);
  const [inspectorImages, setInspectorImages] = useState<MediaDriveSampleImage[]>([]);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorPart, setInspectorPart] = useState<MatchedPart | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<Array<{ id: string; sku: string; primaryPartNumber: string; partName: string | null }>>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const pageRef = useRef(1);

  const load = useCallback(async (mode: "replace" | "append" = "replace") => {
    if (authStatus !== "ready") return;
    if (demo) {
      setBatches(demoBatches);
      setSummary({
        totalFolders: 4,
        matchedFolders: 3,
        pendingFolders: 1,
        totalPhotos: 14,
        linkedPhotos: 7,
      });
      setPagination({ page: 1, totalPages: 1, total: 4 });
      return;
    }
    setLoading(true);
    try {
      const page = mode === "append" ? pageRef.current + 1 : 1;
      const params = new URLSearchParams({ page: String(page), pageSize: "100" });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      const data = (await apiFetch(`/api/media-drive/folders?${params.toString()}`)) as FolderListResponse;
      const withUrls = await resolveImageUrls(data.folders.flatMap((folder) => folder.sampleImages));
      const urlById = new Map(withUrls.map((image) => [image.mediaAssetId, image.url]));
      const hydrated: FolderBatchItem[] = data.folders.map((folder) => ({
        ...folder,
        sampleImages: folder.sampleImages.map((image) => ({ ...image, url: urlById.get(image.mediaAssetId) })),
      }));
      pageRef.current = page;
      setBatches((current) => (mode === "append" ? [...current, ...hydrated] : hydrated));
      setSummary(data.summary ?? emptySummary);
      setPagination(data.pagination);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the media drive vault");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, authStatus, demo, search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshInspector(partNumber: string) {
    if (demo) return;
    setInspectorLoading(true);
    try {
      const data = (await apiFetch(`/api/media-drive/folders/${encodeURIComponent(partNumber)}?page=1&pageSize=100`)) as FolderDetailResponse;
      const resolved = await resolveImageUrls(data.images);
      setInspectorImages(resolved);
      setInspectorPart(data.matchedPart);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load folder photos");
    } finally {
      setInspectorLoading(false);
    }
  }

  function openInspector(batch: FolderBatchItem) {
    setSelectedBatch(batch);
    setInspectorImages(batch.sampleImages);
    setInspectorPart(batch.matchedPart);
    if (!demo) void refreshInspector(batch.partNumber);
  }

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
          if (partNoFolder && /\.(jpg|jpeg|png|webp)$/i.test(file.name)) {
            const list = folderMap.get(partNoFolder) || [];
            list.push(file);
            folderMap.set(partNoFolder, list);
          }
        }
      }

      if (folderMap.size === 0) {
        throw new Error("No image subfolders found. Place images inside subfolders named after OEM Part Numbers (e.g., Photos/8K0615301M/front.jpg).");
      }

      if (demo) {
        const newBatches: FolderBatchItem[] = [];
        folderMap.forEach((imgFiles, partNo) => {
          const isKnown = partNo.length >= 3;
          newBatches.push({
            partNumber: partNo,
            folderPath: `Uploaded/${partNo}`,
            matchedPart: isKnown ? { id: `demo-${partNo}`, sku: `SKU-${partNo}`, primaryPartNumber: partNo, partName: `OEM Auto Part ${partNo}` } : null,
            imageCount: imgFiles.length,
            linkedCount: isKnown ? imgFiles.length : 0,
            sampleImages: imgFiles.slice(0, 3).map((file, index) => ({
              mediaAssetId: `demo-${partNo}-${index}`,
              originalFilename: file.name,
              mimeType: "image/jpeg",
              byteSize: file.size,
              checksum: "demo",
              sourcePath: file.name,
              createdAt: new Date().toISOString(),
              url: URL.createObjectURL(file),
            })),
            status: isKnown ? "AUTO_ASSIGNED" : "PENDING_CATALOG",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        });
        setBatches((current) => [...newBatches, ...current]);
        setNotice(`Scanned ${folderMap.size} part number subfolders (${files.length} total photos) in demo mode. Upload is available when connected to the live API.`);
        return;
      }

      // Flatten every image with its part-number subfolder so we can read files
      // in parallel batches while reporting real progress.
      const entries: Array<{ partNo: string; file: File }> = [];
      let totalBytes = 0;
      folderMap.forEach((imgFiles, partNo) => {
        for (const file of imgFiles) {
          entries.push({ partNo, file });
          totalBytes += file.size;
        }
      });
      let loadedBytes = 0;

      // Build a ZIP preserving the PartNumberFolder/photo structure, then let the
      // API store every image on S3 and auto-assign to matching catalog parts.
      const zipEntries: Record<string, Uint8Array> = {};
      const batchSize = 12;
      for (let offset = 0; offset < entries.length; offset += batchSize) {
        const chunk = entries.slice(offset, offset + batchSize);
        const read = await Promise.all(chunk.map(async ({ partNo, file }) => ({
          partNo,
          file,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })));
        for (const item of read) {
          zipEntries[`${item.partNo}/${item.file.name}`] = item.bytes;
          loadedBytes += item.file.size;
        }
        setUploadProgress({
          phase: "reading",
          percent: Math.min(99, Math.round((loadedBytes / Math.max(totalBytes, 1)) * 100)),
          filesRead: Math.min(offset + batchSize, entries.length),
          totalFiles: entries.length,
        });
      }

      setUploadProgress({ phase: "packing", percent: 100, filesRead: entries.length, totalFiles: entries.length });
      const archiveBytes = zipSync(zipEntries, { level: 6 });
      const archiveName = `media-drive-${Date.now()}.zip`;
      setUploadProgress({ phase: "uploading", percent: 100, filesRead: entries.length, totalFiles: entries.length });
      const result = (await apiFetch("/api/media-drive/ingest", {
        method: "POST",
        headers: { "x-file-name": archiveName, "Content-Type": "application/zip" },
        body: archiveBytes,
      })) as IngestResponse;

      const issues = result.issues ?? [];
      const warningCount = issues.filter((issue) => issue.severity === "warning").length;
      await load("replace");
      const summaryText = `${result.summary.matchedFolders} subfolder(s) auto-matched to catalog parts, ${result.summary.pendingFolders} pending catalog intake (${result.summary.totalPhotos} photos stored on S3).`;
      setNotice(warningCount > 0 ? `${summaryText} ${warningCount} file warning(s) were skipped.` : summaryText);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to scan folder directory");
    } finally {
      setScanning(false);
      setUploadProgress(null);
    }
  }

  async function runRematch(batch: FolderBatchItem) {
    if (demo) return;
    setBusyAction(`rematch-${batch.partNumber}`);
    setError("");
    try {
      const result = (await apiFetch(`/api/media-drive/folders/${encodeURIComponent(batch.partNumber)}/rematch`, { method: "POST" })) as { matched: boolean; part: MatchedPart | null; linkedCount: number };
      if (result.matched) {
        setNotice(`Folder ${batch.partNumber} auto-matched to catalog part ${result.part?.sku} — ${result.linkedCount} photo(s) attached.`);
      } else {
        setNotice(`Folder ${batch.partNumber} still has no matching catalog part. Use "Link to a part" to assign it manually.`);
      }
      await load("replace");
      const refreshed = batches.find((item) => item.partNumber === batch.partNumber);
      if (refreshed) openInspector(refreshed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rematch failed");
    } finally {
      setBusyAction("");
    }
  }

  async function runLink(batch: FolderBatchItem, partId: string) {
    if (demo) return;
    setBusyAction(`link-${batch.partNumber}`);
    setError("");
    try {
      await apiFetch(`/api/media-drive/folders/${encodeURIComponent(batch.partNumber)}/link`, {
        method: "POST",
        body: JSON.stringify({ partId }),
      });
      setPickerOpen(false);
      setNotice(`Folder ${batch.partNumber} linked to the selected catalog part.`);
      await load("replace");
      const refreshed = batches.find((item) => item.partNumber === batch.partNumber);
      if (refreshed) openInspector(refreshed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Linking failed");
    } finally {
      setBusyAction("");
    }
  }

  async function runDelete(batch: FolderBatchItem) {
    if (demo) return;
    if (!window.confirm(`Delete the photo folder ${batch.partNumber} (${batch.imageCount} photo(s)) from the media drive?`)) return;
    setBusyAction(`delete-${batch.partNumber}`);
    setError("");
    try {
      await apiFetch(`/api/media-drive/folders/${encodeURIComponent(batch.partNumber)}`, { method: "DELETE" });
      setSelectedBatch(null);
      setNotice(`Photo folder ${batch.partNumber} removed from the media drive.`);
      await load("replace");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Deletion failed");
    } finally {
      setBusyAction("");
    }
  }

  async function searchParts(query: string) {
    if (!query.trim()) {
      setPickerResults([]);
      return;
    }
    setPickerLoading(true);
    try {
      const data = (await apiFetch(`/api/parts?q=${encodeURIComponent(query.trim())}&page=1&pageSize=8`)) as { parts: Array<{ id: string; sku: string; primaryPartNumber: string; partName: string | null }> };
      setPickerResults(data.parts ?? []);
    } catch {
      setPickerResults([]);
    } finally {
      setPickerLoading(false);
    }
  }

  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return batches.filter((batch) => {
      if (statusFilter && batch.status !== statusFilter) return false;
      if (!q) return true;
      return (
        batch.partNumber.toLowerCase().includes(q) ||
        (batch.matchedPart && batch.matchedPart.sku.toLowerCase().includes(q)) ||
        (batch.matchedPart && batch.matchedPart.partName?.toLowerCase().includes(q))
      );
    });
  }, [batches, search, statusFilter]);

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>AUTOMATED PART PHOTO MATCHING &amp; VAULT</span>
          <h1>Media Drive &amp; Photo Vault</h1>
          <p>Upload master photo folders containing part-number subfolders. PartPulse stores every photo on S3, matches each subfolder to catalog parts by OEM Part Number or SKU, and attaches the images automatically.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => void load("replace")} aria-label="Refresh Vault" title="Refresh Vault">
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
            {scanning ? (uploadProgress?.phase === "reading" ? "Reading Photos..." : uploadProgress?.phase === "packing" ? "Packing Archive..." : "Uploading Photos...") : "Upload Photo Folder"}
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

      {/* Upload Progress Panel */}
      {uploadProgress && (
        <div className={styles.uploadProgressBox}>
          <div className={styles.uploadProgressHeader}>
            <span className={styles.uploadProgressLabel}>
              {uploadProgress.phase === "reading" ? "Reading photo files" : uploadProgress.phase === "packing" ? "Packing photo archive" : "Uploading to media drive (S3)"}
            </span>
            <span className={styles.uploadProgressMeta}>
              {uploadProgress.filesRead}/{uploadProgress.totalFiles} photo{uploadProgress.totalFiles === 1 ? "" : "s"}
              {uploadProgress.phase === "reading" && <> · {uploadProgress.percent}%</>}
            </span>
          </div>
          <div className={styles.uploadProgressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress.phase === "reading" ? uploadProgress.percent : undefined} aria-label="Upload progress">
            <div
              className={`${styles.uploadProgressFill} ${uploadProgress.phase !== "reading" ? styles.uploadProgressFillIndeterminate : ""}`}
              style={uploadProgress.phase === "reading" ? { width: `${uploadProgress.percent}%` } : undefined}
            />
          </div>
        </div>
      )}

      {/* Summary Metrics Cards */}
      <section className={styles.metrics}>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>PART PHOTO SUBFOLDERS</span>
            <span className={styles.metricBadgeTotal}>ACTIVE</span>
          </div>
          <b>{summary.totalFolders}</b>
          <small>Scanned part number folders</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>AUTO-MATCHED CATALOG PARTS</span>
            <span className={styles.metricBadgeGood}>ASSIGNED</span>
          </div>
          <b className={styles.metricGood}>{summary.matchedFolders}</b>
          <small>{summary.linkedPhotos} photo(s) attached to catalog items</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>PHOTOS STORED ON S3</span>
            <span className={styles.metricBadgeValue}>IMAGES</span>
          </div>
          <b className={styles.metricValue}>{summary.totalPhotos}</b>
          <small>Photos stored in the media drive</small>
        </article>
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>PENDING CATALOG INTAKE</span>
            <span className={styles.metricBadgeWarn}>STAGED</span>
          </div>
          <b className={styles.metricWarn}>{summary.pendingFolders}</b>
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
            <strong>
              {uploadProgress
                ? uploadProgress.phase === "reading" ? `Reading photos... ${uploadProgress.percent}%`
                  : uploadProgress.phase === "packing" ? "Packing photo archive..." : "Uploading to media drive..."
                : "Drag & drop master photo folder"}
            </strong>
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
          <p className={styles.structureNote}>When uploaded, PartPulse scans each subfolder name (e.g. <code>8K0615301M</code>), matches it against catalog parts by OEM Part Number or SKU, stores every photo on S3, and attaches the images automatically!</p>
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
            <span className={styles.paginationHint}>{pagination.total} folder{pagination.total === 1 ? "" : "s"} · {summary.totalPhotos} photo{summary.totalPhotos === 1 ? "" : "s"} on S3</span>
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
                  <tr key={item.partNumber}>
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
                          item.sampleImages.map((image) => (
                            <Thumb key={image.mediaAssetId} image={image} className={styles.thumbImg} />
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
                      {item.matchedPart?.partName ? (
                        <b className={styles.titleCell}>{item.matchedPart.partName}</b>
                      ) : (
                        <span className={styles.subtle}>Part number not in catalog yet</span>
                      )}
                    </td>
                    <td>
                      {item.matchedPart ? (
                        <Link href="/catalog" className={styles.skuLink}>
                          <code>{item.matchedPart.sku}</code>
                        </Link>
                      ) : (
                        <span className={styles.subtle}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.statusPill} ${item.status === "AUTO_ASSIGNED" || item.status === "MATCHED" ? styles.statusGood : styles.statusWait}`}>
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td className={styles.dateCell}>{new Date(item.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.inspectBtn}
                        onClick={() => openInspector(item)}
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
        {!loading && pagination.page < pagination.totalPages && (
          <div className={styles.loadMoreRow}>
            <button type="button" className={styles.ghostBtn} onClick={() => void load("append")}>
              Load more folders ({pagination.total - batches.length} remaining)
            </button>
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
                  {inspectorPart ? (
                    <code className={styles.statCodeBlue}>{inspectorPart.sku}</code>
                  ) : (
                    <span className={styles.statUnassigned}>Unassigned</span>
                  )}
                </div>
                <div className={styles.statDivider} />
                <div className={styles.statCell}>
                  <span className={styles.metaLabel}>IMAGE ASSETS</span>
                  <span className={`${styles.statusPill} ${selectedBatch.imageCount > 0 ? styles.statusGood : styles.statusWait}`}>{selectedBatch.imageCount} photo{selectedBatch.imageCount === 1 ? "" : "s"} stored on S3</span>
                </div>
              </div>

              <div className={styles.photoGridModal}>
                {inspectorImages.length > 0 ? (
                  inspectorImages.map((image, idx) => (
                    <div key={image.mediaAssetId} className={styles.modalPhotoCard}>
                      <div className={styles.modalImgWrap}>
                        {image.url ? (
                          <img src={image.url} alt={image.originalFilename} />
                        ) : (
                          <span className={styles.modalImgPlaceholder}>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                          </span>
                        )}
                      </div>
                      <div className={styles.modalPhotoFooter}>
                        <code>{image.originalFilename}</code>
                        <span className={styles.photoSizeTag}>{imageExt(image.mimeType)} · {humanBytes(image.byteSize)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={styles.noImagesBox}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3"/></svg>
                    <b>{inspectorLoading ? "Loading photos from S3..." : `${selectedBatch.imageCount} image files staged in vault`}</b>
                    <span>Images are automatically assigned to catalog part <b>{inspectorPart?.sku ?? selectedBatch.partNumber}</b></span>
                  </div>
                )}
              </div>

              {(selectedBatch.status === "MATCHED" || selectedBatch.status === "PENDING_CATALOG") && !demo && (
                <div className={styles.quickActions}>
                  <button
                    type="button"
                    className={styles.inspectBtn}
                    disabled={Boolean(busyAction)}
                    onClick={() => void runRematch(selectedBatch)}
                  >
                    {busyAction === `rematch-${selectedBatch.partNumber}` ? "Matching..." : "Auto-match now"}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    disabled={Boolean(busyAction)}
                    onClick={() => { setPickerOpen(true); setPickerQuery(""); setPickerResults([]); }}
                  >
                    Link to a catalog part
                  </button>
                </div>
              )}

              <footer className={styles.modalFooterActions}>
                <button
                  type="button"
                  className={styles.dangerBtn}
                  disabled={Boolean(busyAction)}
                  onClick={() => void runDelete(selectedBatch)}
                >
                  {busyAction === `delete-${selectedBatch.partNumber}` ? "Deleting..." : "Delete folder"}
                </button>
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

      {/* Part Picker Modal */}
      {pickerOpen && selectedBatch && (
        <div className={styles.modalBackdrop} role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}>
          <div className={styles.pickerModal} role="dialog">
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.eyebrow}>MANUAL ASSIGNMENT</span>
                <h2 className={styles.modalTitle}>Link folder <code className={styles.modalPartBadge}>{selectedBatch.partNumber}</code> to a catalog part</h2>
              </div>
              <button type="button" className={styles.closeBtn} onClick={() => setPickerOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </header>
            <div className={styles.modalBody}>
              <div className={styles.pickerSearch}>
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => { setPickerQuery(e.target.value); void searchParts(e.target.value); }}
                  placeholder="Search catalog by SKU, part number, or title..."
                />
                {pickerLoading && <span className={styles.pickerSpinner}>Searching...</span>}
              </div>
              {pickerResults.length === 0 ? (
                <div className={styles.pickerEmpty}>
                  <span>No catalog parts match "{pickerQuery}". Create the part in Catalog first, then link this folder.</span>
                </div>
              ) : (
                <ul className={styles.pickerList}>
                  {pickerResults.map((part) => (
                    <li key={part.id}>
                      <button
                        type="button"
                        className={styles.pickerRow}
                        disabled={Boolean(busyAction)}
                        onClick={() => void runLink(selectedBatch, part.id)}
                      >
                        <span className={styles.pickerSku}><code>{part.sku}</code></span>
                        <span className={styles.pickerTitle}>{part.partName || `Part ${part.primaryPartNumber}`}</span>
                        <span className={styles.pickerAction}>{busyAction === `link-${selectedBatch.partNumber}` ? "Linking..." : "Link photos →"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
