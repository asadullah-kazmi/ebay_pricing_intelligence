import { describe, expect, it } from "vitest";
import { normalizeFitmentApplications, scoreFitmentCandidate } from "./fitment-service.js";

describe("fitment candidate scoring", () => {
  it("requires a user review while ranking exact part-number and brand evidence highest", () => {
    const result = scoreFitmentCandidate({
      epid: "123", title: "Genuine ACDelco HVAC module 84178783", brand: "ACDelco",
      imageUrl: null, productWebUrl: null,
      aspects: { "Manufacturer Part Number": ["8417-8783"] },
    }, { partNumber: "84178783", brand: "ACDelco" });
    expect(result.score).toBe(100);
    expect(result.matchedOn).toEqual(["exact part-number aspect", "brand", "part number in title"]);
  });

  it("does not treat an unrelated catalog product as a candidate", () => {
    const result = scoreFitmentCandidate({
      epid: "456", title: "Generic brake rotor", brand: "Other", imageUrl: null, productWebUrl: null,
      aspects: { "Manufacturer Part Number": ["XYZ"] },
    }, { partNumber: "84178783", brand: "ACDelco" });
    expect(result.score).toBe(0);
    expect(result.matchedOn).toEqual([]);
  });
});

describe("fitment application normalization", () => {
  it("sorts fields, drops empty rows, and deduplicates equivalent applications", () => {
    const result = normalizeFitmentApplications([
      { Model: "A4", Year: "2013", Make: "Audi" },
      { Year: "2013", Make: "Audi", Model: "A4" },
      { Year: "" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties).toEqual({ Make: "Audi", Model: "A4", Year: "2013" });
    expect(result[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
