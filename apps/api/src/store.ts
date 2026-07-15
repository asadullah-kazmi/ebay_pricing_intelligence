import type { Analytics, MatchedListing, Marketplace } from "./types.js";

interface SearchResult { oem: string; marketplace: Marketplace; searchedAt: string; listings: MatchedListing[]; analytics: Analytics | null }
const searches = new Map<string, SearchResult>();

export const store = {
  save(result: SearchResult) { searches.set(result.oem, result); },
  get(oem: string) { return searches.get(oem); },
  listing(id: string) { return [...searches.values()].flatMap((result) => result.listings).find((item) => item.id === id); },
};
