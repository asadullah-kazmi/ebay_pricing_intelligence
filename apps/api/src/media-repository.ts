import type { ConfirmedImageObject } from "./object-storage.js";
import { prisma } from "./db.js";

export async function saveConfirmedMediaAsset(organizationId: string, image: ConfirmedImageObject) {
  return prisma.mediaAsset.upsert({
    where: { organizationId_storageKey: { organizationId, storageKey: image.storageKey } },
    create: {
      organizationId,
      storageKey: image.storageKey,
      originalFilename: image.originalFilename,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      checksum: image.checksum,
      status: "UPLOADED",
    },
    update: {
      originalFilename: image.originalFilename,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      checksum: image.checksum,
      status: "UPLOADED",
    },
  });
}

export async function findMediaStorageKey(organizationId: string, mediaAssetId: string): Promise<string | null> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: mediaAssetId, organizationId },
    select: { storageKey: true },
  });
  return asset?.storageKey ?? null;
}
