import { getConfig } from "../config.js";
import { getEbaySellerAccessToken } from "../ebay-seller-oauth.js";
import type { Marketplace } from "../types.js";
import { EbayApiError } from "./ebay.js";

function apiBase(): string {
  return getConfig().ebay.environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export function contentLanguage(marketplace: Marketplace): string {
  if (marketplace === "EBAY_GB") return "en-GB";
  if (marketplace === "EBAY_DE") return "de-DE";
  return "en-US";
}

export function acceptLanguage(marketplace: Marketplace): string {
  return contentLanguage(marketplace);
}

async function providerError(response: Response, operation: string): Promise<EbayApiError> {
  let detail = "";
  try {
    const body = await response.json() as { errors?: Array<{ message?: string; longMessage?: string }> };
    detail = body.errors?.[0]?.longMessage ?? body.errors?.[0]?.message ?? "";
  } catch { /* Empty provider error response. */ }
  return new EbayApiError(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`, response.status, operation);
}

async function inventoryRequest(input: {
  organizationId: string;
  marketplace: Marketplace;
  sku: string;
  suffix?: string;
  method: "PUT" | "DELETE";
  payload?: unknown;
  operation: string;
  connectionId?: string | null;
}) {
  const token = await getEbaySellerAccessToken(input.organizationId, input.connectionId ?? undefined);
  const suffix = input.suffix ?? "";
  const response = await fetch(`${apiBase()}/sell/inventory/v1/inventory_item/${encodeURIComponent(input.sku)}${suffix}`, {
    method: input.method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": contentLanguage(input.marketplace),
      "X-EBAY-C-MARKETPLACE-ID": input.marketplace,
    },
    ...(input.payload === undefined ? {} : { body: JSON.stringify(input.payload) }),
  });
  if (!response.ok && !(input.method === "DELETE" && response.status === 404)) {
    throw await providerError(response, input.operation);
  }
}

export async function putInventoryItem(organizationId: string, marketplace: Marketplace, sku: string, payload: unknown, connectionId?: string | null) {
  await inventoryRequest({ organizationId, marketplace, sku, method: "PUT", payload, operation: "eBay inventory item write", connectionId });
}

export async function replaceProductCompatibility(
  organizationId: string,
  marketplace: Marketplace,
  sku: string,
  payload: unknown | null,
  connectionId?: string | null,
) {
  await inventoryRequest({
    organizationId,
    marketplace,
    sku,
    suffix: "/product_compatibility",
    method: payload ? "PUT" : "DELETE",
    ...(payload ? { payload } : {}),
    operation: payload ? "eBay product compatibility write" : "eBay product compatibility removal",
    connectionId,
  });
}

async function offerRequest<T>(input: {
  organizationId: string;
  marketplace: Marketplace;
  path: string;
  method: "GET" | "POST" | "PUT";
  payload?: unknown;
  operation: string;
  connectionId?: string | null;
}): Promise<T> {
  const token = await getEbaySellerAccessToken(input.organizationId, input.connectionId ?? undefined);
  const response = await fetch(`${apiBase()}/sell/inventory/v1${input.path}`, {
    method: input.method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": contentLanguage(input.marketplace),
      "X-EBAY-C-MARKETPLACE-ID": input.marketplace,
    },
    ...(input.payload === undefined ? {} : { body: JSON.stringify(input.payload) }),
  });
  if (!response.ok) throw await providerError(response, input.operation);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function inventoryApiRequest<T>(input: {
  organizationId: string;
  marketplace: Marketplace;
  path: string;
  method: "GET" | "POST";
  payload?: unknown;
  operation: string;
  connectionId?: string | null;
}): Promise<T> {
  const token = await getEbaySellerAccessToken(input.organizationId, input.connectionId ?? undefined);
  const response = await fetch(`${apiBase()}/sell/inventory/v1${input.path}`, {
    method: input.method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(input.method === "GET"
        ? { Accept: "application/json", "Accept-Language": acceptLanguage(input.marketplace) }
        : { "Content-Type": "application/json", "Content-Language": contentLanguage(input.marketplace) }),
      "X-EBAY-C-MARKETPLACE-ID": input.marketplace,
    },
    ...(input.payload === undefined ? {} : { body: JSON.stringify(input.payload) }),
  });
  if (!response.ok) throw await providerError(response, input.operation);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface EbayInventoryItemSummary {
  sku: string;
  title: string | null;
  condition: string | null;
  totalQuantity: number | null;
  availability: Record<string, unknown>;
  product: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface EbayOfferSummary {
  offerId: string;
  sku: string | null;
  marketplaceId: string | null;
  status: string | null;
  listingId: string | null;
  listingStatus: string | null;
  listingOnHold: boolean;
  priceValue: number | null;
  priceCurrency: string | null;
  availableQuantity: number | null;
  categoryId: string | null;
  format: string | null;
  payload: Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function normalizeInventoryItemSummary(item: Record<string, unknown>): EbayInventoryItemSummary | null {
  const sku = text(item.sku);
  if (!sku) return null;
  const availability = typeof item.availability === "object" && item.availability !== null
    ? item.availability as Record<string, unknown>
    : {};
  const shipTo = typeof availability.shipToLocationAvailability === "object" && availability.shipToLocationAvailability !== null
    ? availability.shipToLocationAvailability as Record<string, unknown>
    : {};
  const product = typeof item.product === "object" && item.product !== null
    ? item.product as Record<string, unknown>
    : {};
  return {
    sku,
    title: text(product.title),
    condition: text(item.condition),
    totalQuantity: numeric(shipTo.quantity),
    availability,
    product,
    payload: item,
  };
}

export function normalizeOfferSummary(offer: Record<string, unknown>): EbayOfferSummary | null {
  const offerId = text(offer.offerId);
  if (!offerId) return null;
  const pricingSummary = typeof offer.pricingSummary === "object" && offer.pricingSummary !== null
    ? offer.pricingSummary as Record<string, unknown>
    : {};
  const price = typeof pricingSummary.price === "object" && pricingSummary.price !== null
    ? pricingSummary.price as Record<string, unknown>
    : {};
  const listing = typeof offer.listing === "object" && offer.listing !== null
    ? offer.listing as Record<string, unknown>
    : {};
  const listingPolicies = typeof offer.listingPolicies === "object" && offer.listingPolicies !== null
    ? offer.listingPolicies as Record<string, unknown>
    : {};
  return {
    offerId,
    sku: text(offer.sku),
    marketplaceId: text(offer.marketplaceId),
    status: text(offer.status),
    listingId: text(listing.listingId) ?? text(offer.listingId),
    listingStatus: text(listing.listingStatus),
    listingOnHold: listing.listingOnHold === true,
    priceValue: numeric(price.value),
    priceCurrency: text(price.currency),
    availableQuantity: numeric(offer.availableQuantity),
    categoryId: text(offer.categoryId),
    format: text(offer.format),
    payload: { ...offer, listingPolicies },
  };
}

export async function getInventoryItemsPage(input: {
  organizationId: string;
  marketplace: Marketplace;
  connectionId: string;
  limit?: number;
  offset?: number;
}): Promise<{ inventoryItems: EbayInventoryItemSummary[]; total: number; size: number; limit: number; offset: number }> {
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;
  const response = await inventoryApiRequest<Record<string, unknown>>({
    organizationId: input.organizationId,
    marketplace: input.marketplace,
    connectionId: input.connectionId,
    method: "GET",
    path: `/inventory_item?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`,
    operation: "eBay inventory item list",
  });
  const inventoryItems = Array.isArray(response.inventoryItems)
    ? response.inventoryItems
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map(normalizeInventoryItemSummary)
      .filter((item): item is EbayInventoryItemSummary => Boolean(item))
    : [];
  return {
    inventoryItems,
    total: numeric(response.total) ?? inventoryItems.length,
    size: numeric(response.size) ?? inventoryItems.length,
    limit,
    offset,
  };
}

export async function getOffersPage(input: {
  organizationId: string;
  marketplace: Marketplace;
  connectionId: string;
  sku: string;
}): Promise<{ offers: EbayOfferSummary[] }> {
  const response = await inventoryApiRequest<Record<string, unknown>>({
    organizationId: input.organizationId,
    marketplace: input.marketplace,
    connectionId: input.connectionId,
    method: "GET",
    path: `/offer?sku=${encodeURIComponent(input.sku)}&marketplace_id=${encodeURIComponent(input.marketplace)}`,
    operation: "eBay offer list by SKU",
  });
  const offers = Array.isArray(response.offers)
    ? response.offers
      .filter((offer): offer is Record<string, unknown> => typeof offer === "object" && offer !== null)
      .map(normalizeOfferSummary)
      .filter((offer): offer is EbayOfferSummary => Boolean(offer))
    : [];
  return { offers };
}

export async function bulkUpdatePriceQuantity(
  organizationId: string,
  marketplace: Marketplace,
  payload: unknown,
  connectionId?: string | null,
): Promise<Record<string, unknown>> {
  return inventoryApiRequest<Record<string, unknown>>({
    organizationId,
    marketplace,
    connectionId,
    method: "POST",
    path: "/bulk_update_price_quantity",
    payload,
    operation: "eBay price and quantity update",
  });
}

export async function createOffer(organizationId: string, marketplace: Marketplace, payload: unknown, connectionId?: string | null): Promise<string> {
  const response = await offerRequest<{ offerId?: string }>({
    organizationId, marketplace, path: "/offer", method: "POST", payload, operation: "eBay offer creation", connectionId,
  });
  if (!response.offerId) throw new EbayApiError("eBay offer creation returned no offer ID", 502, "eBay offer creation");
  return response.offerId;
}

export async function updateOffer(organizationId: string, marketplace: Marketplace, offerId: string, payload: unknown, connectionId?: string | null): Promise<void> {
  await offerRequest<void>({
    organizationId, marketplace, path: `/offer/${encodeURIComponent(offerId)}`, method: "PUT", payload, operation: "eBay offer update", connectionId,
  });
}

export async function findOfferIdBySku(organizationId: string, marketplace: Marketplace, sku: string, connectionId?: string | null): Promise<string | null> {
  const response = await offerRequest<{ offers?: Array<{ offerId?: string; sku?: string; marketplaceId?: string; status?: string }> }>({
    organizationId,
    marketplace,
    path: `/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${encodeURIComponent(marketplace)}`,
    method: "GET",
    operation: "eBay offer reconciliation",
    connectionId,
  });
  return response.offers?.find((offer) =>
    offer.sku === sku
    && offer.marketplaceId === marketplace
    && ["UNPUBLISHED", "DRAFT"].includes(offer.status ?? ""),
  )?.offerId ?? null;
}

export interface ListingFeeSummary {
  total: number | null;
  currency: string | null;
  warnings: unknown[];
  response: Record<string, unknown>;
}

export function summarizeListingFees(response: Record<string, unknown>): ListingFeeSummary {
  const summaries = Array.isArray(response.feeSummaries) ? response.feeSummaries : [];
  let total = 0;
  let found = false;
  let currency: string | null = null;
  const warnings: unknown[] = [];
  for (const summary of summaries) {
    if (typeof summary !== "object" || summary === null) continue;
    const row = summary as Record<string, unknown>;
    if (Array.isArray(row.warnings)) warnings.push(...row.warnings);
    const fees = Array.isArray(row.fees) ? row.fees : [];
    for (const fee of fees) {
      if (typeof fee !== "object" || fee === null) continue;
      const amount = (fee as Record<string, unknown>).amount;
      if (typeof amount !== "object" || amount === null) continue;
      const value = Number((amount as Record<string, unknown>).value);
      if (!Number.isFinite(value)) continue;
      found = true;
      total += value;
      if (typeof (amount as Record<string, unknown>).currency === "string") currency = (amount as Record<string, unknown>).currency as string;
    }
  }
  return { total: found ? Math.round(total * 100) / 100 : null, currency, warnings, response };
}

export async function getListingFees(organizationId: string, marketplace: Marketplace, offerId: string, connectionId?: string | null): Promise<ListingFeeSummary> {
  const response = await offerRequest<Record<string, unknown>>({
    organizationId,
    marketplace,
    path: "/offer/get_listing_fees",
    method: "POST",
    payload: { offers: [{ offerId }] },
    operation: "eBay listing fee preview",
    connectionId,
  });
  return summarizeListingFees(response);
}

export async function publishOffer(organizationId: string, marketplace: Marketplace, offerId: string, connectionId?: string | null): Promise<string> {
  const response = await offerRequest<{ listingId?: string }>({
    organizationId,
    marketplace,
    path: `/offer/${encodeURIComponent(offerId)}/publish`,
    method: "POST",
    operation: "eBay offer publication",
    connectionId,
  });
  if (!response.listingId) throw new EbayApiError("eBay publication returned no listing ID", 502, "eBay offer publication");
  return response.listingId;
}

export async function getPublishedListingId(organizationId: string, marketplace: Marketplace, offerId: string, connectionId?: string | null): Promise<string | null> {
  const snapshot = await getOfferSnapshot(organizationId, marketplace, offerId, connectionId);
  return snapshot.listingId;
}

export interface RemoteOfferSnapshot {
  offerId: string | null;
  listingId: string | null;
  listingStatus: string | null;
  listingOnHold: boolean;
  soldQuantity: number | null;
  payload: Record<string, unknown>;
}

export function normalizeOfferSnapshot(response: Record<string, unknown>): RemoteOfferSnapshot {
  const listing = typeof response.listing === "object" && response.listing !== null
    ? response.listing as Record<string, unknown>
    : {};
  return {
    offerId: typeof response.offerId === "string" ? response.offerId : null,
    listingId: typeof listing.listingId === "string" ? listing.listingId : typeof response.listingId === "string" ? response.listingId : null,
    listingStatus: typeof listing.listingStatus === "string" ? listing.listingStatus : null,
    listingOnHold: listing.listingOnHold === true,
    soldQuantity: typeof listing.soldQuantity === "number" ? listing.soldQuantity : null,
    payload: response,
  };
}

export async function getOfferSnapshot(organizationId: string, marketplace: Marketplace, offerId: string, connectionId?: string | null): Promise<RemoteOfferSnapshot> {
  const response = await offerRequest<Record<string, unknown>>({
    organizationId,
    marketplace,
    path: `/offer/${encodeURIComponent(offerId)}`,
    method: "GET",
    operation: "eBay published offer reconciliation",
    connectionId,
  });
  return normalizeOfferSnapshot(response);
}

export async function withdrawOffer(organizationId: string, marketplace: Marketplace, offerId: string, connectionId?: string | null): Promise<void> {
  await offerRequest<void>({
    organizationId,
    marketplace,
    path: `/offer/${encodeURIComponent(offerId)}/withdraw`,
    method: "POST",
    operation: "eBay offer withdrawal",
    connectionId,
  });
}
