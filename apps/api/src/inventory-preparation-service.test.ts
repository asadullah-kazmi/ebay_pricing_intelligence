import { describe, expect, it } from "vitest";
import { buildCompatibilityPayload, buildInventoryItemPayload } from "./inventory-preparation-service.js";

describe("eBay inventory preparation", () => {
  it("builds a complete used inventory payload with package data", () => {
    const result = buildInventoryItemPayload({
      title: "OEM BMW Brake Caliper",
      description: "Tested used part.",
      condition: "USED",
      quantity: 2,
      aspects: { Brand: ["BMW"], MPN: ["123"] },
      imageUrls: ["https://i.ebayimg.com/image.jpg"],
      weight: 4.5,
      weightUnit: "LB",
      length: 12,
      width: 8,
      height: 6,
      dimensionUnit: "IN",
    });
    expect(result.payload).toMatchObject({
      availability: { shipToLocationAvailability: { quantity: 2 } },
      condition: "USED_GOOD",
      product: { imageUrls: ["https://i.ebayimg.com/image.jpg"] },
      packageWeightAndSize: { weight: { value: 4.5, unit: "POUND" }, dimensions: { unit: "INCH" } },
    });
    expect(result.warnings).toHaveLength(1);
  });

  it("maps approved applications to compatibility name/value pairs", () => {
    expect(buildCompatibilityPayload([{ Year: "2020", Make: "BMW", Model: "X3" }])).toEqual({
      compatibleProducts: [{ compatibilityProperties: [
        { name: "Year", value: "2020" },
        { name: "Make", value: "BMW" },
        { name: "Model", value: "X3" },
      ] }],
    });
  });
});
