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
