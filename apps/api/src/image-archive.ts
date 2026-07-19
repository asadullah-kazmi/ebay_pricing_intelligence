import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { unzipSync } from "fflate";

export interface ImageMappingRow {
  id: string;
  rowNumber: number;
  sku: string;
  imageGroup: string;
  vin: string | null;
}

export type ImageMappingStrategy = "MANIFEST" | "SKU_FOLDER" | "IMAGE_GROUP_FOLDER" | "SKU_FILENAME" | "UNMATCHED" | "AMBIGUOUS";
export type ImageMappingStatus = "MATCHED" | "REVIEW_REQUIRED" | "UNMATCHED";

export interface ImageArchiveIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  sourcePath?: string;
}

export interface MappedArchiveImage {
  sourcePath: string;
  originalFilename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  checksum: string;
  bytes: Buffer;
  importRowId: string | null;
  strategy: ImageMappingStrategy;
  status: ImageMappingStatus;
  displayOrder: number;
}

export interface ParsedImageArchive {
  images: MappedArchiveImage[];
  issues: ImageArchiveIssue[];
}

export class ImageArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageArchiveError";
  }
}

interface ManifestEntry {
  filename: string;
  sku: string;
  displayOrder?: number;
}

function issue(code: string, severity: "error" | "warning", message: string, sourcePath?: string): ImageArchiveIssue {
  return { code, severity, message, ...(sourcePath ? { sourcePath } : {}) };
}

export function normalizeArchivePath(input: string): string {
  const replaced = input.normalize("NFKC").replace(/\\/g, "/");
  if (/^(?:\/|[A-Za-z]:\/)/.test(replaced)) throw new ImageArchiveError("Archive contains an absolute path");
  const segments = replaced.split("/").filter((segment) => segment !== "");
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new ImageArchiveError("Archive contains an unsafe path");
  }
  return segments.join("/");
}

function imageMimeType(path: string, bytes: Uint8Array): MappedArchiveImage["mimeType"] | null {
  const extension = path.toLowerCase().split(".").at(-1);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const webp = bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  if ((extension === "jpg" || extension === "jpeg") && jpeg) return "image/jpeg";
  if (extension === "png" && png) return "image/png";
  if (extension === "webp" && webp) return "image/webp";
  return null;
}

function parseManifest(contents: Uint8Array, issues: ImageArchiveIssue[]): ManifestEntry[] {
  try {
    const records = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(contents), {
      bom: true,
      columns: (headers: string[]) => headers.map((header) => header.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      max_record_size: 100_000,
    }) as Array<Record<string, string>>;
    const entries: ManifestEntry[] = [];
    for (const [index, record] of records.entries()) {
      if (!record.filename || !record.sku) {
        issues.push(issue("INVALID_MANIFEST_ROW", "error", `Manifest row ${index + 2} requires filename and sku`, "manifest.csv"));
        continue;
      }
      let filename: string;
      try { filename = normalizeArchivePath(record.filename); }
      catch {
        issues.push(issue("INVALID_MANIFEST_PATH", "error", `Manifest row ${index + 2} contains an unsafe filename`, "manifest.csv"));
        continue;
      }
      const rawOrder = record.displayorder?.trim();
      const displayOrder = rawOrder && /^\d+$/.test(rawOrder) ? Number(rawOrder) : undefined;
      if (rawOrder && displayOrder === undefined) {
        issues.push(issue("INVALID_MANIFEST_ORDER", "error", `Manifest row ${index + 2} displayOrder must be a non-negative integer`, "manifest.csv"));
        continue;
      }
      entries.push({ filename, sku: record.sku.trim(), displayOrder });
    }
    return entries;
  } catch {
    issues.push(issue("INVALID_MANIFEST", "error", "manifest.csv must be a valid UTF-8 CSV with filename, sku, and optional displayOrder columns", "manifest.csv"));
    return [];
  }
}

function exactCandidates(value: string, rows: ImageMappingRow[], selector: (row: ImageMappingRow) => string): ImageMappingRow[] {
  const normalized = value.trim().toUpperCase();
  return rows.filter((row) => selector(row).trim().toUpperCase() === normalized);
}

function filenameSkuCandidates(path: string, rows: ImageMappingRow[]): ImageMappingRow[] {
  const leaf = path.split("/").at(-1) ?? path;
  const stem = leaf.replace(/\.[^.]+$/, "").toUpperCase();
  return rows.filter(({ sku }) => {
    const candidate = sku.trim().toUpperCase();
    return stem === candidate || ["_", "-", " "].some((separator) => stem.startsWith(`${candidate}${separator}`));
  });
}

function inferredDisplayOrder(path: string): number | undefined {
  const stem = (path.split("/").at(-1) ?? path).replace(/\.[^.]+$/, "");
  const value = stem.match(/(?:^|[_\-\s])(\d+)$/)?.[1];
  return value === undefined ? undefined : Number(value);
}

export function parseAndMapImageArchive(
  archive: Buffer,
  rows: ImageMappingRow[],
  limits: { maxFiles?: number; maxImageBytes?: number; maxExpandedBytes?: number } = {},
): ParsedImageArchive {
  const maxFiles = limits.maxFiles ?? 2_000;
  const maxImageBytes = limits.maxImageBytes ?? 20_971_520;
  const maxExpandedBytes = limits.maxExpandedBytes ?? 262_144_000;
  const issues: ImageArchiveIssue[] = [];
  let fileCount = 0;
  let expandedBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(archive), {
      filter(file) {
        if (file.name.endsWith("/")) return false;
        const path = normalizeArchivePath(file.name);
        if (path.startsWith("__MACOSX/") || path.split("/").at(-1) === ".DS_Store") return false;
        fileCount += 1;
        expandedBytes += file.originalSize;
        if (fileCount > maxFiles) throw new ImageArchiveError(`Archive exceeds the ${maxFiles}-file limit`);
        if (expandedBytes > maxExpandedBytes) throw new ImageArchiveError("Archive expands beyond the configured safety limit");
        const extension = path.toLowerCase().split(".").at(-1);
        const supported = path.toLowerCase() === "manifest.csv" || ["jpg", "jpeg", "png", "webp"].includes(extension ?? "");
        if (!supported) {
          issues.push(issue("UNSUPPORTED_FILE_SKIPPED", "warning", "Unsupported archive file was skipped", path));
          return false;
        }
        if (path.toLowerCase() !== "manifest.csv" && file.originalSize > maxImageBytes) {
          issues.push(issue("IMAGE_TOO_LARGE", "error", `Image exceeds the ${maxImageBytes}-byte limit`, path));
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ImageArchiveError) throw error;
    throw new ImageArchiveError("The image archive is not a valid or safe ZIP file");
  }

  const normalizedFiles = new Map<string, Uint8Array>();
  for (const [rawPath, contents] of Object.entries(files)) normalizedFiles.set(normalizeArchivePath(rawPath), contents);
  const manifestBytes = [...normalizedFiles.entries()].find(([path]) => path.toLowerCase() === "manifest.csv")?.[1];
  const manifest = manifestBytes ? parseManifest(manifestBytes, issues) : [];
  const images: MappedArchiveImage[] = [];

  for (const [sourcePath, contents] of normalizedFiles) {
    if (sourcePath.toLowerCase() === "manifest.csv") continue;
    const mimeType = imageMimeType(sourcePath, contents);
    if (!mimeType) {
      issues.push(issue("INVALID_IMAGE_CONTENT", "error", "Image content does not match its supported extension", sourcePath));
      continue;
    }

    const leaf = sourcePath.split("/").at(-1) ?? sourcePath;
    const parentSegments = sourcePath.split("/").slice(0, -1);
    const manifestMatches = manifest.filter(({ filename }) => {
      const manifestLeaf = filename.split("/").at(-1);
      return filename.includes("/")
        ? filename.toUpperCase() === sourcePath.toUpperCase()
        : manifestLeaf?.toUpperCase() === leaf.toUpperCase();
    });
    let candidates: ImageMappingRow[] = [];
    let strategy: ImageMappingStrategy = "UNMATCHED";
    let manifestOrder: number | undefined;

    if (manifestMatches.length === 1) {
      strategy = "MANIFEST";
      candidates = exactCandidates(manifestMatches[0]!.sku, rows, (row) => row.sku);
      manifestOrder = manifestMatches[0]!.displayOrder;
    } else if (manifestMatches.length > 1) {
      strategy = "AMBIGUOUS";
    } else {
      const skuFolderCandidates = rows.filter((row) => parentSegments.some((segment) => segment.toUpperCase() === row.sku.trim().toUpperCase()));
      if (skuFolderCandidates.length) {
        strategy = "SKU_FOLDER";
        candidates = skuFolderCandidates;
      } else {
        const imageGroupCandidates = rows.filter((row) => parentSegments.some((segment) => segment.toUpperCase() === row.imageGroup.trim().toUpperCase()));
        if (imageGroupCandidates.length) {
          strategy = "IMAGE_GROUP_FOLDER";
          candidates = imageGroupCandidates;
        } else {
          candidates = filenameSkuCandidates(sourcePath, rows);
          if (candidates.length) strategy = "SKU_FILENAME";
        }
      }
    }

    const uniquelyMatched = candidates.length === 1 && strategy !== "AMBIGUOUS";
    const ambiguous = candidates.length > 1 || strategy === "AMBIGUOUS" || (strategy === "MANIFEST" && candidates.length === 0);
    const finalStrategy = ambiguous ? (strategy === "MANIFEST" ? "MANIFEST" : "AMBIGUOUS") : strategy;
    const status: ImageMappingStatus = uniquelyMatched ? "MATCHED" : ambiguous ? "REVIEW_REQUIRED" : "UNMATCHED";
    if (ambiguous) issues.push(issue("IMAGE_MATCH_REVIEW_REQUIRED", "warning", "Image mapping is ambiguous or references an unknown manifest SKU", sourcePath));
    else if (!uniquelyMatched) issues.push(issue("IMAGE_UNMATCHED", "warning", "Image could not be matched to a staged SKU", sourcePath));

    images.push({
      sourcePath,
      originalFilename: leaf,
      mimeType,
      byteSize: contents.length,
      checksum: createHash("sha256").update(contents).digest("hex"),
      bytes: Buffer.from(contents),
      importRowId: uniquelyMatched ? candidates[0]!.id : null,
      strategy: finalStrategy,
      status,
      displayOrder: manifestOrder ?? inferredDisplayOrder(sourcePath) ?? 0,
    });
  }
  return { images, issues };
}
