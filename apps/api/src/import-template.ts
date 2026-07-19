export const catalogImportTemplateVersion = "1.0";
export const catalogImportTemplateFilename = "partpulse-catalog-import-v1.csv";

export interface ImportTemplateColumn {
  name: string;
  required: boolean;
  dataType: "text" | "integer" | "decimal" | "enum";
  description: string;
  example: string;
  allowedValues?: readonly string[];
}

export const catalogImportColumns: readonly ImportTemplateColumn[] = [
  { name: "TemplateVersion", required: true, dataType: "enum", description: "Template contract version.", example: "1.0", allowedValues: [catalogImportTemplateVersion] },
  { name: "VIN", required: true, dataType: "text", description: "Normalized 17-character donor VIN, or UNAVAILABLE.", example: "1GNEK13Z43R000001" },
  { name: "SKU", required: true, dataType: "text", description: "Organization-unique inventory SKU.", example: "SKU-001" },
  { name: "PartNumber", required: true, dataType: "text", description: "Primary OEM, MPN, or interchange number.", example: "84178783" },
  { name: "Condition", required: true, dataType: "enum", description: "Inventory condition.", example: "USED", allowedValues: ["NEW", "USED"] },
  { name: "Quantity", required: true, dataType: "integer", description: "Available quantity; zero is allowed.", example: "1" },
  { name: "Cost", required: true, dataType: "decimal", description: "Unit acquisition cost without a currency symbol.", example: "35.00" },
  { name: "Currency", required: true, dataType: "text", description: "Three-letter ISO 4217 currency code.", example: "USD" },
  { name: "ImageGroup", required: true, dataType: "text", description: "Exact image folder or manifest group; use SKU when possible.", example: "SKU-001" },
  { name: "Brand", required: false, dataType: "text", description: "Verified manufacturer or brand.", example: "GM" },
  { name: "PartName", required: false, dataType: "text", description: "Human-readable part name.", example: "HVAC Blower Motor Control Module" },
  { name: "InterchangeNumbers", required: false, dataType: "text", description: "Additional numbers separated with a vertical bar (|).", example: "13598091|F011500138" },
  { name: "Description", required: false, dataType: "text", description: "Verified condition and part notes.", example: "Tested working; connector intact" },
  { name: "DonorMileage", required: false, dataType: "integer", description: "Non-negative donor vehicle mileage.", example: "85000" },
  { name: "DonorColor", required: false, dataType: "text", description: "Donor vehicle or part color.", example: "Black" },
  { name: "Placement", required: false, dataType: "text", description: "Vehicle placement such as Front Left.", example: "Front" },
  { name: "Warehouse", required: false, dataType: "text", description: "Warehouse code.", example: "MAIN" },
  { name: "BinLocation", required: false, dataType: "text", description: "Bin code inside the selected warehouse.", example: "A-01-03" },
  { name: "Weight", required: false, dataType: "decimal", description: "Packaged shipping weight.", example: "2.50" },
  { name: "WeightUnit", required: false, dataType: "enum", description: "Required when Weight is present.", example: "LB", allowedValues: ["LB", "KG"] },
  { name: "Length", required: false, dataType: "decimal", description: "Package length.", example: "12.00" },
  { name: "Width", required: false, dataType: "decimal", description: "Package width.", example: "8.00" },
  { name: "Height", required: false, dataType: "decimal", description: "Package height.", example: "6.00" },
  { name: "DimensionUnit", required: false, dataType: "enum", description: "Required when a package dimension is present.", example: "IN", allowedValues: ["IN", "CM"] },
  { name: "Notes", required: false, dataType: "text", description: "Internal notes that are not automatically published.", example: "Shelf label replaced" },
] as const;

export function createCatalogImportCsv(): string {
  return `${catalogImportColumns.map(({ name }) => name).join(",")}\r\n`;
}

export const catalogImportTemplate = {
  version: catalogImportTemplateVersion,
  filename: catalogImportTemplateFilename,
  columns: catalogImportColumns,
};
