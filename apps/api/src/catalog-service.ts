import { Prisma, type CatalogPartStatus, type PartCondition } from "@prisma/client";
import { recordAuditEvent } from "./audit-service.js";
import { prisma } from "./db.js";
import { buildListingDescriptionHtml, isListingDescriptionTemplate } from "./domain/listing-description.js";
import { buildEbayListingTitle } from "./domain/listing-title.js";
import { normalizePartNumber } from "./domain/matching.js";
import { invalidateListingDraftsForCatalogChanges } from "./listing-draft-service.js";

export class CatalogError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "CatalogError";
  }
}

export interface CatalogQuery {
  q?: string;
  brand?: string;
  status?: CatalogPartStatus;
  condition?: PartCondition;
  hasImages?: boolean;
  hasPricing?: boolean;
  hasFitment?: boolean;
  hasDraft?: boolean;
  hasShippingPolicy?: boolean;
  draftStatus?: "DRAFT" | "BLOCKED" | "READY";
  marketplace?: "EBAY_US" | "EBAY_GB" | "EBAY_DE";
  warehouseId?: string;
  minQuantity?: number;
  maxQuantity?: number;
  minCost?: number;
  maxCost?: number;
  createdFrom?: Date;
  createdTo?: Date;
  sort: "newest" | "oldest" | "updated" | "sku";
  page: number;
  pageSize: number;
}

export function buildCatalogWhere(organizationId: string, query: Omit<CatalogQuery, "page" | "pageSize" | "sort">): Prisma.PartWhereInput {
  const q = query.q?.trim();
  const inventoryFilter: Prisma.InventoryItemWhereInput = {
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.minQuantity !== undefined || query.maxQuantity !== undefined ? {
      quantity: { ...(query.minQuantity !== undefined ? { gte: query.minQuantity } : {}), ...(query.maxQuantity !== undefined ? { lte: query.maxQuantity } : {}) },
    } : {}),
    ...(query.minCost !== undefined || query.maxCost !== undefined ? {
      cost: { ...(query.minCost !== undefined ? { gte: query.minCost } : {}), ...(query.maxCost !== undefined ? { lte: query.maxCost } : {}) },
    } : {}),
  };
  const draftFilter: Prisma.ListingDraftWhereInput = {
    ...(query.marketplace ? { marketplace: query.marketplace } : {}),
    ...(query.draftStatus ? { status: query.draftStatus } : {}),
    ...(query.hasShippingPolicy === true ? { shippingPolicyId: { not: null } } : {}),
    ...(query.hasShippingPolicy === false ? { shippingPolicyId: null } : {}),
  };
  const hasInventoryFilter = Object.keys(inventoryFilter).length > 0;
  const hasDraftFilter = Object.keys(draftFilter).length > 0;
  const brand = query.brand?.trim();
  return {
    organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.condition ? { condition: query.condition } : {}),
    ...(brand ? { brand: { equals: brand, mode: "insensitive" } } : {}),
    ...(query.hasImages === true ? { media: { some: {} } } : {}),
    ...(query.hasImages === false ? { media: { none: {} } } : {}),
    ...(hasInventoryFilter ? { inventoryItem: { is: inventoryFilter } } : {}),
    ...(query.hasPricing === true ? { pricingProposals: { some: { status: { in: ["APPROVED", "OVERRIDDEN"] } } } } : {}),
    ...(query.hasPricing === false ? { pricingProposals: { none: { status: { in: ["APPROVED", "OVERRIDDEN"] } } } } : {}),
    ...(query.hasFitment === true ? { fitmentApplications: { some: { status: "APPROVED" } } } : {}),
    ...(query.hasFitment === false ? { fitmentApplications: { none: { status: "APPROVED" } } } : {}),
    ...(query.hasDraft === true || (query.hasDraft === undefined && hasDraftFilter) ? { listingDrafts: { some: draftFilter } } : {}),
    ...(query.hasDraft === false ? { listingDrafts: { none: hasDraftFilter ? draftFilter : {} } } : {}),
    ...(query.createdFrom || query.createdTo ? {
      createdAt: { ...(query.createdFrom ? { gte: query.createdFrom } : {}), ...(query.createdTo ? { lte: query.createdTo } : {}) },
    } : {}),
    ...(q ? {
      OR: (() => {
        // Identifier-like queries skip brand/title/VIN ILIKE scans — those dominate list latency.
        const looksLikeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,64}$/.test(q) && !/\s/.test(q);
        if (looksLikeIdentifier) {
          return [
            { sku: { contains: q, mode: "insensitive" as const } },
            { primaryPartNumber: { contains: q, mode: "insensitive" as const } },
            { normalizedSku: { contains: q.toUpperCase() } },
            { normalizedPartNumber: { contains: normalizePartNumber(q) || q.toUpperCase() } },
            { partNumbers: { some: { value: { contains: q, mode: "insensitive" as const } } } },
          ];
        }
        return [
          { sku: { contains: q, mode: "insensitive" as const } },
          { primaryPartNumber: { contains: q, mode: "insensitive" as const } },
          { brand: { contains: q, mode: "insensitive" as const } },
          { partName: { contains: q, mode: "insensitive" as const } },
          { partNumbers: { some: { value: { contains: q, mode: "insensitive" as const } } } },
          { donorVehicle: { vin: { contains: q, mode: "insensitive" as const } } },
        ];
      })(),
    } : {}),
  };
}

function catalogOrderBy(sort: CatalogQuery["sort"]): Prisma.PartOrderByWithRelationInput {
  if (sort === "oldest") return { createdAt: "asc" };
  if (sort === "updated") return { updatedAt: "desc" };
  if (sort === "sku") return { normalizedSku: "asc" };
  return { createdAt: "desc" };
}

const catalogCardSelect = {
  id: true,
  sku: true,
  primaryPartNumber: true,
  brand: true,
  partName: true,
  condition: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  inventoryItem: {
    select: {
      quantity: true,
      cost: true,
      currency: true,
    },
  },
  media: {
    orderBy: { displayOrder: "asc" as const },
    take: 1,
    select: { mediaAsset: { select: { id: true } } },
  },
  _count: { select: { media: true } },
} satisfies Prisma.PartSelect;

type CatalogMetaCache = {
  expiresAt: number;
  warehouses: Array<{ id: string; code: string; name: string }>;
  summary: { total: number; byStatus: Record<string, number> };
};

const catalogMetaCache = new Map<string, CatalogMetaCache>();
const CATALOG_META_TTL_MS = 60_000;

export async function listCatalogParts(organizationId: string, query: CatalogQuery) {
  const where = buildCatalogWhere(organizationId, query);
  const cachedMeta = catalogMetaCache.get(organizationId);
  const metaFresh = cachedMeta && cachedMeta.expiresAt > Date.now();

  // Read-only fan-out: avoid serial $transaction round-trips (painful on remote Neon).
  const [parts, total, statusCounts, warehouses] = await Promise.all([
    prisma.part.findMany({
      where,
      orderBy: catalogOrderBy(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: catalogCardSelect,
    }),
    prisma.part.count({ where }),
    metaFresh
      ? Promise.resolve(null)
      : prisma.part.groupBy({ by: ["status"], where: { organizationId }, orderBy: { status: "asc" }, _count: { _all: true } }),
    metaFresh
      ? Promise.resolve(cachedMeta.warehouses)
      : prisma.warehouse.findMany({ where: { organizationId }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const partIds = parts.map((part) => part.id);
  const latestPricing = partIds.length
    ? await prisma.pricingJobItem.findMany({
        where: {
          organizationId,
          partId: { in: partIds },
          status: { in: ["COMPLETED", "NO_MATCHES"] },
        },
        orderBy: [{ partId: "asc" }, { completedAt: "desc" }],
        distinct: ["partId"],
        select: {
          id: true,
          partId: true,
          status: true,
          competitorCount: true,
          recommendedPrice: true,
          currency: true,
          completedAt: true,
          pricingJob: { select: { marketplace: true } },
        },
      })
    : [];
  const pricingByPartId = new Map(latestPricing.map((item) => [item.partId, item]));

  let summary: CatalogMetaCache["summary"];
  let resolvedWarehouses: CatalogMetaCache["warehouses"];
  if (metaFresh && cachedMeta) {
    summary = cachedMeta.summary;
    resolvedWarehouses = cachedMeta.warehouses;
  } else {
    const statusEntries = (statusCounts ?? []).map((group) => [group.status, typeof group._count === "object" ? group._count._all ?? 0 : 0] as const);
    summary = {
      total: statusEntries.reduce((sum, [, count]) => sum + count, 0),
      byStatus: Object.fromEntries(statusEntries),
    };
    resolvedWarehouses = warehouses ?? [];
    catalogMetaCache.set(organizationId, {
      expiresAt: Date.now() + CATALOG_META_TTL_MS,
      warehouses: resolvedWarehouses,
      summary,
    });
  }

  return {
    parts: parts.map((part) => {
      const pricing = pricingByPartId.get(part.id);
      return {
        ...part,
        inventoryItem: part.inventoryItem
          ? { ...part.inventoryItem, warehouse: null, binLocation: null }
          : null,
        donorVehicle: null,
        fitmentJobItems: [],
        pricingJobItems: pricing
          ? [{
              id: pricing.id,
              status: pricing.status,
              competitorCount: pricing.competitorCount,
              recommendedPrice: pricing.recommendedPrice,
              currency: pricing.currency,
              completedAt: pricing.completedAt,
              pricingJob: pricing.pricingJob,
            }]
          : [],
      };
    }),
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) || 0 },
    summary,
    warehouses: resolvedWarehouses,
  };
}

export async function getCatalogPart(organizationId: string, partId: string) {
  const part = await prisma.part.findFirst({
    where: { id: partId, organizationId },
    select: {
      id: true,
      sku: true,
      primaryPartNumber: true,
      brand: true,
      partName: true,
      description: true,
      condition: true,
      status: true,
      placement: true,
      notes: true,
      donorMileage: true,
      donorColor: true,
      createdAt: true,
      updatedAt: true,
      donorVehicle: {
        select: { vin: true, year: true, make: true, model: true, trim: true, engine: true },
      },
      partNumbers: {
        orderBy: [{ type: "asc" }, { value: "asc" }],
        take: 20,
        select: { id: true, type: true, value: true },
      },
      inventoryItem: {
        select: {
          quantity: true,
          cost: true,
          currency: true,
          weight: true,
          weightUnit: true,
          length: true,
          width: true,
          height: true,
          dimensionUnit: true,
          warehouse: { select: { id: true, code: true, name: true } },
          binLocation: { select: { id: true, code: true } },
        },
      },
      media: {
        orderBy: { displayOrder: "asc" },
        take: 12,
        select: {
          id: true,
          displayOrder: true,
          mediaAsset: { select: { id: true, originalFilename: true, mimeType: true } },
        },
      },
      fitmentApplications: {
        where: { status: "APPROVED" },
        orderBy: { approvedAt: "desc" },
        take: 12,
        select: {
          id: true,
          marketplace: true,
          properties: true,
          source: true,
          approvedAt: true,
        },
      },
      listingDrafts: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          marketplace: true,
          status: true,
          title: true,
          categoryId: true,
          shippingPolicyId: true,
          price: true,
          currency: true,
          updatedAt: true,
        },
      },
      _count: { select: { media: true } },
    },
  });
  if (!part) throw new CatalogError("Catalog part not found", 404);

  let description = part.description;
  if (!isListingDescriptionTemplate(description)) {
    const fitmentRows = await prisma.fitmentApplication.findMany({
      where: { partId: part.id, status: "APPROVED" },
      select: { properties: true },
      take: 120,
    });
    const applications = fitmentRows.flatMap(({ properties }) => {
      if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
      return [Object.fromEntries(Object.entries(properties).flatMap(([key, value]) =>
        typeof value === "string" && value.trim() ? [[key, value.trim()]] : [],
      ))];
    });
    const title = part.listingDrafts[0]?.title?.trim() || buildEbayListingTitle({
      brand: part.brand,
      partName: part.partName,
      primaryPartNumber: part.primaryPartNumber,
      condition: part.condition,
      placement: part.placement,
      fitmentApplications: applications,
    });
    const notes = description?.trim() || null;
    description = buildListingDescriptionHtml({
      title,
      partName: part.partName,
      primaryPartNumber: part.primaryPartNumber,
      condition: part.condition,
      brand: part.brand,
      notes,
      fitmentApplications: applications,
    });
    await prisma.part.update({ where: { id: part.id }, data: { description } });
  }

  return {
    ...part,
    description,
    pricingJobItems: [],
    fitmentJobItems: [],
  };
}

export interface CatalogPartUpdate {
  sku?: string;
  primaryPartNumber?: string;
  brand?: string | null;
  partName?: string | null;
  description?: string | null;
  condition?: PartCondition;
  status?: CatalogPartStatus;
  donorMileage?: number | null;
  donorColor?: string | null;
  placement?: string | null;
  notes?: string | null;
  inventory?: {
    quantity?: number;
    cost?: number;
    currency?: string;
    warehouseCode?: string | null;
    binLocation?: string | null;
    weight?: number | null;
    weightUnit?: "LB" | "KG" | null;
    length?: number | null;
    width?: number | null;
    height?: number | null;
    dimensionUnit?: "IN" | "CM" | null;
  };
}

export async function updateCatalogPart(organizationId: string, partId: string, input: CatalogPartUpdate) {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.part.findFirst({
        where: { id: partId, organizationId },
        select: {
          id: true,
          primaryPartNumber: true,
          normalizedPartNumber: true,
          inventoryItem: { select: { id: true, warehouseId: true, weight: true, weightUnit: true, length: true, width: true, height: true, dimensionUnit: true } },
        },
      });
      if (!existing) throw new CatalogError("Catalog part not found", 404);

      let warehouseId: string | null | undefined;
      let binLocationId: string | null | undefined;
      if (input.inventory && "warehouseCode" in input.inventory) {
        const code = input.inventory.warehouseCode?.trim().toUpperCase() || null;
        if (code) {
          const warehouse = await tx.warehouse.upsert({
            where: { organizationId_code: { organizationId, code } },
            create: { organizationId, code, name: code },
            update: {},
            select: { id: true },
          });
          warehouseId = warehouse.id;
          const binCode = input.inventory.binLocation?.trim() || null;
          if (binCode) {
            const bin = await tx.binLocation.upsert({
              where: { warehouseId_code: { warehouseId: warehouse.id, code: binCode } },
              create: { organizationId, warehouseId: warehouse.id, code: binCode },
              update: {},
              select: { id: true },
            });
            binLocationId = bin.id;
          } else binLocationId = null;
        } else {
          warehouseId = null;
          binLocationId = null;
        }
      }

      const primaryPartNumber = input.primaryPartNumber?.trim();
      const normalizedPartNumber = primaryPartNumber ? normalizePartNumber(primaryPartNumber) : undefined;
      await tx.part.update({
        where: { id: partId },
        data: {
          ...(input.sku ? { sku: input.sku.trim(), normalizedSku: input.sku.trim().toUpperCase() } : {}),
          ...(primaryPartNumber ? { primaryPartNumber, normalizedPartNumber } : {}),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.partName !== undefined ? { partName: input.partName } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.condition ? { condition: input.condition } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.donorMileage !== undefined ? { donorMileage: input.donorMileage } : {}),
          ...(input.donorColor !== undefined ? { donorColor: input.donorColor } : {}),
          ...(input.placement !== undefined ? { placement: input.placement } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      });
      if (primaryPartNumber && normalizedPartNumber) {
        const primary = await tx.partNumber.findFirst({ where: { partId, type: "PRIMARY" }, select: { id: true } });
        if (primary) await tx.partNumber.update({ where: { id: primary.id }, data: { value: primaryPartNumber, normalizedValue: normalizedPartNumber } });
        else await tx.partNumber.create({ data: { organizationId, partId, type: "PRIMARY", value: primaryPartNumber, normalizedValue: normalizedPartNumber } });
      }
      if (input.inventory) {
        if (!existing.inventoryItem) throw new CatalogError("Part inventory record is missing", 409);
        const inventory = input.inventory;
        const finalWeight = inventory.weight !== undefined ? inventory.weight : existing.inventoryItem.weight;
        const finalWeightUnit = inventory.weightUnit !== undefined ? inventory.weightUnit : existing.inventoryItem.weightUnit;
        if ((finalWeight !== null) !== (finalWeightUnit !== null)) throw new CatalogError("Weight and weight unit must be supplied or cleared together");
        const finalDimensions = [
          inventory.length !== undefined ? inventory.length : existing.inventoryItem.length,
          inventory.width !== undefined ? inventory.width : existing.inventoryItem.width,
          inventory.height !== undefined ? inventory.height : existing.inventoryItem.height,
        ];
        const finalDimensionUnit = inventory.dimensionUnit !== undefined ? inventory.dimensionUnit : existing.inventoryItem.dimensionUnit;
        if (finalDimensions.some((value) => value !== null) !== (finalDimensionUnit !== null)) {
          throw new CatalogError("Dimensions and dimension unit must be supplied or cleared together");
        }
        await tx.inventoryItem.update({
          where: { partId },
          data: {
            ...(inventory.quantity !== undefined ? { quantity: inventory.quantity } : {}),
            ...(inventory.cost !== undefined ? { cost: new Prisma.Decimal(inventory.cost) } : {}),
            ...(inventory.currency ? { currency: inventory.currency } : {}),
            ...(warehouseId !== undefined ? { warehouseId } : {}),
            ...(binLocationId !== undefined ? { binLocationId } : {}),
            ...(inventory.weight !== undefined ? { weight: inventory.weight === null ? null : new Prisma.Decimal(inventory.weight) } : {}),
            ...(inventory.weightUnit !== undefined ? { weightUnit: inventory.weightUnit } : {}),
            ...(inventory.length !== undefined ? { length: inventory.length === null ? null : new Prisma.Decimal(inventory.length) } : {}),
            ...(inventory.width !== undefined ? { width: inventory.width === null ? null : new Prisma.Decimal(inventory.width) } : {}),
            ...(inventory.height !== undefined ? { height: inventory.height === null ? null : new Prisma.Decimal(inventory.height) } : {}),
            ...(inventory.dimensionUnit !== undefined ? { dimensionUnit: inventory.dimensionUnit } : {}),
          },
        });
      }
    });
    return getCatalogPart(organizationId, partId);
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CatalogError("SKU or part number conflicts with another catalog record", 409);
    throw error;
  }
}

export async function bulkUpdateCatalogStatus(organizationId: string, partIds: string[], status: CatalogPartStatus) {
  return prisma.$transaction(async (tx) => {
    const count = await tx.part.count({ where: { organizationId, id: { in: partIds } } });
    if (count !== partIds.length) throw new CatalogError("One or more selected parts were not found", 404);
    const result = await tx.part.updateMany({ where: { organizationId, id: { in: partIds } }, data: { status } });
    return { updated: result.count, status };
  });
}

export interface CatalogBulkUpdate {
  status?: CatalogPartStatus;
  condition?: PartCondition;
  placement?: string | null;
  quantity?: number;
  warehouseCode?: string | null;
  binLocation?: string | null;
}

export async function bulkUpdateCatalogParts(
  organizationId: string,
  userId: string,
  partIds: string[],
  changes: CatalogBulkUpdate,
) {
  return prisma.$transaction(async (tx) => {
    const parts = await tx.part.findMany({
      where: { organizationId, id: { in: partIds } },
      select: { id: true, inventoryItem: { select: { id: true } } },
    });
    if (parts.length !== partIds.length) throw new CatalogError("One or more selected parts were not found", 404);
    if (changes.quantity !== undefined && parts.some(({ inventoryItem }) => !inventoryItem)) {
      throw new CatalogError("One or more selected parts do not have inventory records", 409);
    }

    let warehouseId: string | null | undefined;
    let binLocationId: string | null | undefined;
    if (changes.warehouseCode !== undefined) {
      const warehouseCode = changes.warehouseCode?.trim().toUpperCase() || null;
      if (warehouseCode) {
        const warehouse = await tx.warehouse.upsert({
          where: { organizationId_code: { organizationId, code: warehouseCode } },
          create: { organizationId, code: warehouseCode, name: warehouseCode },
          update: {},
          select: { id: true },
        });
        warehouseId = warehouse.id;
        const binCode = changes.binLocation?.trim() || null;
        if (binCode) {
          const bin = await tx.binLocation.upsert({
            where: { warehouseId_code: { warehouseId: warehouse.id, code: binCode } },
            create: { organizationId, warehouseId: warehouse.id, code: binCode },
            update: {},
            select: { id: true },
          });
          binLocationId = bin.id;
        } else {
          binLocationId = null;
        }
      } else {
        warehouseId = null;
        binLocationId = null;
      }
    }

    if (changes.status || changes.condition || changes.placement !== undefined) {
      await tx.part.updateMany({
        where: { organizationId, id: { in: partIds } },
        data: {
          ...(changes.status ? { status: changes.status } : {}),
          ...(changes.condition ? { condition: changes.condition } : {}),
          ...(changes.placement !== undefined ? { placement: changes.placement } : {}),
        },
      });
    }
    if (changes.quantity !== undefined || warehouseId !== undefined) {
      await tx.inventoryItem.updateMany({
        where: { organizationId, partId: { in: partIds } },
        data: {
          ...(changes.quantity !== undefined ? { quantity: changes.quantity } : {}),
          ...(warehouseId !== undefined ? { warehouseId, binLocationId } : {}),
        },
      });
    }

    const invalidatedDrafts = await invalidateListingDraftsForCatalogChanges(
      tx,
      organizationId,
      userId,
      partIds,
      Object.keys(changes),
    );
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "catalog.parts.bulk_updated",
      resourceType: "Part",
      severity: "INFO",
      summary: `Bulk-updated ${parts.length} catalog parts`,
      metadata: JSON.parse(JSON.stringify({ partIds, changes, invalidatedDrafts })) as Prisma.InputJsonObject,
    });
    return { updated: parts.length, invalidatedDrafts };
  });
}

export async function deleteCatalogParts(organizationId: string, userId: string, partIds: string[]) {
  const uniqueIds = [...new Set(partIds)];
  return prisma.$transaction(async (tx) => {
    const parts = await tx.part.findMany({
      where: { organizationId, id: { in: uniqueIds } },
      select: { id: true, sku: true },
    });
    if (parts.length !== uniqueIds.length) {
      throw new CatalogError("One or more selected parts were not found", 404);
    }
    const result = await tx.part.deleteMany({
      where: { organizationId, id: { in: uniqueIds } },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "catalog.parts.deleted",
      resourceType: "Part",
      severity: "WARNING",
      summary: `Deleted ${result.count} catalog part${result.count === 1 ? "" : "s"}`,
      metadata: {
        partIds: parts.map(({ id }) => id),
        skus: parts.map(({ sku }) => sku),
        deleted: result.count,
      } as Prisma.InputJsonObject,
    });
    return { deleted: result.count };
  });
}

export function formatCatalogCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportCatalogCsv(organizationId: string, query: Omit<CatalogQuery, "page" | "pageSize">) {
  const parts = await prisma.part.findMany({
    where: buildCatalogWhere(organizationId, query),
    orderBy: catalogOrderBy(query.sort),
    take: 5_000,
    select: {
      sku: true, primaryPartNumber: true, brand: true, partName: true, condition: true, status: true, createdAt: true,
      donorVehicle: { select: { vin: true } },
      inventoryItem: { select: { quantity: true, cost: true, currency: true, warehouse: { select: { code: true } }, binLocation: { select: { code: true } } } },
      _count: { select: { media: true } },
    },
  });
  const headers = ["SKU", "PartNumber", "Brand", "PartName", "Condition", "Status", "VIN", "Quantity", "Cost", "Currency", "Warehouse", "BinLocation", "Images", "CreatedAt"];
  const rows = parts.map((part) => [
    part.sku, part.primaryPartNumber, part.brand, part.partName, part.condition, part.status, part.donorVehicle?.vin,
    part.inventoryItem?.quantity, part.inventoryItem?.cost, part.inventoryItem?.currency, part.inventoryItem?.warehouse?.code,
    part.inventoryItem?.binLocation?.code, part._count.media, part.createdAt.toISOString(),
  ]);
  return [headers, ...rows].map((row) => row.map(formatCatalogCsvCell).join(",")).join("\r\n") + "\r\n";
}
