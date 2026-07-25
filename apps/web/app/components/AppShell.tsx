"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import BrandMark from "./BrandMark";
import styles from "./shell.module.css";

export type NavKey =
  | "dashboard"
  | "catalog"
  | "inventory"
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
  { key: "catalog", href: "/catalog", label: "Catalog", icon: "M4 6h16M4 10h16M4 14h16M4 18h16" },
  { key: "inventory", href: "/catalog", label: "Inventory", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { key: "listings", href: "/catalog#listing-drafts", label: "Listings", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { key: "pricing", href: "/", label: "Pricing", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "fitment", href: "/catalog#fitment-workflow", label: "Fitment", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { key: "shipping", href: "/catalog#listing-drafts", label: "Shipping", icon: "M8 17l4 4 4-4m-4-5v9M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2.59 13.59a2 2 0 010-2.83L9.76 3.59a2 2 0 012.83 0l7.17 7.17a2 2 0 010 2.83z" },
  { key: "pipeline", href: "/pipeline", label: "Pipeline", icon: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" },
  { key: "reports", href: "/admin", label: "Reports", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { key: "settings", href: "/account/security", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

type AppShellProps = {
  active: NavKey;
  children: ReactNode;
  userName?: string;
  userRole?: string;
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
  badgeCount,
  onSignOut,
  footerNote,
  onNavigate,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "PP";

  return (
    <div className={`${styles.shell}${collapsed ? ` ${styles.collapsed}` : ""}`}>
      <aside className={styles.sidebar}>
        <div className={styles.brandRow}>
        <Link className={styles.brand} href="/dashboard" title="PartPulse" onClick={() => onNavigate?.("/dashboard")}>
          <BrandMark inverse compact />
        </Link>
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
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={active === item.key ? styles.active : undefined}
              title={item.label}
              prefetch
              onClick={() => onNavigate?.(item.href)}
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
      <div className={styles.workspace}>{children}</div>
    </div>
  );
}
