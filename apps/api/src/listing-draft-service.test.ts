import { describe, expect, it } from "vitest";
import { evaluateListingReadiness, type DraftValues } from "./listing-draft-service.js";

const complete: DraftValues = {
  title: "OEM ACDelco HVAC Control Module 84178783",
  description: "Tested actual item.",
  categoryId: "33596",
  condition: "USED",
  ebayCondition: "USED_GOOD",
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

  it("validates selected seller resources and live category requirements", () => {
    const issues = evaluateListingReadiness(complete, {
      sellerConnected: true,
      approvedImageCount: 2,
      fitmentApplicationCount: 1,
      sellerResources: {
        paymentPolicyIds: new Set(["PAY"]),
        returnPolicyIds: new Set(["RET"]),
        fulfillmentPolicyIds: new Set(["OTHER"]),
        inventoryLocationKeys: new Set(["MAIN"]),
      },
      categoryRequirements: [
        { name: "Brand", required: true, recommended: false, mode: "SELECTION_ONLY", dataType: "STRING", cardinality: "SINGLE", values: ["BMW", "Audi"] },
        { name: "Type", required: true, recommended: false, mode: "FREE_TEXT", dataType: "STRING", cardinality: "SINGLE", values: [] },
      ],
      categoryConditions: [{ conditionId: "5000", enumValue: "USED_GOOD", name: "Used - Good", description: null }],
    });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SHIPPING_POLICY_INVALID", severity: "BLOCKER" }),
      expect.objectContaining({ code: "ASPECT_VALUE_INVALID", field: "aspects.Brand" }),
      expect.objectContaining({ code: "REQUIRED_ASPECT_MISSING", field: "aspects.Type" }),
    ]));
    expect(issues.some(({ code }) => code === "CATEGORY_METADATA_PENDING")).toBe(false);
  });

  it("blocks an unapproved or changed listing price", () => {
    const missing = evaluateListingReadiness(complete, {
      sellerConnected: true,
      approvedImageCount: 2,
      fitmentApplicationCount: 1,
      pricingApproval: null,
    });
    expect(missing).toContainEqual(expect.objectContaining({ code: "PRICING_APPROVAL_REQUIRED", severity: "BLOCKER" }));

    const changed = evaluateListingReadiness(complete, {
      sellerConnected: true,
      approvedImageCount: 2,
      fitmentApplicationCount: 1,
      pricingApproval: { approvedPrice: 70, currency: "USD", belowFloor: false },
    });
    expect(changed).toContainEqual(expect.objectContaining({ code: "PRICE_NOT_APPROVED", severity: "BLOCKER" }));
  });
});
