import { getConfig } from "../config.js";
import { normalizePartNumber } from "../domain/matching.js";
import type { Marketplace } from "../types.js";
import { EbayApiError, getEbayApplicationToken } from "./ebay.js";

export interface FitmentPartInput {
  partNumber: string;
  brand: string | null;
  partName: string | null;
}

export interface EbayFitmentCandidate {
  epid: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  productWebUrl: string | null;
  aspects: Record<string, string[]>;
}

export interface EbayFitmentDiscovery {
  categoryId: string | null;
  categoryName: string | null;
  candidates: EbayFitmentCandidate[];
}

export interface EbayFitmentApplications {
  metadataVersion: string | null;
  applications: Array<Record<string, string>>;
}

const metadataMarketplaces: Record<Marketplace, string> = {
  EBAY_US: "EBAY_MOTORS_US",
  EBAY_GB: "EBAY_GB",
  EBAY_DE: "EBAY_DE",
};

function apiBase(): string {
  return getConfig().ebay.environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

async function ebayError(response: Response, operation: string): Promise<EbayApiError> {
  let detail = "";
  try {
    const body = await response.json() as { errors?: Array<{ message?: string; longMessage?: string }> };
    detail = body.errors?.[0]?.longMessage ?? body.errors?.[0]?.message ?? "";
  } catch { /* Some eBay errors do not contain JSON. */ }
  return new EbayApiError(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`, response.status, operation);
}

async function ebayRequest<T>(path: string, marketplace: Marketplace, operation: string, init?: RequestInit): Promise<T> {
  const token = await getEbayApplicationToken();
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw await ebayError(response, operation);
  return response.json() as Promise<T>;
}

function aspectsFromProduct(product: Record<string, unknown>): Record<string, string[]> {
  const values = product.aspects as Array<{ localizedName?: string; localizedValues?: string[] }> | undefined;
  const aspects = Object.fromEntries((values ?? []).flatMap((aspect) => aspect.localizedName ? [[aspect.localizedName, aspect.localizedValues ?? []]] : []));
  const mpn = product.mpn as string[] | undefined;
  if (mpn?.length && !aspects.MPN) aspects.MPN = mpn;
  return aspects;
}

function demoDiscovery(part: FitmentPartInput): EbayFitmentDiscovery {
  return {
    categoryId: "33596",
    categoryName: "Other Engine Parts",
    candidates: [{
      epid: `demo-${normalizePartNumber(part.partNumber)}`,
      title: `${part.brand ?? "OEM"} ${part.partName ?? "Automotive Part"} ${part.partNumber}`,
      brand: part.brand,
      imageUrl: null,
      productWebUrl: null,
      aspects: { "Manufacturer Part Number": [part.partNumber], ...(part.brand ? { Brand: [part.brand] } : {}) },
    }],
  };
}

export async function discoverEbayFitment(part: FitmentPartInput, marketplace: Marketplace): Promise<EbayFitmentDiscovery> {
  if (getConfig().ebay.mode === "demo") return demoDiscovery(part);

  const tree = await ebayRequest<{ categoryTreeId?: string }>(
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${encodeURIComponent(marketplace)}`,
    marketplace,
    "eBay category tree lookup",
  );
  const categoryQuery = [part.brand, part.partName, part.partNumber].filter(Boolean).join(" ");
  const suggestions = tree.categoryTreeId
    ? await ebayRequest<{ categorySuggestions?: Array<{ category?: { categoryId?: string; categoryName?: string } }> }>(
      `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(tree.categoryTreeId)}/get_category_suggestions?q=${encodeURIComponent(categoryQuery)}`,
      marketplace,
      "eBay category suggestion",
    )
    : { categorySuggestions: [] };
  const category = suggestions.categorySuggestions?.[0]?.category;
  const query = new URLSearchParams({ mpn: part.partNumber, limit: "20" });
  if (category?.categoryId) query.set("category_ids", category.categoryId);
  const products = await ebayRequest<{ productSummaries?: Array<Record<string, unknown>> }>(
    `/commerce/catalog/v1_beta/product_summary/search?${query}`,
    marketplace,
    "eBay product catalog search",
  );
  return {
    categoryId: category?.categoryId ?? null,
    categoryName: category?.categoryName ?? null,
    candidates: (products.productSummaries ?? []).flatMap((product) => {
      const epid = String(product.epid ?? "");
      if (!epid) return [];
      const image = product.image as { imageUrl?: string } | undefined;
      return [{
        epid,
        title: String(product.title ?? "Untitled eBay product"),
        brand: typeof product.brand === "string" ? product.brand : null,
        imageUrl: image?.imageUrl ?? null,
        productWebUrl: typeof product.productWebUrl === "string" ? product.productWebUrl : null,
        aspects: aspectsFromProduct(product),
      }];
    }),
  };
}

function demoApplications(): EbayFitmentApplications {
  return {
    metadataVersion: "demo-1",
    applications: [
      { Year: "2020", Make: "Demo Motors", Model: "Atlas", Trim: "Base" },
      { Year: "2021", Make: "Demo Motors", Model: "Atlas", Trim: "Base" },
    ],
  };
}

export async function getEbayProductCompatibilities(epid: string, marketplace: Marketplace): Promise<EbayFitmentApplications> {
  if (getConfig().ebay.mode === "demo") return demoApplications();
  const applications: Array<Record<string, string>> = [];
  const metadataVersion: string | null = null;
  let offset = 0;
  const limit = 100;
  for (;;) {
    const result = await ebayRequest<{
      compatibilityDetails?: Array<{ productDetails?: Array<{ propertyName?: string; propertyValue?: string }> }>;
      pagination?: { count?: number; limit?: number; offset?: number; total?: number };
    }>("/sell/metadata/v1/compatibilities/get_product_compatibilities", marketplace, "eBay product compatibility lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-EBAY-C-MARKETPLACE-ID": metadataMarketplaces[marketplace] },
      body: JSON.stringify({ productIdentifier: { epid }, dataset: ["Searchable"], paginationInput: { limit, offset } }),
    });
    const page = result.compatibilityDetails ?? [];
    applications.push(...page.flatMap((entry) => {
      const properties = Object.fromEntries((entry.productDetails ?? []).flatMap((detail) =>
        detail.propertyName && detail.propertyValue ? [[detail.propertyName, detail.propertyValue]] : [],
      ));
      return Object.keys(properties).length ? [properties] : [];
    }));
    offset += page.length;
    if (!page.length || page.length < limit || (typeof result.pagination?.total === "number" && offset >= result.pagination.total)) break;
  }
  return { metadataVersion, applications };
}
