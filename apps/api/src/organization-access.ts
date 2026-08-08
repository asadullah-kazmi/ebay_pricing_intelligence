import type { OrganizationRole } from "./auth.js";

export const organizationPermissions = [
  "tab.dashboard",
  "tab.quick_sku",
  "tab.pipeline",
  "tab.catalog",
  "tab.pricing",
  "tab.media_drive",
  "tab.inventory",
  "tab.orders",
  "tab.fitment",
  "tab.shipping",
  "tab.channels",
  "tab.reports",
  "tab.settings",
  "dashboard.view",
  "quick_sku.create",
  "pipeline.view",
  "pipeline.upload",
  "pipeline.manage",
  "catalog.view",
  "catalog.edit",
  "catalog.delete",
  "catalog.publish",
  "pricing.view",
  "pricing.run",
  "pricing.edit",
  "pricing.export",
  "media.view",
  "media.upload",
  "media.delete",
  "inventory.view",
  "inventory.edit",
  "orders.view",
  "orders.manage",
  "fitment.view",
  "fitment.manage",
  "shipping.view",
  "shipping.manage",
  "channels.manage",
  "reports.view",
  "team.manage",
  "admin.manage",
] as const;

export type OrganizationAccessPermission = typeof organizationPermissions[number];

const allPermissions = [...organizationPermissions];

export const roleDefaultPermissions: Record<string, readonly OrganizationAccessPermission[]> = {
  OWNER: allPermissions,
  ADMIN: allPermissions,
  LISTING_MANAGER: [
    "tab.quick_sku", "quick_sku.create",
    "tab.pipeline", "pipeline.view", "pipeline.upload", "pipeline.manage",
    "tab.catalog", "catalog.view", "catalog.edit", "catalog.delete", "catalog.publish",
    "tab.pricing", "pricing.view", "pricing.run", "pricing.edit", "pricing.export",
    "tab.media_drive", "media.view", "media.upload", "media.delete",
  ],
  STORE_MANAGER: [
    "tab.dashboard", "dashboard.view",
    "tab.inventory", "inventory.view", "inventory.edit",
    "tab.orders", "orders.view", "orders.manage",
    "tab.pricing", "pricing.view", "pricing.run", "pricing.edit", "pricing.export",
    "tab.fitment", "fitment.view", "fitment.manage",
    "tab.shipping", "shipping.view", "shipping.manage",
  ],
  // Compatibility defaults for memberships created before granular RBAC.
  MANAGER: allPermissions.filter((permission) => permission !== "team.manage" && permission !== "admin.manage"),
  CATALOG_OPERATOR: ["tab.quick_sku", "quick_sku.create", "tab.pipeline", "pipeline.view", "pipeline.upload", "pipeline.manage", "tab.catalog", "catalog.view", "catalog.edit", "tab.media_drive", "media.view", "media.upload"],
  PRICING_OPERATOR: ["tab.pricing", "pricing.view", "pricing.run", "pricing.edit", "pricing.export"],
  PUBLISHER: ["tab.catalog", "catalog.view", "catalog.publish"],
  VIEWER: [],
};

export function isOrganizationPermission(value: string): value is OrganizationAccessPermission {
  return (organizationPermissions as readonly string[]).includes(value);
}

export function normalizeOrganizationPermissions(values: readonly string[]) {
  return [...new Set(values.filter(isOrganizationPermission))];
}

export function effectiveOrganizationPermissions(role: OrganizationRole, overrides: readonly string[] = []) {
  if (role === "OWNER" || role === "ADMIN") return [...allPermissions];
  return overrides.length
    ? normalizeOrganizationPermissions(overrides)
    : [...(roleDefaultPermissions[role] ?? [])];
}

export function hasOrganizationPermission(role: OrganizationRole, overrides: readonly string[], permission: OrganizationAccessPermission) {
  return effectiveOrganizationPermissions(role, overrides).includes(permission);
}
