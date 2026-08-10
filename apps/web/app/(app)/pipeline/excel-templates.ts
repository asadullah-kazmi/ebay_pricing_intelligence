import ExcelJS from "exceljs";

export async function generateQuickUpdateExcel(): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PartPulse eBay Intelligence";
  workbook.lastModifiedBy = "PartPulse System";
  workbook.created = new Date();
  workbook.modified = new Date();

  // ==========================================
  // TAB 1: Instructions & Guide
  // ==========================================
  const guideSheet = workbook.addWorksheet("Instructions & Guide", {
    views: [{ showGridLines: true }],
  });

  guideSheet.columns = [
    { width: 22 }, // Column Name
    { width: 14 }, // Required?
    { width: 14 }, // Data Type
    { width: 58 }, // Description
    { width: 28 }, // Example Value
  ];

  // Title Banner (Row 1)
  guideSheet.mergeCells("A1:E1");
  const titleCell = guideSheet.getCell("A1");
  titleCell.value = "PartPulse eBay Intelligence - Quick Update Template Guide";
  titleCell.font = { name: "Segoe UI", size: 16, bold: true, color: { argb: "FFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0C274D" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  guideSheet.getRow(1).height = 42;

  // Subtitle Banner (Row 2)
  guideSheet.mergeCells("A2:E2");
  const subTitleCell = guideSheet.getCell("A2");
  subTitleCell.value = "Official Bulk Inventory & Price Sync Guide | Version 1.0";
  subTitleCell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "93C5FD" } };
  subTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1E40AF" } };
  subTitleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  guideSheet.getRow(2).height = 24;

  // Blank Row 3
  guideSheet.getRow(3).height = 12;

  // Section Header: Quick Start (Row 4)
  guideSheet.mergeCells("A4:E4");
  const sec1Cell = guideSheet.getCell("A4");
  sec1Cell.value = "🚀 QUICK START INSTRUCTIONS";
  sec1Cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "0C274D" } };
  sec1Cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EFF6FF" } };
  sec1Cell.alignment = { vertical: "middle", horizontal: "left" };
  guideSheet.getRow(4).height = 26;

  const instructions = [
    "1. Click the 'Quick Update Intake' tab at the bottom of this workbook to enter your parts.",
    "2. Enter your OEM Part Numbers (MPN), Brands, Selling Prices, and Available Quantities under the styled header row.",
    "3. Do not modify or delete the header names on Row 1 of the data sheet.",
    "4. Save this file (.xlsx or .csv) and upload it directly into PartPulse Pipeline (/pipeline).",
  ];

  instructions.forEach((text, idx) => {
    const rowNum = 5 + idx;
    guideSheet.mergeCells(`A${rowNum}:E${rowNum}`);
    const cell = guideSheet.getCell(`A${rowNum}`);
    cell.value = text;
    cell.font = { name: "Segoe UI", size: 10, color: { argb: "334155" } };
    guideSheet.getRow(rowNum).height = 20;
  });

  // Blank Row 9
  guideSheet.getRow(9).height = 14;

  // Section Header: Column Schema (Row 10)
  guideSheet.mergeCells("A10:E10");
  const sec2Cell = guideSheet.getCell("A10");
  sec2Cell.value = "📋 COLUMN SPECIFICATIONS & FORMATTING RULES";
  sec2Cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "0C274D" } };
  sec2Cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EFF6FF" } };
  sec2Cell.alignment = { vertical: "middle", horizontal: "left" };
  guideSheet.getRow(10).height = 26;

  // Table Headers (Row 11)
  const schemaHeaders = ["Column Name", "Required?", "Data Type", "Description & Rules", "Example Value"];
  const headerRow = guideSheet.getRow(11);
  headerRow.height = 26;
  schemaHeaders.forEach((text, colIdx) => {
    const cell = headerRow.getCell(colIdx + 1);
    cell.value = text;
    cell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "2563EB" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });

  // Schema Rows
  const schemaData = [
    ["Part no", "REQUIRED", "Text", "OEM Part Number, MPN, or interchange number.", "8K0615301M"],
    ["Brand", "REQUIRED", "Text", "Brand assigned directly to the catalog item.", "Audi"],
    ["Selling Price", "REQUIRED", "USD amount", "Plain values default to USD. Both 149.99 and $149.99 are accepted.", "149.99"],
    ["Quantity", "REQUIRED", "Integer", "Available inventory stock quantity. Whole non-negative number.", "12"],
  ];

  schemaData.forEach((rowValues, idx) => {
    const rowNum = 12 + idx;
    const row = guideSheet.getRow(rowNum);
    row.height = 22;
    rowValues.forEach((val, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = val;
      cell.font = { name: "Segoe UI", size: 9.5, color: { argb: "1E293B" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      if (colIdx === 1) {
        cell.font = { name: "Segoe UI", size: 9.5, bold: true, color: { argb: "166534" } };
      }
      cell.border = {
        bottom: { style: "thin", color: { argb: "E2E8F0" } },
        right: { style: "thin", color: { argb: "E2E8F0" } },
      };
    });
  });

  // ==========================================
  // TAB 2: Quick Update Data Intake Sheet
  // ==========================================
  const dataSheet = workbook.addWorksheet("Quick Update Intake", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
  });

  dataSheet.columns = [
    { header: "Part no", key: "partNo", width: 24 },
    { header: "Brand", key: "brand", width: 20 },
    { header: "Selling Price", key: "price", width: 18 },
    { header: "Quantity", key: "quantity", width: 16 },
  ];

  // Header Styling for Data Sheet (Row 1)
  const dataHeaderRow = dataSheet.getRow(1);
  dataHeaderRow.height = 32;
  ["Part no", "Brand", "Selling Price", "Quantity"].forEach((text, idx) => {
    const cell = dataHeaderRow.getCell(idx + 1);
    cell.value = text;
    cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0C274D" } };
    cell.alignment = { vertical: "middle", horizontal: idx < 2 ? "left" : "right" };
    cell.border = {
      bottom: { style: "medium", color: { argb: "2563EB" } },
    };
  });

  // Sample Data Rows
  const sampleRows = [
    { partNo: "8K0615301M", brand: "Audi", price: 149.99, quantity: 12 },
    { partNo: "4E0833051C", brand: "Audi", price: 89.50, quantity: 5 },
    { partNo: "1GNEK13Z43R", brand: "Chevrolet", price: 299.00, quantity: 3 },
    { partNo: "84178783", brand: "GM", price: 65.00, quantity: 8 },
  ];

  sampleRows.forEach((item, idx) => {
    const rowNum = 2 + idx;
    const row = dataSheet.getRow(rowNum);
    row.height = 24;

    const cellPart = row.getCell(1);
    cellPart.value = item.partNo;
    cellPart.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "2563EB" } };
    cellPart.alignment = { vertical: "middle", horizontal: "left" };

    const cellBrand = row.getCell(2);
    cellBrand.value = item.brand;
    cellBrand.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    cellBrand.alignment = { vertical: "middle", horizontal: "left" };

    const cellPrice = row.getCell(3);
    cellPrice.value = item.price;
    cellPrice.numFmt = "$#,##0.00";
    cellPrice.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    cellPrice.alignment = { vertical: "middle", horizontal: "right" };

    const cellQty = row.getCell(4);
    cellQty.value = item.quantity;
    cellQty.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    cellQty.alignment = { vertical: "middle", horizontal: "right" };

    [cellPart, cellBrand, cellPrice, cellQty].forEach((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: "F1F5F9" } },
      };
      if (idx % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F8FAFC" } };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function generateFullCatalogExcel(): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PartPulse eBay Intelligence";
  workbook.lastModifiedBy = "PartPulse System";
  workbook.created = new Date();
  workbook.modified = new Date();

  // ==========================================
  // TAB 1: Instructions & Guide
  // ==========================================
  const guideSheet = workbook.addWorksheet("Instructions & Guide", {
    views: [{ showGridLines: true }],
  });

  guideSheet.columns = [
    { width: 22 }, // Column Name
    { width: 14 }, // Required?
    { width: 14 }, // Data Type
    { width: 58 }, // Description
    { width: 38 }, // Example Value
  ];

  // Title Banner (Row 1)
  guideSheet.mergeCells("A1:E1");
  const titleCell = guideSheet.getCell("A1");
  titleCell.value = "PartPulse eBay Intelligence - Full Catalog Intake Guide";
  titleCell.font = { name: "Segoe UI", size: 16, bold: true, color: { argb: "FFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0C274D" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  guideSheet.getRow(1).height = 42;

  // Subtitle Banner (Row 2)
  guideSheet.mergeCells("A2:E2");
  const subTitleCell = guideSheet.getCell("A2");
  subTitleCell.value = "Standard Catalog & Listing Draft Intake Guide | Version 1.0";
  subTitleCell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "93C5FD" } };
  subTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1E40AF" } };
  subTitleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  guideSheet.getRow(2).height = 24;

  // Blank Row 3
  guideSheet.getRow(3).height = 12;

  // Section Header: Quick Start (Row 4)
  guideSheet.mergeCells("A4:E4");
  const sec1Cell = guideSheet.getCell("A4");
  sec1Cell.value = "🚀 QUICK START INSTRUCTIONS";
  sec1Cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "0C274D" } };
  sec1Cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EFF6FF" } };
  sec1Cell.alignment = { vertical: "middle", horizontal: "left" };
  guideSheet.getRow(4).height = 26;

  const instructions = [
    "1. Switch to the 'Full Catalog Intake' tab at the bottom of this workbook to enter your listing drafts.",
    "2. Fill in Part Number, Selling Price, Quantity, Brand, Description, Image URL (PicsURL), and custom SKU.",
    "3. Keep row 1 column headers unchanged for automatic PartPulse AI parsing.",
    "4. Upload this file (.xlsx) directly into PartPulse Pipeline (/pipeline) to stage eBay draft listings.",
  ];

  instructions.forEach((text, idx) => {
    const rowNum = 5 + idx;
    guideSheet.mergeCells(`A${rowNum}:E${rowNum}`);
    const cell = guideSheet.getCell(`A${rowNum}`);
    cell.value = text;
    cell.font = { name: "Segoe UI", size: 10, color: { argb: "334155" } };
    guideSheet.getRow(rowNum).height = 20;
  });

  // Blank Row 9
  guideSheet.getRow(9).height = 14;

  // Section Header: Column Schema (Row 10)
  guideSheet.mergeCells("A10:E10");
  const sec2Cell = guideSheet.getCell("A10");
  sec2Cell.value = "📋 COLUMN SPECIFICATIONS & FORMATTING RULES";
  sec2Cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "0C274D" } };
  sec2Cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "EFF6FF" } };
  sec2Cell.alignment = { vertical: "middle", horizontal: "left" };
  guideSheet.getRow(10).height = 26;

  // Table Headers (Row 11)
  const schemaHeaders = ["Column Name", "Required?", "Data Type", "Description & Rules", "Example Value"];
  const headerRow = guideSheet.getRow(11);
  headerRow.height = 26;
  schemaHeaders.forEach((text, colIdx) => {
    const cell = headerRow.getCell(colIdx + 1);
    cell.value = text;
    cell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "2563EB" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });

  // Schema Rows
  const schemaData = [
    ["Part Number", "REQUIRED", "Text", "Primary OEM Part Number, MPN, or interchange number.", "8K0615301M"],
    ["Selling Price", "REQUIRED", "Decimal", "Target listing selling price in USD.", "149.99"],
    ["Quantity", "REQUIRED", "Integer", "Available stock quantity.", "12"],
    ["Brand", "OPTIONAL", "Text", "OEM or aftermarket brand name.", "Audi"],
    ["Description", "OPTIONAL", "Text", "Listing title or condition details for eBay listing draft.", "OEM Rear Brake Disc Rotor 8K0615301M"],
    ["PicsURL", "OPTIONAL", "Text", "Direct image URL or photo folder group name.", "https://images.partpulse.io/8k0615301m.jpg"],
    ["SKU", "OPTIONAL", "Text", "Organization inventory SKU (auto-generated if empty).", "AUDI-8K0615301M-USED"],
  ];

  schemaData.forEach((rowValues, idx) => {
    const rowNum = 12 + idx;
    const row = guideSheet.getRow(rowNum);
    row.height = 22;
    rowValues.forEach((val, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = val;
      cell.font = { name: "Segoe UI", size: 9.5, color: { argb: "1E293B" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      if (colIdx === 1) {
        cell.font = { name: "Segoe UI", size: 9.5, bold: true, color: val === "REQUIRED" ? { argb: "166534" } : { argb: "64748B" } };
      }
      cell.border = {
        bottom: { style: "thin", color: { argb: "E2E8F0" } },
        right: { style: "thin", color: { argb: "E2E8F0" } },
      };
    });
  });

  // ==========================================
  // TAB 2: Full Catalog Data Intake Sheet
  // ==========================================
  const dataSheet = workbook.addWorksheet("Full Catalog Intake", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
  });

  dataSheet.columns = [
    { header: "Part Number", key: "partNo", width: 24 },
    { header: "Selling Price", key: "price", width: 18 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Brand", key: "brand", width: 18 },
    { header: "Description", key: "description", width: 48 },
    { header: "PicsURL", key: "picsUrl", width: 44 },
    { header: "SKU", key: "sku", width: 28 },
  ];

  // Header Styling for Data Sheet (Row 1)
  const dataHeaderRow = dataSheet.getRow(1);
  dataHeaderRow.height = 32;
  ["Part Number", "Selling Price", "Quantity", "Brand", "Description", "PicsURL", "SKU"].forEach((text, idx) => {
    const cell = dataHeaderRow.getCell(idx + 1);
    cell.value = text;
    cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "0C274D" } };
    cell.alignment = { vertical: "middle", horizontal: idx === 1 || idx === 2 ? "right" : "left" };
    cell.border = {
      bottom: { style: "medium", color: { argb: "2563EB" } },
    };
  });

  // Sample Data Rows
  const sampleRows = [
    {
      partNo: "8K0615301M",
      price: 149.99,
      quantity: 12,
      brand: "Audi",
      description: "OEM Rear Brake Disc Rotor 8K0615301M for Audi A4 A5 Q5",
      picsUrl: "https://images.partpulse.io/samples/8k0615301m.jpg",
      sku: "AUDI-8K0615301M-USED",
    },
    {
      partNo: "4E0833051C",
      price: 89.50,
      quantity: 5,
      brand: "Audi",
      description: "OEM Rear Right Door Glass Panel 4E0833051C",
      picsUrl: "https://images.partpulse.io/samples/4e0833051c.jpg",
      sku: "AUDI-4E0833051C-USED",
    },
    {
      partNo: "1GNEK13Z43R",
      price: 299.00,
      quantity: 3,
      brand: "Chevrolet",
      description: "OEM Transfer Case Control Module 1GNEK13Z43R",
      picsUrl: "https://images.partpulse.io/samples/1gnek13z43r.jpg",
      sku: "GM-1GNEK13Z43R-USED",
    },
  ];

  sampleRows.forEach((item, idx) => {
    const rowNum = 2 + idx;
    const row = dataSheet.getRow(rowNum);
    row.height = 24;

    const cellPart = row.getCell(1);
    cellPart.value = item.partNo;
    cellPart.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "2563EB" } };
    cellPart.alignment = { vertical: "middle", horizontal: "left" };

    const cellPrice = row.getCell(2);
    cellPrice.value = item.price;
    cellPrice.numFmt = "$#,##0.00";
    cellPrice.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    cellPrice.alignment = { vertical: "middle", horizontal: "right" };

    const cellQty = row.getCell(3);
    cellQty.value = item.quantity;
    cellQty.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    cellQty.alignment = { vertical: "middle", horizontal: "right" };

    const cellBrand = row.getCell(4);
    cellBrand.value = item.brand;
    cellBrand.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    cellBrand.alignment = { vertical: "middle", horizontal: "left" };

    const cellDesc = row.getCell(5);
    cellDesc.value = item.description;
    cellDesc.font = { name: "Segoe UI", size: 10, color: { argb: "0F172A" } };
    cellDesc.alignment = { vertical: "middle", horizontal: "left" };

    const cellPics = row.getCell(6);
    cellPics.value = item.picsUrl;
    cellPics.font = { name: "Segoe UI", size: 9.5, color: { argb: "2563EB" }, underline: "single" };
    cellPics.alignment = { vertical: "middle", horizontal: "left" };

    const cellSku = row.getCell(7);
    cellSku.value = item.sku;
    cellSku.font = { name: "Segoe UI", size: 9.5, bold: true, color: { argb: "475569" } };
    cellSku.alignment = { vertical: "middle", horizontal: "left" };

    [cellPart, cellPrice, cellQty, cellBrand, cellDesc, cellPics, cellSku].forEach((cell) => {
      cell.border = { bottom: { style: "thin", color: { argb: "F1F5F9" } } };
      if (idx % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F8FAFC" } };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
