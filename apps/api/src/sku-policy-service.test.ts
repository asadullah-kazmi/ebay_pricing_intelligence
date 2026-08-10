import { describe, expect, it } from "vitest";
import { normalizeSkuPrefix, partNumberToSku } from "./sku-policy-service.js";

describe("organization SKU policy formatting", () => {
  it("normalizes a company prefix into a stable catalog prefix", () => {
    expect(normalizeSkuPrefix(" bl-ap ")).toBe("BLAP");
  });

  it("uses the uploaded part number as a case-insensitive SKU", () => {
    expect(partNumberToSku(" 8k0 615 301m ")).toBe("8K0-615-301M");
  });

  it("limits part-number SKUs to the catalog field length", () => {
    expect(partNumberToSku("A".repeat(120))).toHaveLength(100);
  });
});
