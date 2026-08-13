import type { Prisma } from "@prisma/client";
import type { ConfirmedImageObject } from "./object-storage.js";
import { prisma } from "./db.js";

export async function saveConfirmedMediaAsset(
  organizationId: string,
  image: ConfirmedImageObject,
  metadata?: { sourceType?: string; sourceMetadata?: Prisma.InputJsonValue },
) {
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
      ...(metadata?.sourceType ? { sourceType: metadata.sourceType } : {}),
      ...(metadata?.sourceMetadata !== undefined ? { sourceMetadata: metadata.sourceMetadata } : {}),
    },
    update: {
      originalFilename: image.originalFilename,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      checksum: image.checksum,
      status: "UPLOADED",
      ...(metadata?.sourceType ? { sourceType: metadata.sourceType } : {}),
      ...(metadata?.sourceMetadata !== undefined ? { sourceMetadata: metadata.sourceMetadata } : {}),
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

export async function listOrganizationImageAssets(
  organizationId: string,
  input: { search?: string; page: number; pageSize: number },
) {
  const search = input.search?.trim();
  const where: Prisma.MediaAssetWhereInput = {
    organizationId,
    mimeType: { in: ["image/jpeg", "image/png", "image/webp"] },
    status: { in: ["UPLOADED", "READY"] },
    ...(search ? { originalFilename: { contains: search, mode: "insensitive" } } : {}),
  };
  const [assets, total] = await prisma.$transaction([
    prisma.mediaAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        byteSize: true,
        width: true,
        height: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.mediaAsset.count({ where }),
  ]);
  return {
    assets,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize) || 0,
    },
  };
}
