import { getConfig } from "../config.js";
import { getEbaySellerAccessToken } from "../ebay-seller-oauth.js";
import { EbayApiError } from "./ebay.js";

const compatibilityLevel = "1231";

export const EBAY_TRADING_SYNC_MARKETPLACES = [
  "EBAY_US",
  "EBAY_MOTORS_US",
  "EBAY_CA",
  "EBAY_GB",
  "EBAY_AU",
  "EBAY_AT",
  "EBAY_BE_FR",
  "EBAY_FR",
  "EBAY_DE",
  "EBAY_IT",
  "EBAY_BE_NL",
  "EBAY_NL",
  "EBAY_ES",
  "EBAY_CH",
  "EBAY_HK",
  "EBAY_IN",
  "EBAY_IE",
  "EBAY_MY",
  "EBAY_CA_FR",
  "EBAY_PH",
  "EBAY_PL",
  "EBAY_SG",
] as const;

const tradingSiteIds: Record<string, string> = {
  EBAY_US: "0",
  EBAY_MOTORS_US: "100",
  EBAY_CA: "2",
  EBAY_GB: "3",
  EBAY_AU: "15",
  EBAY_AT: "16",
  EBAY_BE_FR: "23",
  EBAY_FR: "71",
  EBAY_DE: "77",
  EBAY_IT: "101",
  EBAY_BE_NL: "123",
  EBAY_NL: "146",
  EBAY_ES: "186",
  EBAY_CH: "193",
  EBAY_HK: "201",
  EBAY_IN: "203",
  EBAY_IE: "205",
  EBAY_MY: "207",
  EBAY_CA_FR: "210",
  EBAY_PH: "211",
  EBAY_PL: "212",
  EBAY_SG: "216",
};

function tradingBase(): string {
  return getConfig().ebay.environment === "production" ? "https://api.ebay.com/ws/api.dll" : "https://api.sandbox.ebay.com/ws/api.dll";
}

export function tradingSiteId(marketplace: string): string {
  return tradingSiteIds[marketplace] ?? "0";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function firstTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match?.[1] == null ? null : decodeXml(match[1].trim());
}

function tagBlocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "gi"))].map((match) => match[0]);
}

function priceTag(xml: string, tag: string): { value: number | null; currency: string | null } {
  const match = new RegExp(`<${tag}(?:\\s[^>]*currencyID="([^"]+)")?[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  if (!match) return { value: null, currency: null };
  return { currency: text(match[1]), value: numeric(decodeXml(match[2]?.trim() ?? "")) };
}

function parseErrors(xml: string): string {
  const errors = tagBlocks(xml, "Errors")
    .map((block) => firstTag(block, "LongMessage") ?? firstTag(block, "ShortMessage"))
    .filter((message): message is string => Boolean(message));
  return errors.join("; ");
}

async function tradingRequest(input: {
  organizationId: string;
  connectionId: string;
  marketplace: string;
  callName: string;
  body: string;
}): Promise<string> {
  const token = await getEbaySellerAccessToken(input.organizationId, input.connectionId);
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<${input.callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${escapeXml(token)}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  ${input.body}
</${input.callName}Request>`;
  const response = await fetch(tradingBase(), {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-COMPATIBILITY-LEVEL": compatibilityLevel,
      "X-EBAY-API-CALL-NAME": input.callName,
      "X-EBAY-API-SITEID": tradingSiteId(input.marketplace),
    },
    body: envelope,
  });
  const xml = await response.text();
  const ack = firstTag(xml, "Ack");
  if (!response.ok || ack === "Failure") {
    const detail = parseErrors(xml);
    throw new EbayApiError(`eBay Trading ${input.callName} failed (${response.status})${detail ? `: ${detail}` : ""}`, response.status, `Trading ${input.callName}`);
  }
  return xml;
}

export interface EbayTradingActiveListing {
  sourceKey: string;
  listingId: string;
  sku: string | null;
  title: string | null;
  condition: string | null;
  quantity: number | null;
  quantitySold: number | null;
  price: number | null;
  currency: string | null;
  listingStatus: string | null;
  categoryId: string | null;
  imageUrl: string | null;
  payload: Record<string, unknown>;
}

function parseTradingItem(block: string): EbayTradingActiveListing | null {
  const itemId = text(firstTag(block, "ItemID"));
  if (!itemId) return null;
  const sku = text(firstTag(block, "SKU"));
  const quantity = numeric(firstTag(block, "Quantity"));
  const quantitySold = numeric(firstTag(block, "QuantitySold"));
  const price = priceTag(block, "CurrentPrice");
  const imageUrl = text(firstTag(block, "GalleryURL")) ?? text(firstTag(block, "PictureURL"));
  const categoryBlock = firstTag(block, "PrimaryCategory") ?? "";
  const sellingStatusBlock = firstTag(block, "SellingStatus") ?? "";
  return {
    sourceKey: `TRADING:${itemId}`,
    listingId: itemId,
    sku,
    title: text(firstTag(block, "Title")),
    condition: text(firstTag(block, "ConditionDisplayName")) ?? text(firstTag(block, "ConditionID")),
    quantity,
    quantitySold,
    price: price.value,
    currency: price.currency,
    listingStatus: text(firstTag(sellingStatusBlock, "ListingStatus")) ?? "Active",
    categoryId: text(firstTag(categoryBlock, "CategoryID")),
    imageUrl,
    payload: {
      itemId,
      sku,
      title: text(firstTag(block, "Title")),
      quantity,
      quantitySold,
      galleryUrl: imageUrl,
      listingType: text(firstTag(block, "ListingType")),
      startTime: text(firstTag(block, "StartTime")),
      endTime: text(firstTag(block, "EndTime")),
    },
  };
}

export async function getTradingActiveListingsPage(input: {
  organizationId: string;
  connectionId: string;
  marketplace: string;
  pageNumber?: number;
  entriesPerPage?: number;
}): Promise<{ listings: EbayTradingActiveListing[]; total: number; pageNumber: number; entriesPerPage: number; hasMore: boolean }> {
  const pageNumber = input.pageNumber ?? 1;
  const entriesPerPage = input.entriesPerPage ?? 200;
  const xml = await tradingRequest({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    marketplace: input.marketplace,
    callName: "GetMyeBaySelling",
    body: `
  <DetailLevel>ReturnAll</DetailLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>`,
  });
  const activeList = firstTag(xml, "ActiveList") ?? "";
  const pagination = firstTag(activeList, "PaginationResult") ?? "";
  const total = numeric(firstTag(pagination, "TotalNumberOfEntries")) ?? 0;
  const hasMore = firstTag(activeList, "HasMoreItems") === "true";
  const itemArray = firstTag(activeList, "ItemArray") ?? "";
  const listings = tagBlocks(itemArray, "Item")
    .map(parseTradingItem)
    .filter((item): item is EbayTradingActiveListing => Boolean(item));
  return { listings, total, pageNumber, entriesPerPage, hasMore };
}

export async function getTradingSellerListPage(input: {
  organizationId: string;
  connectionId: string;
  marketplace: string;
  pageNumber?: number;
  entriesPerPage?: number;
  endTimeFrom: Date;
  endTimeTo: Date;
}): Promise<{ listings: EbayTradingActiveListing[]; total: number; pageNumber: number; entriesPerPage: number; hasMore: boolean }> {
  const pageNumber = input.pageNumber ?? 1;
  const entriesPerPage = input.entriesPerPage ?? 200;
  const xml = await tradingRequest({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    marketplace: input.marketplace,
    callName: "GetSellerList",
    body: `
  <DetailLevel>ReturnAll</DetailLevel>
  <GranularityLevel>Fine</GranularityLevel>
  <EndTimeFrom>${escapeXml(input.endTimeFrom.toISOString())}</EndTimeFrom>
  <EndTimeTo>${escapeXml(input.endTimeTo.toISOString())}</EndTimeTo>
  <Pagination>
    <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
  <OutputSelector>HasMoreItems</OutputSelector>
  <OutputSelector>PaginationResult</OutputSelector>
  <OutputSelector>ItemArray.Item.ItemID</OutputSelector>
  <OutputSelector>ItemArray.Item.SKU</OutputSelector>
  <OutputSelector>ItemArray.Item.Title</OutputSelector>
  <OutputSelector>ItemArray.Item.Quantity</OutputSelector>
  <OutputSelector>ItemArray.Item.SellingStatus.QuantitySold</OutputSelector>
  <OutputSelector>ItemArray.Item.SellingStatus.CurrentPrice</OutputSelector>
  <OutputSelector>ItemArray.Item.SellingStatus.ListingStatus</OutputSelector>
  <OutputSelector>ItemArray.Item.PictureDetails.GalleryURL</OutputSelector>
  <OutputSelector>ItemArray.Item.PictureDetails.PictureURL</OutputSelector>
  <OutputSelector>ItemArray.Item.PrimaryCategory.CategoryID</OutputSelector>
  <OutputSelector>ItemArray.Item.ConditionDisplayName</OutputSelector>
  <OutputSelector>ItemArray.Item.ConditionID</OutputSelector>
  <OutputSelector>ItemArray.Item.ListingType</OutputSelector>
  <OutputSelector>ItemArray.Item.StartTime</OutputSelector>
  <OutputSelector>ItemArray.Item.EndTime</OutputSelector>`,
  });
  const pagination = firstTag(xml, "PaginationResult") ?? "";
  const total = numeric(firstTag(pagination, "TotalNumberOfEntries")) ?? 0;
  const hasMore = firstTag(xml, "HasMoreItems") === "true";
  const itemArray = firstTag(xml, "ItemArray") ?? "";
  const listings = tagBlocks(itemArray, "Item")
    .map(parseTradingItem)
    .filter((item): item is EbayTradingActiveListing => Boolean(item));
  return { listings, total, pageNumber, entriesPerPage, hasMore };
}
