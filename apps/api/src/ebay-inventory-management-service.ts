import { prisma } from "./db.js";
import type { Marketplace } from "./types.js";
import {
  bulkUpdatePriceQuantity,
  getInventoryItemsPage,
  getOffersPage,
  withdrawOffer,
  type EbayInventoryItemSummary,
  type EbayOfferSummary,
} from "./providers/ebay-inventory.js";

export class EbayInventoryManagementError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "EbayInventoryManagementError";
  }
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
}

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
}) {
  const rows = new Map<string, EbayInventoryRow>();
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
    });
  }
  return [...rows.values()];
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

export async function listEbayStoreInventory(input: {
  organizationId: string;
  connectionId?: string;
  q?: string;
  stock?: EbayInventoryStockFilter;
  offerStatus?: EbayInventoryOfferFilter;
  page?: number;
  pageSize?: number;
}) {
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

  const errors: Array<{ connectionId: string; username: string | null; message: string }> = [];
  const rows: EbayInventoryRow[] = [];
  for (const connection of connections) {
    const marketplace = asMarketplace(connection.defaultMarketplace);
    const account = { id: connection.id, username: connection.username, isDefault: connection.isDefault, marketplace };
    try {
      const [inventoryItems, offers] = await Promise.all([
        collectPages(
          (offset) => getInventoryItemsPage({ organizationId: input.organizationId, connectionId: connection.id, marketplace, limit: 100, offset }),
          (page) => page.inventoryItems,
        ) as Promise<EbayInventoryItemSummary[]>,
        collectPages(
          (offset) => getOffersPage({ organizationId: input.organizationId, connectionId: connection.id, marketplace, limit: 100, offset }),
          (page) => page.offers,
        ) as Promise<EbayOfferSummary[]>,
      ]);
      rows.push(...mergeRows({ account, inventoryItems, offers }));
    } catch (error) {
      errors.push({
        connectionId: connection.id,
        username: connection.username,
        message: error instanceof Error ? error.message : "Unable to sync eBay inventory",
      });
    }
  }

  const query = input.q?.trim().toLowerCase() ?? "";
  const stock = input.stock ?? "ALL";
  const offerStatus = input.offerStatus ?? "ALL";
  const filtered = rows.filter((row) => {
    if (query && ![row.sku, row.title, row.condition, row.listingId, row.account.username].some((value) => value?.toLowerCase().includes(query))) return false;
    if (stock === "IN_STOCK" && (row.quantity ?? 0) <= 5) return false;
    if (stock === "LOW_STOCK" && !((row.quantity ?? 0) > 0 && (row.quantity ?? 0) <= 5)) return false;
    if (stock === "OUT_OF_STOCK" && (row.quantity ?? 0) > 0) return false;
    const normalizedStatus = (row.offerStatus ?? row.listingStatus ?? "").toUpperCase();
    if (offerStatus === "PUBLISHED" && !["PUBLISHED", "ACTIVE"].includes(normalizedStatus)) return false;
    if (offerStatus === "UNPUBLISHED" && !["UNPUBLISHED", "DRAFT"].includes(normalizedStatus)) return false;
    if (offerStatus === "ENDED" && !["ENDED", "WITHDRAWN"].includes(normalizedStatus)) return false;
    return true;
  });
  filtered.sort((a, b) => Number(Boolean(b.listingId)) - Number(Boolean(a.listingId)) || a.sku.localeCompare(b.sku));

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const offset = (page - 1) * pageSize;
  const pageRows = filtered.slice(offset, offset + pageSize);
  const summary = {
    total: rows.length,
    filtered: filtered.length,
    connectedAccounts: connections.length,
    published: rows.filter((row) => ["PUBLISHED", "ACTIVE"].includes((row.offerStatus ?? row.listingStatus ?? "").toUpperCase())).length,
    unpublished: rows.filter((row) => ["UNPUBLISHED", "DRAFT"].includes((row.offerStatus ?? row.listingStatus ?? "").toUpperCase())).length,
    lowStock: rows.filter((row) => (row.quantity ?? 0) > 0 && (row.quantity ?? 0) <= 5).length,
    outOfStock: rows.filter((row) => (row.quantity ?? 0) <= 0).length,
  };
  return {
    accounts: connections.map((connection) => ({
      id: connection.id,
      username: connection.username,
      isDefault: connection.isDefault,
      marketplace: asMarketplace(connection.defaultMarketplace),
    })),
    items: pageRows,
    pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
    summary,
    errors,
    syncedAt: new Date().toISOString(),
  };
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
  return bulkUpdatePriceQuantity(input.organizationId, input.marketplace, { requests: [request] }, input.connectionId);
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
  return { withdrawn: true };
}
