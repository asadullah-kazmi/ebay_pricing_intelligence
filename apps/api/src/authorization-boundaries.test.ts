import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { organizationRoles, type OrganizationRole } from "./auth.js";
import { organizationPermissionRoles, roleHasPermission } from "./authorization-policy.js";
import { getTenantContext, requireOrganizationRoles, type TenantContext } from "./tenant-context.js";

function tenant(role: OrganizationRole): TenantContext {
  return {
    user: { id: "user-1", email: "operator@example.com", name: "Operator" },
    organization: { id: "org-1", name: "Test Auto", slug: "test-auto" },
    role,
    permissions: [],
  };
}

function responseWith(role?: OrganizationRole) {
  const response = {
    locals: role ? { tenant: tenant(role) } : {},
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe("organization authorization boundaries", () => {
  it("keeps high-risk administration and team operations owner/admin only", () => {
    for (const permission of ["administration", "teamManagement", "pricingRule"] as const) {
      expect(organizationPermissionRoles[permission]).toEqual(["OWNER", "ADMIN"]);
      for (const role of organizationRoles) {
        expect(roleHasPermission(role, permission)).toBe(role === "OWNER" || role === "ADMIN");
      }
    }
  });

  it("does not give viewer or specialized operators unrelated write permissions", () => {
    for (const permission of Object.keys(organizationPermissionRoles) as Array<keyof typeof organizationPermissionRoles>) {
      expect(roleHasPermission("VIEWER", permission)).toBe(false);
    }
    expect(roleHasPermission("PRICING_OPERATOR", "pricing")).toBe(true);
    expect(roleHasPermission("PRICING_OPERATOR", "catalogWrite")).toBe(false);
    expect(roleHasPermission("CATALOG_OPERATOR", "fitment")).toBe(true);
    expect(roleHasPermission("CATALOG_OPERATOR", "listingPublish")).toBe(false);
    expect(roleHasPermission("PUBLISHER", "listingPublish")).toBe(true);
    expect(roleHasPermission("PUBLISHER", "pricing")).toBe(false);
  });

  it("returns 401 without tenant context and 403 for a disallowed role", () => {
    const middleware = requireOrganizationRoles("OWNER", "ADMIN");
    const missing = responseWith();
    const missingNext = vi.fn() as NextFunction;
    middleware({} as Request, missing as unknown as Response, missingNext);
    expect(missing.status).toHaveBeenCalledWith(401);
    expect(missingNext).not.toHaveBeenCalled();

    const viewer = responseWith("VIEWER");
    const viewerNext = vi.fn() as NextFunction;
    middleware({} as Request, viewer as unknown as Response, viewerNext);
    expect(viewer.status).toHaveBeenCalledWith(403);
    expect(viewerNext).not.toHaveBeenCalled();
  });

  it("passes an allowed role and exposes only the verified tenant context", () => {
    const middleware = requireOrganizationRoles("OWNER", "ADMIN");
    const owner = responseWith("OWNER");
    const next = vi.fn() as NextFunction;
    middleware({} as Request, owner as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(getTenantContext(owner as unknown as Response)).toEqual(tenant("OWNER"));
    expect(() => getTenantContext(responseWith() as unknown as Response)).toThrow("Tenant context is unavailable");
  });
});
