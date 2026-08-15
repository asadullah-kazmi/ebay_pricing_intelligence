import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { EBAY_TRADING_SYNC_MARKETPLACES, getTradingOrdersPage, type EbayTradingOrderSummary } from "./providers/ebay-trading.js";

export class EbayOrderManagementError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 | 409 | 502 = 400) {
    super(message);
    this.name = "EbayOrderManagementError";
  }
}

export type EbayOrderCacheRefreshStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
export type EbayOrderStatusFilter = "ALL" | "PAID" | "AWAITING_SHIPMENT" | "SHIPPED" | "CANCELLED";

export interface EbayOrderCacheRefreshProgress {
  key: string;
  status: EbayOrderCacheRefreshStatus;
  percent: number;
  message: string;
  accountsTotal: number;
  accountsCompleted: number;
  currentAccount: string | null;
  totalOrders: number;
  ordersFetched: number;
  cacheSaved: number;
  errors: number;
  errorMessages: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EbayStoreOrderRow {
  key: string;
  account: { id: string; username: string | null; isDefault: boolean; marketplace: string };
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
  itemCount: number | null;
  firstSku: string | null;
  firstTitle: string | null;
  shippingService: string | null;
  shippingValue: number | null;
  shippingCurrency: string | null;
  shippingAddress: Record<string, unknown> | null;
  transactions: Array<Record<string, unknown>>;
  syncedAt: string;
}

type ActiveConnection = {
  id: string;
  username: string | null;
  isDefault: boolean;
  defaultMarketplace: string;
};

const runningOrderRefreshes = new Map<string, Promise<unknown>>();
const orderRefreshProgress = new Map<string, EbayOrderCacheRefreshProgress>();

function syncKey(input: { organizationId: string; connectionId?: string }) {
  return `${input.organizationId}:${input.connectionId ?? "all"}`;
}

function idleProgress(key: string): EbayOrderCacheRefreshProgress {
  return {
    key,
    status: "IDLE",
    percent: 0,
    message: "Order sync is idle.",
    accountsTotal: 0,
    accountsCompleted: 0,
    currentAccount: null,
    totalOrders: 0,
    ordersFetched: 0,
    cacheSaved: 0,
    errors: 0,
    errorMessages: [],
    startedAt: null,
    finishedAt: null,
  };
}

function setProgress(key: string, patch: Partial<EbayOrderCacheRefreshProgress>) {
  const current = orderRefreshProgress.get(key) ?? idleProgress(key);
  const next = {
    ...current,
    ...patch,
    percent: Math.max(0, Math.min(100, Math.round(patch.percent ?? current.percent))),
  };
  orderRefreshProgress.set(key, next);
  return next;
}

export function getEbayStoreOrderCacheRefreshProgress(input: { organizationId: string; connectionId?: string }) {
  return orderRefreshProgress.get(syncKey(input)) ?? idleProgress(syncKey(input));
}

function syncMarketplacesForConnection(connection: ActiveConnection): string[] {
  const defaultMarketplace = connection.defaultMarketplace?.trim() || "EBAY_US";
  return [
    defaultMarketplace,
    ...EBAY_TRADING_SYNC_MARKETPLACES.filter((marketplace) => marketplace !== defaultMarketplace),
  ];
}

async function listActiveConnections(input: { organizationId: string; connectionId?: string }) {
  const connections = await prisma.ebaySellerConnection.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      ...(input.connectionId ? { id: input.connectionId } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { username: "asc" }, { createdAt: "asc" }],
    select: { id: true, username: true, isDefault: true, defaultMarketplace: true },
  });
  if (input.connectionId && connections.length === 0) throw new EbayOrderManagementError("Connected eBay account not found", 404);
  return connections;
}

function toJson(value: Record<string, unknown> | Array<Record<string, unknown>> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value ? value as Prisma.InputJsonValue : Prisma.JsonNull;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function orderToRow(input: {
  order: EbayTradingOrderSummary;
  account: EbayStoreOrderRow["account"];
  syncedAt: Date;
}): EbayStoreOrderRow {
  return {
    key: `${input.account.id}:${input.account.marketplace}:${input.order.sourceKey}`,
    account: input.account,
    orderId: input.order.orderId,
    legacyOrderId: input.order.legacyOrderId,
    buyerUsername: input.order.buyerUsername,
    buyerEmail: input.order.buyerEmail,
    buyerName: input.order.buyerName,
    orderStatus: input.order.orderStatus,
    checkoutStatus: input.order.checkoutStatus,
    paymentStatus: input.order.paymentStatus,
    fulfillmentStatus: input.order.fulfillmentStatus,
    paidTime: input.order.paidTime,
    createdTime: input.order.createdTime,
    shippedTime: input.order.shippedTime,
    totalValue: input.order.totalValue,
    totalCurrency: input.order.totalCurrency,
    quantity: input.order.quantity,
    itemCount: input.order.itemCount,
    firstSku: input.order.firstSku,
    firstTitle: input.order.firstTitle,
    shippingService: input.order.shippingService,
    shippingValue: input.order.shippingValue,
    shippingCurrency: input.order.shippingCurrency,
    shippingAddress: input.order.shippingAddress,
    transactions: input.order.transactions as unknown as Array<Record<string, unknown>>,
    syncedAt: input.syncedAt.toISOString(),
  };
}

function cachedRowToOrderRow(row: {
  id: string;
  marketplace: string;
  orderId: string;
  legacyOrderId: string | null;
  buyerUsername: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  orderStatus: string | null;
  checkoutStatus: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  paidTime: Date | null;
  createdTime: Date | null;
  shippedTime: Date | null;
  totalValue: Prisma.Decimal | null;
  totalCurrency: string | null;
  quantity: number | null;
  itemCount: number | null;
  firstSku: string | null;
  firstTitle: string | null;
  shippingService: string | null;
  shippingValue: Prisma.Decimal | null;
  shippingCurrency: string | null;
  shippingAddress: Prisma.JsonValue | null;
  transactions: Prisma.JsonValue | null;
  syncedAt: Date;
  ebaySellerConnection: { id: string; username: string | null; isDefault: boolean; defaultMarketplace: string };
}): EbayStoreOrderRow {
  return {
    key: row.id,
    account: {
      id: row.ebaySellerConnection.id,
      username: row.ebaySellerConnection.username,
      isDefault: row.ebaySellerConnection.isDefault,
      marketplace: row.marketplace || row.ebaySellerConnection.defaultMarketplace || "EBAY_US",
    },
    orderId: row.orderId,
    legacyOrderId: row.legacyOrderId,
    buyerUsername: row.buyerUsername,
    buyerEmail: row.buyerEmail,
    buyerName: row.buyerName,
    orderStatus: row.orderStatus,
    checkoutStatus: row.checkoutStatus,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    paidTime: row.paidTime?.toISOString() ?? null,
    createdTime: row.createdTime?.toISOString() ?? null,
    shippedTime: row.shippedTime?.toISOString() ?? null,
    totalValue: row.totalValue == null ? null : Number(row.totalValue),
    totalCurrency: row.totalCurrency,
    quantity: row.quantity,
    itemCount: row.itemCount,
    firstSku: row.firstSku,
    firstTitle: row.firstTitle,
    shippingService: row.shippingService,
    shippingValue: row.shippingValue == null ? null : Number(row.shippingValue),
    shippingCurrency: row.shippingCurrency,
    shippingAddress: typeof row.shippingAddress === "object" && row.shippingAddress !== null && !Array.isArray(row.shippingAddress)
      ? row.shippingAddress as Record<string, unknown>
      : null,
    transactions: Array.isArray(row.transactions) ? row.transactions as Array<Record<string, unknown>> : [],
    syncedAt: row.syncedAt.toISOString(),
  };
}

const orderCacheRowSelect = {
  id: true,
  marketplace: true,
  orderId: true,
  legacyOrderId: true,
  buyerUsername: true,
  buyerEmail: true,
  buyerName: true,
  orderStatus: true,
  checkoutStatus: true,
  paymentStatus: true,
  fulfillmentStatus: true,
  paidTime: true,
  createdTime: true,
  shippedTime: true,
  totalValue: true,
  totalCurrency: true,
  quantity: true,
  itemCount: true,
  firstSku: true,
  firstTitle: true,
  shippingService: true,
  shippingValue: true,
  shippingCurrency: true,
  shippingAddress: true,
  transactions: true,
  syncedAt: true,
  ebaySellerConnection: { select: { id: true, username: true, isDefault: true, defaultMarketplace: true } },
} satisfies Prisma.EbayOrderCacheItemSelect;

function orderCacheWhere(input: {
  organizationId: string;
  connectionId?: string;
  q?: string;
  status?: EbayOrderStatusFilter;
}): Prisma.EbayOrderCacheItemWhereInput {
  const where: Prisma.EbayOrderCacheItemWhereInput = {
    organizationId: input.organizationId,
    ...(input.connectionId ? { ebaySellerConnectionId: input.connectionId } : {}),
  };
  const and: Prisma.EbayOrderCacheItemWhereInput[] = [];
  const query = input.q?.trim();
  if (query) {
    and.push({
      OR: [
        { orderId: { contains: query, mode: "insensitive" } },
        { legacyOrderId: { contains: query, mode: "insensitive" } },
        { buyerUsername: { contains: query, mode: "insensitive" } },
        { buyerEmail: { contains: query, mode: "insensitive" } },
        { buyerName: { contains: query, mode: "insensitive" } },
        { firstSku: { contains: query, mode: "insensitive" } },
        { firstTitle: { contains: query, mode: "insensitive" } },
        { ebaySellerConnection: { username: { contains: query, mode: "insensitive" } } },
      ],
    });
  }
  const status = input.status ?? "ALL";
  if (status === "PAID") and.push({ paymentStatus: { not: null } });
  if (status === "AWAITING_SHIPMENT") and.push({ fulfillmentStatus: "AWAITING_SHIPMENT" });
  if (status === "SHIPPED") and.push({ OR: [{ fulfillmentStatus: "SHIPPED" }, { shippedTime: { not: null } }] });
  if (status === "CANCELLED") and.push({ orderStatus: { contains: "Cancel", mode: "insensitive" } });
  if (and.length > 0) where.AND = and;
  return where;
}

async function shapeCachedOrdersResponse(input: {
  organizationId: string;
  connectionId?: string;
  connections: ActiveConnection[];
  errors?: Array<{ connectionId: string; username: string | null; message: string }>;
  q?: string;
  status?: EbayOrderStatusFilter;
  page?: number;
  pageSize?: number;
}) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const whereBase: Prisma.EbayOrderCacheItemWhereInput = {
    organizationId: input.organizationId,
    ...(input.connectionId ? { ebaySellerConnectionId: input.connectionId } : {}),
  };
  const whereFiltered = orderCacheWhere(input);
  const awaitingWhere: Prisma.EbayOrderCacheItemWhereInput = { ...whereBase, fulfillmentStatus: "AWAITING_SHIPMENT" };
  const shippedWhere: Prisma.EbayOrderCacheItemWhereInput = { ...whereBase, OR: [{ fulfillmentStatus: "SHIPPED" }, { shippedTime: { not: null } }] };
  const cancelledWhere: Prisma.EbayOrderCacheItemWhereInput = { ...whereBase, orderStatus: { contains: "Cancel", mode: "insensitive" } };

  const [rows, total, filtered, awaitingShipment, shipped, cancelled, revenue, lastSynced] = await Promise.all([
    prisma.ebayOrderCacheItem.findMany({
      where: whereFiltered,
      select: orderCacheRowSelect,
      orderBy: [{ createdTime: "desc" }, { orderId: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ebayOrderCacheItem.count({ where: whereBase }),
    prisma.ebayOrderCacheItem.count({ where: whereFiltered }),
    prisma.ebayOrderCacheItem.count({ where: awaitingWhere }),
    prisma.ebayOrderCacheItem.count({ where: shippedWhere }),
    prisma.ebayOrderCacheItem.count({ where: cancelledWhere }),
    prisma.ebayOrderCacheItem.aggregate({ where: whereBase, _sum: { totalValue: true } }),
    prisma.ebayOrderCacheItem.aggregate({ where: whereBase, _max: { syncedAt: true } }),
  ]);

  return {
    accounts: input.connections.map((connection) => ({
      id: connection.id,
      username: connection.username,
      isDefault: connection.isDefault,
      marketplace: connection.defaultMarketplace || "EBAY_US",
    })),
    items: rows.map(cachedRowToOrderRow),
    pagination: { page, pageSize, total: filtered, totalPages: Math.max(1, Math.ceil(filtered / pageSize)) },
    summary: {
      total,
      filtered,
      connectedAccounts: input.connections.length,
      awaitingShipment,
      shipped,
      cancelled,
      revenue: revenue._sum.totalValue == null ? 0 : Number(revenue._sum.totalValue),
    },
    errors: input.errors ?? [],
    syncedAt: lastSynced._max.syncedAt?.toISOString() ?? null,
  };
}

export async function listEbayStoreOrders(input: {
  organizationId: string;
  connectionId?: string;
  q?: string;
  status?: EbayOrderStatusFilter;
  page?: number;
  pageSize?: number;
}) {
  const connections = await listActiveConnections({ organizationId: input.organizationId, connectionId: input.connectionId });
  return shapeCachedOrdersResponse({ ...input, connections });
}

export async function syncEbayStoreOrders(input: {
  organizationId: string;
  connectionId?: string;
  q?: string;
  status?: EbayOrderStatusFilter;
  page?: number;
  pageSize?: number;
}) {
  const key = syncKey(input);
  const connections = await listActiveConnections({ organizationId: input.organizationId, connectionId: input.connectionId });
  const syncTasks = connections.flatMap((connection) => syncMarketplacesForConnection(connection).map((marketplace) => ({ connection, marketplace })));
  const startedAt = new Date();
  const createTimeTo = new Date();
  const createTimeFrom = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
  const errors: Array<{ connectionId: string; username: string | null; message: string }> = [];
  let successfulSiteSyncs = 0;

  setProgress(key, {
    status: "RUNNING",
    percent: 2,
    message: "Preparing connected eBay accounts and order sites...",
    accountsTotal: syncTasks.length,
    accountsCompleted: 0,
    currentAccount: null,
    totalOrders: 0,
    ordersFetched: 0,
    cacheSaved: 0,
    errors: 0,
    errorMessages: [],
    startedAt: startedAt.toISOString(),
    finishedAt: null,
  });

  for (const [taskIndex, task] of syncTasks.entries()) {
    const { connection, marketplace } = task;
    const accountBase = (taskIndex / Math.max(1, syncTasks.length)) * 100;
    const accountSpan = 100 / Math.max(1, syncTasks.length);
    const accountLabel = `${connection.username ?? "eBay account"} - ${marketplace}`;
    const fetchedOrders: EbayTradingOrderSummary[] = [];
    let totalOrders = 0;
    let cacheSavedForAccount = 0;
    const cacheSavedBefore = orderRefreshProgress.get(key)?.cacheSaved ?? 0;
    try {
      setProgress(key, {
        percent: Math.max(4, accountBase),
        message: `Fetching recent ${marketplace} orders from ${connection.username ?? "eBay account"}...`,
        currentAccount: accountLabel,
      });
      const entriesPerPage = 100;
      for (let pageNumber = 1; pageNumber <= 1000; pageNumber += 1) {
        const page = await getTradingOrdersPage({
          organizationId: input.organizationId,
          connectionId: connection.id,
          marketplace,
          entriesPerPage,
          pageNumber,
          createTimeFrom,
          createTimeTo,
        });
        if (pageNumber === 1) {
          totalOrders = page.total;
          setProgress(key, {
            percent: accountBase + accountSpan * 0.1,
            message: `Found ${totalOrders} recent ${marketplace} order${totalOrders === 1 ? "" : "s"}...`,
            totalOrders: (orderRefreshProgress.get(key)?.totalOrders ?? 0) + totalOrders,
          });
        }
        fetchedOrders.push(...page.orders);
        setProgress(key, {
          percent: accountBase + accountSpan * Math.min(0.72, 0.1 + (fetchedOrders.length / Math.max(1, totalOrders || fetchedOrders.length)) * 0.62),
          message: `Fetched ${fetchedOrders.length}/${totalOrders || fetchedOrders.length} ${marketplace} order records...`,
          ordersFetched: (orderRefreshProgress.get(key)?.ordersFetched ?? 0) + page.orders.length,
        });
        for (const [orderIndex, order] of page.orders.entries()) {
          await prisma.ebayOrderCacheItem.upsert({
            where: {
              ebaySellerConnectionId_sourceKey: {
                ebaySellerConnectionId: connection.id,
                sourceKey: order.sourceKey,
              },
            },
            update: {
              organizationId: input.organizationId,
              orderId: order.orderId,
              legacyOrderId: order.legacyOrderId,
              buyerUsername: order.buyerUsername,
              buyerEmail: order.buyerEmail,
              buyerName: order.buyerName,
              orderStatus: order.orderStatus,
              checkoutStatus: order.checkoutStatus,
              paymentStatus: order.paymentStatus,
              fulfillmentStatus: order.fulfillmentStatus,
              paidTime: toDate(order.paidTime),
              createdTime: toDate(order.createdTime),
              shippedTime: toDate(order.shippedTime),
              totalValue: order.totalValue,
              totalCurrency: order.totalCurrency,
              quantity: order.quantity,
              itemCount: order.itemCount,
              firstSku: order.firstSku,
              firstTitle: order.firstTitle,
              shippingService: order.shippingService,
              shippingValue: order.shippingValue,
              shippingCurrency: order.shippingCurrency,
              shippingAddress: toJson(order.shippingAddress),
              transactions: toJson(order.transactions as unknown as Array<Record<string, unknown>>),
              payload: toJson(order.payload),
              syncedAt: startedAt,
            },
            create: {
              organizationId: input.organizationId,
              ebaySellerConnectionId: connection.id,
              marketplace,
              sourceKey: order.sourceKey,
              orderId: order.orderId,
              legacyOrderId: order.legacyOrderId,
              buyerUsername: order.buyerUsername,
              buyerEmail: order.buyerEmail,
              buyerName: order.buyerName,
              orderStatus: order.orderStatus,
              checkoutStatus: order.checkoutStatus,
              paymentStatus: order.paymentStatus,
              fulfillmentStatus: order.fulfillmentStatus,
              paidTime: toDate(order.paidTime),
              createdTime: toDate(order.createdTime),
              shippedTime: toDate(order.shippedTime),
              totalValue: order.totalValue,
              totalCurrency: order.totalCurrency,
              quantity: order.quantity,
              itemCount: order.itemCount,
              firstSku: order.firstSku,
              firstTitle: order.firstTitle,
              shippingService: order.shippingService,
              shippingValue: order.shippingValue,
              shippingCurrency: order.shippingCurrency,
              shippingAddress: toJson(order.shippingAddress),
              transactions: toJson(order.transactions as unknown as Array<Record<string, unknown>>),
              payload: toJson(order.payload),
              syncedAt: startedAt,
            },
          });
          cacheSavedForAccount += 1;
          if (orderIndex % 25 === 0 || orderIndex === page.orders.length - 1) {
            setProgress(key, {
              percent: accountBase + accountSpan * Math.min(0.95, 0.72 + (fetchedOrders.length / Math.max(1, totalOrders || fetchedOrders.length)) * 0.23),
              message: `Cached ${cacheSavedForAccount}/${totalOrders || fetchedOrders.length} ${marketplace} order rows...`,
              cacheSaved: cacheSavedBefore + cacheSavedForAccount,
            });
          }
        }
        if (!page.hasMore || fetchedOrders.length >= page.total || page.orders.length === 0) break;
      }
      await prisma.ebayOrderCacheItem.deleteMany({
        where: {
          organizationId: input.organizationId,
          ebaySellerConnectionId: connection.id,
          marketplace,
          syncedAt: { lt: startedAt },
        },
      });
      successfulSiteSyncs += 1;
      setProgress(key, {
        percent: accountBase + accountSpan * 0.95,
        message: `Finished ${connection.username ?? "eBay account"} on ${marketplace}.`,
        accountsCompleted: taskIndex + 1,
        errors: errors.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync eBay orders";
      errors.push({ connectionId: connection.id, username: connection.username, message: `${marketplace}: ${message}` });
      const current = orderRefreshProgress.get(key) ?? idleProgress(key);
      setProgress(key, {
        message: `${accountLabel} order sync failed: ${message}`,
        accountsCompleted: taskIndex + 1,
        errors: errors.length,
        errorMessages: [...current.errorMessages, `${accountLabel}: ${message}`].slice(-5),
      });
    }
  }

  const failed = successfulSiteSyncs === 0 && syncTasks.length > 0;
  setProgress(key, {
    status: failed ? "FAILED" : "COMPLETED",
    percent: 100,
    message: failed ? errors[0]?.message ?? "Order sync failed." : "Order sync completed.",
    currentAccount: null,
    finishedAt: new Date().toISOString(),
    errors: errors.length,
    errorMessages: errors.map((item) => `${item.username ?? "eBay account"}: ${item.message}`).slice(-5),
  });

  return shapeCachedOrdersResponse({ ...input, connections, errors });
}

export function startEbayStoreOrderCacheRefresh(input: Parameters<typeof syncEbayStoreOrders>[0]) {
  const key = syncKey(input);
  const existing = runningOrderRefreshes.get(key);
  if (existing) return { started: false, running: true, progress: getEbayStoreOrderCacheRefreshProgress(input) };
  const task = syncEbayStoreOrders(input)
    .catch((error) => {
      console.error(JSON.stringify({
        type: "ebay_store_order_cache_refresh_failed",
        organizationId: input.organizationId,
        connectionId: input.connectionId ?? null,
        error: error instanceof Error ? { name: error.name, message: error.message } : error,
      }));
    })
    .finally(() => runningOrderRefreshes.delete(key));
  runningOrderRefreshes.set(key, task);
  return { started: true, running: true, progress: getEbayStoreOrderCacheRefreshProgress(input) };
}
