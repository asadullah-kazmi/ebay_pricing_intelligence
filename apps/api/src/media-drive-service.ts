import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { prisma } from "./db.js";
import { normalizePartNumber } from "./domain/matching.js";
import { findReusableMediaAsset } from "./import-repository.js";
import { saveConfirmedMediaAsset } from "./media-repository.js";
import type { ObjectStorage } from "./object-storage.js";

export const MEDIA_DRIVE_SOURCE_TYPE = "MEDIA_DRIVE_FOLDER";
export const MEDIA_DRIVE_MAX_FILES = 2_000;
export const MEDIA_DRIVE_MAX_EXPANDED_BYTES = 262_144_000;

export type MediaDriveFolderStatus = "AUTO_ASSIGNED" | "MATCHED" | "PENDING_CATALOG";

export interface MediaDriveFolderImage {
  mediaAssetId: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  sourcePath: string;
  createdAt: string;
}

export interface MediaDriveFolder {
  partNumber: string;
  folderPath: string | null;
  imageCount: number;
  sampleImages: MediaDriveFolderImage[];
  matchedPart: {
    id: string;
    sku: string;
    primaryPartNumber: string;
    partName: string | null;
  } | null;
  linkedCount: number;
  status: MediaDriveFolderStatus;
  createdAt: string;
  updatedAt: string;
}

export class MediaDriveError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "MediaDriveError";
  }
}

function imageMimeType(path: string, bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
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

function normalizeFolderPath(input: string): string {
  const replaced = input.normalize("NFKC").replace(/\\/g, "/");
  if (/^(?:\/|[A-Za-z]:\/)/.test(replaced)) throw new MediaDriveError("Archive contains an absolute path");
  const segments = replaced.split("/").filter((segment) => segment !== "");
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new MediaDriveError("Archive contains an unsafe path");
  }
  return segments.join("/");
}

export async function findPartByPartNumber(organizationId: string, partNumber: string) {
  const normalized = normalizePartNumber(partNumber);
  if (!normalized) return null;
  const byPrimary = await prisma.part.findFirst({
    where: { organizationId, normalizedPartNumber: normalized },
    select: { id: true, sku: true, normalizedSku: true, primaryPartNumber: true, partName: true, status: true },
  });
  if (byPrimary) return byPrimary;
  const byAlternate = await prisma.partNumber.findFirst({
    where: { organizationId, normalizedValue: normalized },
    select: { part: { select: { id: true, sku: true, normalizedSku: true, primaryPartNumber: true, partName: true, status: true } } },
  });
  if (byAlternate) return byAlternate.part;
  return prisma.part.findFirst({
    where: { organizationId, normalizedSku: normalized },
    select: { id: true, sku: true, normalizedSku: true, primaryPartNumber: true, partName: true, status: true },
  });
}

function inferredDisplayOrder(path: string): number {
  const stem = (path.split("/").at(-1) ?? path).replace(/\.[^.]+$/, "");
  const value = stem.match(/(?:^|[_\-\s])(\d+)$/)?.[1];
  return value === undefined ? 0 : Number(value);
}

interface ParsedFolderImage {
  sourcePath: string;
  originalFilename: string;
  partFolder: string;
  folderPath: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  checksum: string;
  bytes: Buffer;
  displayOrder: number;
}

export function parseMediaDriveArchive(archive: Buffer, limits: { maxFiles?: number; maxImageBytes?: number; maxExpandedBytes?: number } = {}): {
  images: ParsedFolderImage[];
  issues: Array<{ code: string; severity: "error" | "warning"; message: string; sourcePath?: string }>;
} {
  const maxFiles = limits.maxFiles ?? MEDIA_DRIVE_MAX_FILES;
  const maxImageBytes = limits.maxImageBytes ?? 20_971_520;
  const maxExpandedBytes = limits.maxExpandedBytes ?? MEDIA_DRIVE_MAX_EXPANDED_BYTES;
  const issues: Array<{ code: string; severity: "error" | "warning"; message: string; sourcePath?: string }> = [];
  let fileCount = 0;
  let expandedBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(archive), {
      filter(file) {
        if (file.name.endsWith("/")) return false;
        const path = normalizeFolderPath(file.name);
        if (path.startsWith("__MACOSX/") || path.split("/").at(-1) === ".DS_Store") return false;
        fileCount += 1;
        expandedBytes += file.originalSize;
        if (fileCount > maxFiles) throw new MediaDriveError(`Photo folder archive exceeds the ${maxFiles}-file limit`);
        if (expandedBytes > maxExpandedBytes) throw new MediaDriveError("Photo folder archive expands beyond the configured safety limit");
        const extension = path.toLowerCase().split(".").at(-1);
        if (!["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) {
          issues.push({ code: "UNSUPPORTED_FILE_SKIPPED", severity: "warning", message: "Unsupported archive file was skipped", sourcePath: path });
          return false;
        }
        if (file.originalSize > maxImageBytes) {
          issues.push({ code: "IMAGE_TOO_LARGE", severity: "error", message: `Image exceeds the ${maxImageBytes}-byte limit`, sourcePath: path });
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof MediaDriveError) throw error;
    throw new MediaDriveError("The photo folder archive is not a valid or safe ZIP file");
  }

  const images: ParsedFolderImage[] = [];
  for (const [rawPath, contents] of Object.entries(files)) {
    const sourcePath = normalizeFolderPath(rawPath);
    const segments = sourcePath.split("/");
    if (segments.length < 2) {
      issues.push({ code: "IMAGE_NOT_IN_SUBFOLDER", severity: "warning", message: "Image is not inside a part-number subfolder and was skipped", sourcePath });
      continue;
    }
    const mimeType = imageMimeType(sourcePath, contents);
    if (!mimeType) {
      issues.push({ code: "INVALID_IMAGE_CONTENT", severity: "error", message: "Image content does not match its supported extension", sourcePath });
      continue;
    }
    const partFolder = segments.at(-2)!.trim().toUpperCase();
    const normalized = normalizePartNumber(partFolder);
    if (!normalized) {
      issues.push({ code: "INVALID_FOLDER_NAME", severity: "warning", message: "Subfolder name does not contain a part number", sourcePath });
      continue;
    }
    images.push({
      sourcePath,
      originalFilename: segments.at(-1)!,
      partFolder,
      folderPath: segments.slice(0, -1).join("/"),
      mimeType,
      byteSize: contents.length,
      checksum: createHash("sha256").update(contents).digest("hex"),
      bytes: Buffer.from(contents),
      displayOrder: inferredDisplayOrder(sourcePath),
    });
  }
  return { images, issues };
}

async function linkFolderToPart(input: {
  organizationId: string;
  partNumber: string;
  mediaAssetIds: string[];
  userId: string;
}) {
  const part = await findPartByPartNumber(input.organizationId, input.partNumber);
  if (!part) return null;
  const existing = await prisma.partMedia.findMany({
    where: { organizationId: input.organizationId, partId: part.id, mediaAssetId: { in: input.mediaAssetIds } },
    select: { mediaAssetId: true },
  });
  const existingSet = new Set(existing.map((entry) => entry.mediaAssetId));
  const newAssetIds = input.mediaAssetIds.filter((mediaAssetId) => !existingSet.has(mediaAssetId));
  if (newAssetIds.length) {
    const currentMax = await prisma.partMedia.aggregate({
      where: { organizationId: input.organizationId, partId: part.id },
      _max: { displayOrder: true },
    });
    let displayOrder = currentMax._max.displayOrder ?? -1;
    await prisma.partMedia.createMany({
      data: newAssetIds.map((mediaAssetId) => {
        displayOrder += 1;
        return {
          organizationId: input.organizationId,
          partId: part.id,
          mediaAssetId,
          displayOrder,
          approved: true,
          altText: `${part.partName ?? "Automotive part"} - ${part.sku}`,
        };
      }),
    });
  }
  if (part.status !== "ARCHIVED" && part.status !== "IMPORT_ERROR" && part.status !== "READY_FOR_ENRICHMENT") {
    await prisma.part.update({
      where: { id: part.id },
      data: { status: "READY_FOR_ENRICHMENT", updatedAt: new Date() },
    });
  }
  return part;
}

export async function ingestMediaDriveFolderArchive(input: {
  organizationId: string;
  userId: string;
  filename: string;
  bytes: Buffer;
  storage: ObjectStorage;
  maxImageBytes: number;
}) {
  const { images, issues } = parseMediaDriveArchive(input.bytes, { maxImageBytes: input.maxImageBytes });
  if (!images.length) {
    throw new MediaDriveError("The archive contains no supported images inside part-number subfolders");
  }

  const folderMap = new Map<string, ParsedFolderImage[]>();
  for (const image of images) {
    const list = folderMap.get(image.partFolder) ?? [];
    list.push(image);
    folderMap.set(image.partFolder, list);
  }

  const mediaByChecksum = new Map<string, string>();
  let imagesStored = 0;
  let imagesReused = 0;
  for (let index = 0; index < images.length; index += 4) {
    const chunk = images.slice(index, index + 4);
    await Promise.all(chunk.map(async (image) => {
      const reusable = await findReusableMediaAsset(input.organizationId, image.checksum);
      if (reusable) {
        mediaByChecksum.set(image.checksum, reusable.id);
        imagesReused += 1;
        return;
      }
      const stored = await input.storage.storeExtractedImage({
        organizationId: input.organizationId,
        filename: image.originalFilename,
        mimeType: image.mimeType,
        bytes: image.bytes,
        checksum: image.checksum,
      });
      const asset = await saveConfirmedMediaAsset(input.organizationId, stored, {
        sourceType: MEDIA_DRIVE_SOURCE_TYPE,
        sourceMetadata: {
          partNumber: image.partFolder,
          folderPath: image.folderPath,
          archiveFilename: input.filename,
        },
      });
      mediaByChecksum.set(image.checksum, asset.id);
      imagesStored += 1;
    }));
  }

  const folders: Array<{
    partNumber: string;
    folderPath: string;
    imageCount: number;
    sampleImages: MediaDriveFolderImage[];
    matchedPart: MediaDriveFolder["matchedPart"];
    linkedCount: number;
    status: MediaDriveFolderStatus;
    createdAt: string;
    updatedAt: string;
  }> = [];

  for (const [partFolder, folderImages] of folderMap) {
    const ordered = [...folderImages].sort((a, b) => a.displayOrder - b.displayOrder);
    const assetIds = ordered.map((image) => mediaByChecksum.get(image.checksum)!);
    const assets = await prisma.mediaAsset.findMany({
      where: { organizationId: input.organizationId, id: { in: assetIds } },
      select: {
        id: true, originalFilename: true, mimeType: true, byteSize: true, checksum: true, createdAt: true,
        parts: { select: { partId: true } },
      },
    });
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const part = await linkFolderToPart({
      organizationId: input.organizationId,
      partNumber: partFolder,
      mediaAssetIds: assetIds,
      userId: input.userId,
    });
    const linkedCount = assets.filter((asset) => asset.parts.length > 0).length;
    folders.push({
      partNumber: partFolder,
      folderPath: ordered[0]!.folderPath,
      imageCount: ordered.length,
      sampleImages: ordered.slice(0, 3).map((image) => {
        const asset = assetById.get(mediaByChecksum.get(image.checksum)!);
        return {
          mediaAssetId: mediaByChecksum.get(image.checksum)!,
          originalFilename: asset?.originalFilename ?? image.originalFilename,
          mimeType: asset?.mimeType ?? image.mimeType,
          byteSize: asset?.byteSize ?? image.byteSize,
          checksum: image.checksum,
          sourcePath: image.sourcePath,
          createdAt: asset?.createdAt.toISOString() ?? new Date().toISOString(),
        };
      }),
      matchedPart: part ? {
        id: part.id,
        sku: part.sku,
        primaryPartNumber: part.primaryPartNumber,
        partName: part.partName,
      } : null,
      linkedCount,
      status: part ? (linkedCount > 0 ? "AUTO_ASSIGNED" : "MATCHED") : "PENDING_CATALOG",
      createdAt: assets.reduce((earliest, asset) => earliest && earliest < asset.createdAt ? earliest : asset.createdAt, assets[0]?.createdAt ?? new Date()).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    folders,
    summary: {
      totalFolders: folders.length,
      matchedFolders: folders.filter((folder) => folder.status !== "PENDING_CATALOG").length,
      pendingFolders: folders.filter((folder) => folder.status === "PENDING_CATALOG").length,
      totalPhotos: images.length,
      imagesStored,
      imagesReused,
    },
    issues,
  };
}

export async function listMediaDriveFolders(input: {
  organizationId: string;
  search?: string;
  status?: MediaDriveFolderStatus;
  page: number;
  pageSize: number;
}): Promise<{ folders: MediaDriveFolder[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { totalFolders: number; matchedFolders: number; pendingFolders: number; totalPhotos: number; linkedPhotos: number } }> {
  const assets = await prisma.mediaAsset.findMany({
    where: { organizationId: input.organizationId, sourceType: MEDIA_DRIVE_SOURCE_TYPE },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      byteSize: true,
      checksum: true,
      createdAt: true,
      sourceMetadata: true,
      parts: { select: { partId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const grouped = new Map<string, typeof assets>();
  for (const asset of assets) {
    const partNumber = String((asset.sourceMetadata as { partNumber?: unknown } | null)?.partNumber ?? "").trim().toUpperCase();
    if (!partNumber) continue;
    const list = grouped.get(partNumber) ?? [];
    list.push(asset);
    grouped.set(partNumber, list);
  }

  const partCache = new Map<string, Awaited<ReturnType<typeof findPartByPartNumber>>>();
  async function resolvePart(partNumber: string) {
    const hit = partCache.get(partNumber);
    if (hit !== undefined) return hit;
    const part = await findPartByPartNumber(input.organizationId, partNumber);
    partCache.set(partNumber, part);
    return part;
  }

  const folders: MediaDriveFolder[] = [];
  for (const [partNumber, folderAssets] of grouped) {
    const ordered = [...folderAssets].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const part = await resolvePart(partNumber);
    const linkedCount = folderAssets.filter((asset) => asset.parts.length > 0).length;
    const status: MediaDriveFolderStatus = part ? (linkedCount > 0 ? "AUTO_ASSIGNED" : "MATCHED") : "PENDING_CATALOG";
    if (input.status && status !== input.status) continue;
    const folderPath = String((folderAssets[0]!.sourceMetadata as { folderPath?: unknown } | null)?.folderPath ?? "").trim() || null;
    if (input.search) {
      const q = input.search.trim().toLowerCase();
      const partNumberMatch = partNumber.toLowerCase().includes(q);
      const partMatch = part
        ? part.sku.toLowerCase().includes(q) || part.primaryPartNumber.toLowerCase().includes(q) || (part.partName ?? "").toLowerCase().includes(q)
        : false;
      if (!partNumberMatch && !partMatch) continue;
    }
    folders.push({
      partNumber,
      folderPath,
      imageCount: folderAssets.length,
      sampleImages: ordered.slice(0, 3).map((asset) => ({
        mediaAssetId: asset.id,
        originalFilename: asset.originalFilename,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        checksum: asset.checksum,
        sourcePath: `${folderPath ? `${folderPath}/` : ""}${partNumber}/${asset.originalFilename}`,
        createdAt: asset.createdAt.toISOString(),
      })),
      matchedPart: part ? {
        id: part.id,
        sku: part.sku,
        primaryPartNumber: part.primaryPartNumber,
        partName: part.partName,
      } : null,
      linkedCount,
      status,
      createdAt: ordered[0]!.createdAt.toISOString(),
      updatedAt: ordered[ordered.length - 1]!.createdAt.toISOString(),
    });
  }

  folders.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const total = folders.length;
  const start = (input.page - 1) * input.pageSize;
  const pageFolders = folders.slice(start, start + input.pageSize);
  return {
    folders: pageFolders,
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) },
    summary: {
      totalFolders: grouped.size,
      matchedFolders: [...grouped.keys()].reduce((count, partNumber) => {
        const part = partCache.get(partNumber);
        return count + (part ? 1 : 0);
      }, 0),
      pendingFolders: [...grouped.keys()].reduce((count, partNumber) => {
        const part = partCache.get(partNumber);
        return count + (part ? 0 : 1);
      }, 0),
      totalPhotos: assets.length,
      linkedPhotos: assets.filter((asset) => asset.parts.length > 0).length,
    },
  };
}

async function findFolderAssets(organizationId: string, partNumber: string) {
  const normalized = partNumber.trim().toUpperCase();
  if (!normalizePartNumber(normalized)) throw new MediaDriveError("Invalid part number folder name");
  const assets = await prisma.mediaAsset.findMany({
    where: {
      organizationId,
      sourceType: MEDIA_DRIVE_SOURCE_TYPE,
      sourceMetadata: { path: ["partNumber"], equals: normalized },
    },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      byteSize: true,
      checksum: true,
      createdAt: true,
      sourceMetadata: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return assets;
}

export async function getMediaDriveFolder(input: {
  organizationId: string;
  partNumber: string;
  page: number;
  pageSize: number;
}) {
  const assets = await findFolderAssets(input.organizationId, input.partNumber);
  if (!assets.length) throw new MediaDriveError("Photo folder not found", 404);
  const part = await findPartByPartNumber(input.organizationId, input.partNumber);
  const start = (input.page - 1) * input.pageSize;
  const pageAssets = assets.slice(start, start + input.pageSize);
  return {
    partNumber: input.partNumber.toUpperCase(),
    folderPath: String((assets[0]!.sourceMetadata as { folderPath?: unknown } | null)?.folderPath ?? "").trim() || null,
    imageCount: assets.length,
    matchedPart: part ? { id: part.id, sku: part.sku, primaryPartNumber: part.primaryPartNumber, partName: part.partName } : null,
    images: pageAssets.map((asset) => ({
      mediaAssetId: asset.id,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      checksum: asset.checksum,
      sourcePath: `${input.partNumber.toUpperCase()}/${asset.originalFilename}`,
      createdAt: asset.createdAt.toISOString(),
    })),
    pagination: { page: input.page, pageSize: input.pageSize, total: assets.length, totalPages: Math.ceil(assets.length / input.pageSize) },
  };
}

export async function linkMediaDriveFolderToPart(input: { organizationId: string; partNumber: string; partId: string; userId: string }) {
  const part = await prisma.part.findFirst({
    where: { id: input.partId, organizationId: input.organizationId },
    select: { id: true, sku: true, primaryPartNumber: true, partName: true, status: true },
  });
  if (!part) throw new MediaDriveError("Catalog part not found", 404);
  const assets = await findFolderAssets(input.organizationId, input.partNumber);
  if (!assets.length) throw new MediaDriveError("Photo folder not found", 404);
  const linkedPart = await linkFolderToPart({
    organizationId: input.organizationId,
    partNumber: input.partNumber,
    mediaAssetIds: assets.map((asset) => asset.id),
    userId: input.userId,
  });
  return {
    partNumber: input.partNumber.toUpperCase(),
    part: linkedPart ? { id: linkedPart.id, sku: linkedPart.sku, primaryPartNumber: linkedPart.primaryPartNumber, partName: linkedPart.partName } : null,
    linkedCount: await prisma.partMedia.count({
      where: { organizationId: input.organizationId, partId: part.id, mediaAssetId: { in: assets.map((asset) => asset.id) } },
    }),
  };
}

export async function rematchMediaDriveFolder(input: { organizationId: string; partNumber: string; userId: string }) {
  const assets = await findFolderAssets(input.organizationId, input.partNumber);
  if (!assets.length) throw new MediaDriveError("Photo folder not found", 404);
  const part = await linkFolderToPart({
    organizationId: input.organizationId,
    partNumber: input.partNumber,
    mediaAssetIds: assets.map((asset) => asset.id),
    userId: input.userId,
  });
  if (!part) {
    return {
      partNumber: input.partNumber.toUpperCase(),
      matched: false,
      part: null,
      linkedCount: 0,
    };
  }
  return {
    partNumber: input.partNumber.toUpperCase(),
    matched: true,
    part: { id: part.id, sku: part.sku, primaryPartNumber: part.primaryPartNumber, partName: part.partName },
    linkedCount: await prisma.partMedia.count({
      where: { organizationId: input.organizationId, partId: part.id, mediaAssetId: { in: assets.map((asset) => asset.id) } },
    }),
  };
}

export async function deleteMediaDriveFolder(input: { organizationId: string; partNumber: string }) {
  const assets = await findFolderAssets(input.organizationId, input.partNumber);
  if (!assets.length) throw new MediaDriveError("Photo folder not found", 404);
  const assetIds = assets.map((asset) => asset.id);
  await prisma.$transaction([
    prisma.partMedia.deleteMany({ where: { organizationId: input.organizationId, mediaAssetId: { in: assetIds } } }),
    prisma.importMediaMatch.deleteMany({ where: { organizationId: input.organizationId, mediaAssetId: { in: assetIds } } }),
    prisma.mediaAsset.deleteMany({ where: { organizationId: input.organizationId, id: { in: assetIds } } }),
  ]);
  return { deleted: true, partNumber: input.partNumber.toUpperCase(), imageCount: assetIds.length };
}
