import { describe, expect, it } from "vitest";
import { getAdminRetryPolicy } from "./admin-operations-service.js";

describe("admin retry policy", () => {
  it("allows local payload preparation and read-only reconciliation", () => {
    expect(getAdminRetryPolicy("INVENTORY_PREPARATION", "PREPARE").retryAllowed).toBe(true);
    expect(getAdminRetryPolicy("LISTING_OPERATION", "RECONCILE").retryAllowed).toBe(true);
  });

  it("blocks commands that can repeat external eBay mutations", () => {
    expect(getAdminRetryPolicy("INVENTORY_SYNC", "SYNC").retryAllowed).toBe(false);
    expect(getAdminRetryPolicy("OFFER", "PUBLISH").retryAllowed).toBe(false);
    expect(getAdminRetryPolicy("LISTING_OPERATION", "REVISE").retryAllowed).toBe(false);
    expect(getAdminRetryPolicy("LISTING_OPERATION", "WITHDRAW").retryAllowed).toBe(false);
  });

  it("routes pricing and fitment failures to item-level dead letters", () => {
    expect(getAdminRetryPolicy("PRICING", null)).toMatchObject({ retryAllowed: false });
    expect(getAdminRetryPolicy("FITMENT", null).retryReason).toContain("dead-letter");
  });
});
