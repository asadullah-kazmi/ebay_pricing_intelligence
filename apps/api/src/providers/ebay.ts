import { getConfig } from "../config.js";
import type { ListingCondition, Marketplace, RawListing } from "../types.js";

const marketplaceCurrency: Record<Marketplace, string> = {
  EBAY_US: "USD",
  EBAY_GB: "GBP",
  EBAY_DE: "EUR",
};

interface CachedToken { value: string; expiresAt: number; environment: string }
let cachedToken: CachedToken | undefined;

export class EbayApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly operation: string) {
    super(message);
    this.name = "EbayApiError";
  }
}

function apiBase(): string {
  return getConfig().ebay.environment === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";
}

async function errorMessage(response: Response, operation: string): Promise<string> {
  let detail = "";
  try {
    const body = await response.json() as { errors?: Array<{ message?: string; longMessage?: string }> };
    detail = body.errors?.[0]?.longMessage ?? body.errors?.[0]?.message ?? "";
  } catch { /* eBay can return an empty or non-JSON error body. */ }
  return `${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`;
}

export async function getEbayApplicationToken(): Promise<string> {
  const { ebay } = getConfig();
  if (!ebay.clientId || !ebay.clientSecret) throw new Error("eBay credentials are not configured");
  if (cachedToken && cachedToken.environment === ebay.environment && cachedToken.expiresAt > Date.now() + 60_000) {
  return cachedToken.value;
}

  const response = await fetch(`${apiBase()}/identity/v1/oauth2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${ebay.clientId}:${ebay.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  if (!response.ok) throw new EbayApiError(await errorMessage(response, "eBay authorization"), response.status, "authorize");
  const token = await response.json() as { access_token: string; expires_in?: number };
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + (token.expires_in ?? 7200) * 1000,
    environment: ebay.environment,
  };
  return token.access_token;
}

async function ebayGet<T>(path: string, marketplace: Marketplace, operation: string): Promise<T> {
  const token = await getEbayApplicationToken();
  const response = await fetch(`${apiBase()}${path}`, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplace,
    },
  });
  if (!response.ok) throw new EbayApiError(await errorMessage(response, operation), response.status, operation);
  return response.json() as Promise<T>;
}

async function mapWithConcurrency<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function demoListings(oem: string, marketplace: Marketplace, condition: ListingCondition): RawListing[] {
  const currency = marketplaceCurrency[marketplace];
  const listings = [82.5, 91, 97.49, 105, 118.25].map((price, index) => ({
    id: `demo-${marketplace}-${index + 1}`,
    title: `${index % 2 ? "Genuine" : "OEM"} automotive part ${oem}`,
    seller: index === 3 ? "my-parts-store" : `competitor-${index + 1}`,
    price, shipping: index % 2 ? 0 : 8.95, currency,
    condition: index === 4 ? "Used" : "New", marketplace,
    url: "https://www.ebay.com/",
    aspects: (index === 4
      ? { "Manufacturer Part Number": ["UNRELATED-123"] }
      : { "Manufacturer Part Number": [oem], "OE/OEM Part Number": [oem] }) as Record<string, string[]>,
    imageUrls: [
      `https://i.ebayimg.com/images/g/demo-${encodeURIComponent(oem)}-${index + 1}/s-l1600.jpg`,
      `https://i.ebayimg.com/images/g/demo-${encodeURIComponent(oem)}-${index + 1}-detail/s-l1600.jpg`,
    ],
  }));
  return condition === "ANY"
    ? listings
    : listings.filter((listing) => condition === "NEW" ? listing.condition.startsWith("New") : listing.condition === "Used");
}

function toListing(item: Record<string, unknown>, marketplace: Marketplace): RawListing {
  const price = item.price as { value?: string; currency?: string } | undefined;
  const shippingOptions = item.shippingOptions as Array<{ shippingCost?: { value?: string } }> | undefined;
  const localizedAspects = item.localizedAspects as Array<{ name?: string; value?: string }> | undefined;
  const primaryImage = item.image as { imageUrl?: string } | undefined;
  const additionalImages = item.additionalImages as Array<{ imageUrl?: string }> | undefined;
  const imageUrls = [
    primaryImage?.imageUrl,
    ...(additionalImages ?? []).map((image) => image.imageUrl),
  ].filter((url): url is string => typeof url === "string" && url.startsWith("https://"));
  const aspects = (localizedAspects ?? []).reduce<Record<string, string[]>>((result, aspect) => {
    if (aspect.name && aspect.value) (result[aspect.name] ??= []).push(aspect.value);
    return result;
  }, {});
  return {
    id: String(item.itemId), title: String(item.title ?? ""),
    seller: String((item.seller as { username?: string })?.username ?? "unknown"),
    price: Number(price?.value ?? 0),
    shipping: Number(shippingOptions?.[0]?.shippingCost?.value ?? 0),
    currency: price?.currency ?? marketplaceCurrency[marketplace],
    condition: String(item.condition ?? "Unknown"), marketplace,
    url: String(item.itemWebUrl ?? ""), aspects,
    imageUrls: [...new Set(imageUrls)],
  };
}

export async function checkEbayConnection(): Promise<{ environment: string; authenticated: true }> {
  await getEbayApplicationToken();
  return { environment: getConfig().ebay.environment, authenticated: true };
}

export async function searchEbay(oem: string, marketplace: Marketplace, condition: ListingCondition = "ANY"): Promise<RawListing[]> {
  if (getConfig().ebay.mode === "demo") return demoListings(oem, marketplace, condition);

  const query = new URLSearchParams({ q: oem, limit: "50" });
  if (condition !== "ANY") query.set("filter", `conditions:{${condition}}`);
  const data = await ebayGet<{ itemSummaries?: Array<Record<string, unknown>> }>(
    `/buy/browse/v1/item_summary/search?${query}`,
    marketplace,
    "eBay listing search",
  );
  const summaries = data.itemSummaries ?? [];
  const detailedItems = await mapWithConcurrency(summaries, 5, async (summary) => {
    const itemId = String(summary.itemId ?? "");
    if (!itemId) return summary;
    try {
      const detail = await ebayGet<Record<string, unknown>>(
        `/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
        marketplace,
        "eBay item details",
      );
      return { ...summary, ...detail };
    } catch (error) {
      if (error instanceof EbayApiError && error.status === 404) return summary;
      throw error;
    }
  });
  return detailedItems.map((item) => toListing(item, marketplace));
}

export async function findSellerBrowseImage(input: {
  marketplace: Marketplace;
  query: string;
  sellerUsername?: string | null;
  limit?: number;
}): Promise<string | null> {
  return (await findSellerBrowseListingSnapshot(input))?.imageUrl ?? null;
}

export interface SellerBrowseListingSnapshot {
  itemId: string | null;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  condition: string | null;
  itemWebUrl: string | null;
  categoryId: string | null;
}

function firstBrowseImage(item: Record<string, unknown>): string | null {
  const primary = (item.image as { imageUrl?: unknown } | undefined)?.imageUrl;
  if (typeof primary === "string" && primary.startsWith("https://")) return primary;
  const thumbnail = Array.isArray(item.thumbnailImages) ? item.thumbnailImages[0] as { imageUrl?: unknown } | undefined : undefined;
  if (typeof thumbnail?.imageUrl === "string" && thumbnail.imageUrl.startsWith("https://")) return thumbnail.imageUrl;
  return null;
}

function browseCategoryId(item: Record<string, unknown>): string | null {
  const leaf = item.leafCategoryIds;
  if (Array.isArray(leaf) && typeof leaf[0] === "string" && leaf[0].trim()) return leaf[0];
  const categories = item.categories;
  if (Array.isArray(categories)) {
    for (const category of categories) {
      if (typeof category !== "object" || category === null) continue;
      const categoryId = (category as Record<string, unknown>).categoryId;
      if (typeof categoryId === "string" && categoryId.trim()) return categoryId;
    }
  }
  return null;
}

export async function findSellerBrowseListingSnapshot(input: {
  marketplace: Marketplace;
  query: string;
  sellerUsername?: string | null;
  limit?: number;
}): Promise<SellerBrowseListingSnapshot | null> {
  if (!input.query.trim()) return null;
  const query = new URLSearchParams({
    q: input.query.trim(),
    limit: String(Math.max(1, Math.min(input.limit ?? 10, 20))),
  });
  if (input.sellerUsername?.trim()) query.set("filter", `sellers:{${input.sellerUsername.trim()}}`);
  const data = await ebayGet<{ itemSummaries?: Array<Record<string, unknown>> }>(
    `/buy/browse/v1/item_summary/search?${query}`,
    input.marketplace,
    "eBay seller listing image search",
  );
  const seller = input.sellerUsername?.trim().toLowerCase();
  for (const item of data.itemSummaries ?? []) {
    const itemSeller = String((item.seller as { username?: string } | undefined)?.username ?? "").trim().toLowerCase();
    if (seller && itemSeller && itemSeller !== seller) continue;
    const price = item.price as { value?: unknown; currency?: unknown } | undefined;
    const priceValue = typeof price?.value === "number"
      ? price.value
      : typeof price?.value === "string" && Number.isFinite(Number(price.value))
        ? Number(price.value)
        : null;
    return {
      itemId: typeof item.itemId === "string" ? item.itemId : null,
      title: typeof item.title === "string" ? item.title : null,
      imageUrl: firstBrowseImage(item),
      price: priceValue,
      currency: typeof price?.currency === "string" ? price.currency : marketplaceCurrency[input.marketplace],
      condition: typeof item.condition === "string" ? item.condition : null,
      itemWebUrl: typeof item.itemWebUrl === "string" ? item.itemWebUrl : null,
      categoryId: browseCategoryId(item),
    };
  }
  return null;
}
