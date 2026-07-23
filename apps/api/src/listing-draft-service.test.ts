import { describe, expect, it } from "vitest";
import { evaluateListingReadiness, type DraftValues } from "./listing-draft-service.js";

const complete: DraftValues = {
  title: "OEM ACDelco HVAC Control Module 84178783",
  description: "Tested actual item.",
  categoryId: "33596",
  condition: "USED",
  price: 68.58,
  currency: "USD",
  quantity: 1,
  aspects: { "Manufacturer Part Number": ["84178783"], Brand: ["ACDelco"] },
  paymentPolicyId: "PAY",
  returnPolicyId: "RET",
  shippingPolicyId: "SHIP",
  merchantLocationKey: "MAIN",
};

describe("listing publication readiness", () => {
  it("has no blockers when required draft, seller, and image data are present", () => {
    const issues = evaluateListingReadiness(complete, { sellerConnected: true, approvedImageCount: 2, fitmentApplicationCount: 10 });
    expect(issues.filter(({ severity }) => severity === "BLOCKER")).toEqual([]);
    expect(issues.some(({ code }) => code === "CATEGORY_METADATA_PENDING")).toBe(true);
  });

  it("reports actionable blockers without treating missing fitment as universally fatal", () => {
    const issues = evaluateListingReadiness({ ...complete, title: "", price: null, quantity: 0, categoryId: null }, {
      sellerConnected: false,
      approvedImageCount: 0,
      fitmentApplicationCount: 0,
    });
    expect(issues.filter(({ severity }) => severity === "BLOCKER").map(({ code }) => code)).toEqual(expect.arrayContaining([
      "SELLER_NOT_CONNECTED", "TITLE_REQUIRED", "CATEGORY_REQUIRED", "PRICE_REQUIRED", "QUANTITY_REQUIRED", "APPROVED_IMAGE_REQUIRED",
    ]));
    expect(issues).toContainEqual(expect.objectContaining({ code: "FITMENT_NOT_APPROVED", severity: "WARNING" }));
  });
});
