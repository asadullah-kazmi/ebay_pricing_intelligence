import { describe, expect, it } from "vitest";
import { contentLanguage } from "./ebay-inventory.js";

describe("eBay Inventory API localization", () => {
  it("uses the marketplace content language required by inventory writes", () => {
    expect(contentLanguage("EBAY_US")).toBe("en-US");
    expect(contentLanguage("EBAY_GB")).toBe("en-GB");
    expect(contentLanguage("EBAY_DE")).toBe("de-DE");
  });
});
