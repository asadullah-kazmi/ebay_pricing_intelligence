import { describe, expect, it } from "vitest";
import { notificationForEvent } from "./notification-service.js";

describe("operational notification mapping", () => {
  it("maps governed pricing work to pricing operators", () => {
    expect(notificationForEvent("pricing.proposal.created", { proposalId: "proposal-1" })).toMatchObject({
      category: "PRICING",
      severity: "INFO",
      roles: expect.arrayContaining(["OWNER", "ADMIN", "PRICING_OPERATOR"]),
    });
  });

  it("includes a published listing ID without accepting arbitrary payload shapes", () => {
    expect(notificationForEvent("listing.published", { listingId: "123456789" })).toMatchObject({
      category: "PUBLISHING",
      severity: "SUCCESS",
      message: "eBay listing 123456789 is live.",
    });
    expect(notificationForEvent("listing.published", ["not", "an", "object"])?.message).toBe("The approved eBay listing is live.");
  });

  it("treats remote drift as a critical notification", () => {
    expect(notificationForEvent("listing.reconciliation.drifted", {})).toMatchObject({
      category: "PUBLISHING",
      severity: "CRITICAL",
      actionUrl: "/admin",
    });
  });

  it("ignores events that are not user-facing", () => {
    expect(notificationForEvent("listing.draft.updated", {})).toBeNull();
    expect(notificationForEvent("pricing.job.created", {})).toBeNull();
  });

  it("routes completed retention runs only to tenant owners and administrators", () => {
    expect(notificationForEvent("retention.run.completed", { mode: "APPLY" })).toMatchObject({
      category: "SYSTEM",
      severity: "SUCCESS",
      roles: ["OWNER", "ADMIN"],
    });
  });
});
