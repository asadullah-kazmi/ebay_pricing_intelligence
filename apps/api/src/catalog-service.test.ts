import { describe, expect, it } from "vitest";
import { buildCatalogWhere, formatCatalogCsvCell } from "./catalog-service.js";

describe("catalog query construction", () => {
  it("always applies tenant scope while searching supported identifiers", () => {
    const where = buildCatalogWhere("org-1", { q: "84178783" });
    expect(where.organizationId).toBe("org-1");
    expect(where.OR).toEqual(expect.arrayContaining([
      { sku: { contains: "84178783", mode: "insensitive" } },
      { primaryPartNumber: { contains: "84178783", mode: "insensitive" } },
      { donorVehicle: { vin: { contains: "84178783", mode: "insensitive" } } },
    ]));
  });

  it("combines status, condition, image, warehouse, and date filters", () => {
    const createdFrom = new Date("2026-07-01T00:00:00.000Z");
    const where = buildCatalogWhere("org-2", {
      status: "NEEDS_IMAGES",
      condition: "USED",
      hasImages: false,
      warehouseId: "warehouse-1",
      createdFrom,
    });
    expect(where).toMatchObject({
      organizationId: "org-2",
      status: "NEEDS_IMAGES",
      condition: "USED",
      media: { none: {} },
      inventoryItem: { warehouseId: "warehouse-1" },
      createdAt: { gte: createdFrom },
    });
  });
});

describe("catalog CSV values", () => {
  it("escapes commas, quotes, and line breaks", () => {
    expect(formatCatalogCsvCell("plain")).toBe("plain");
    expect(formatCatalogCsvCell('Module, "rear"')).toBe('"Module, ""rear"""');
    expect(formatCatalogCsvCell("line 1\nline 2")).toBe('"line 1\nline 2"');
    expect(formatCatalogCsvCell(null)).toBe("");
  });
});
