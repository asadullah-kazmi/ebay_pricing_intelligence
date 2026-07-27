import { describe, expect, it } from "vitest";
import { buildCompatibilityPayload, buildInventoryItemPayload } from "./inventory-preparation-service.js";

describe("eBay inventory preparation", () => {
  it("builds a complete used inventory payload with package data", () => {
    const result = buildInventoryItemPayload({
      title: "OEM BMW Brake Caliper",
      description: "Tested used part.",
      conditionDescription: "Used OEM BMW Brake Caliper. Part number 123.",
      condition: "USED",
      ebayCondition: "USED_GOOD",
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
      conditionDescription: "Used OEM BMW Brake Caliper. Part number 123.",
      product: { imageUrls: ["https://i.ebayimg.com/image.jpg"] },
      packageWeightAndSize: { weight: { value: 4.5, unit: "POUND" }, dimensions: { unit: "INCH" } },
    });
    expect(result.warnings).toHaveLength(0);
  });

  it("keeps HTML listing description on product and plain text on conditionDescription", () => {
    const html = "<div style=\"color:red\">Rich <b>listing</b> description</div>";
    const result = buildInventoryItemPayload({
      title: "OEM Part",
      description: html,
      conditionDescription: "Used OEM Part. Part number 999.",
      condition: "USED",
      ebayCondition: "USED_GOOD",
      quantity: 1,
      aspects: {},
      imageUrls: ["https://i.ebayimg.com/image.jpg"],
      weight: null,
      weightUnit: null,
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
    });
    expect(result.payload.product).toMatchObject({ description: html });
    expect(result.payload).toMatchObject({ conditionDescription: "Used OEM Part. Part number 999." });
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
