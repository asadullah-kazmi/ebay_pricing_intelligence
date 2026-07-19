import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogImportColumns, catalogImportTemplateVersion, createCatalogImportCsv } from "./import-template.js";

describe("catalog import template", () => {
  it("has a stable version and unique column names", () => {
    expect(catalogImportTemplateVersion).toBe("1.0");
    const names = catalogImportColumns.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice(0, 9)).toEqual([
      "TemplateVersion", "VIN", "SKU", "PartNumber", "Condition",
      "Quantity", "Cost", "Currency", "ImageGroup",
    ]);
  });

  it("marks the complete intake contract as required", () => {
    expect(catalogImportColumns.filter(({ required }) => required).map(({ name }) => name)).toEqual([
      "TemplateVersion", "VIN", "SKU", "PartNumber", "Condition",
      "Quantity", "Cost", "Currency", "ImageGroup",
    ]);
  });

  it("keeps the published CSV artifact synchronized with the code contract", () => {
    const published = readFileSync(resolve(process.cwd(), "../../templates/partpulse-catalog-import-v1.csv"), "utf8");
    expect(published.replace(/\r?\n/g, "\n")).toBe(createCatalogImportCsv().replace(/\r?\n/g, "\n"));
  });
});
