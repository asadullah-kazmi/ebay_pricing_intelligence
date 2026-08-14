import { prisma } from "./db.js";
import { Prisma } from "@prisma/client";
import type { Marketplace } from "./types.js";
import {
  bulkUpdatePriceQuantity,
  getInventoryItemsPage,
  getOffersPage,
  withdrawOffer,
  type EbayInventoryItemSummary,
  type EbayOfferSummary,
} from "./providers/ebay-inventory.js";
import { EbayApiError } from "./providers/ebay.js";

export class EbayInventoryManagementError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "EbayInventoryManagementError";
  }
}

const runningInventoryCacheRefreshes = new Map<string, Promise<unknown>>();

export type EbayInventoryStockFilter = "ALL" | "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
export type EbayInventoryOfferFilter = "ALL" | "PUBLISHED" | "UNPUBLISHED" | "ENDED";

export interface EbayInventoryRow {
  key: string;
  account: {
    id: string;
    username: string | null;
    isDefault: boolean;
    marketplace: Marketplace;
  };
  sku: string;
  title: string | null;
  condition: string | null;
  quantity: number | null;
  price: number | null;
  currency: string | null;
  offerId: string | null;
  offerStatus: string | null;
  listingId: string | null;
  listingStatus: string | null;
  listingOnHold: boolean;
  categoryId: string | null;
  imageUrl: string | null;
  inventoryPayload: Record<string, unknown> | null;
  offerPayload: Record<string, unknown> | null;
  syncedAt: string;
}

type ActiveConnection = {
  id: string;
  username: string | null;
  isDefault: boolean;
  defaultMarketplace: string;
};

function asMarketplace(value: string | null | undefined): Marketplace {
  if (value === "EBAY_GB" || value === "EBAY_DE") return value;
  return "EBAY_US";
}

function firstImage(product: Record<string, unknown>): string | null {
  const imageUrls = product.imageUrls;
  if (Array.isArray(imageUrls)) {
    const first = imageUrls.find((value) => typeof value === "string" && value.trim());
    if (typeof first === "string") return first;
  }
  const image = product.image;
  if (typeof image === "object" && image !== null && typeof (image as Record<string, unknown>).imageUrl === "string") {
    return (image as { imageUrl: string }).imageUrl;
  }
  return null;
}

function mergeRows(input: {
  account: EbayInventoryRow["account"];
  inventoryItems: EbayInventoryItemSummary[];
  offers: EbayOfferSummary[];
  syncedAt?: Date;
}) {
  const rows = new Map<string, EbayInventoryRow>();
  const syncedAt = (input.syncedAt ?? new Date()).toISOString();
  for (const item of input.inventoryItems) {
    rows.set(item.sku, {
      key: `${input.account.id}:${item.sku}`,
      account: input.account,
      sku: item.sku,
      title: item.title,
      condition: item.condition,
      quantity: item.totalQuantity,
      price: null,
      currency: null,
      offerId: null,
      offerStatus: null,
      listingId: null,
      listingStatus: null,
      listingOnHold: false,
      categoryId: null,
      imageUrl: firstImage(item.product),
      inventoryPayload: item.payload,
      offerPayload: null,
      syncedAt,
    });
  }
  for (const offer of input.offers) {
    const sku = offer.sku ?? offer.offerId;
    const existing = rows.get(sku);
    rows.set(sku, {
      key: `${input.account.id}:${sku}:${offer.offerId}`,
      account: input.account,
      sku,
      title: existing?.title ?? null,
      condition: existing?.condition ?? null,
      quantity: offer.availableQuantity ?? existing?.quantity ?? null,
      price: offer.priceValue,
      currency: offer.priceCurrency,
      offerId: offer.offerId,
      offerStatus: offer.status,
      listingId: offer.listingId,
      listingStatus: offer.listingStatus,
      listingOnHold: offer.listingOnHold,
      categoryId: offer.categoryId,
      imageUrl: existing?.imageUrl ?? null,
      inventoryPayload: existing?.inventoryPayload ?? null,
      offerPayload: offer.payload,
      syncedAt,
    });
  }
  return [...rows.values()];
}

function toJson(value: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value ? value as Prisma.InputJsonValue : Prisma.JsonNull;
}

function cachedRowToInventoryRow(row: {
  id: string;
  ebaySellerConnectionId: string;
  marketplace: string;
  sku: string;
  title: string | null;
  condition: string | null;
  quantity: number | null;
  price: Prisma.Decimal | null;
  currency: string | null;
  offerId: string | null;
  offerStatus: string | null;
  listingId: string | null;
  listingStatus: string | null;
  listingOnHold: boolean;
  categoryId: string | null;
  imageUrl: string | null;
  inventoryPayload: Prisma.JsonValue | null;
  offerPayload: Prisma.JsonValue | null;
  syncedAt: Date;
  ebaySellerConnection: { id: string; username: string | null; isDefault: boolean; defaultMarketplace: string };
}): EbayInventoryRow {
  return {
    key: row.id,
    account: {
      id: row.ebaySellerConnection.id,
      username: row.ebaySellerConnection.username,
      isDefault: row.ebaySellerConnection.isDefault,
      marketplace: asMarketplace(row.marketplace || row.ebaySellerConnection.defaultMarketplace),
    },
    sku: row.sku,
    title: row.title,
    condition: row.condition,
    quantity: row.quantity,
    price: row.price == null ? null : Number(row.price),
    currency: row.currency,
    offerId: row.offerId,
    offerStatus: row.offerStatus,
    listingId: row.listingId,
    listingStatus: row.listingStatus,
    listingOnHold: row.listingOnHold,
    categoryId: row.categoryId,
    imageUrl: row.imageUrl,
    inventoryPayload: typeof row.inventoryPayload === "object" && row.inventoryPayload !== null && !Array.isArray(row.inventoryPayload)
      ? row.inventoryPayload as Record<string, unknown>
      : null,
    offerPayload: typeof row.offerPayload === "object" && row.offerPayload !== null && !Array.isArray(row.offerPayload)
      ? row.offerPayload as Record<string, unknown>
      : null,
    syncedAt: row.syncedAt.toISOString(),
  };
}

async function collectPages<T>(fetchPage: (offset: number) => Promise<{ total: number; size: number; limit: number } & T>, pick: (page: T) => unknown[]) {
  const limit = 100;
  let offset = 0;
  const output: unknown[] = [];
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await fetchPage(offset);
    output.push(...pick(page));
    const nextOffset = offset + page.limit;
    if (page.size <= 0 || nextOffset >= page.total) break;
    offset = nextOffset;
  }
  return output;
}

async function collectOffersForInventoryItems(input: {
  organizationId: string;
  connectionId: string;
  marketplace: Marketplace;
  inventoryItems: EbayInventoryItemSummary[];
  errors: Array<{ connectionId: string; username: string | null; message: string }>;
  username: string | null;
}) {
  const offers: EbayOfferSummary[] = [];
  const skus = [...new Set(input.inventoryItems.map((item) => item.sku).filter(Boolean))];
  const batchSize = 5;
  for (let index = 0; index < skus.length; index += batchSize) {
    const batch = skus.slice(index, index + batchSize);
    const results = await Promise.allSettled(batch.map((sku) =>
      getOffersPage({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        marketplace: input.marketplace,
        sku,
      }),
    ));
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") {
        offers.push(...result.value.offers);
        return;
      }
      if (result.reason instanceof EbayApiError && result.reason.status === 404) {
        return;
      }
      const sku = batch[resultIndex];
      input.errors.push({
        connectionId: input.connectionId,
        username: input.username,
        message: `Offer lookup skipped for ${sku}: ${result.reason instanceof Error ? result.reason.message : "Unable to load offer"}`,
      });
    });
  }
  return offers;
}

async function listActiveConnections(input: { organizationId: string; connectionId?: string }) {
  const connections = await prisma.ebaySellerConnection.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      ...(input.connectionId ? { id: input.connectionId } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { username: "asc" }, { createdAt: "asc" }],
    select: { id: true, username: true, isDefault: true, defaultMarketplace: true },
  });
  if (input.connectionId && connections.length === 0) throw new EbayInventoryManagementError("Connected eBay account not found", 404);
  return connections;
}

function applyInventoryFilters(rows: EbayInventoryRow[], input: {
  q?: string;
  stock?: EbayInventoryStockFilter;
  offerStatus?: EbayInventoryOfferFilter;
}) {
  const query = input.q?.trim().toLowerCase() ?? "";
  const stock = input.stock ?? "ALL";
  const offerStatus = input.offerStatus ?? "ALL";
  return rows.filter((row) => {
    if (query && ![row.sku, row.title, row.condition, row.listingId, row.account.username].some((value) => value?.toLowerCase().includes(query))) return false;
    if (stock === "IN_STOCK" && (row.quantity ?? 0) <= 5) return false;
    if (stock === "LOW_STOCK" && !((row.quantity ?? 0) > 0 && (row.quantity ?? 0) <= 5)) return false;
    if (stock === "OUT_OF_STOCK" && (row.quantity ?? 0) > 0) return false;
    const normalizedStatus = (row.offerStatus ?? row.listingStatus ?? "").toUpperCase();
    if (offerStatus === "PUBLISHED" && !["PUBLISHED", "ACTIVE"].includes(normalizedStatus)) return false;
    if (offerStatus === "UNPUBLISHED" && !["UNPUBLISHED", "DRAFT", ""].includes(normalizedStatus)) return false;
    if (offerStatus === "ENDED" && !["ENDED", "WITHDRAWN"].includes(normalizedStatus)) return false;
    return true;
  });
}

function shapeInventoryResponse(input: {
  connections: ActiveConnection[];
  rows: EbayInventoryRow[];
  errors?: Array<{ connectionId: string; username: string | null; message: string }>;
  page?: number;
  pageSize?: number;
  q?: string;
  stock?: EbayInventoryStockFilter;
  offerStatus?: EbayInventoryOfferFilter;
}) {
  const filtered = applyInventoryFilters(input.rows, input);
  filtered.sort((a, b) => Number(Boolean(b.listingId)) - Number(Boolean(a.listingId)) || a.sku.localeCompare(b.sku));
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const pageRows = filtered.slice(offset, offset + pageSize);
  const lastSyncedAt = input.rows
    .map((row) => row.syncedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const summary = {
    total: input.rows.length,
    filtered: filtered.length,
    connectedAccounts: input.connections.length,
    published: input.rows.filter((row) => ["PUBLISHED", "ACTIVE"].includes((row.offerStatus ?? row.listingStatus ?? "").toUpperCase())).length,
    unpublished: input.rows.filter((row) => ["UNPUBLISHED", "DRAFT", ""].includes((row.offerStatus ?? row.listingStatus ?? "").toUpperCase())).length,
    lowStock: input.rows.filter((row) => (row.quantity ?? 0) > 0 && (row.quantity ?? 0) <= 5).length,
    outOfStock: input.rows.filter((row) => (row.quantity ?? 0) <= 0).length,
  };
  return {
    accounts: input.connections.map((connection) => ({
      id: connection.id,
      username: connection.username,
      isDefault: connection.isDefault,
      marketplace: asMarketplace(connection.defaultMarketplace),
    })),
    items: pageRows,
    pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
    summary,
    errors: input.errors ?? [],
    syncedAt: lastSyncedAt,
  };
}

export async function listEbayStoreInventory(input: {
  organizationId: string;
  connectionId?: string;
  q?: string;
  stock?: EbayInventoryStockFilter;
  offerStatus?: EbayInventoryOfferFilter;
  page?: number;
  pageSize?: number;
}) {
  const connections = await listActiveConnections({ organizationId: input.organizationId, connectionId: input.connectionId });
  const cached = await prisma.ebayInventoryCacheItem.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.connectionId ? { ebaySellerConnectionId: input.connectionId } : {}),
    },
    include: { ebaySellerConnection: { select: { id: true, username: true, isDefault: true, defaultMarketplace: true } } },
  });
  return shapeInventoryResponse({ ...input, connections, rows: cached.map(cachedRowToInventoryRow) });
}

export async function syncEbayStoreInventory(input: {
  organizationId: string;
  connectionId?: string;
  q?: string;
  stock?: EbayInventoryStockFilter;
  offerStatus?: EbayInventoryOfferFilter;
  page?: number;
  pageSize?: number;
}) {
  const connections = await listActiveConnections({ organizationId: input.organizationId, connectionId: input.connectionId });
  const errors: Array<{ connectionId: string; username: string | null; message: string }> = [];
  const refreshedRows: EbayInventoryRow[] = [];
  for (const connection of connections) {
    const marketplace = asMarketplace(connection.defaultMarketplace);
    const account = { id: connection.id, username: connection.username, isDefault: connection.isDefault, marketplace };
    const syncStartedAt = new Date();
    try {
      const inventoryItems = await collectPages(
        (offset) => getInventoryItemsPage({ organizationId: input.organizationId, connectionId: connection.id, marketplace, limit: 100, offset }),
        (page) => page.inventoryItems,
      ) as EbayInventoryItemSummary[];
      const offers = await collectOffersForInventoryItems({
        organizationId: input.organizationId,
        connectionId: connection.id,
        marketplace,
        inventoryItems,
        errors,
        username: connection.username,
      });
      const rows = mergeRows({ account, inventoryItems, offers, syncedAt: syncStartedAt });
      for (const row of rows) {
        await prisma.ebayInventoryCacheItem.upsert({
          where: {
            ebaySellerConnectionId_marketplace_sku: {
              ebaySellerConnectionId: connection.id,
              marketplace,
              sku: row.sku,
            },
          },
          update: {
            title: row.title,
            condition: row.condition,
            quantity: row.quantity,
            price: row.price,
            currency: row.currency,
            offerId: row.offerId,
            offerStatus: row.offerStatus,
            listingId: row.listingId,
            listingStatus: row.listingStatus,
            listingOnHold: row.listingOnHold,
            categoryId: row.categoryId,
            imageUrl: row.imageUrl,
            inventoryPayload: toJson(row.inventoryPayload),
            offerPayload: toJson(row.offerPayload),
            syncedAt: syncStartedAt,
          },
          create: {
            organizationId: input.organizationId,
            ebaySellerConnectionId: connection.id,
            marketplace,
            sku: row.sku,
            title: row.title,
            condition: row.condition,
            quantity: row.quantity,
            price: row.price,
            currency: row.currency,
            offerId: row.offerId,
            offerStatus: row.offerStatus,
            listingId: row.listingId,
            listingStatus: row.listingStatus,
            listingOnHold: row.listingOnHold,
            categoryId: row.categoryId,
            imageUrl: row.imageUrl,
            inventoryPayload: toJson(row.inventoryPayload),
            offerPayload: toJson(row.offerPayload),
            syncedAt: syncStartedAt,
          },
        });
      }
      await prisma.ebayInventoryCacheItem.deleteMany({
        where: {
          organizationId: input.organizationId,
          ebaySellerConnectionId: connection.id,
          marketplace,
          syncedAt: { lt: syncStartedAt },
        },
      });
      refreshedRows.push(...rows);
    } catch (error) {
      errors.push({
        connectionId: connection.id,
        username: connection.username,
        message: error instanceof Error ? error.message : "Unable to sync eBay inventory",
      });
    }
  }
  if (refreshedRows.length > 0) {
    return shapeInventoryResponse({ ...input, connections, rows: refreshedRows, errors });
  }
  const cached = await prisma.ebayInventoryCacheItem.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.connectionId ? { ebaySellerConnectionId: input.connectionId } : {}),
    },
    include: { ebaySellerConnection: { select: { id: true, username: true, isDefault: true, defaultMarketplace: true } } },
  });
  return shapeInventoryResponse({ ...input, connections, rows: cached.map(cachedRowToInventoryRow), errors });
}

export function startEbayStoreInventoryCacheRefresh(input: Parameters<typeof syncEbayStoreInventory>[0]) {
  const key = `${input.organizationId}:${input.connectionId ?? "all"}`;
  const existing = runningInventoryCacheRefreshes.get(key);
  if (existing) return { started: false, running: true };
  const task = syncEbayStoreInventory(input)
    .catch((error) => {
      console.error(JSON.stringify({
        type: "ebay_store_inventory_cache_refresh_failed",
        organizationId: input.organizationId,
        connectionId: input.connectionId ?? null,
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
      }));
    })
    .finally(() => runningInventoryCacheRefreshes.delete(key));
  runningInventoryCacheRefreshes.set(key, task);
  return { started: true, running: true };
}

export async function updateEbayStoreInventoryItem(input: {
  organizationId: string;
  connectionId: string;
  sku: string;
  marketplace: Marketplace;
  offerId?: string | null;
  quantity?: number;
  price?: number;
  currency?: string;
}) {
  const connection = await prisma.ebaySellerConnection.findFirst({
    where: { organizationId: input.organizationId, id: input.connectionId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!connection) throw new EbayInventoryManagementError("Connected eBay account not found", 404);
  if (input.quantity === undefined && input.price === undefined) throw new EbayInventoryManagementError("Enter a quantity or price to update", 400);
  if (input.price !== undefined && !input.offerId) throw new EbayInventoryManagementError("An eBay offer ID is required to update selling price", 409);
  const request: Record<string, unknown> = {
    sku: input.sku,
    marketplaceId: input.marketplace,
  };
  if (input.quantity !== undefined) request.shipToLocationAvailability = { quantity: input.quantity };
  if (input.price !== undefined && input.offerId) {
    request.offers = [{
      offerId: input.offerId,
      price: { currency: input.currency ?? "USD", value: String(input.price) },
    }];
  }
  const result = await bulkUpdatePriceQuantity(input.organizationId, input.marketplace, { requests: [request] }, input.connectionId);
  await prisma.ebayInventoryCacheItem.updateMany({
    where: {
      organizationId: input.organizationId,
      ebaySellerConnectionId: input.connectionId,
      marketplace: input.marketplace,
      sku: input.sku,
    },
    data: {
      ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
      ...(input.price === undefined ? {} : { price: input.price, currency: input.currency ?? "USD" }),
      syncedAt: new Date(),
    },
  });
  return result;
}

export async function withdrawEbayStoreOffer(input: {
  organizationId: string;
  connectionId: string;
  marketplace: Marketplace;
  offerId: string;
}) {
  const connection = await prisma.ebaySellerConnection.findFirst({
    where: { organizationId: input.organizationId, id: input.connectionId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!connection) throw new EbayInventoryManagementError("Connected eBay account not found", 404);
  await withdrawOffer(input.organizationId, input.marketplace, input.offerId, input.connectionId);
  await prisma.ebayInventoryCacheItem.updateMany({
    where: {
      organizationId: input.organizationId,
      ebaySellerConnectionId: input.connectionId,
      marketplace: input.marketplace,
      offerId: input.offerId,
    },
    data: {
      offerStatus: "WITHDRAWN",
      listingStatus: "ENDED",
      syncedAt: new Date(),
    },
  });
  return { withdrawn: true };
}
