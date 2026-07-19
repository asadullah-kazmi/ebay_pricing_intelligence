import { createHash } from "node:crypto";
import { findImageMappingBatch, findReusableMediaAsset, saveImageArchiveMappings } from "./import-repository.js";
import { ImageArchiveError, parseAndMapImageArchive } from "./image-archive.js";
import { saveConfirmedMediaAsset } from "./media-repository.js";
import type { ObjectStorage } from "./object-storage.js";

export class ImageImportError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ImageImportError";
  }
}

export async function importImageArchive(input: {
  organizationId: string;
  importBatchId: string;
  filename: string;
  bytes: Buffer;
  storage: ObjectStorage;
  maxImageBytes: number;
}) {
  const batch = await findImageMappingBatch(input.organizationId, input.importBatchId);
  if (!batch) throw new ImageImportError("Import batch not found", 404);
  if (batch.status === "FAILED") throw new ImageImportError("Images cannot be attached to a failed spreadsheet import", 409);
  const archiveChecksum = createHash("sha256").update(input.bytes).digest("hex");
  if (batch.imageArchiveChecksum === archiveChecksum) {
    return {
      id: batch.id,
      status: batch.status,
      imageMatchCount: batch.imageMatchCount,
      imageReviewCount: batch.imageReviewCount,
      imageUnmatchedCount: batch.imageUnmatchedCount,
      reused: true,
      issues: [],
    };
  }
  if (batch.imageArchiveChecksum) throw new ImageImportError("This batch already has a different image archive", 409);

  let parsed;
  try {
    parsed = parseAndMapImageArchive(input.bytes, batch.rows, { maxImageBytes: input.maxImageBytes });
  } catch (error) {
    if (error instanceof ImageArchiveError) throw new ImageImportError(error.message);
    throw error;
  }
  if (!parsed.images.length) throw new ImageImportError("The ZIP archive contains no valid supported images");

  const archiveKey = await input.storage.storeImageArchive({
    organizationId: input.organizationId,
    importBatchId: input.importBatchId,
    filename: input.filename,
    bytes: input.bytes,
    checksum: archiveChecksum,
  });

  const mediaIds = new Map<string, string>();
  const uniqueImages = [...new Map(parsed.images.map((image) => [image.checksum, image])).values()];
  for (let index = 0; index < uniqueImages.length; index += 4) {
    const chunk = uniqueImages.slice(index, index + 4);
    await Promise.all(chunk.map(async (image) => {
      const reusable = await findReusableMediaAsset(input.organizationId, image.checksum);
      if (reusable) {
        mediaIds.set(image.checksum, reusable.id);
        return;
      }
      const stored = await input.storage.storeExtractedImage({
        organizationId: input.organizationId,
        filename: image.originalFilename,
        mimeType: image.mimeType,
        bytes: image.bytes,
        checksum: image.checksum,
      });
      const asset = await saveConfirmedMediaAsset(input.organizationId, stored);
      mediaIds.set(image.checksum, asset.id);
    }));
  }

  const saved = await saveImageArchiveMappings({
    organizationId: input.organizationId,
    importBatchId: input.importBatchId,
    archiveKey,
    archiveChecksum,
    invalidRows: batch.invalidRows,
    issues: parsed.issues,
    mappings: parsed.images.map((image) => ({ ...image, mediaAssetId: mediaIds.get(image.checksum)! })),
  });
  return { ...saved, reused: false, issues: parsed.issues };
}
