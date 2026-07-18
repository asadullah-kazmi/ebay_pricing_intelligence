import type { Analytics, MatchedListing, Marketplace } from "./types.js";
import { prisma } from "./db.js";

export interface SearchResult {
  oem: string;
  marketplace: Marketplace;
  searchedAt: string;
  listings: MatchedListing[];
  analytics: Analytics | null;
}

const numberOrNull = (value: { toString(): string } | null): number | null =>
  value === null ? null : Number(value.toString());

export async function saveSearchResult(result: SearchResult): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.part.upsert({
      where: { oem: result.oem },
      create: { oem: result.oem },
      update: {},
    });

    const search = await tx.search.create({
      data: {
        oem: result.oem,
        marketplace: result.marketplace,
        searchedAt: new Date(result.searchedAt),
        competitorCount: result.analytics?.count ?? 0,
        lowest: result.analytics?.lowest,
        average: result.analytics?.average,
        median: result.analytics?.median,
        highest: result.analytics?.highest,
        recommendedPrice: result.analytics?.recommendedPrice,
        currency: result.analytics?.currency,
      },
    });

    for (const listing of result.listings) {
      await tx.listing.upsert({
        where: { id: listing.id },
        create: {
          id: listing.id,
          title: listing.title,
          seller: listing.seller,
          price: listing.price,
          shipping: listing.shipping,
          currency: listing.currency,
          condition: listing.condition,
          marketplace: listing.marketplace,
          url: listing.url,
          matchedOn: listing.matchedOn,
          oem: result.oem,
        },
        update: {
          title: listing.title,
          seller: listing.seller,
          price: listing.price,
          shipping: listing.shipping,
          currency: listing.currency,
          condition: listing.condition,
          marketplace: listing.marketplace,
          url: listing.url,
          matchedOn: listing.matchedOn,
          oem: result.oem,
        },
      });
    }

    if (result.listings.length) {
      await tx.priceHistory.createMany({
        data: result.listings.map((listing) => ({
          listingId: listing.id,
          searchId: search.id,
          price: listing.price,
          shipping: listing.shipping,
          capturedAt: new Date(result.searchedAt),
        })),
      });
    }
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function findListing(id: string) {
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { prices: { orderBy: { capturedAt: "desc" }, take: 20 } },
  });
  if (!listing) return null;
  return {
    ...listing,
    price: Number(listing.price),
    shipping: Number(listing.shipping),
    landedPrice: Number(listing.price) + Number(listing.shipping),
    prices: listing.prices.map((capture) => ({
      ...capture,
      price: Number(capture.price),
      shipping: Number(capture.shipping),
    })),
  };
}

function analyticsFromSearch(search: {
  competitorCount: number; lowest: { toString(): string } | null; average: { toString(): string } | null;
  median: { toString(): string } | null; highest: { toString(): string } | null;
  recommendedPrice: { toString(): string } | null; currency: string | null;
}): Analytics | null {
  if (!search.currency || search.lowest === null) return null;
  return {
    count: search.competitorCount,
    lowest: numberOrNull(search.lowest)!,
    average: numberOrNull(search.average)!,
    median: numberOrNull(search.median)!,
    highest: numberOrNull(search.highest)!,
    recommendedPrice: numberOrNull(search.recommendedPrice)!,
    currency: search.currency,
  };
}

export async function findLatestAnalytics(oem: string): Promise<Analytics | null | undefined> {
  const search = await prisma.search.findFirst({ where: { oem }, orderBy: { searchedAt: "desc" } });
  return search ? analyticsFromSearch(search) : undefined;
}

export async function findSearchHistory(oem: string) {
  const searches = await prisma.search.findMany({ where: { oem }, orderBy: { searchedAt: "desc" }, take: 100 });
  return searches.map((search) => ({
    searchId: search.id,
    marketplace: search.marketplace,
    capturedAt: search.searchedAt.toISOString(),
    analytics: analyticsFromSearch(search),
  }));
}

export async function deleteListingsForClosedEbayAccount(username?: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const listings = await tx.listing.findMany({
      where: username ? { seller: { equals: username, mode: "insensitive" } } : undefined,
      select: { id: true },
    });
    const listingIds = listings.map(({ id }) => id);
    if (!listingIds.length) return 0;

    await tx.priceHistory.deleteMany({ where: { listingId: { in: listingIds } } });
    const deleted = await tx.listing.deleteMany({ where: { id: { in: listingIds } } });
    return deleted.count;
  });
}
