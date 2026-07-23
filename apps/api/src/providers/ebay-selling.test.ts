import { describe, expect, it } from "vitest";
import { normalizeCategoryAspects, normalizeInventoryLocations } from "./ebay-selling.js";

describe("eBay selling metadata normalization", () => {
  it("normalizes required category aspects and allowed values", () => {
    expect(normalizeCategoryAspects([{
      localizedAspectName: "Brand",
      aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED", aspectMode: "SELECTION_ONLY", itemToAspectCardinality: "SINGLE" },
      aspectValues: [{ localizedValue: "BMW" }, { localizedValue: "Audi" }],
    }])).toEqual([{
      name: "Brand", required: true, recommended: true, mode: "SELECTION_ONLY", dataType: null, cardinality: "SINGLE", values: ["BMW", "Audi"],
    }]);
  });

  it("filters malformed locations and disables unavailable locations", () => {
    expect(normalizeInventoryLocations([
      { merchantLocationKey: "MAIN", name: "Main warehouse", merchantLocationStatus: "ENABLED" },
      { merchantLocationKey: "OLD", merchantLocationStatus: "DISABLED" },
      { name: "Missing key" },
    ])).toMatchObject([
      { remoteId: "MAIN", enabled: true },
      { remoteId: "OLD", enabled: false },
    ]);
  });
});
