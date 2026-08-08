"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import AppShell, { type NavKey } from "./AppShell";
import BrandMark from "./BrandMark";
import { AuthProvider, useAuth } from "./AuthProvider";
import WorkspaceViews from "./WorkspaceViews";
import styles from "./workspace.module.css";
import { firstAllowedRoute, permissionSet } from "../lib/organization-access";

type NavContextValue = {
  pathname: string;
  navigateOptimistic: (href: string) => void;
};

const NavContext = createContext<NavContextValue | null>(null);

export function useWorkspacePathname() {
  const value = useContext(NavContext);
  const fallback = usePathname();
  return value?.pathname ?? fallback;
}

function resolveActive(pathname: string): NavKey {
  const path = pathname.split("#")[0] ?? pathname;
  if (path.startsWith("/media-drive")) return "mediaDrive";
  if (path.startsWith("/pipeline")) return "pipeline";
  if (path.startsWith("/orders")) return "orders";
  if (path.startsWith("/channels")) return "channels";
  if (path.startsWith("/inventory")) return "inventory";
  if (path.startsWith("/pricing")) return "pricing";
  if (path.startsWith("/fitment")) return "fitment";
  if (path.startsWith("/shipping")) return "shipping";
  if (path.startsWith("/reports")) return "reports";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/quick-sku")) return "quickSku";
  if (path.startsWith("/catalog")) return "catalog";
  if (path.startsWith("/admin/team")) return "team";
  if (path.startsWith("/admin")) return "reports";
  if (path.startsWith("/notifications")) return "notifications";
  if (path.startsWith("/account")) return "settings";
  return "dashboard";
}

function isShellWorkspace(pathname: string) {
  const path = pathname.split("#")[0] ?? pathname;
  return (
    path.startsWith("/dashboard") ||
    path.startsWith("/catalog") ||
    path.startsWith("/quick-sku") ||
    path.startsWith("/inventory") ||
    path.startsWith("/pricing") ||
    path.startsWith("/fitment") ||
    path.startsWith("/media-drive") ||
    path.startsWith("/shipping") ||
    path.startsWith("/pipeline") ||
    path.startsWith("/orders") ||
    path.startsWith("/channels") ||
    path.startsWith("/reports") ||
    path.startsWith("/settings")
  );
}

function SignInPanel() {
  return (
    <section className={styles.signInPanel}>
      <BrandMark />
      <span className={styles.eyebrow}>PARTPULSE WORKSPACE</span>
      <h1>Sign in to continue</h1>
      <p>Your session has ended. Sign in again to keep working in PartPulse.</p>
      <Link className={styles.signInButton} href="/login">
        Sign in to PartPulse
      </Link>
    </section>
  );
}

function AccessDeniedPanel({ href }: { href: string }) {
  return (
    <section className={styles.signInPanel}>
      <BrandMark />
      <span className={styles.eyebrow}>ACCESS CONTROL</span>
      <h1>This area is not assigned to you</h1>
      <p>Ask your organization administrator to add this tab or the required action to your access profile.</p>
      <Link className={styles.signInButton} href={href}>Open an available workspace</Link>
    </section>
  );
}

function WorkspaceFrame({ children }: { children: ReactNode }) {
  const realPathname = usePathname();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const pathname = optimisticPath ?? realPathname;
  const { status, session, logout } = useAuth();
  const active = resolveActive(pathname);
  const access = permissionSet(session?.role, session?.permissions);
  const requiredTab: Partial<Record<NavKey, string>> = {
    dashboard: "tab.dashboard", quickSku: "tab.quick_sku", pipeline: "tab.pipeline",
    catalog: "tab.catalog", pricing: "tab.pricing", mediaDrive: "tab.media_drive",
    inventory: "tab.inventory", orders: "tab.orders", fitment: "tab.fitment",
    shipping: "tab.shipping", channels: "tab.channels", reports: "tab.reports", settings: "tab.settings",
  };
  const canOpenActive = !requiredTab[active] || access.has(requiredTab[active]!);
  const firstAllowedHref = firstAllowedRoute(session?.role, session?.permissions);

  useEffect(() => {
    setOptimisticPath(null);
  }, [realPathname]);

  const navigateOptimistic = useCallback((href: string) => {
    const path = href.split("?")[0] ?? href;
    if (isShellWorkspace(path)) setOptimisticPath(path);
  }, []);

  const navValue = useMemo(
    () => ({ pathname, navigateOptimistic }),
    [pathname, navigateOptimistic],
  );

  return (
    <NavContext.Provider value={navValue}>
      <AppShell
        active={active}
        userName={session?.user.name || session?.user.email || "PartPulse"}
        userRole={session?.organization.name || "Workspace"}
        organizationRole={session?.role}
        permissions={session?.permissions}
        onSignOut={() => void logout()}
        onNavigate={navigateOptimistic}
      >
        {status === "required" ? (
          <SignInPanel />
        ) : status === "ready" && !canOpenActive ? (
          <AccessDeniedPanel href={firstAllowedHref} />
        ) : isShellWorkspace(pathname) ? (
          <WorkspaceViews pathname={pathname} />
        ) : (
          children
        )}
      </AppShell>
    </NavContext.Provider>
  );
}

export default function WorkspaceProvider({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <WorkspaceFrame>{children}</WorkspaceFrame>
    </AuthProvider>
  );
}
