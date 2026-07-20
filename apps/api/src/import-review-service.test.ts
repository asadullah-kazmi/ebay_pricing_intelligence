import { describe, expect, it } from "vitest";
import { buildImportReadiness, ImportReviewError, parseConfirmableImportRow } from "./import-review-service.js";

const validNormalizedRow = {
  templateVersion: "1.0" as const,
  vin: "1GNEK13Z43R000001",
  sku: "SKU-001",
  normalizedSku: "SKU-001",
  primaryPartNumber: "84-178-783",
  normalizedPartNumber: "84178783",
  condition: "USED" as const,
  quantity: 1,
  cost: 25.5,
  currency: "USD",
  imageGroup: "VIN-001",
  interchangeNumbers: ["13598091"],
};

describe("import review readiness", () => {
  it("allows a valid batch after every image is resolved", () => {
    expect(buildImportReadiness({
      status: "READY_TO_COMMIT",
      totalRows: 50,
      invalidRows: 0,
      imageReviewCount: 0,
      imageUnmatchedCount: 0,
    })).toEqual({ canConfirm: true, blockers: [] });
  });

  it("reports row and image blockers independently", () => {
    const result = buildImportReadiness({
      status: "REVIEW_REQUIRED",
      totalRows: 3,
      invalidRows: 1,
      imageReviewCount: 2,
      imageUnmatchedCount: 1,
    });
    expect(result.canConfirm).toBe(false);
    expect(result.blockers.map(({ code }) => code)).toEqual(["INVALID_ROWS", "UNRESOLVED_IMAGES"]);
  });

  it("treats completed confirmation as idempotent but not confirmable again", () => {
    const result = buildImportReadiness({
      status: "COMPLETED",
      totalRows: 1,
      invalidRows: 0,
      imageReviewCount: 0,
      imageUnmatchedCount: 0,
    });
    expect(result.canConfirm).toBe(false);
    expect(result.blockers[0]?.code).toBe("IMPORT_COMPLETED");
  });
});

describe("confirmable staged rows", () => {
  it("accepts the normalized data written by the import parser", () => {
    expect(parseConfirmableImportRow(validNormalizedRow)).toEqual(validNormalizedRow);
  });

  it("rejects corrupted normalized data before opening catalog records", () => {
    expect(() => parseConfirmableImportRow({ ...validNormalizedRow, quantity: -1 })).toThrow(ImportReviewError);
    expect(() => parseConfirmableImportRow({ ...validNormalizedRow, normalizedSku: "WRONG" })).toThrow(ImportReviewError);
    expect(() => parseConfirmableImportRow({ ...validNormalizedRow, weight: 2 })).toThrow(ImportReviewError);
  });
});
