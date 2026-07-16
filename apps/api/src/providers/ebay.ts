import { getConfig } from "../config.js";
import type { Marketplace, RawListing } from "../types.js";

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

async function getApplicationToken(): Promise<string> {
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
  const token = await getApplicationToken();
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

function demoListings(oem: string, marketplace: Marketplace): RawListing[] {
  const currency = marketplaceCurrency[marketplace];
  return [82.5, 91, 97.49, 105, 118.25].map((price, index) => ({
    id: `demo-${marketplace}-${index + 1}`,
    title: `${index % 2 ? "Genuine" : "OEM"} automotive part ${oem}`,
    seller: index === 3 ? "my-parts-store" : `competitor-${index + 1}`,
    price, shipping: index % 2 ? 0 : 8.95, currency,
    condition: index === 4 ? "Used" : "New", marketplace,
    url: "https://www.ebay.com/",
    aspects: (index === 4
      ? { "Manufacturer Part Number": ["UNRELATED-123"] }
      : { "Manufacturer Part Number": [oem], "OE/OEM Part Number": [oem] }) as Record<string, string[]>,
  }));
}

function toListing(item: Record<string, unknown>, marketplace: Marketplace): RawListing {
  const price = item.price as { value?: string; currency?: string } | undefined;
  const shippingOptions = item.shippingOptions as Array<{ shippingCost?: { value?: string } }> | undefined;
  const localizedAspects = item.localizedAspects as Array<{ name?: string; value?: string }> | undefined;
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
  };
}

export async function checkEbayConnection(): Promise<{ environment: string; authenticated: true }> {
  await getApplicationToken();
  return { environment: getConfig().ebay.environment, authenticated: true };
}

export async function searchEbay(oem: string, marketplace: Marketplace): Promise<RawListing[]> {
  if (getConfig().ebay.mode === "demo") return demoListings(oem, marketplace);

  const query = new URLSearchParams({ q: oem, limit: "50" });
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
