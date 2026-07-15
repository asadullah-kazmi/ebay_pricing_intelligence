import type { Marketplace, RawListing } from "../types.js";

const marketplaceCurrency: Record<Marketplace, string> = {
  EBAY_US: "USD",
  EBAY_GB: "GBP",
  EBAY_DE: "EUR",
};

function demoListings(oem: string, marketplace: Marketplace): RawListing[] {
  const currency = marketplaceCurrency[marketplace];
  const values = [82.5, 91, 97.49, 105, 118.25];
  return values.map((price, index) => ({
    id: `demo-${marketplace}-${index + 1}`,
    title: `${index % 2 ? "Genuine" : "OEM"} automotive part ${oem}`,
    seller: index === 3 ? "my-parts-store" : `competitor-${index + 1}`,
    price,
    shipping: index % 2 ? 0 : 8.95,
    currency,
    condition: index === 4 ? "Used" : "New",
    marketplace,
    url: "https://www.ebay.com/",
    aspects: index === 4
      ? { "Manufacturer Part Number": ["UNRELATED-123"] }
      : { "Manufacturer Part Number": [oem], "OE/OEM Part Number": [oem] },
  }));
}

export async function searchEbay(oem: string, marketplace: Marketplace): Promise<RawListing[]> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return demoListings(oem, marketplace);

  const production = process.env.EBAY_ENVIRONMENT === "production";
  const identityBase = production ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
  const tokenResponse = await fetch(`${identityBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
  });
  if (!tokenResponse.ok) throw new Error(`eBay authorization failed (${tokenResponse.status})`);
  const token = await tokenResponse.json() as { access_token: string };
  const response = await fetch(`${identityBase}/buy/browse/v1/item_summary/search?q=${encodeURIComponent(oem)}&limit=50`, {
    headers: { Authorization: `Bearer ${token.access_token}`, "X-EBAY-C-MARKETPLACE-ID": marketplace },
  });
  if (!response.ok) throw new Error(`eBay search failed (${response.status})`);
  const data = await response.json() as { itemSummaries?: Array<Record<string, unknown>> };
  const summaries = data.itemSummaries ?? [];
  const detailedItems = await Promise.all(summaries.map(async (summary) => {
    const itemId = String(summary.itemId ?? "");
    const detailResponse = await fetch(`${identityBase}/buy/browse/v1/item/${encodeURIComponent(itemId)}`, {
      headers: { Authorization: `Bearer ${token.access_token}`, "X-EBAY-C-MARKETPLACE-ID": marketplace },
    });
    if (!detailResponse.ok) return summary;
    return { ...summary, ...await detailResponse.json() as Record<string, unknown> };
  }));

  return detailedItems.map((item) => {
    const price = item.price as { value?: string; currency?: string } | undefined;
    const shippingOptions = item.shippingOptions as Array<{ shippingCost?: { value?: string } }> | undefined;
    const localizedAspects = item.localizedAspects as Array<{ name?: string; value?: string }> | undefined;
    const aspects = (localizedAspects ?? []).reduce<Record<string, string[]>>((result, aspect) => {
      if (!aspect.name || !aspect.value) return result;
      (result[aspect.name] ??= []).push(aspect.value);
      return result;
    }, {});
    return {
      id: String(item.itemId), title: String(item.title ?? ""), seller: String((item.seller as { username?: string })?.username ?? "unknown"),
      price: Number(price?.value ?? 0), shipping: Number(shippingOptions?.[0]?.shippingCost?.value ?? 0), currency: price?.currency ?? marketplaceCurrency[marketplace],
      condition: String(item.condition ?? "Unknown"), marketplace, url: String(item.itemWebUrl ?? ""), aspects,
    };
  });
}
