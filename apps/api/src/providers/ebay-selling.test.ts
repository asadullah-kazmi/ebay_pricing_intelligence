import { describe, expect, it } from "vitest";
import { normalizeCategoryAspects, normalizeCategoryConditions, normalizeInventoryLocations } from "./ebay-selling.js";

describe("eBay selling metadata normalization", () => {
  it("maps supported category condition IDs to Inventory API enum values", () => {
    expect(normalizeCategoryConditions([
      { conditionId: "1000", conditionDescription: "New" },
      { conditionId: 5000, conditionDescription: "Used - Good", conditionHelpText: "Shows normal wear." },
      { conditionId: "9999", conditionDescription: "Unknown" },
    ])).toEqual([
      { conditionId: "1000", enumValue: "NEW", name: "New", description: null },
      { conditionId: "5000", enumValue: "USED_GOOD", name: "Used - Good", description: "Shows normal wear." },
    ]);
  });

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
