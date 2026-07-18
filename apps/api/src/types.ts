export type Marketplace = "EBAY_US" | "EBAY_GB" | "EBAY_DE";
export type ListingCondition = "ANY" | "NEW" | "USED";

export interface RawListing {
  id: string;
  title: string;
  seller: string;
  price: number;
  shipping: number;
  currency: string;
  condition: string;
  marketplace: Marketplace;
  url: string;
  aspects: Record<string, string[]>;
}

export interface MatchedListing extends RawListing {
  matchedOn: string[];
  landedPrice: number;
}

export interface Analytics {
  count: number;
  lowest: number;
  average: number;
  median: number;
  highest: number;
  recommendedPrice: number;
  currency: string;
}
