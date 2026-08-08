"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  apiGetCached,
  getCachedAccessSession,
  getCachedWorkspaceSession,
  logoutSession,
  refreshAccessSession,
  SessionExpiredError,
  setCachedWorkspaceSession,
  type CachedWorkspaceSession,
} from "../lib/auth-session";

export type WorkspaceSession = CachedWorkspaceSession;

type AuthStatus = "loading" | "ready" | "required";

type AuthContextValue = {
  status: AuthStatus;
  token: string;
  session: WorkspaceSession | null;
  demo: boolean;
  logout: () => Promise<void>;
  apiFetch: (path: string, init?: RequestInit) => Promise<unknown>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readDemoFlag() {
  return (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("demo") === "1"
  );
}

function initialAuthState(): {
  status: AuthStatus;
  token: string;
  session: WorkspaceSession | null;
  demo: boolean;
} {
  if (typeof window === "undefined") {
    return { status: "loading", token: "", session: null, demo: false };
  }
  if (readDemoFlag()) {
    return {
      status: "ready",
      token: "demo",
      demo: true,
      session: {
        user: { id: "demo", email: "demo@partpulse.local", name: "Demo Operator" },
        organization: { id: "demo", name: "Demo Yard", slug: "demo" },
        role: "CATALOG_OPERATOR",
        permissions: [],
      },
    };
  }
  const access = getCachedAccessSession();
  const profile = getCachedWorkspaceSession();
  if (access && profile) {
    return { status: "ready", token: access.accessToken, session: profile, demo: false };
  }
  if (access) {
    return { status: "loading", token: access.accessToken, session: null, demo: false };
  }
  return { status: "loading", token: "", session: null, demo: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(initialAuthState);
  const [status, setStatus] = useState<AuthStatus>(boot.status);
  const [token, setToken] = useState(boot.token);
  const [session, setSession] = useState<WorkspaceSession | null>(boot.session);
  const [demo, setDemo] = useState(boot.demo);

  const markRequired = useCallback(() => {
    setToken("");
    setSession(null);
    setCachedWorkspaceSession(null);
    setStatus("required");
  }, []);

  const syncToken = useCallback(() => {
    const access = getCachedAccessSession();
    if (access) setToken(access.accessToken);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (readDemoFlag()) {
      setDemo(true);
      setToken("demo");
      setSession({
        user: { id: "demo", email: "demo@partpulse.local", name: "Demo Operator" },
        organization: { id: "demo", name: "Demo Yard", slug: "demo" },
        role: "CATALOG_OPERATOR",
        permissions: [],
      });
      setStatus("ready");
      return;
    }

    void refreshAccessSession()
      .then(async (access) => {
        if (cancelled) return;
        setToken(access.accessToken);
        const cachedProfile = getCachedWorkspaceSession();
        if (cachedProfile) {
          setSession(cachedProfile);
          setStatus("ready");
          return;
        }
        const body = (await apiGetCached("/api/session")) as WorkspaceSession;
        if (cancelled) return;
        setCachedWorkspaceSession(body);
        setSession(body);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) markRequired();
      });

    return () => {
      cancelled = true;
    };
  }, [markRequired]);

  // Quietly renew the access token before it expires so workspace polls never 401.
  useEffect(() => {
    if (demo || status !== "ready") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      const access = getCachedAccessSession();
      const delayMs = access
        ? Math.max(5_000, access.expiresAt - Date.now() - 90_000)
        : 5_000;
      timer = setTimeout(() => {
        void refreshAccessSession({ force: true })
          .then((next) => {
            if (cancelled) return;
            setToken(next.accessToken);
            schedule();
          })
          .catch(() => {
            if (!cancelled) markRequired();
          });
      }, delayMs);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [demo, markRequired, status, token]);

  const logout = useCallback(async () => {
    await logoutSession().catch(() => undefined);
    window.location.href = "/login";
  }, []);

  const apiFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    if (demo) throw new Error("Demo mode cannot call the live API");
    try {
      const result = await apiGetCached(path, init);
      syncToken();
      return result;
    } catch (error) {
      if (error instanceof SessionExpiredError) markRequired();
      throw error;
    }
  }, [demo, markRequired, syncToken]);

  const value = useMemo(
    () => ({ status, token, session, demo, logout, apiFetch }),
    [status, token, session, demo, logout, apiFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
