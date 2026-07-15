import type { RawListing } from "../types.js";

const PART_FIELDS = [
  "Manufacturer Part Number",
  "MPN",
  "OE/OEM Part Number",
  "Interchange Part Number",
];

export function normalizePartNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function matchListing(listing: RawListing, query: string): string[] {
  const expected = normalizePartNumber(query);
  return PART_FIELDS.filter((field) =>
    (listing.aspects[field] ?? []).some((value) => normalizePartNumber(value) === expected),
  );
}
