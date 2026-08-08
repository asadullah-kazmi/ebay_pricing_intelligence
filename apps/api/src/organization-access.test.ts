import { describe, expect, it } from "vitest";
import { effectiveOrganizationPermissions, hasOrganizationPermission, roleDefaultPermissions } from "./organization-access.js";

describe("organization access presets", () => {
  it("limits listing managers to listing preparation workspaces", () => {
    const permissions = roleDefaultPermissions.LISTING_MANAGER;
    expect(permissions).toContain("tab.quick_sku");
    expect(permissions).toContain("tab.pipeline");
    expect(permissions).toContain("catalog.publish");
    expect(permissions).toContain("tab.media_drive");
    expect(permissions).not.toContain("tab.orders");
    expect(permissions).not.toContain("team.manage");
  });

  it("limits store managers to store operations workspaces", () => {
    const permissions = roleDefaultPermissions.STORE_MANAGER;
    expect(permissions).toContain("tab.dashboard");
    expect(permissions).toContain("tab.inventory");
    expect(permissions).toContain("tab.orders");
    expect(permissions).toContain("tab.fitment");
    expect(permissions).toContain("tab.shipping");
    expect(permissions).not.toContain("tab.catalog");
    expect(permissions).not.toContain("media.delete");
  });

  it("honors a manager's explicit action overrides", () => {
    const permissions = effectiveOrganizationPermissions("LISTING_MANAGER", ["tab.catalog", "catalog.view"]);
    expect(permissions).toEqual(["tab.catalog", "catalog.view"]);
    expect(hasOrganizationPermission("LISTING_MANAGER", permissions, "catalog.view")).toBe(true);
    expect(hasOrganizationPermission("LISTING_MANAGER", permissions, "catalog.delete")).toBe(false);
  });

  it("always preserves full admin access", () => {
    expect(hasOrganizationPermission("ADMIN", [], "team.manage")).toBe(true);
    expect(hasOrganizationPermission("OWNER", [], "admin.manage")).toBe(true);
  });
});
