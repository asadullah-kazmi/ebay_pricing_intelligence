import type { Analytics, MatchedListing } from "../types.js";

const money = (value: number) => Math.round(value * 100) / 100;

export function calculateAnalytics(listings: MatchedListing[]): Analytics | null {
  if (!listings.length) return null;
  return calculateAnalyticsFromPrices(listings.map((item) => item.landedPrice), listings[0]!.currency);
}

export function calculateAnalyticsFromPrices(values: number[], currency: string): Analytics | null {
  if (!values.length) return null;
  const prices = [...values].sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[middle]! : (prices[middle - 1]! + prices[middle]!) / 2;
  const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  return {
    count: prices.length,
    lowest: money(prices[0]!),
    average: money(average),
    median: money(median),
    highest: money(prices.at(-1)!),
    recommendedPrice: money(median * 0.98),
    currency,
  };
}
