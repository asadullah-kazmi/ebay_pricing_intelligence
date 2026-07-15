import { describe, expect, it } from "vitest";
import { matchListing, normalizePartNumber } from "./matching.js";
import type { RawListing } from "../types.js";

const base: RawListing = { id: "1", title: "Part", seller: "seller", price: 1, shipping: 0, currency: "USD", condition: "New", marketplace: "EBAY_US", url: "", aspects: {} };
describe("matching engine", () => {
  it("normalizes punctuation and case", () => expect(normalizePartNumber(" 8k0-615 301m ")).toBe("8K0615301M"));
  it("requires an exact normalized item-specific value", () => {
    expect(matchListing({ ...base, aspects: { "OE/OEM Part Number": ["8K0-615-301M"] } }, "8k0615301m")).toEqual(["OE/OEM Part Number"]);
    expect(matchListing({ ...base, aspects: { MPN: ["8K0615301MX"] } }, "8K0615301M")).toEqual([]);
  });
});
