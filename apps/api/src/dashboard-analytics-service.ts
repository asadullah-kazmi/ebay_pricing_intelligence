import { prisma } from "./db.js";

type DashboardRange = "7d" | "30d" | "month" | "quarter";
type DashboardCondition = "ALL" | "NEW" | "USED";

type DashboardAnalyticsInput = {
  organizationId: string;
  range?: DashboardRange;
  connectionId?: string;
  marketplace?: string;
  category?: string;
  brand?: string;
  condition?: DashboardCondition;
};

type MetricFormat = "money" | "number" | "percent" | "multiple";

function isAll(value: string | undefined | null) {
  return !value || value === "ALL" || value.toLowerCase().startsWith("all ");
}

function toNumber(value: unknown): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  if (typeof value === "object" && "toString" in value) {
    const numeric = Number((value as { toString(): string }).toString());
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function percentChange(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / previous) * 100;
}

function metric(
  current: number | null,
  previous: number | null,
  format: MetricFormat,
  options: { currency?: string; note?: string; available?: boolean } = {},
) {
  const available = options.available ?? current !== null;
  return {
    current,
    previous,
    changePercent:
      available && current !== null && previous !== null ? percentChange(current, previous) : null,
    format,
    currency: options.currency ?? "USD",
    note: options.note ?? null,
    available,
  };
}

function resolveRange(range: DashboardRange, now = new Date()) {
  const end = new Date(now);
  let start: Date;
  let label: string;

  if (range === "7d") {
    start = new Date(now);
    start.setDate(start.getDate() - 6);
    label = "Last 7 days";
  } else if (range === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    label = "This month";
  } else if (range === "quarter") {
    start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    label = "This quarter";
  } else {
    start = new Date(now);
    start.setDate(start.getDate() - 29);
    label = "Last 30 days";
  }

  start.setHours(0, 0, 0, 0);
  const previousEnd = new Date(start);
  const previousStart = new Date(previousEnd.getTime() - (end.getTime() - start.getTime()));

  return { start, end, previousStart, previousEnd, label };
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function orderIdentity(order: { orderId: string; legacyOrderId: string | null; sourceKey: string }) {
  return order.orderId || order.legacyOrderId || order.sourceKey;
}

function dedupeOrders<T extends { orderId: string; legacyOrderId: string | null; sourceKey: string }>(
  orders: T[],
) {
  const seen = new Set<string>();
  return orders.filter((order) => {
    const key = orderIdentity(order);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mostCommon(values: Array<string | null | undefined>, fallback: string) {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? fallback;
}

function countBy<T>(rows: T[], keyFactory: (row: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFactory(row)?.trim();
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function sumBy<T>(rows: T[], valueFactory: (row: T) => number) {
  return rows.reduce((total, row) => total + valueFactory(row), 0);
}

function orderText(order: {
  orderStatus: string | null;
  checkoutStatus: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
}) {
  return [
    order.orderStatus,
    order.checkoutStatus,
    order.paymentStatus,
    order.fulfillmentStatus,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function isCancelledOrder(order: Parameters<typeof orderText>[0]) {
  return orderText(order).includes("CANCEL");
}

function isReturnedOrder(order: Parameters<typeof orderText>[0]) {
  const text = orderText(order);
  return text.includes("RETURN") || text.includes("REFUND");
}

function isShippedOrder(order: Parameters<typeof orderText>[0] & { shippedTime: Date | null }) {
  const text = orderText(order);
  return Boolean(order.shippedTime) || text.includes("SHIPPED") || text.includes("FULFILLED");
}

function isPublishedInventory(row: { offerStatus: string | null; listingStatus: string | null }) {
  const status = `${row.offerStatus ?? ""} ${row.listingStatus ?? ""}`.toUpperCase();
  if (status.includes("ENDED") || status.includes("UNPUBLISHED")) {
    return false;
  }
  return true;
}

function matchesCondition(value: string | null | undefined, condition: DashboardCondition | undefined) {
  if (!condition || condition === "ALL") {
    return true;
  }
  return normalize(value).includes(condition);
}

function matchesText(value: string | null | undefined, expected: string | undefined) {
  if (isAll(expected)) {
    return true;
  }
  return normalize(value).includes(normalize(expected));
}

function buildTrend(
  start: Date,
  end: Date,
  orders: Array<{
    createdTime: Date | null;
    totalValue: unknown;
    quantity: number | null;
    itemCount: number | null;
  }>,
) {
  const buckets = new Map<string, { date: string; gmv: number; orders: number; units: number }>();
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = dayKey(cursor);
    buckets.set(key, { date: key, gmv: 0, orders: 0, units: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const order of orders) {
    if (!order.createdTime) {
      continue;
    }
    const bucket = buckets.get(dayKey(order.createdTime));
    if (!bucket) {
      continue;
    }
    bucket.gmv += toNumber(order.totalValue);
    bucket.orders += 1;
    bucket.units += order.quantity ?? order.itemCount ?? 1;
  }

  return Array.from(buckets.values());
}

export async function getDashboardAnalytics(input: DashboardAnalyticsInput) {
  const rangeValue = input.range ?? "30d";
  const { start, end, previousStart, previousEnd, label } = resolveRange(rangeValue);
  const marketplaceFilter = isAll(input.marketplace) ? undefined : input.marketplace;
  const connectionFilter = isAll(input.connectionId) ? undefined : input.connectionId;

  const connections = await prisma.ebaySellerConnection.findMany({
    where: { organizationId: input.organizationId },
    select: {
      id: true,
      username: true,
      ebayUserId: true,
      status: true,
      isDefault: true,
      defaultMarketplace: true,
      registrationMarketplace: true,
      updatedAt: true,
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  const scopedConnectionIds = connectionFilter
    ? [connectionFilter]
    : connections.map((connection) => connection.id);

  const orderScope: Record<string, unknown> = { organizationId: input.organizationId };
  if (scopedConnectionIds.length > 0) {
    orderScope.ebaySellerConnectionId = { in: scopedConnectionIds };
  }
  if (marketplaceFilter) {
    orderScope.marketplace = marketplaceFilter;
  }

  const [currentOrderRows, previousOrderRows, inventoryRows, parts, listingDrafts, pricingJobs, bulkPricingJobs, fitmentJobs] =
    await Promise.all([
      prisma.ebayOrderCacheItem.findMany({
        where: { ...orderScope, createdTime: { gte: start, lt: end } },
        select: {
          id: true,
          marketplace: true,
          sourceKey: true,
          orderId: true,
          legacyOrderId: true,
          buyerUsername: true,
          orderStatus: true,
          checkoutStatus: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          createdTime: true,
          shippedTime: true,
          totalValue: true,
          totalCurrency: true,
          quantity: true,
          itemCount: true,
          firstSku: true,
          firstTitle: true,
          syncedAt: true,
        },
      }),
      prisma.ebayOrderCacheItem.findMany({
        where: { ...orderScope, createdTime: { gte: previousStart, lt: previousEnd } },
        select: {
          id: true,
          marketplace: true,
          sourceKey: true,
          orderId: true,
          legacyOrderId: true,
          orderStatus: true,
          checkoutStatus: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          createdTime: true,
          shippedTime: true,
          totalValue: true,
          totalCurrency: true,
          quantity: true,
          itemCount: true,
          firstSku: true,
          firstTitle: true,
        },
      }),
      prisma.ebayInventoryCacheItem.findMany({
        where: {
          organizationId: input.organizationId,
          ...(scopedConnectionIds.length > 0 ? { ebaySellerConnectionId: { in: scopedConnectionIds } } : {}),
          ...(marketplaceFilter ? { marketplace: marketplaceFilter } : {}),
        },
        select: {
          id: true,
          marketplace: true,
          sku: true,
          title: true,
          condition: true,
          quantity: true,
          price: true,
          currency: true,
          offerStatus: true,
          listingStatus: true,
          categoryId: true,
          imageUrl: true,
          syncedAt: true,
        },
      }),
      prisma.part.findMany({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          brand: true,
          condition: true,
          status: true,
          createdAt: true,
          primaryPartNumber: true,
        },
      }),
      prisma.listingDraft.findMany({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          title: true,
          status: true,
          marketplace: true,
          price: true,
          currency: true,
          quantity: true,
          updatedAt: true,
          part: { select: { sku: true, brand: true, primaryPartNumber: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.pricingJob.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true, marketplace: true, status: true, totalItems: true, completedItems: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.bulkPricingJob.findMany({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          sourceFilename: true,
          marketplace: true,
          status: true,
          completedItems: true,
          totalItems: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.fitmentJob.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true, marketplace: true, status: true, reviewedItems: true, totalItems: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
    ]);

  const currentOrders = dedupeOrders(currentOrderRows);
  const previousOrders = dedupeOrders(previousOrderRows);
  const filteredInventory = inventoryRows.filter((row) => {
    const matchesBrand = matchesText(row.title, input.brand);
    const matchesCategory = isAll(input.category) || row.categoryId === input.category;
    return matchesBrand && matchesCategory && matchesCondition(row.condition, input.condition);
  });
  const filteredParts = parts.filter(
    (part) => matchesText(part.brand, input.brand) && matchesCondition(part.condition, input.condition),
  );

  const currency = mostCommon(
    currentOrders.map((order) => order.totalCurrency).concat(filteredInventory.map((row) => row.currency)),
    "USD",
  );
  const previousRevenue = sumBy(previousOrders, (order) => toNumber(order.totalValue));
  const revenue = sumBy(currentOrders, (order) => toNumber(order.totalValue));
  const totalOrders = currentOrders.length;
  const previousTotalOrders = previousOrders.length;
  const unitsSold = sumBy(currentOrders, (order) => order.quantity ?? order.itemCount ?? 1);
  const previousUnitsSold = sumBy(previousOrders, (order) => order.quantity ?? order.itemCount ?? 1);
  const shipped = currentOrders.filter(isShippedOrder).length;
  const cancelled = currentOrders.filter(isCancelledOrder).length;
  const returned = currentOrders.filter(isReturnedOrder).length;
  const awaitingShipment = currentOrders.filter(
    (order) => !isCancelledOrder(order) && !isShippedOrder(order),
  ).length;
  const previousCancelled = previousOrders.filter(isCancelledOrder).length;
  const previousReturned = previousOrders.filter(isReturnedOrder).length;

  const activeListings = filteredInventory.length;
  const publishedListings = filteredInventory.filter(isPublishedInventory).length;
  const lowStock = filteredInventory.filter((row) => (row.quantity ?? 0) > 0 && (row.quantity ?? 0) <= 1).length;
  const outOfStock = filteredInventory.filter((row) => (row.quantity ?? 0) <= 0).length;
  const draftReady = listingDrafts.filter((draft) => draft.status === "READY").length;
  const draftBlocked = listingDrafts.filter((draft) => draft.status === "BLOCKED").length;

  const marketplaceShare = Object.entries(
    currentOrders.reduce<Record<string, number>>((totals, order) => {
      const key = order.marketplace || "Unknown";
      totals[key] = (totals[key] ?? 0) + toNumber(order.totalValue);
      return totals;
    }, {}),
  )
    .map(([marketplace, value]) => ({ marketplace, value }))
    .sort((a, b) => b.value - a.value);

  const topProducts = Object.entries(
    currentOrders.reduce<
      Record<string, { sku: string | null; title: string; revenue: number; units: number; orders: number }>
    >((totals, order) => {
      const key = order.firstSku || order.firstTitle || order.orderId;
      const item = totals[key] ?? {
        sku: order.firstSku,
        title: order.firstTitle || order.firstSku || "Untitled order item",
        revenue: 0,
        units: 0,
        orders: 0,
      };
      item.revenue += toNumber(order.totalValue);
      item.units += order.quantity ?? order.itemCount ?? 1;
      item.orders += 1;
      totals[key] = item;
      return totals;
    }, {}),
  )
    .map(([, value]) => value)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const latestInventorySync = filteredInventory
    .map((row) => row.syncedAt)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const latestOrderSync = currentOrderRows
    .map((row) => row.syncedAt)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const marketplaces = Array.from(
    new Set(
      [
        ...connections.flatMap((connection) => [
          connection.defaultMarketplace,
          connection.registrationMarketplace,
        ]),
        ...inventoryRows.map((row) => row.marketplace),
        ...currentOrderRows.map((row) => row.marketplace),
      ].filter((value): value is string => Boolean(value)),
    ),
  ).sort();

  const brands = Array.from(
    new Set(parts.map((part) => part.brand).filter((value): value is string => Boolean(value))),
  )
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 120);

  return {
    range: {
      value: rangeValue,
      label,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    generatedAt: new Date().toISOString(),
    filters: {
      accounts: connections.map((connection) => ({
        id: connection.id,
        label: connection.username || connection.ebayUserId || "Connected eBay account",
        status: connection.status,
        isDefault: connection.isDefault,
      })),
      marketplaces,
      categories: countBy(inventoryRows, (row) => row.categoryId)
        .slice(0, 80)
        .map((category) => ({ id: category.label, label: category.label, count: category.value })),
      brands,
    },
    connectedAccounts: {
      total: connections.length,
      active: connections.filter((connection) => connection.status === "ACTIVE").length,
      defaultAccountId: connections.find((connection) => connection.isDefault)?.id ?? null,
    },
    lastSynced: {
      inventory: latestInventorySync?.toISOString() ?? null,
      orders: latestOrderSync?.toISOString() ?? null,
    },
    metrics: {
      grossGmv: metric(revenue, previousRevenue, "money", { currency }),
      totalOrders: metric(totalOrders, previousTotalOrders, "number"),
      aov: metric(totalOrders > 0 ? revenue / totalOrders : 0, previousTotalOrders > 0 ? previousRevenue / previousTotalOrders : 0, "money", {
        currency,
      }),
      unitsSold: metric(unitsSold, previousUnitsSold, "number"),
      returnRate: metric(totalOrders > 0 ? (returned / totalOrders) * 100 : 0, previousTotalOrders > 0 ? (previousReturned / previousTotalOrders) * 100 : 0, "percent"),
      cancellationRate: metric(totalOrders > 0 ? (cancelled / totalOrders) * 100 : 0, previousTotalOrders > 0 ? (previousCancelled / previousTotalOrders) * 100 : 0, "percent"),
      activeListings: metric(activeListings, null, "number"),
      publishedListings: metric(publishedListings, null, "number"),
      lowStock: metric(lowStock, null, "number"),
      outOfStock: metric(outOfStock, null, "number"),
      catalogParts: metric(filteredParts.length, null, "number"),
      readyDrafts: metric(draftReady, null, "number"),
      blockedDrafts: metric(draftBlocked, null, "number"),
      netProfit: metric(null, null, "money", {
        currency,
        available: false,
        note: "Configure COGS, shipping, ads, and fee feeds to calculate net profit.",
      }),
      netMargin: metric(null, null, "percent", {
        available: false,
        note: "Net margin needs profit data.",
      }),
      roas: metric(null, null, "multiple", {
        available: false,
        note: "Advertising API data is not connected yet.",
      }),
      adSpend: metric(null, null, "money", {
        currency,
        available: false,
        note: "Advertising API data is not connected yet.",
      }),
      adRevenue: metric(null, null, "money", {
        currency,
        available: false,
        note: "Advertising API data is not connected yet.",
      }),
      cpo: metric(null, null, "money", {
        currency,
        available: false,
        note: "Advertising API data is not connected yet.",
      }),
    },
    insights: {
      awaitingShipment,
      shipped,
      cancelled,
      returned,
      newOrders: awaitingShipment,
      messages: null,
    },
    charts: {
      gmvTrend: buildTrend(start, end, currentOrders),
      marketplaceShare,
      categoryShare: countBy(filteredInventory, (row) => row.categoryId).slice(0, 8),
      inventoryByMarketplace: countBy(filteredInventory, (row) => row.marketplace).slice(0, 8),
      orderStatus: [
        { label: "Awaiting shipment", value: awaitingShipment },
        { label: "Shipped", value: shipped },
        { label: "Cancelled", value: cancelled },
        { label: "Returned", value: returned },
      ],
    },
    topProducts,
    jobs: {
      pricing: pricingJobs.map((job) => ({
        id: job.id,
        oem: `Pricing job ${job.completedItems}/${job.totalItems}`,
        marketplace: job.marketplace,
        status: job.status,
        createdAt: job.createdAt,
      })),
      bulkPricing: bulkPricingJobs.map((job) => ({
        id: job.id,
        fileName: job.sourceFilename ?? "Bulk pricing job",
        marketplace: job.marketplace,
        status: job.status,
        processedRows: job.completedItems,
        totalRows: job.totalItems,
        createdAt: job.createdAt,
      })),
      fitment: fitmentJobs.map((job) => ({
        id: job.id,
        marketplace: job.marketplace,
        status: job.status,
        processedRows: job.reviewedItems,
        totalRows: job.totalItems,
        createdAt: job.createdAt,
      })),
      drafts: listingDrafts,
    },
    marketing: {
      configured: false,
      message: "Advertising metrics will appear after eBay marketing/ad reporting is connected.",
      accounts: [],
    },
    profit: {
      configured: false,
      message: "Profit analysis needs COGS, shipping, platform fees, payment fees, ad spend, and taxes.",
      bridge: [{ label: "GMV", value: revenue, type: "positive" }],
    },
  };
}
