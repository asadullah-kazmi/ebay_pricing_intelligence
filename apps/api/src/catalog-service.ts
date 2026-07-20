import { Prisma, type CatalogPartStatus, type PartCondition } from "@prisma/client";
import { prisma } from "./db.js";
import { normalizePartNumber } from "./domain/matching.js";

export class CatalogError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "CatalogError";
  }
}

export interface CatalogQuery {
  q?: string;
  status?: CatalogPartStatus;
  condition?: PartCondition;
  hasImages?: boolean;
  warehouseId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  sort: "newest" | "oldest" | "updated" | "sku";
  page: number;
  pageSize: number;
}

export function buildCatalogWhere(organizationId: string, query: Omit<CatalogQuery, "page" | "pageSize" | "sort">): Prisma.PartWhereInput {
  const q = query.q?.trim();
  return {
    organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.condition ? { condition: query.condition } : {}),
    ...(query.hasImages === true ? { media: { some: {} } } : {}),
    ...(query.hasImages === false ? { media: { none: {} } } : {}),
    ...(query.warehouseId ? { inventoryItem: { warehouseId: query.warehouseId } } : {}),
    ...(query.createdFrom || query.createdTo ? {
      createdAt: { ...(query.createdFrom ? { gte: query.createdFrom } : {}), ...(query.createdTo ? { lte: query.createdTo } : {}) },
    } : {}),
    ...(q ? {
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { primaryPartNumber: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { partName: { contains: q, mode: "insensitive" } },
        { partNumbers: { some: { value: { contains: q, mode: "insensitive" } } } },
        { donorVehicle: { vin: { contains: q, mode: "insensitive" } } },
      ],
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
  donorVehicle: { select: { vin: true, year: true, make: true, model: true } },
  inventoryItem: {
    select: {
      quantity: true, cost: true, currency: true,
      warehouse: { select: { id: true, code: true, name: true } },
      binLocation: { select: { id: true, code: true } },
    },
  },
  media: {
    orderBy: { displayOrder: "asc" as const },
    take: 1,
    select: { mediaAsset: { select: { id: true, mimeType: true, width: true, height: true } } },
  },
  _count: { select: { media: true } },
} satisfies Prisma.PartSelect;

export async function listCatalogParts(organizationId: string, query: CatalogQuery) {
  const where = buildCatalogWhere(organizationId, query);
  const [parts, total, statusCounts, warehouses] = await prisma.$transaction([
    prisma.part.findMany({
      where,
      orderBy: catalogOrderBy(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: catalogCardSelect,
    }),
    prisma.part.count({ where }),
    prisma.part.groupBy({ by: ["status"], where: { organizationId }, orderBy: { status: "asc" }, _count: { _all: true } }),
    prisma.warehouse.findMany({ where: { organizationId }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const statusEntries = statusCounts.map((group) => [group.status, typeof group._count === "object" ? group._count._all ?? 0 : 0] as const);
  return {
    parts,
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    summary: {
      total: statusEntries.reduce((sum, [, count]) => sum + count, 0),
      byStatus: Object.fromEntries(statusEntries),
    },
    warehouses,
  };
}

export async function getCatalogPart(organizationId: string, partId: string) {
  const part = await prisma.part.findFirst({
    where: { id: partId, organizationId },
    include: {
      donorVehicle: true,
      partNumbers: { orderBy: [{ type: "asc" }, { value: "asc" }] },
      inventoryItem: { include: { warehouse: true, binLocation: true } },
      media: {
        orderBy: { displayOrder: "asc" },
        include: { mediaAsset: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true, width: true, height: true, status: true } } },
      },
      sourceImportRow: { select: { importBatchId: true, rowNumber: true } },
    },
  });
  if (!part) throw new CatalogError("Catalog part not found", 404);
  return part;
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
