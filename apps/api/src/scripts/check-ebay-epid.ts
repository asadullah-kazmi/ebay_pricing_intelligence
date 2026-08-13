import "../env.js";
import { getConfig } from "../config.js";
import { prisma } from "../db.js";
import { getEbaySellerAccessToken } from "../ebay-seller-oauth.js";
import { getEbayApplicationToken } from "../providers/ebay.js";

type JsonRecord = Record<string, unknown>;

function normalize(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function variants(value: string): string[] {
  const compact = normalize(value);
  const values = new Set([value.trim().toUpperCase(), compact]);
  if (compact.length > 6) {
    values.add(`${compact.slice(0, 3)} ${compact.slice(3, 6)} ${compact.slice(6)}`);
    values.add(`${compact.slice(0, 3)}-${compact.slice(3, 6)}-${compact.slice(6)}`);
  }
  return [...values];
}

async function json(response: Response): Promise<JsonRecord> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as JsonRecord; } catch { return { raw: text.slice(0, 300) }; }
}

function aspectValues(item: JsonRecord, names: string[]): string[] {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const aspects = item.localizedAspects as Array<{ name?: string; value?: string }> | undefined;
  return (aspects ?? [])
    .filter((aspect) => aspect.name && wanted.has(aspect.name.toLowerCase()))
    .map((aspect) => aspect.value ?? "")
    .filter(Boolean);
}

function productRecord(item: JsonRecord): JsonRecord {
  return (item.product as JsonRecord | undefined) ?? {};
}

function extractEpid(item: JsonRecord): string | undefined {
  return typeof item.epid === "string" && item.epid ? item.epid : undefined;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tradingProductReferenceId(token: string, legacyItemId: string): Promise<string | undefined> {
  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetItem",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1349",
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials><eBayAuthToken>${xmlEscape(token)}</eBayAuthToken></RequesterCredentials>
        <ItemID>${xmlEscape(legacyItemId)}</ItemID>
        <DetailLevel>ReturnAll</DetailLevel>
        <IncludeItemSpecifics>true</IncludeItemSpecifics>
      </GetItemRequest>`,
  });
  const body = await response.text();
  const match = body.match(/<ProductReferenceID>([^<]+)<\/ProductReferenceID>/i);
  return response.ok ? match?.[1] : undefined;
}

async function main() {
  const mpn = process.argv[2]?.trim();
  const brand = process.argv[3]?.trim();
  if (!mpn || !brand) throw new Error("Usage: npm run ebay:epid:check -- <mpn> <brand>");

  const config = getConfig();
  if (config.ebay.environment !== "production") throw new Error("This diagnostic currently targets production only");
  const browseToken = await getEbayApplicationToken();
  const connection = await prisma.ebaySellerConnection.findFirst({
    where: { status: { in: ["ACTIVE", "ERROR"] }, environment: "production" },
    orderBy: { updatedAt: "desc" },
    select: { organizationId: true, organization: { select: { name: true } } },
  });
  if (!connection) throw new Error("No production eBay seller connection is available");
  const sellerToken = await getEbaySellerAccessToken(connection.organizationId);

  const forms = variants(mpn);
  const queries = [...new Set(forms.flatMap((form) => [`${brand} ${form}`, form]))];
  const summaries = new Map<string, JsonRecord>();

  console.log("ePID discovery diagnostic", {
    organization: connection.organization.name,
    marketplace: "EBAY_US",
    brand,
    mpn,
    normalizedMpn: normalize(mpn),
    forms,
    queries,
  });

  for (const query of queries) {
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "15");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${browseToken}`,
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    const body = await json(response);
    const items = (body.itemSummaries as JsonRecord[] | undefined) ?? [];
    for (const item of items) {
      const itemId = typeof item.itemId === "string" ? item.itemId : "";
      if (itemId && !summaries.has(itemId)) summaries.set(itemId, item);
    }
    console.log({ browseQuery: query, httpStatus: response.status, returned: items.length });
  }

  const targetMpn = normalize(mpn);
  const candidates = [...summaries.values()]
    .map((item) => ({
      item,
      exactTitleMpn: normalize(String(item.title ?? "")).includes(targetMpn),
      exactTitleBrand: new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(String(item.title ?? "")),
    }))
    .sort((left, right) => Number(right.exactTitleMpn) - Number(left.exactTitleMpn) || Number(right.exactTitleBrand) - Number(left.exactTitleBrand))
    .slice(0, 15);

  console.log({ uniqueBrowseListings: summaries.size, inspectedListings: candidates.length });
  const discovered = new Map<string, Set<string>>();
  const inspected: Array<JsonRecord> = [];

  for (const candidate of candidates) {
    const summary = candidate.item;
    const itemId = String(summary.itemId ?? "");
    const detailUrl = new URL(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`);
    detailUrl.searchParams.set("fieldgroups", "PRODUCT");
    const response = await fetch(detailUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${browseToken}`,
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    const detail = response.ok ? await json(response) : {};
    const combined = { ...summary, ...detail };
    const product = productRecord(combined);
    const epids = [extractEpid(summary), extractEpid(detail)].filter((value): value is string => Boolean(value));
    for (const epid of epids) {
      const sources = discovered.get(epid) ?? new Set<string>();
      sources.add(String(summary.legacyItemId ?? itemId));
      discovered.set(epid, sources);
    }
    const productMpns = Array.isArray(product.mpns) ? product.mpns.map(String) : [];
    const listedMpns = aspectValues(combined, ["MPN", "Manufacturer Part Number", "OE/OEM Part Number"]);
    inspected.push({
      legacyItemId: summary.legacyItemId,
      title: summary.title,
      summaryEpid: extractEpid(summary),
      detailEpid: extractEpid(detail),
      productBrand: product.brand,
      productMpns,
      listedMpns,
      exactMpnEvidence: [...productMpns, ...listedMpns].some((value) => normalize(value) === targetMpn) || candidate.exactTitleMpn,
      exactBrandEvidence: String(product.brand ?? "").toLowerCase() === brand.toLowerCase()
        || aspectValues(combined, ["Brand"]).some((value) => value.toLowerCase() === brand.toLowerCase())
        || candidate.exactTitleBrand,
    });
  }

  // Trading GetItem can expose ProductReferenceID for catalog-associated legacy listings.
  for (const candidate of candidates) {
    const legacyItemId = String(candidate.item.legacyItemId ?? "");
    if (!legacyItemId) continue;
    const epid = await tradingProductReferenceId(sellerToken, legacyItemId);
    if (epid) {
      const sources = discovered.get(epid) ?? new Set<string>();
      sources.add(legacyItemId);
      discovered.set(epid, sources);
    }
  }

  console.log("\nInspected Browse listings");
  inspected.forEach((item, index) => console.log({ result: index + 1, ...item }));
  console.log("\nDiscovered ePIDs", [...discovered].map(([epid, sources]) => ({ epid, listingIds: [...sources] })));

  console.log("\nCatalog validation");
  for (const [epid, sources] of discovered) {
    const response = await fetch(`https://api.ebay.com/commerce/catalog/v1_beta/product/${encodeURIComponent(epid)}`, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
    const product = await json(response);
    const productMpns = Array.isArray(product.mpn) ? product.mpn.map(String) : [];
    console.log({
      epid,
      sourceListings: [...sources],
      httpStatus: response.status,
      title: product.title,
      brand: product.brand,
      mpn: productMpns,
      exactBrand: String(product.brand ?? "").toLowerCase() === brand.toLowerCase(),
      exactMpn: productMpns.some((value) => normalize(value) === targetMpn),
    });
  }

  console.log("\nConclusion", {
    discoveredEpidCount: discovered.size,
    note: discovered.size
      ? "Only an ePID whose Catalog product validates against the requested Brand/MPN is safe to use."
      : "No active inspected listing exposed an ePID through Browse or Trading ProductReferenceID.",
  });
}

main()
  .catch((error) => {
    console.error("ePID diagnostic failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
