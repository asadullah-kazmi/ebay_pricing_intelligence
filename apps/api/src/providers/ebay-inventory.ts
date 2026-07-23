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
}) {
  const token = await getEbaySellerAccessToken(input.organizationId);
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

export async function putInventoryItem(organizationId: string, marketplace: Marketplace, sku: string, payload: unknown) {
  await inventoryRequest({ organizationId, marketplace, sku, method: "PUT", payload, operation: "eBay inventory item write" });
}

export async function replaceProductCompatibility(
  organizationId: string,
  marketplace: Marketplace,
  sku: string,
  payload: unknown | null,
) {
  await inventoryRequest({
    organizationId,
    marketplace,
    sku,
    suffix: "/product_compatibility",
    method: payload ? "PUT" : "DELETE",
    ...(payload ? { payload } : {}),
    operation: payload ? "eBay product compatibility write" : "eBay product compatibility removal",
  });
}

async function offerRequest<T>(input: {
  organizationId: string;
  marketplace: Marketplace;
  path: string;
  method: "GET" | "POST" | "PUT";
  payload?: unknown;
  operation: string;
}): Promise<T> {
  const token = await getEbaySellerAccessToken(input.organizationId);
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

export async function createOffer(organizationId: string, marketplace: Marketplace, payload: unknown): Promise<string> {
  const response = await offerRequest<{ offerId?: string }>({
    organizationId, marketplace, path: "/offer", method: "POST", payload, operation: "eBay offer creation",
  });
  if (!response.offerId) throw new EbayApiError("eBay offer creation returned no offer ID", 502, "eBay offer creation");
  return response.offerId;
}

export async function updateOffer(organizationId: string, marketplace: Marketplace, offerId: string, payload: unknown): Promise<void> {
  await offerRequest<void>({
    organizationId, marketplace, path: `/offer/${encodeURIComponent(offerId)}`, method: "PUT", payload, operation: "eBay offer update",
  });
}

export async function findOfferIdBySku(organizationId: string, marketplace: Marketplace, sku: string): Promise<string | null> {
  const response = await offerRequest<{ offers?: Array<{ offerId?: string; sku?: string; marketplaceId?: string; status?: string }> }>({
    organizationId,
    marketplace,
    path: `/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${encodeURIComponent(marketplace)}`,
    method: "GET",
    operation: "eBay offer reconciliation",
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

export async function getListingFees(organizationId: string, marketplace: Marketplace, offerId: string): Promise<ListingFeeSummary> {
  const response = await offerRequest<Record<string, unknown>>({
    organizationId,
    marketplace,
    path: "/offer/get_listing_fees",
    method: "POST",
    payload: { offers: [{ offerId }] },
    operation: "eBay listing fee preview",
  });
  return summarizeListingFees(response);
}

export async function publishOffer(organizationId: string, marketplace: Marketplace, offerId: string): Promise<string> {
  const response = await offerRequest<{ listingId?: string }>({
    organizationId,
    marketplace,
    path: `/offer/${encodeURIComponent(offerId)}/publish`,
    method: "POST",
    operation: "eBay offer publication",
  });
  if (!response.listingId) throw new EbayApiError("eBay publication returned no listing ID", 502, "eBay offer publication");
  return response.listingId;
}

export async function getPublishedListingId(organizationId: string, marketplace: Marketplace, offerId: string): Promise<string | null> {
  const response = await offerRequest<Record<string, unknown>>({
    organizationId,
    marketplace,
    path: `/offer/${encodeURIComponent(offerId)}`,
    method: "GET",
    operation: "eBay published offer reconciliation",
  });
  if (typeof response.listingId === "string") return response.listingId;
  if (typeof response.listing === "object" && response.listing !== null && typeof (response.listing as Record<string, unknown>).listingId === "string") {
    return (response.listing as Record<string, unknown>).listingId as string;
  }
  return null;
}
