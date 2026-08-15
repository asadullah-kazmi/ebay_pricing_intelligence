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

export type EbayInventoryCacheRefreshStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";

export interface EbayInventoryCacheRefreshProgress {
  key: string;
  status: EbayInventoryCacheRefreshStatus;
  percent: number;
  message: string;
  accountsTotal: number;
  accountsCompleted: number;
  currentAccount: string | null;
  totalSkus: number;
  inventorySynced: number;
  offersChecked: number;
  cacheSaved: number;
  errors: number;
  startedAt: string | null;
  finishedAt: string | null;
}

const runningInventoryCacheRefreshes = new Map<string, Promise<unknown>>();
const inventoryCacheRefreshProgress = new Map<string, EbayInventoryCacheRefreshProgress>();

function syncKey(input: { organizationId: string; connectionId?: string }) {
  return `${input.organizationId}:${input.connectionId ?? "all"}`;
}

function idleProgress(key: string): EbayInventoryCacheRefreshProgress {
  return {
    key,
    status: "IDLE",
    percent: 0,
    message: "Inventory sync is idle.",
    accountsTotal: 0,
    accountsCompleted: 0,
    currentAccount: null,
    totalSkus: 0,
    inventorySynced: 0,
    offersChecked: 0,
    cacheSaved: 0,
    errors: 0,
    startedAt: null,
    finishedAt: null,
  };
}

function setProgress(key: string, patch: Partial<EbayInventoryCacheRefreshProgress>) {
  const current = inventoryCacheRefreshProgress.get(key) ?? idleProgress(key);
  const next = {
    ...current,
    ...patch,
    percent: Math.max(0, Math.min(100, Math.round(patch.percent ?? current.percent))),
  };
  inventoryCacheRefreshProgress.set(key, next);
  return next;
}

export function getEbayStoreInventoryCacheRefreshProgress(input: { organizationId: string; connectionId?: string }) {
  return inventoryCacheRefreshProgress.get(syncKey(input)) ?? idleProgress(syncKey(input));
}

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
  const normalizeImageUrl = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withProtocol = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    if (!/^https?:\/\//i.test(withProtocol)) return null;
    try {
      const url = new URL(withProtocol);
      url.pathname = url.pathname.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/");
      return url.toString();
    } catch {
      return null;
    }
  };
  const imageUrl = normalizeImageUrl(product.imageUrl);
  if (imageUrl) return imageUrl;
  const imageUrls = product.imageUrls;
  if (Array.isArray(imageUrls)) {
    for (const value of imageUrls) {
      const url = normalizeImageUrl(value);
      if (url) return url;
    }
  }
  const image = product.image;
  if (typeof image === "object" && image !== null && typeof (image as Record<string, unknown>).imageUrl === "string") {
    const url = normalizeImageUrl((image as { imageUrl: string }).imageUrl);
    if (url) return url;
  }
  const additionalImages = product.additionalImages;
  if (Array.isArray(additionalImages)) {
    for (const candidate of additionalImages) {
      if (typeof candidate === "string") {
        const url = normalizeImageUrl(candidate);
        if (url) return url;
      }
      if (typeof candidate === "object" && candidate !== null) {
        const row = candidate as Record<string, unknown>;
        const url = normalizeImageUrl(row.imageUrl ?? row.url);
        if (url) return url;
      }
    }
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
    imageUrl: row.imageUrl ?? (typeof row.inventoryPayload === "object" && row.inventoryPayload !== null && !Array.isArray(row.inventoryPayload)
      ? firstImage(typeof (row.inventoryPayload as Record<string, unknown>).product === "object" && (row.inventoryPayload as Record<string, unknown>).product !== null
        ? (row.inventoryPayload as Record<string, unknown>).product as Record<string, unknown>
        : {})
      : null),
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
  onBatchComplete?: (count: number) => void;
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
    input.onBatchComplete?.(batch.length);
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
  const key = syncKey(input);
  const connections = await listActiveConnections({ organizationId: input.organizationId, connectionId: input.connectionId });
  setProgress(key, {
    status: "RUNNING",
    percent: 2,
    message: "Preparing connected eBay accounts...",
    accountsTotal: connections.length,
    accountsCompleted: 0,
    currentAccount: null,
    totalSkus: 0,
    inventorySynced: 0,
    offersChecked: 0,
    cacheSaved: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  const errors: Array<{ connectionId: string; username: string | null; message: string }> = [];
  const refreshedRows: EbayInventoryRow[] = [];
  for (const [connectionIndex, connection] of connections.entries()) {
    const marketplace = asMarketplace(connection.defaultMarketplace);
    const account = { id: connection.id, username: connection.username, isDefault: connection.isDefault, marketplace };
    const syncStartedAt = new Date();
    try {
      setProgress(key, {
        percent: Math.max(4, Math.round((connectionIndex / Math.max(1, connections.length)) * 100)),
        message: `Fetching inventory items from ${connection.username ?? "eBay account"}...`,
        currentAccount: connection.username ?? "eBay account",
      });
      const inventoryItems = await collectPages(
        (offset) => getInventoryItemsPage({ organizationId: input.organizationId, connectionId: connection.id, marketplace, limit: 100, offset }),
        (page) => page.inventoryItems,
      ) as EbayInventoryItemSummary[];
      const accountBase = (connectionIndex / Math.max(1, connections.length)) * 100;
      const accountSpan = 100 / Math.max(1, connections.length);
      let offersChecked = 0;
      setProgress(key, {
        percent: accountBase + accountSpan * 0.25,
        message: `Checking eBay offers for ${inventoryItems.length} SKU${inventoryItems.length === 1 ? "" : "s"}...`,
        totalSkus: (inventoryCacheRefreshProgress.get(key)?.totalSkus ?? 0) + inventoryItems.length,
        inventorySynced: (inventoryCacheRefreshProgress.get(key)?.inventorySynced ?? 0) + inventoryItems.length,
      });
      const offers = await collectOffersForInventoryItems({
        organizationId: input.organizationId,
        connectionId: connection.id,
        marketplace,
        inventoryItems,
        errors,
        username: connection.username,
        onBatchComplete: (count) => {
          offersChecked += count;
          const offerProgress = inventoryItems.length > 0 ? offersChecked / inventoryItems.length : 1;
          setProgress(key, {
            percent: accountBase + accountSpan * (0.25 + offerProgress * 0.45),
            message: `Checked ${offersChecked}/${inventoryItems.length} offer records for ${connection.username ?? "eBay account"}...`,
            offersChecked: (inventoryCacheRefreshProgress.get(key)?.offersChecked ?? 0) + count,
            errors: errors.length,
          });
        },
      });
      const rows = mergeRows({ account, inventoryItems, offers, syncedAt: syncStartedAt });
      const cacheSavedBeforeAccount = inventoryCacheRefreshProgress.get(key)?.cacheSaved ?? 0;
      let cacheSavedForAccount = 0;
      for (const [rowIndex, row] of rows.entries()) {
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
        cacheSavedForAccount += 1;
        if (rowIndex % 10 === 0 || rowIndex === rows.length - 1) {
          setProgress(key, {
            percent: accountBase + accountSpan * (0.72 + ((rowIndex + 1) / Math.max(1, rows.length)) * 0.2),
            message: `Saving ${rowIndex + 1}/${rows.length} cached inventory rows...`,
            cacheSaved: cacheSavedBeforeAccount + cacheSavedForAccount,
          });
        }
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
      setProgress(key, {
        percent: accountBase + accountSpan * 0.95,
        message: `Finished ${connection.username ?? "eBay account"}.`,
        accountsCompleted: connectionIndex + 1,
        errors: errors.length,
      });
    } catch (error) {
      errors.push({
        connectionId: connection.id,
        username: connection.username,
        message: error instanceof Error ? error.message : "Unable to sync eBay inventory",
      });
      setProgress(key, {
        message: `Could not sync ${connection.username ?? "eBay account"}. Continuing where possible...`,
        accountsCompleted: connectionIndex + 1,
        errors: errors.length,
      });
    }
  }
  setProgress(key, {
    status: errors.length === connections.length && connections.length > 0 ? "FAILED" : "COMPLETED",
    percent: 100,
    message: errors.length === connections.length && connections.length > 0 ? "Inventory sync failed." : "Inventory sync completed.",
    currentAccount: null,
    finishedAt: new Date().toISOString(),
    errors: errors.length,
  });
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
  const key = syncKey(input);
  const existing = runningInventoryCacheRefreshes.get(key);
  if (existing) return { started: false, running: true, progress: getEbayStoreInventoryCacheRefreshProgress(input) };
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
  return { started: true, running: true, progress: getEbayStoreInventoryCacheRefreshProgress(input) };
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
