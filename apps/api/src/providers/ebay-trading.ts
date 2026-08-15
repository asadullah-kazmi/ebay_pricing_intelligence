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

export interface EbayTradingOrderLine {
  itemId: string | null;
  transactionId: string | null;
  orderLineItemId: string | null;
  sku: string | null;
  title: string | null;
  quantityPurchased: number | null;
  transactionPrice: number | null;
  transactionCurrency: string | null;
}

export interface EbayTradingOrderSummary {
  sourceKey: string;
  orderId: string;
  legacyOrderId: string | null;
  buyerUsername: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  orderStatus: string | null;
  checkoutStatus: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  paidTime: string | null;
  createdTime: string | null;
  shippedTime: string | null;
  totalValue: number | null;
  totalCurrency: string | null;
  quantity: number | null;
  itemCount: number;
  firstSku: string | null;
  firstTitle: string | null;
  shippingService: string | null;
  shippingValue: number | null;
  shippingCurrency: string | null;
  shippingAddress: Record<string, unknown> | null;
  transactions: EbayTradingOrderLine[];
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

function parseAddress(block: string): Record<string, unknown> | null {
  if (!block) return null;
  const address = {
    name: text(firstTag(block, "Name")),
    street1: text(firstTag(block, "Street1")),
    street2: text(firstTag(block, "Street2")),
    city: text(firstTag(block, "CityName")),
    stateOrProvince: text(firstTag(block, "StateOrProvince")),
    country: text(firstTag(block, "Country")),
    countryName: text(firstTag(block, "CountryName")),
    postalCode: text(firstTag(block, "PostalCode")),
    phone: text(firstTag(block, "Phone")),
  };
  return Object.values(address).some(Boolean) ? address : null;
}

function parseTradingOrderLine(block: string): EbayTradingOrderLine {
  const itemBlock = firstTag(block, "Item") ?? "";
  const transactionPrice = priceTag(block, "TransactionPrice");
  return {
    itemId: text(firstTag(itemBlock, "ItemID")),
    transactionId: text(firstTag(block, "TransactionID")),
    orderLineItemId: text(firstTag(block, "OrderLineItemID")),
    sku: text(firstTag(itemBlock, "SKU")) ?? text(firstTag(block, "SKU")),
    title: text(firstTag(itemBlock, "Title")),
    quantityPurchased: numeric(firstTag(block, "QuantityPurchased")),
    transactionPrice: transactionPrice.value,
    transactionCurrency: transactionPrice.currency,
  };
}

function parseTradingOrder(block: string): EbayTradingOrderSummary | null {
  const orderId = text(firstTag(block, "OrderID"));
  if (!orderId) return null;
  const checkoutStatusBlock = firstTag(block, "CheckoutStatus") ?? "";
  const shippingServiceBlock = firstTag(block, "ShippingServiceSelected") ?? "";
  const shippingAddressBlock = firstTag(block, "ShippingAddress") ?? "";
  const total = priceTag(block, "Total");
  const amountPaid = priceTag(block, "AmountPaid");
  const shipping = priceTag(shippingServiceBlock, "ShippingServiceCost");
  const transactionArray = firstTag(block, "TransactionArray") ?? "";
  const transactions = tagBlocks(transactionArray, "Transaction").map(parseTradingOrderLine);
  const quantity = transactions.reduce((sum, line) => sum + (line.quantityPurchased ?? 0), 0);
  const firstLine = transactions.find((line) => line.title || line.sku) ?? null;
  const createdTime = text(firstTag(block, "CreatedTime"));
  const paidTime = text(firstTag(block, "PaidTime"));
  const shippedTime = text(firstTag(block, "ShippedTime"));
  const orderStatus = text(firstTag(block, "OrderStatus"));
  const checkoutStatus = text(firstTag(checkoutStatusBlock, "Status"));
  const paymentStatus = text(firstTag(checkoutStatusBlock, "eBayPaymentStatus"));
  const fulfillmentStatus = shippedTime ? "SHIPPED" : paidTime || paymentStatus === "NoPaymentFailure" ? "AWAITING_SHIPMENT" : checkoutStatus;
  return {
    sourceKey: `TRADING_ORDER:${orderId}`,
    orderId,
    legacyOrderId: text(firstTag(block, "ExtendedOrderID")),
    buyerUsername: text(firstTag(block, "BuyerUserID")),
    buyerEmail: text(firstTag(block, "BuyerEmail")),
    buyerName: text(firstTag(shippingAddressBlock, "Name")),
    orderStatus,
    checkoutStatus,
    paymentStatus,
    fulfillmentStatus,
    paidTime,
    createdTime,
    shippedTime,
    totalValue: total.value ?? amountPaid.value,
    totalCurrency: total.currency ?? amountPaid.currency,
    quantity: quantity || null,
    itemCount: transactions.length,
    firstSku: firstLine?.sku ?? null,
    firstTitle: firstLine?.title ?? null,
    shippingService: text(firstTag(shippingServiceBlock, "ShippingService")),
    shippingValue: shipping.value,
    shippingCurrency: shipping.currency,
    shippingAddress: parseAddress(shippingAddressBlock),
    transactions,
    payload: {
      orderId,
      legacyOrderId: text(firstTag(block, "ExtendedOrderID")),
      createdTime,
      paidTime,
      shippedTime,
      orderStatus,
      checkoutStatus,
      paymentStatus,
      shippingService: text(firstTag(shippingServiceBlock, "ShippingService")),
      total: { value: total.value ?? amountPaid.value, currency: total.currency ?? amountPaid.currency },
    },
  };
}

export async function getTradingOrdersPage(input: {
  organizationId: string;
  connectionId: string;
  marketplace: string;
  pageNumber?: number;
  entriesPerPage?: number;
  createTimeFrom: Date;
  createTimeTo: Date;
}): Promise<{ orders: EbayTradingOrderSummary[]; total: number; pageNumber: number; entriesPerPage: number; hasMore: boolean }> {
  const pageNumber = input.pageNumber ?? 1;
  const entriesPerPage = input.entriesPerPage ?? 100;
  const xml = await tradingRequest({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    marketplace: input.marketplace,
    callName: "GetOrders",
    body: `
  <DetailLevel>ReturnAll</DetailLevel>
  <OrderRole>Seller</OrderRole>
  <OrderStatus>All</OrderStatus>
  <CreateTimeFrom>${escapeXml(input.createTimeFrom.toISOString())}</CreateTimeFrom>
  <CreateTimeTo>${escapeXml(input.createTimeTo.toISOString())}</CreateTimeTo>
  <Pagination>
    <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
  <OutputSelector>HasMoreOrders</OutputSelector>
  <OutputSelector>PaginationResult</OutputSelector>
  <OutputSelector>OrderArray.Order.OrderID</OutputSelector>
  <OutputSelector>OrderArray.Order.ExtendedOrderID</OutputSelector>
  <OutputSelector>OrderArray.Order.BuyerUserID</OutputSelector>
  <OutputSelector>OrderArray.Order.BuyerEmail</OutputSelector>
  <OutputSelector>OrderArray.Order.OrderStatus</OutputSelector>
  <OutputSelector>OrderArray.Order.CheckoutStatus</OutputSelector>
  <OutputSelector>OrderArray.Order.CreatedTime</OutputSelector>
  <OutputSelector>OrderArray.Order.PaidTime</OutputSelector>
  <OutputSelector>OrderArray.Order.ShippedTime</OutputSelector>
  <OutputSelector>OrderArray.Order.Total</OutputSelector>
  <OutputSelector>OrderArray.Order.AmountPaid</OutputSelector>
  <OutputSelector>OrderArray.Order.ShippingServiceSelected</OutputSelector>
  <OutputSelector>OrderArray.Order.ShippingAddress</OutputSelector>
  <OutputSelector>OrderArray.Order.TransactionArray.Transaction.Item.ItemID</OutputSelector>
  <OutputSelector>OrderArray.Order.TransactionArray.Transaction.Item.SKU</OutputSelector>
  <OutputSelector>OrderArray.Order.TransactionArray.Transaction.Item.Title</OutputSelector>
  <OutputSelector>OrderArray.Order.TransactionArray.Transaction.TransactionID</OutputSelector>
  <OutputSelector>OrderArray.Order.TransactionArray.Transaction.OrderLineItemID</OutputSelector>
  <OutputSelector>OrderArray.Order.TransactionArray.Transaction.QuantityPurchased</OutputSelector>
  <OutputSelector>OrderArray.Order.TransactionArray.Transaction.TransactionPrice</OutputSelector>`,
  });
  const pagination = firstTag(xml, "PaginationResult") ?? "";
  const total = numeric(firstTag(pagination, "TotalNumberOfEntries")) ?? 0;
  const hasMore = firstTag(xml, "HasMoreOrders") === "true";
  const orderArray = firstTag(xml, "OrderArray") ?? "";
  const orders = tagBlocks(orderArray, "Order")
    .map(parseTradingOrder)
    .filter((order): order is EbayTradingOrderSummary => Boolean(order));
  return { orders, total, pageNumber, entriesPerPage, hasMore };
}
