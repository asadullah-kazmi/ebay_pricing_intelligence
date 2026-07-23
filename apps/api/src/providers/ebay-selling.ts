import { getConfig } from "../config.js";
import { getEbaySellerAccessToken } from "../ebay-seller-oauth.js";
import type { Marketplace } from "../types.js";
import { EbayApiError, getEbayApplicationToken } from "./ebay.js";

export type SellerResourceType = "PAYMENT_POLICY" | "RETURN_POLICY" | "FULFILLMENT_POLICY" | "INVENTORY_LOCATION";

export interface SellerResource {
  type: SellerResourceType;
  remoteId: string;
  name: string | null;
  enabled: boolean;
  payload: Record<string, unknown>;
}

export interface EbayAspectRequirement {
  name: string;
  required: boolean;
  recommended: boolean;
  mode: string | null;
  dataType: string | null;
  cardinality: string | null;
  values: string[];
}

function apiBase(): string {
  return getConfig().ebay.environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

async function providerError(response: Response, operation: string): Promise<EbayApiError> {
  let detail = "";
  try {
    const body = await response.json() as { errors?: Array<{ message?: string; longMessage?: string }> };
    detail = body.errors?.[0]?.longMessage ?? body.errors?.[0]?.message ?? "";
  } catch { /* Some provider errors contain no JSON body. */ }
  return new EbayApiError(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`, response.status, operation);
}

async function sellerGet<T>(organizationId: string, path: string, marketplace: Marketplace, operation: string): Promise<T> {
  const token = await getEbaySellerAccessToken(organizationId);
  const response = await fetch(`${apiBase()}${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": marketplace },
  });
  if (!response.ok) throw await providerError(response, operation);
  return response.json() as Promise<T>;
}

async function applicationGet<T>(path: string, marketplace: Marketplace, operation: string): Promise<T> {
  const token = await getEbayApplicationToken();
  const response = await fetch(`${apiBase()}${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": marketplace },
  });
  if (!response.ok) throw await providerError(response, operation);
  return response.json() as Promise<T>;
}

function policyResources(
  type: Exclude<SellerResourceType, "INVENTORY_LOCATION">,
  rows: Array<Record<string, unknown>>,
  idField: string,
): SellerResource[] {
  return rows.flatMap((row) => {
    const remoteId = typeof row[idField] === "string" ? row[idField] : "";
    if (!remoteId) return [];
    const categoryTypes = Array.isArray(row.categoryTypes)
      ? row.categoryTypes.flatMap((entry) =>
        typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).name === "string"
          ? [(entry as Record<string, unknown>).name as string]
          : [],
      )
      : [];
    return [{
      type,
      remoteId,
      name: typeof row.name === "string" ? row.name : null,
      enabled: !categoryTypes.length || categoryTypes.includes("ALL_EXCLUDING_MOTORS_VEHICLES"),
      payload: row,
    }];
  });
}

export function normalizeInventoryLocations(rows: Array<Record<string, unknown>>): SellerResource[] {
  return rows.flatMap((row) => {
    const remoteId = typeof row.merchantLocationKey === "string" ? row.merchantLocationKey : "";
    if (!remoteId) return [];
    const status = typeof row.merchantLocationStatus === "string" ? row.merchantLocationStatus : "ENABLED";
    return [{
      type: "INVENTORY_LOCATION" as const,
      remoteId,
      name: typeof row.name === "string" ? row.name : remoteId,
      enabled: status === "ENABLED",
      payload: row,
    }];
  });
}

export function normalizeCategoryAspects(rows: Array<Record<string, unknown>>): EbayAspectRequirement[] {
  return rows.flatMap((row) => {
    const name = typeof row.localizedAspectName === "string" ? row.localizedAspectName.trim() : "";
    if (!name) return [];
    const constraint = typeof row.aspectConstraint === "object" && row.aspectConstraint !== null
      ? row.aspectConstraint as Record<string, unknown>
      : {};
    const values = Array.isArray(row.aspectValues)
      ? row.aspectValues.flatMap((entry) =>
        typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).localizedValue === "string"
          ? [(entry as Record<string, unknown>).localizedValue as string]
          : [],
      )
      : [];
    return [{
      name,
      required: constraint.aspectRequired === true,
      recommended: constraint.aspectUsage === "RECOMMENDED",
      mode: typeof constraint.aspectMode === "string" ? constraint.aspectMode : null,
      dataType: typeof constraint.aspectDataType === "string" ? constraint.aspectDataType : null,
      cardinality: typeof constraint.itemToAspectCardinality === "string" ? constraint.itemToAspectCardinality : null,
      values,
    }];
  });
}

export async function fetchSellerResources(organizationId: string, marketplace: Marketplace): Promise<SellerResource[]> {
  const [payment, returns, fulfillment, locations] = await Promise.all([
    sellerGet<{ paymentPolicies?: Array<Record<string, unknown>> }>(
      organizationId,
      `/sell/account/v1/payment_policy?marketplace_id=${marketplace}`,
      marketplace,
      "eBay payment policy lookup",
    ),
    sellerGet<{ returnPolicies?: Array<Record<string, unknown>> }>(
      organizationId,
      `/sell/account/v1/return_policy?marketplace_id=${marketplace}`,
      marketplace,
      "eBay return policy lookup",
    ),
    sellerGet<{ fulfillmentPolicies?: Array<Record<string, unknown>> }>(
      organizationId,
      `/sell/account/v1/fulfillment_policy?marketplace_id=${marketplace}`,
      marketplace,
      "eBay fulfillment policy lookup",
    ),
    sellerGet<{ locations?: Array<Record<string, unknown>> }>(
      organizationId,
      "/sell/inventory/v1/location?limit=200&offset=0",
      marketplace,
      "eBay inventory location lookup",
    ),
  ]);
  return [
    ...policyResources("PAYMENT_POLICY", payment.paymentPolicies ?? [], "paymentPolicyId"),
    ...policyResources("RETURN_POLICY", returns.returnPolicies ?? [], "returnPolicyId"),
    ...policyResources("FULFILLMENT_POLICY", fulfillment.fulfillmentPolicies ?? [], "fulfillmentPolicyId"),
    ...normalizeInventoryLocations(locations.locations ?? []),
  ];
}

export async function fetchCategoryAspects(marketplace: Marketplace, categoryId: string): Promise<EbayAspectRequirement[]> {
  const taxonomyMarketplace = marketplace === "EBAY_US" ? "EBAY_MOTORS_US" : marketplace;
  const tree = await applicationGet<{ categoryTreeId?: string }>(
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(taxonomyMarketplace)}`,
    marketplace,
    "eBay category tree lookup",
  );
  if (!tree.categoryTreeId) throw new EbayApiError("eBay did not return a category tree", 502, "category aspects");
  const result = await applicationGet<{ aspects?: Array<Record<string, unknown>> }>(
    `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(tree.categoryTreeId)}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    marketplace,
    "eBay category aspect lookup",
  );
  return normalizeCategoryAspects(result.aspects ?? []);
}
