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
    select: { storageKey: true, externalUrl: true },
  });
  return asset?.externalUrl ?? asset?.storageKey ?? null;
}

export async function findMediaStorageKeys(
  organizationId: string,
  mediaAssetIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(mediaAssetIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const assets = await prisma.mediaAsset.findMany({
    where: { organizationId, id: { in: uniqueIds } },
    select: { id: true, storageKey: true, externalUrl: true },
  });
  return new Map(assets.map((asset) => [asset.id, asset.externalUrl ?? asset.storageKey]));
}
