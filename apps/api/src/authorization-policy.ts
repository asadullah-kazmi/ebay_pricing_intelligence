import type { OrganizationRole } from "./auth.js";

export const organizationPermissionRoles = {
  catalogWrite: ["OWNER", "ADMIN", "LISTING_MANAGER", "MANAGER", "CATALOG_OPERATOR"],
  pricing: ["OWNER", "ADMIN", "LISTING_MANAGER", "STORE_MANAGER", "MANAGER", "PRICING_OPERATOR"],
  pricingRule: ["OWNER", "ADMIN"],
  fitment: ["OWNER", "ADMIN", "STORE_MANAGER", "MANAGER", "CATALOG_OPERATOR"],
  listingPublish: ["OWNER", "ADMIN", "LISTING_MANAGER", "MANAGER", "PUBLISHER"],
  deadLetterOperations: ["OWNER", "ADMIN", "MANAGER"],
  administration: ["OWNER", "ADMIN"],
  teamManagement: ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly OrganizationRole[]>;

export type OrganizationPermission = keyof typeof organizationPermissionRoles;

export function roleHasPermission(role: OrganizationRole, permission: OrganizationPermission): boolean {
  return (organizationPermissionRoles[permission] as readonly OrganizationRole[]).includes(role);
}
