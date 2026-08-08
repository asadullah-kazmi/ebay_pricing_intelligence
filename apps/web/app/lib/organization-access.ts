export const accessRoles = ["ADMIN", "LISTING_MANAGER", "STORE_MANAGER"] as const;
export type AccessRole = typeof accessRoles[number];

export type AccessOption = {
  tab: string;
  label: string;
  permission: string;
  actions: Array<{ permission: string; label: string }>;
};

export const accessOptions: AccessOption[] = [
  { tab: "dashboard", label: "Dashboard", permission: "tab.dashboard", actions: [{ permission: "dashboard.view", label: "View organization dashboard" }] },
  { tab: "quickSku", label: "Quick SKU", permission: "tab.quick_sku", actions: [{ permission: "quick_sku.create", label: "Create listings from part numbers" }] },
  { tab: "pipeline", label: "Pipeline", permission: "tab.pipeline", actions: [{ permission: "pipeline.view", label: "View imports" }, { permission: "pipeline.upload", label: "Upload sheets and images" }, { permission: "pipeline.manage", label: "Review and commit imports" }] },
  { tab: "catalog", label: "Catalog", permission: "tab.catalog", actions: [{ permission: "catalog.view", label: "View listings" }, { permission: "catalog.edit", label: "Edit listings" }, { permission: "catalog.delete", label: "Delete listings" }, { permission: "catalog.publish", label: "Publish listings" }] },
  { tab: "pricing", label: "Pricing", permission: "tab.pricing", actions: [{ permission: "pricing.view", label: "View pricing" }, { permission: "pricing.run", label: "Run pricing jobs" }, { permission: "pricing.edit", label: "Edit selling prices" }, { permission: "pricing.export", label: "Export priced sheets" }] },
  { tab: "mediaDrive", label: "Media Drive", permission: "tab.media_drive", actions: [{ permission: "media.view", label: "View media" }, { permission: "media.upload", label: "Upload and link images" }, { permission: "media.delete", label: "Delete images and folders" }] },
  { tab: "inventory", label: "Inventory", permission: "tab.inventory", actions: [{ permission: "inventory.view", label: "View inventory" }, { permission: "inventory.edit", label: "Edit stock and locations" }] },
  { tab: "orders", label: "Orders", permission: "tab.orders", actions: [{ permission: "orders.view", label: "View orders" }, { permission: "orders.manage", label: "Manage order workflow" }] },
  { tab: "fitment", label: "Fitx", permission: "tab.fitment", actions: [{ permission: "fitment.view", label: "View compatibility" }, { permission: "fitment.manage", label: "Add and approve fitment" }] },
  { tab: "shipping", label: "Shipping", permission: "tab.shipping", actions: [{ permission: "shipping.view", label: "View shipping policies" }, { permission: "shipping.manage", label: "Assign shipping policies" }] },
  { tab: "channels", label: "Channels", permission: "tab.channels", actions: [{ permission: "channels.manage", label: "Connect and manage stores" }] },
  { tab: "reports", label: "Reports", permission: "tab.reports", actions: [{ permission: "reports.view", label: "View reports and audit activity" }] },
  { tab: "settings", label: "Administration", permission: "tab.settings", actions: [{ permission: "team.manage", label: "Invite and manage users" }, { permission: "admin.manage", label: "Manage organization settings" }] },
];

const listingTabs = new Set(["quickSku", "pipeline", "catalog", "pricing", "mediaDrive"]);
const storeTabs = new Set(["dashboard", "inventory", "orders", "pricing", "fitment", "shipping"]);

export function defaultPermissionsForRole(role: AccessRole) {
  const selected = role === "ADMIN" ? accessOptions : accessOptions.filter((option) => (role === "LISTING_MANAGER" ? listingTabs : storeTabs).has(option.tab));
  return selected.flatMap((option) => [option.permission, ...option.actions.map((action) => action.permission)]);
}

export function roleLabel(role: string) {
  if (role === "OWNER" || role === "ADMIN") return "Admin";
  if (role === "LISTING_MANAGER") return "Listing Manager";
  if (role === "STORE_MANAGER") return "Store Manager";
  return role.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function permissionSet(role: string | undefined, permissions: string[] | undefined) {
  if (role === "OWNER" || role === "ADMIN") return new Set(accessOptions.flatMap((option) => [option.permission, ...option.actions.map((action) => action.permission)]));
  if (permissions?.length) return new Set(permissions);
  if (role === "LISTING_MANAGER" || role === "STORE_MANAGER") return new Set(defaultPermissionsForRole(role));
  return new Set<string>();
}

const routeByTabPermission: Record<string, string> = {
  "tab.dashboard": "/dashboard",
  "tab.quick_sku": "/quick-sku",
  "tab.pipeline": "/pipeline",
  "tab.catalog": "/catalog",
  "tab.pricing": "/pricing",
  "tab.media_drive": "/media-drive",
  "tab.inventory": "/inventory",
  "tab.orders": "/orders",
  "tab.fitment": "/fitment",
  "tab.shipping": "/shipping",
  "tab.channels": "/channels",
  "tab.reports": "/reports",
  "tab.settings": "/settings",
};

/** Returns the first workspace route visible to this organization member. */
export function firstAllowedRoute(role: string | undefined, permissions: string[] | undefined) {
  const access = permissionSet(role, permissions);
  return accessOptions
    .map((option) => [option.permission, routeByTabPermission[option.permission]] as const)
    .find(([permission, route]) => Boolean(route) && access.has(permission))?.[1] ?? "/login";
}
