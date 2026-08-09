import { describe, expect, it } from "vitest";
import { normalizeListingTeamName } from "./listing-team-service.js";

describe("listing team tags", () => {
  it("normalizes spacing and case for organization-scoped uniqueness", () => {
    expect(normalizeListingTeamName("  Main   Warehouse ")).toBe("main warehouse");
    expect(normalizeListingTeamName("MAIN WAREHOUSE")).toBe("main warehouse");
  });
});
