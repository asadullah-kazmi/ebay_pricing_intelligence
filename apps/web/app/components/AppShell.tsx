"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "./BrandMark";
import styles from "./shell.module.css";
import { permissionSet } from "../lib/organization-access";

export type NavKey =
  | "dashboard"
  | "catalog"
  | "quickSku"
  | "inventory"
  | "orders"
  | "channels"
  | "mediaDrive"
  | "listings"
  | "pricing"
  | "fitment"
  | "shipping"
  | "pipeline"
  | "reports"
  | "settings"
  | "notifications"
  | "team";

const navItems: Array<{ key: NavKey; href: string; label: string; icon: string }> = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { key: "quickSku", href: "/quick-sku", label: "Quick SKU", icon: "M12 4v16m8-8H4" },
  { key: "pipeline", href: "/pipeline", label: "Pipeline", icon: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" },
  { key: "catalog", href: "/catalog", label: "Catalog", icon: "M4 6h16M4 10h16M4 14h16M4 18h16" },
  { key: "fitment", href: "/fitment", label: "Fitx", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { key: "mediaDrive", href: "/media-drive", label: "Media Drive", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { key: "inventory", href: "/inventory", label: "Inventory", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { key: "pricing", href: "/pricing", label: "Pricing", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "orders", href: "/orders", label: "Orders", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { key: "channels", href: "/channels", label: "Channels", icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" },
  { key: "shipping", href: "/shipping", label: "Shipping", icon: "M8 17l4 4 4-4m-4-5v9M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2.59 13.59a2 2 0 010-2.83L9.76 3.59a2 2 0 012.83 0l7.17 7.17a2 2 0 010 2.83z" },
  { key: "reports", href: "/reports", label: "Reports", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { key: "settings", href: "/settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

type AppShellProps = {
  active: NavKey;
  children: ReactNode;
  userName?: string;
  userRole?: string;
  organizationRole?: string;
  permissions?: string[];
  badgeCount?: number;
  onSignOut?: () => void;
  footerNote?: string;
  onNavigate?: (href: string) => void;
};

export default function AppShell({
  active,
  children,
  userName = "Operator",
  userRole = "Catalog",
  organizationRole,
  permissions,
  badgeCount,
  onSignOut,
  footerNote,
  onNavigate,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const access = permissionSet(organizationRole, permissions);
  const navPermission: Partial<Record<NavKey, string>> = {
    dashboard: "tab.dashboard", quickSku: "tab.quick_sku", pipeline: "tab.pipeline",
    catalog: "tab.catalog", pricing: "tab.pricing", mediaDrive: "tab.media_drive",
    inventory: "tab.inventory", orders: "tab.orders", fitment: "tab.fitment",
    shipping: "tab.shipping", channels: "tab.channels", reports: "tab.reports", settings: "tab.settings",
  };
  const visibleNavItems = navItems.filter((item) => !navPermission[item.key] || access.has(navPermission[item.key]!));
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "PP";

  useEffect(() => {
    setMobileNavOpen(false);
  }, [active]);

  return (
    <div className={`${styles.shell}${collapsed ? ` ${styles.collapsed}` : ""}${mobileNavOpen ? ` ${styles.mobileNavOpen}` : ""}`}>
      <aside className={styles.sidebar}>
        <div className={styles.brandRow}>
          <Link className={styles.brand} href="/dashboard" title="PartPulse" onClick={() => onNavigate?.("/dashboard")}>
            <BrandMark inverse compact />
          </Link>
          <button
            type="button"
            className={styles.mobileMenuToggle}
            onClick={() => setMobileNavOpen((value) => !value)}
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileNavOpen}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {mobileNavOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={collapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
            </svg>
          </button>
        </div>
        <nav className={styles.nav}>
          {visibleNavItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={active === item.key ? styles.active : undefined}
              title={item.label}
              prefetch
              onClick={() => {
                onNavigate?.(item.href);
                setMobileNavOpen(false);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={item.icon} />
              </svg>
              <span className={styles.navLabel}>{item.label}</span>
              {item.key === "pipeline" && badgeCount ? <em className={styles.badge}>{badgeCount}</em> : null}
            </Link>
          ))}
        </nav>
        <div className={styles.sideFoot}>
          {footerNote ? <p className={styles.footerNote}>{footerNote}</p> : null}
          <div className={styles.userCard} title={`${userName} · ${userRole}`}>
            <span className={styles.avatar}>{initials}</span>
            <div className={styles.userMeta}>
              <strong>{userName}</strong>
              <small>{userRole}</small>
            </div>
          </div>
          {onSignOut ? (
            <button type="button" className={styles.signOut} onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </aside>
      {mobileNavOpen ? (
        <button
          type="button"
          className={styles.mobileBackdrop}
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <div className={styles.workspace}>{children}</div>
    </div>
  );
}
