"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./settings.module.css";
import UserManagement from "./UserManagement";

interface Security {
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
  passwordChangedAt: string | null;
  mfaEnabled: boolean;
  recoveryCodesRemaining: number;
}

const demoSecurity: Security = {
  email: "demo@partpulse.local",
  emailVerified: true,
  hasPassword: true,
  passwordChangedAt: new Date(Date.now() - 14 * 86400_000).toISOString(),
  mfaEnabled: false,
  recoveryCodesRemaining: 0,
};

function time(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Never";
}

export default function SettingsWorkspace() {
  const { status: authStatus, demo, apiFetch, session, logout } = useAuth();
  const [security, setSecurity] = useState<Security | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"security" | "workspace" | "users">("security");
  const canManageUsers = session?.role === "OWNER" || session?.role === "ADMIN" || session?.permissions?.includes("team.manage");

  const load = useCallback(async () => {
    if (authStatus !== "ready") return;
    if (demo) {
      setSecurity(demoSecurity);
      return;
    }
    try {
      setSecurity(await apiFetch("/api/auth/security") as Security);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load account security");
    }
  }, [apiFetch, authStatus, demo]);

  useEffect(() => {
    void load();
  }, [load]);

  function start(name: string) {
    setBusy(name);
    setError("");
    setNotice("");
  }

  async function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) {
      setNotice("Password changes require a live account session.");
      return;
    }
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) {
      setError("Passwords do not match");
      return;
    }
    start("password");
    try {
      await apiFetch("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: String(form.get("currentPassword") || "") || undefined,
          password: form.get("password"),
        }),
      });
      window.location.assign("/login?security=password");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update password");
      setBusy("");
    }
  }

  async function beginMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) {
      setNotice("MFA setup requires a live account session.");
      return;
    }
    start("setup");
    try {
      setSetup(await apiFetch("/api/auth/mfa/setup", {
        method: "POST",
        body: JSON.stringify({ password: new FormData(event.currentTarget).get("password") }),
      }) as { secret: string; otpauthUri: string });
      setNotice("Add this key to your authenticator, then confirm a current six-digit code.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to begin MFA setup");
    } finally {
      setBusy("");
    }
  }

  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) return;
    start("confirm");
    try {
      const result = await apiFetch("/api/auth/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: new FormData(event.currentTarget).get("code") }),
      }) as { recoveryCodes: string[] };
      setCodes(result.recoveryCodes);
      setSetup(null);
      setNotice("MFA is enabled. Save every recovery code now; they will not be shown again.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm MFA");
    } finally {
      setBusy("");
    }
  }

  async function sensitiveMfa(event: FormEvent<HTMLFormElement>, action: "disable" | "codes") {
    event.preventDefault();
    if (demo) {
      setNotice("MFA changes require a live account session.");
      return;
    }
    start(action);
    const form = new FormData(event.currentTarget);
    try {
      if (action === "disable") {
        await apiFetch("/api/auth/mfa", {
          method: "DELETE",
          body: JSON.stringify({ password: form.get("password"), code: form.get("code") }),
        });
        window.location.assign("/login?security=mfa-disabled");
      } else {
        const result = await apiFetch("/api/auth/mfa/recovery-codes", {
          method: "POST",
          body: JSON.stringify({ password: form.get("password"), code: form.get("code") }),
        }) as { recoveryCodes: string[] };
        setCodes(result.recoveryCodes);
        setNotice("Old recovery codes are invalid. Save this new set now.");
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update MFA");
    } finally {
      setBusy("");
    }
  }

  async function signOut() {
    start("logout");
    await logout();
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice("Copied securely.");
  }

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>Account & Security</span>
          <h1>Settings</h1>
          <p>Manage account security, MFA protection, workspace preferences, and team access.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.ghostBtn} disabled={busy === "logout"} onClick={() => void signOut()}>
            {busy === "logout" ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      {demo && <div className={styles.notice}>Development preview — security actions are disabled.</div>}

      <div className={styles.profile}>
        <div className={styles.avatar}>
          {(session?.user.name || security?.email || "PP")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("") || "PP"}
        </div>
        <div className={styles.profileInfo}>
          <b>{session?.user.name || "Operator"}</b>
          <span>{security?.email || session?.user.email}</span>
          <small>
            {session?.organization.name || "Workspace"}
            {" · "}
            {session?.role ? session.role.replaceAll("_", " ").toLowerCase() : "member"}
          </small>
        </div>
        <div className={styles.profileMeta}>
          <span className={`${styles.pill} ${security?.mfaEnabled ? styles.pillGood : styles.pillWait}`}>
            {security?.mfaEnabled ? "🛡️ MFA active" : "⚠️ MFA disabled"}
          </span>
          <span className={`${styles.pill} ${security?.emailVerified ? styles.pillGood : styles.pillWait}`}>
            {security?.emailVerified ? "✓ Email verified" : "✉️ Email unverified"}
          </span>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Settings sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "security"}
          className={tab === "security" ? styles.tabActive : undefined}
          onClick={() => setTab("security")}
        >
          Security
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "workspace"}
          className={tab === "workspace" ? styles.tabActive : undefined}
          onClick={() => setTab("workspace")}
        >
          Workspace
        </button>
        {canManageUsers && <button
          type="button"
          role="tab"
          aria-selected={tab === "users"}
          className={tab === "users" ? styles.tabActive : undefined}
          onClick={() => setTab("users")}
        >
          User management
        </button>}
      </div>

      {tab === "security" && (
        <>
          {codes.length > 0 && (
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <span className={styles.eyebrow}>Recovery codes</span>
                  <h2>One-time recovery codes</h2>
                </div>
                <p>Store these offline. Each code works once.</p>
              </div>
              <div className={styles.codes}>
                {codes.map((code) => <code key={code}>{code}</code>)}
              </div>
              <div className={styles.panelFooter}>
                <button type="button" className={styles.primary} onClick={() => void copy(codes.join("\n"))}>
                  Copy all codes
                </button>
              </div>
            </section>
          )}

          <div className={styles.grid}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <span className={styles.eyebrow}>Password</span>
                  <h2>{security?.hasPassword ? "Change password" : "Create password"}</h2>
                </div>
                <p>
                  {security?.hasPassword
                    ? `Last changed ${time(security.passwordChangedAt)}. Changing it revokes every active refresh session.`
                    : "Invitation access created your account. Add a password for future sign-ins."}
                </p>
              </div>
              <form className={styles.form} onSubmit={password}>
                {security?.hasPassword && (
                  <label>
                    <span>Current password</span>
                    <input name="currentPassword" type="password" autoComplete="current-password" required />
                  </label>
                )}
                <label>
                  <span>New password</span>
                  <input name="password" type="password" autoComplete="new-password" minLength={12} required />
                </label>
                <label>
                  <span>Confirm password</span>
                  <input name="confirm" type="password" autoComplete="new-password" required />
                </label>
                <span className={styles.hint}>12+ characters with uppercase, lowercase, number, and symbol.</span>
                <button type="submit" className={styles.primary} disabled={busy === "password"}>
                  {busy === "password" ? "Updating…" : security?.hasPassword ? "Change password" : "Create password"}
                </button>
              </form>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <span className={styles.eyebrow}>Multi-factor authentication</span>
                  <h2>{security?.mfaEnabled ? "MFA enabled" : "Add an authenticator"}</h2>
                </div>
                <p>
                  {security?.mfaEnabled
                    ? `${security.recoveryCodesRemaining} recovery codes remain`
                    : "Optional extra protection for sign-in and sensitive actions."}
                </p>
              </div>
              <div className={styles.form}>
                {!security?.hasPassword ? (
                  <p className={styles.hint}>Create a password before enabling MFA.</p>
                ) : !security?.mfaEnabled && !setup ? (
                  <form onSubmit={beginMfa}>
                    <label>
                      <span>Confirm password</span>
                      <input name="password" type="password" required />
                    </label>
                    <button type="submit" className={styles.primary} disabled={busy === "setup"}>
                      {busy === "setup" ? "Starting…" : "Begin MFA setup"}
                    </button>
                  </form>
                ) : setup ? (
                  <>
                    <p className={styles.hint}>
                      Enter this secret manually in Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP app.
                    </p>
                    <div className={styles.secret}>{setup.secret}</div>
                    <button type="button" className={styles.ghostBtn} onClick={() => void copy(setup.otpauthUri)}>
                      Copy authenticator URI
                    </button>
                    <form onSubmit={confirmMfa}>
                      <label>
                        <span>Current six-digit code</span>
                        <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
                      </label>
                      <button type="submit" className={styles.primary} disabled={busy === "confirm"}>
                        {busy === "confirm" ? "Confirming…" : "Confirm and enable"}
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <form onSubmit={(event) => void sensitiveMfa(event, "codes")}>
                      <label>
                        <span>Password</span>
                        <input name="password" type="password" required />
                      </label>
                      <label>
                        <span>Authenticator or recovery code</span>
                        <input name="code" required />
                      </label>
                      <button type="submit" className={styles.ghostBtn} disabled={busy === "codes"}>
                        {busy === "codes" ? "Generating…" : "Generate new recovery codes"}
                      </button>
                    </form>
                    <form onSubmit={(event) => void sensitiveMfa(event, "disable")}>
                      <label>
                        <span>Password</span>
                        <input name="password" type="password" required />
                      </label>
                      <label>
                        <span>Authenticator or recovery code</span>
                        <input name="code" required />
                      </label>
                      <button type="submit" className={styles.dangerBtn} disabled={busy === "disable"}>
                        {busy === "disable" ? "Disabling…" : "Disable MFA and revoke sessions"}
                      </button>
                    </form>
                  </>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {tab === "workspace" && (
        <div className={styles.grid}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>Organization</span>
                <h2>{session?.organization.name || "Workspace"}</h2>
              </div>
              <p>Team access and role management for this PartPulse organization.</p>
            </div>
            <div className={styles.linkList}>
              {canManageUsers && <button type="button" onClick={() => setTab("users")}>
                <b>Team management</b>
                <span>Invite users and assign Admin, Listing Manager, or Store Manager access</span>
              </button>}
              <Link href="/reports">
                <b>Operations reports</b>
                <span>Publishing health, failed jobs, retention, and audit trail</span>
              </Link>
              <Link href="/notifications">
                <b>Notifications</b>
                <span>Personal alerts for pricing, fitment, and publishing</span>
              </Link>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>Connected services</span>
                <h2>Marketplace</h2>
              </div>
              <p>eBay connection and seller resources are managed from Catalog workflows.</p>
            </div>
            <div className={styles.linkList}>
              <Link href="/catalog">
                <b>Open catalog</b>
                <span>Connect eBay, sync policies, and manage listing drafts</span>
              </Link>
              <Link href="/shipping">
                <b>Shipping policies</b>
                <span>Assign fulfillment policies and merchant locations</span>
              </Link>
            </div>
          </section>
        </div>
      )}

      {tab === "users" && canManageUsers && <UserManagement />}
    </div>
  );
}
