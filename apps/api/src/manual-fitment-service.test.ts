import { describe, expect, it } from "vitest";
import { ManualFitmentError, normalizeManualFitmentProperties } from "./manual-fitment-service.js";

describe("manual fitment normalization", () => {
  it("trims, removes empty properties, and produces a stable fingerprint", () => {
    const first = normalizeManualFitmentProperties({ Model: " X3 ", Year: "2020", Empty: "", Make: "BMW" });
    const second = normalizeManualFitmentProperties({ Make: "BMW", Year: "2020", Model: "X3" });
    expect(first.properties).toEqual({ Make: "BMW", Model: "X3", Year: "2020" });
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("rejects an empty application", () => {
    expect(() => normalizeManualFitmentProperties({ Year: " " })).toThrow(ManualFitmentError);
  });
});
