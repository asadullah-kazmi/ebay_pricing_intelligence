import { describe, expect, it } from "vitest";
import {
  buildEbayListingTitle,
  cleanPartNameForTitle,
  extractPosition,
  yearRangeFromFitment,
} from "./listing-title.js";

const audiA6Fitment = Array.from({ length: 7 }, (_, index) => ({
  Year: String(2012 + index),
  Make: "Audi",
  Model: "A6",
  Trim: "C7",
}));

describe("buildEbayListingTitle", () => {
  it("follows Year → Make → Model/Generation → Position → Part Name → MPN → OEM Used", () => {
    const title = buildEbayListingTitle({
      brand: "Audi",
      partName: "Hood Hinge Cover Cap",
      primaryPartNumber: "4G9827279",
      condition: "USED",
      fitmentApplications: audiA6Fitment,
      aspects: { "Placement on Vehicle": ["Front Left"] },
    });
    expect(title).toBe("2012-2018 Audi A6 C7 Front Left Hood Hinge Cover Cap 4G9827279 OEM Used");
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it("matches guideline sample patterns", () => {
    expect(buildEbayListingTitle({
      brand: "Audi",
      partName: "Headrest Black Leather",
      primaryPartNumber: "4G8881902",
      condition: "USED",
      fitmentApplications: [{ Year: "2011", Make: "Audi", Model: "A6", Trim: "C7" }, { Year: "2018", Make: "Audi", Model: "A6", Trim: "C7" }],
      sourceTitle: "Front Right Headrest Black Leather",
    })).toBe("2011-2018 Audi A6 C7 Front Right Headrest Black Leather 4G8881902 OEM Used");

    expect(buildEbayListingTitle({
      brand: "Audi",
      partName: "Fog Light",
      primaryPartNumber: "8T0941699E",
      condition: "USED",
      fitmentApplications: audiA6Fitment,
      sourceTitle: "Front Left Fog Light",
    })).toBe("2012-2018 Audi A6 C7 Front Left Fog Light 8T0941699E OEM Used");

    expect(buildEbayListingTitle({
      brand: "Audi",
      partName: "AWD Control Module",
      primaryPartNumber: "4H0907163A",
      condition: "USED",
      fitmentApplications: audiA6Fitment,
    })).toBe("2012-2018 Audi A6 C7 AWD Control Module 4H0907163A OEM Used");

    expect(buildEbayListingTitle({
      brand: "Audi",
      partName: "Third Brake Light",
      primaryPartNumber: "4G9945097",
      condition: "USED",
      fitmentApplications: audiA6Fitment,
      sourceTitle: "Rear Third Brake Light",
    })).toBe("2012-2018 Audi A6 C7 Rear Third Brake Light 4G9945097 OEM Used");
  });

  it("builds a usable title without fitment data", () => {
    expect(buildEbayListingTitle({
      brand: "Audi",
      partName: "LEFT FRONT DOOR GRIS",
      primaryPartNumber: "4E0831051C",
      condition: "USED",
      sourceTitle: "LEFT FRONT DOOR GRIS 834611 FOR A8 4E2 3.0",
    })).toBe("Audi Front Left Door Gris 4E0831051C OEM Used");
  });

  it("never exceeds 80 characters", () => {
    const title = buildEbayListingTitle({
      brand: "Mercedes-Benz",
      partName: "Electronic Power Steering Control Module Assembly With Wiring Harness",
      primaryPartNumber: "A0009062300",
      condition: "USED",
      fitmentApplications: [{ Year: "2010", Make: "Mercedes-Benz", Model: "E-Class", Trim: "W212" }, { Year: "2016", Make: "Mercedes-Benz", Model: "E-Class", Trim: "W212" }],
      sourceTitle: "Front Left Electronic Power Steering Control Module Assembly With Wiring Harness",
    });
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title).toContain("A0009062300");
    expect(title.endsWith("OEM Used")).toBe(true);
  });
});

describe("yearRangeFromFitment", () => {
  it("returns a single year or a range", () => {
    expect(yearRangeFromFitment([{ Year: "2013" }, { Year: "2013" }])).toBe("2013");
    expect(yearRangeFromFitment([{ Year: "2012" }, { Year: "2018" }])).toBe("2012-2018");
  });
});

describe("extractPosition", () => {
  it("normalizes common placement phrases", () => {
    expect(extractPosition({ partName: "LEFT FRONT DOOR GRIS" })).toBe("Front Left");
    expect(extractPosition({ sourceTitle: "Rear Third Brake Light" })).toBe("Rear");
  });
});

describe("cleanPartNameForTitle", () => {
  it("removes brand, part number, and placement tokens", () => {
    expect(cleanPartNameForTitle({
      partName: "OEM Audi Front Left Fog Light 8T0941699E",
      brand: "Audi",
      primaryPartNumber: "8T0941699E",
      position: "Front Left",
    })).toBe("Fog Light");
  });
});
