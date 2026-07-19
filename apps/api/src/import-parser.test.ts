import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { applyExistingSkuConflicts, parseAndValidateImport } from "./import-parser.js";
import { catalogImportColumns } from "./import-template.js";

const headers = catalogImportColumns.map(({ name }) => name);

function csv(rows: Array<Record<string, string>>): Buffer {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((header) => row[header] ?? "").join(","));
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function xlsx(rows: Array<Record<string, string>>): Buffer {
  const values = [Object.fromEntries(headers.map((header) => [header, header])), ...rows];
  const sheetRows = values.map((row, rowIndex) => {
    const cells = headers.map((header, columnIndex) =>
      `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xml(row[header] ?? "")}</t></is></c>`,
    ).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return Buffer.from(zipSync({
    "[Content_Types].xml": new TextEncoder().encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels": new TextEncoder().encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": new TextEncoder().encode('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Parts" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": new TextEncoder().encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": new TextEncoder().encode(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  }));
}

const validRow = {
  TemplateVersion: "1.0",
  VIN: "1GNEK13Z43R000001",
  SKU: "SKU-001",
  PartNumber: "84-178-783",
  Condition: "USED",
  Quantity: "1",
  Cost: "35.00",
  Currency: "usd",
  ImageGroup: "SKU-001",
  Weight: "2.5",
  WeightUnit: "LB",
  Length: "12",
  Width: "8",
  Height: "6",
  DimensionUnit: "IN",
};

describe("catalog staging parser", () => {
  it("normalizes a valid CSV row without committing catalog data", async () => {
    const result = await parseAndValidateImport("parts.csv", csv([validRow]));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      status: "VALID",
      normalizedData: {
        vin: "1GNEK13Z43R000001",
        sku: "SKU-001",
        normalizedSku: "SKU-001",
        normalizedPartNumber: "84178783",
        currency: "USD",
      },
    });
  });

  it("parses the first worksheet of a valid XLSX upload", async () => {
    const result = await parseAndValidateImport("parts.xlsx", xlsx([validRow]));
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ status: "VALID", normalizedData: { normalizedPartNumber: "84178783" } });
  });

  it("reports invalid business values at row level", async () => {
    const result = await parseAndValidateImport("parts.csv", csv([{
      ...validRow,
      VIN: "INVALID",
      Condition: "REFURBISHED",
      Quantity: "-1",
      Cost: "$5",
      WeightUnit: "",
    }]));
    expect(result.rows[0]?.status).toBe("INVALID");
    expect(result.rows[0]?.normalizedData).toBeNull();
    expect(result.rows[0]?.errors.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "INVALID_VIN", "INVALID_CONDITION", "INVALID_QUANTITY", "INVALID_COST", "WEIGHT_UNIT_REQUIRED",
    ]));
  });

  it("marks every occurrence of a duplicate case-insensitive SKU", async () => {
    const result = await parseAndValidateImport("parts.csv", csv([
      validRow,
      { ...validRow, SKU: "sku-001", PartNumber: "OTHER" },
    ]));
    expect(result.rows.map(({ status }) => status)).toEqual(["INVALID", "INVALID"]);
    expect(result.rows.every(({ errors }) => errors.some(({ code }) => code === "DUPLICATE_SKU"))).toBe(true);
  });

  it("marks a SKU that already belongs to the organization's catalog", async () => {
    const result = await parseAndValidateImport("parts.csv", csv([validRow]));
    applyExistingSkuConflicts(result, new Set(["SKU-001"]));
    expect(result.rows[0]).toMatchObject({ status: "INVALID", normalizedData: null });
    expect(result.rows[0]?.errors).toContainEqual(expect.objectContaining({ code: "SKU_ALREADY_EXISTS" }));
  });

  it("rejects modified template headers", async () => {
    const invalid = Buffer.from(`WrongHeader,${headers.slice(1).join(",")}\n`, "utf8");
    const result = await parseAndValidateImport("parts.csv", invalid);
    expect(result.rows).toEqual([]);
    expect(result.errors.map(({ code }) => code)).toEqual(expect.arrayContaining(["MISSING_HEADERS", "UNKNOWN_HEADERS", "HEADER_ORDER"]));
  });

  it("rejects formulas in XLSX worksheet XML", async () => {
    const workbook = Buffer.from(zipSync({
      "xl/worksheets/sheet1.xml": new TextEncoder().encode("<worksheet><sheetData><c><f>1+1</f><v>2</v></c></sheetData></worksheet>"),
    }));
    const result = await parseAndValidateImport("parts.xlsx", workbook);
    expect(result.errors).toEqual([expect.objectContaining({ code: "FORMULAS_NOT_ALLOWED" })]);
  });
});
