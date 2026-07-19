import { parse as parseCsv } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { catalogImportColumns, catalogImportTemplateVersion } from "./import-template.js";
import { normalizePartNumber } from "./domain/matching.js";

const maxImportRows = 5_000;

type Cell = string | number | boolean | Date | null;
type Severity = "error" | "warning";

export interface ImportValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  field?: string;
}

export interface NormalizedImportRow {
  templateVersion: "1.0";
  vin: string | null;
  sku: string;
  normalizedSku: string;
  primaryPartNumber: string;
  normalizedPartNumber: string;
  condition: "NEW" | "USED";
  quantity: number;
  cost: number;
  currency: string;
  imageGroup: string;
  brand?: string;
  partName?: string;
  interchangeNumbers: string[];
  description?: string;
  donorMileage?: number;
  donorColor?: string;
  placement?: string;
  warehouse?: string;
  binLocation?: string;
  weight?: number;
  weightUnit?: "LB" | "KG";
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: "IN" | "CM";
  notes?: string;
}

export interface ValidatedImportRow {
  rowNumber: number;
  rawData: Record<string, string | number | boolean | null>;
  normalizedData: NormalizedImportRow | null;
  status: "VALID" | "WARNING" | "INVALID";
  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];
}

export interface ParsedImport {
  rows: ValidatedImportRow[];
  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];
}

function issue(code: string, severity: Severity, message: string, field?: string): ImportValidationIssue {
  return { code, severity, message, ...(field ? { field } : {}) };
}

function text(value: Cell | undefined): string {
  if (value === null || value === undefined) return "";
  return value instanceof Date ? value.toISOString() : String(value).trim();
}

function optionalText(value: Cell | undefined): string | undefined {
  return text(value) || undefined;
}

function nonnegativeInteger(value: Cell | undefined): number | null {
  const raw = text(value);
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nonnegativeDecimal(value: Cell | undefined): number | null {
  const raw = text(value);
  if (!/^(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function containsFormula(value: Cell | undefined): boolean {
  return typeof value === "string" && value.trimStart().startsWith("=");
}

function parseRow(rowNumber: number, headers: string[], cells: Cell[]): ValidatedImportRow {
  const rawData = Object.fromEntries(headers.map((header, index) => {
    const value = cells[index];
    return [header, value instanceof Date ? value.toISOString() : value ?? null];
  }));
  const values = Object.fromEntries(headers.map((header, index) => [header, cells[index]])) as Record<string, Cell | undefined>;
  const errors: ImportValidationIssue[] = [];
  const warnings: ImportValidationIssue[] = [];
  const required = (field: string) => {
    const value = text(values[field]);
    if (!value) errors.push(issue("REQUIRED", "error", `${field} is required`, field));
    return value;
  };

  for (const header of headers) {
    if (containsFormula(values[header])) errors.push(issue("FORMULA_NOT_ALLOWED", "error", "Formula cells are not allowed", header));
  }
  if (cells.slice(headers.length).some((value) => text(value) !== "")) {
    errors.push(issue("EXTRA_CELLS", "error", "The row contains values beyond the published template columns"));
  }

  const versionValue = required("TemplateVersion");
  const version = versionValue === "1" ? catalogImportTemplateVersion : versionValue;
  if (version && version !== catalogImportTemplateVersion) {
    errors.push(issue("UNSUPPORTED_TEMPLATE_VERSION", "error", `TemplateVersion must be ${catalogImportTemplateVersion}`, "TemplateVersion"));
  }

  const rawVin = required("VIN").toUpperCase();
  let vin: string | null = rawVin;
  if (rawVin === "UNAVAILABLE") {
    vin = null;
    warnings.push(issue("VIN_UNAVAILABLE", "warning", "Automatic donor-vehicle enrichment will be limited", "VIN"));
  } else if (rawVin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(rawVin)) {
    errors.push(issue("INVALID_VIN", "error", "VIN must contain 17 valid VIN characters or UNAVAILABLE", "VIN"));
  }

  const sku = required("SKU");
  const primaryPartNumber = required("PartNumber");
  if (sku.length > 100) errors.push(issue("SKU_TOO_LONG", "error", "SKU cannot exceed 100 characters", "SKU"));
  if (primaryPartNumber.length > 100) errors.push(issue("PART_NUMBER_TOO_LONG", "error", "PartNumber cannot exceed 100 characters", "PartNumber"));
  if (primaryPartNumber && !normalizePartNumber(primaryPartNumber)) {
    errors.push(issue("INVALID_PART_NUMBER", "error", "PartNumber must contain at least one letter or number", "PartNumber"));
  }
  if (typeof values.PartNumber === "number") {
    warnings.push(issue("NUMERIC_PART_NUMBER", "warning", "Numeric spreadsheet formatting may have removed leading zeroes", "PartNumber"));
  }
  const conditionValue = required("Condition").toUpperCase();
  if (conditionValue && conditionValue !== "NEW" && conditionValue !== "USED") {
    errors.push(issue("INVALID_CONDITION", "error", "Condition must be NEW or USED", "Condition"));
  }
  const quantity = nonnegativeInteger(values.Quantity);
  if (quantity === null) errors.push(issue("INVALID_QUANTITY", "error", "Quantity must be a non-negative whole number", "Quantity"));
  const cost = nonnegativeDecimal(values.Cost);
  if (cost === null) errors.push(issue("INVALID_COST", "error", "Cost must be a non-negative decimal without a currency symbol", "Cost"));
  const currency = required("Currency").toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push(issue("INVALID_CURRENCY", "error", "Currency must be a three-letter code", "Currency"));
  const imageGroup = required("ImageGroup");

  const donorMileageRaw = optionalText(values.DonorMileage);
  const donorMileage = donorMileageRaw === undefined ? undefined : nonnegativeInteger(values.DonorMileage);
  if (donorMileageRaw !== undefined && donorMileage === null) {
    errors.push(issue("INVALID_DONOR_MILEAGE", "error", "DonorMileage must be a non-negative whole number", "DonorMileage"));
  }

  const weightRaw = optionalText(values.Weight);
  const weight = weightRaw === undefined ? undefined : nonnegativeDecimal(values.Weight);
  const weightUnitRaw = optionalText(values.WeightUnit)?.toUpperCase();
  if (weightRaw !== undefined && weight === null) errors.push(issue("INVALID_WEIGHT", "error", "Weight must be a non-negative decimal", "Weight"));
  if ((weight !== undefined && weight !== null) !== Boolean(weightUnitRaw)) {
    errors.push(issue("WEIGHT_UNIT_REQUIRED", "error", "Weight and WeightUnit must be provided together", "WeightUnit"));
  }
  if (weightUnitRaw && weightUnitRaw !== "LB" && weightUnitRaw !== "KG") {
    errors.push(issue("INVALID_WEIGHT_UNIT", "error", "WeightUnit must be LB or KG", "WeightUnit"));
  }

  const dimensions = ["Length", "Width", "Height"] as const;
  const dimensionValues = dimensions.map((field) => {
    const raw = optionalText(values[field]);
    const parsed = raw === undefined ? undefined : nonnegativeDecimal(values[field]);
    if (raw !== undefined && parsed === null) errors.push(issue("INVALID_DIMENSION", "error", `${field} must be a non-negative decimal`, field));
    return parsed;
  });
  const hasDimensions = dimensionValues.some((value) => value !== undefined && value !== null);
  const dimensionUnitRaw = optionalText(values.DimensionUnit)?.toUpperCase();
  if (hasDimensions !== Boolean(dimensionUnitRaw)) {
    errors.push(issue("DIMENSION_UNIT_REQUIRED", "error", "Dimensions and DimensionUnit must be provided together", "DimensionUnit"));
  }
  if (dimensionUnitRaw && dimensionUnitRaw !== "IN" && dimensionUnitRaw !== "CM") {
    errors.push(issue("INVALID_DIMENSION_UNIT", "error", "DimensionUnit must be IN or CM", "DimensionUnit"));
  }

  const warehouse = optionalText(values.Warehouse)?.toUpperCase();
  const binLocation = optionalText(values.BinLocation);
  if (binLocation && !warehouse) errors.push(issue("WAREHOUSE_REQUIRED", "error", "Warehouse is required when BinLocation is present", "Warehouse"));

  const interchangeNumbers = (optionalText(values.InterchangeNumbers) ?? "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.findIndex((candidate) => normalizePartNumber(candidate) === normalizePartNumber(value)) === index);

  const normalizedData: NormalizedImportRow | null = errors.length ? null : {
    templateVersion: catalogImportTemplateVersion,
    vin,
    sku,
    normalizedSku: sku.toUpperCase(),
    primaryPartNumber,
    normalizedPartNumber: normalizePartNumber(primaryPartNumber),
    condition: conditionValue as "NEW" | "USED",
    quantity: quantity!,
    cost: cost!,
    currency,
    imageGroup,
    brand: optionalText(values.Brand),
    partName: optionalText(values.PartName),
    interchangeNumbers,
    description: optionalText(values.Description),
    donorMileage: donorMileage ?? undefined,
    donorColor: optionalText(values.DonorColor),
    placement: optionalText(values.Placement),
    warehouse,
    binLocation,
    weight: weight ?? undefined,
    weightUnit: weightUnitRaw as "LB" | "KG" | undefined,
    length: dimensionValues[0] ?? undefined,
    width: dimensionValues[1] ?? undefined,
    height: dimensionValues[2] ?? undefined,
    dimensionUnit: dimensionUnitRaw as "IN" | "CM" | undefined,
    notes: optionalText(values.Notes),
  };

  return {
    rowNumber,
    rawData,
    normalizedData,
    status: errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID",
    errors,
    warnings,
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textNodes(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1] ?? "")).join("");
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) throw new Error("INVALID_XLSX");
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function readXlsxMatrix(bytes: Buffer): Cell[][] {
  let expandedBytes = 0;
  const files = unzipSync(new Uint8Array(bytes), {
    filter(file) {
      const relevant = file.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/i.test(file.name);
      if (relevant) {
        expandedBytes += file.originalSize;
        if (expandedBytes > 50 * 1024 * 1024) throw new Error("XLSX_EXPANDED_SIZE_LIMIT");
      }
      return relevant;
    },
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const worksheetName = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0];
  if (!worksheetName) throw new Error("INVALID_XLSX");
  const worksheet = decoder.decode(files[worksheetName]);
  if (/<f(?:\s|>|\/)/i.test(worksheet)) throw new Error("FORMULAS_NOT_ALLOWED");

  const sharedStringsXml = files["xl/sharedStrings.xml"] ? decoder.decode(files["xl/sharedStrings.xml"]) : "";
  const sharedStrings = [...sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)]
    .map((match) => textNodes(match[1] ?? ""));
  const rows: Cell[][] = [];
  for (const rowMatch of worksheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    const attributes = rowMatch[1] ?? "";
    const rowNumber = Number(attributes.match(/\br="(\d+)"/i)?.[1] ?? rows.length + 1);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) throw new Error("INVALID_XLSX");
    const row: Cell[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const cellAttributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const reference = cellAttributes.match(/\br="([A-Z]+\d+)"/i)?.[1];
      if (!reference) throw new Error("INVALID_XLSX");
      const type = cellAttributes.match(/\bt="([^"]+)"/i)?.[1];
      const rawValue = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1] ?? "";
      let value: Cell;
      if (type === "inlineStr") value = textNodes(body);
      else if (type === "s") value = sharedStrings[Number(rawValue)] ?? "";
      else if (type === "b") value = rawValue === "1";
      else if (type === "str") value = decodeXml(rawValue);
      else if (rawValue === "") value = null;
      else {
        const numeric = Number(rawValue);
        value = Number.isFinite(numeric) ? numeric : decodeXml(rawValue);
      }
      row[columnIndex(reference)] = value;
    }
    rows[rowNumber - 1] = row;
  }
  return rows.map((row) => row ?? []);
}

async function readMatrix(filename: string, bytes: Buffer): Promise<Cell[][]> {
  const extension = filename.toLowerCase().split(".").at(-1);
  if (extension === "csv") {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return parseCsv(content, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: 1_000_000,
    }) as Cell[][];
  }
  if (extension === "xlsx") {
    return readXlsxMatrix(bytes);
  }
  throw new Error("UNSUPPORTED_FILE_TYPE");
}

export async function parseAndValidateImport(filename: string, bytes: Buffer): Promise<ParsedImport> {
  const errors: ImportValidationIssue[] = [];
  const warnings: ImportValidationIssue[] = [];
  let matrix: Cell[][];
  try {
    matrix = await readMatrix(filename, bytes);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_FILE";
    const message = code === "UNSUPPORTED_FILE_TYPE"
      ? "Only UTF-8 CSV and XLSX files are supported"
      : code === "FORMULAS_NOT_ALLOWED"
        ? "XLSX formulas are not allowed; replace formulas with their values"
        : "The spreadsheet could not be read";
    return { rows: [], errors: [issue(code, "error", message)], warnings };
  }
  if (!matrix.length) return { rows: [], errors: [issue("EMPTY_FILE", "error", "The spreadsheet is empty")], warnings };

  const headers = matrix[0]!.map((value) => text(value));
  const expectedHeaders = catalogImportColumns.map(({ name }) => name);
  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  const missing = expectedHeaders.filter((header) => !headers.includes(header));
  const unknown = headers.filter((header) => header && !expectedHeaders.includes(header));
  if (duplicates.length) errors.push(issue("DUPLICATE_HEADERS", "error", `Duplicate headers: ${[...new Set(duplicates)].join(", ")}`));
  if (missing.length) errors.push(issue("MISSING_HEADERS", "error", `Missing headers: ${missing.join(", ")}`));
  if (unknown.length) errors.push(issue("UNKNOWN_HEADERS", "error", `Unknown headers: ${unknown.join(", ")}`));
  if (headers.length !== expectedHeaders.length || headers.some((header, index) => header !== expectedHeaders[index])) {
    errors.push(issue("HEADER_ORDER", "error", "Use the v1.0 template headers in their published order"));
  }
  if (errors.length) return { rows: [], errors, warnings };

  const dataRows = matrix.slice(1).filter((row) => row.some((value) => text(value) !== ""));
  if (dataRows.length > maxImportRows) {
    return { rows: [], errors: [issue("ROW_LIMIT", "error", `A single import cannot exceed ${maxImportRows} rows`)], warnings };
  }
  const rows = dataRows.map((row, index) => parseRow(index + 2, headers, row));

  const skuRows = new Map<string, ValidatedImportRow[]>();
  for (const row of rows) {
    const normalizedSku = text(row.rawData.SKU).toUpperCase();
    if (!normalizedSku) continue;
    const matches = skuRows.get(normalizedSku) ?? [];
    matches.push(row);
    skuRows.set(normalizedSku, matches);
  }
  for (const [sku, matches] of skuRows) {
    if (matches.length < 2) continue;
    for (const row of matches) {
      row.errors.push(issue("DUPLICATE_SKU", "error", `SKU ${sku} appears more than once in this file`, "SKU"));
      row.normalizedData = null;
      row.status = "INVALID";
    }
  }
  return { rows, errors, warnings };
}

export function applyExistingSkuConflicts(parsed: ParsedImport, existingNormalizedSkus: ReadonlySet<string>): ParsedImport {
  for (const row of parsed.rows) {
    const normalizedSku = text(row.rawData.SKU).toUpperCase();
    if (!normalizedSku || !existingNormalizedSkus.has(normalizedSku)) continue;
    row.errors.push(issue("SKU_ALREADY_EXISTS", "error", `SKU ${text(row.rawData.SKU)} already exists in the catalog`, "SKU"));
    row.normalizedData = null;
    row.status = "INVALID";
  }
  return parsed;
}
