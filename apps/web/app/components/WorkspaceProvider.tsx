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
  const [path = "", hash = ""] = pathname.split("#");
  if (path.startsWith("/pipeline")) return "pipeline";
  if (path.startsWith("/catalog")) {
    if (hash === "listing-drafts") return "listings";
    if (hash === "fitment-workflow") return "fitment";
    return "catalog";
  }
  if (path.startsWith("/admin/team")) return "team";
  if (path.startsWith("/admin")) return "reports";
  if (path.startsWith("/notifications")) return "notifications";
  if (path.startsWith("/account")) return "settings";
  if (path === "/") return "pricing";
  return "dashboard";
}

function isShellWorkspace(pathname: string) {
  const path = pathname.split("#")[0] ?? pathname;
  return (
    path.startsWith("/dashboard") ||
    path.startsWith("/catalog") ||
    path.startsWith("/pipeline")
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

function WorkspaceFrame({ children }: { children: ReactNode }) {
  const realPathname = usePathname();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const pathname = optimisticPath ?? realPathname;
  const { status, session, logout } = useAuth();
  const active = resolveActive(pathname);

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
        onSignOut={() => void logout()}
        onNavigate={navigateOptimistic}
      >
        {status === "required" ? (
          <SignInPanel />
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
