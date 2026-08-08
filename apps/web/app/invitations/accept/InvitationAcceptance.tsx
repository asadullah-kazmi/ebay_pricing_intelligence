"use client";

import { FormEvent, useEffect, useState } from "react";
import BrandMark from "../../components/BrandMark";
import { primeAuthenticatedSession } from "../../lib/auth-session";
import { firstAllowedRoute } from "../../lib/organization-access";
import styles from "./accept.module.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Preview {
  organization: { name: string; slug: string };
  email: string;
  name: string | null;
  role: string;
  permissions: string[];
  expiresAt: string;
}

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function InvitationAcceptance() {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "accepting" | "complete" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const invitationToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    if (!invitationToken) {
      setError("This invitation link is incomplete or missing a valid security token.");
      setState("error");
      return;
    }
    setToken(invitationToken);
    fetch(`${apiBase}/api/invitations/preview`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: invitationToken }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Invitation link expired or invalid");
        return body;
      })
      .then((body: Preview) => {
        setPreview(body);
        setState("ready");
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Invitation cannot be opened");
        setState("error");
      });
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password !== String(form.get("confirmPassword") || "")) {
      setError("Passwords do not match. Please re-enter your password.");
      return;
    }
    setState("accepting");
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/invitations/accept`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: String(form.get("name") || "").trim(), password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to accept invitation");
      setState("complete");
      primeAuthenticatedSession({
        accessToken: body.accessToken,
        expiresIn: body.accessTokenExpiresIn,
        workspace: {
          user: body.user,
          organization: body.organization,
          role: body.role,
          permissions: body.permissions,
        },
      });
      const destination = firstAllowedRoute(body.role, body.permissions);
      window.setTimeout(() => window.location.assign(destination), 900);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to accept invitation");
      setState("ready");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.ambientGlow} />

      <section className={styles.card}>
        <header className={styles.brandHeader}>
          <a className={styles.brand} href="/" title="PartPulse">
            <BrandMark />
          </a>
        </header>

        {state === "loading" && (
          <div className={styles.statusBox}>
            <div className={styles.spinner} />
            <h2>Verifying Security Token</h2>
            <p>Validating invitation parameters and organization permissions…</p>
          </div>
        )}

        {state === "error" && (
          <div className={styles.statusBox}>
            <div className={styles.errorIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <span className={styles.badgeDanger}>INVITATION UNAVAILABLE</span>
            <h2>Link Expired or Invalid</h2>
            <p>{error}</p>
            <a href="/" className={styles.secondaryBtn}>Return to Homepage</a>
          </div>
        )}

        {state === "complete" && (
          <div className={styles.statusBox}>
            <div className={styles.successIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <span className={styles.badgeSuccess}>ACCESS ACTIVATED</span>
            <h2>Welcome to {preview?.organization.name}</h2>
            <p>Your password is set and your secure workspace session is initialized. Redirecting to PartPulse…</p>
          </div>
        )}

        {(state === "ready" || state === "accepting") && preview && (
          <>
            <div className={styles.inviteHeader}>
              <span className={styles.badgePill}>ORGANIZATION INVITATION</span>
              <h1>Join {preview.organization.name}</h1>
              <p>
                You were invited as <b>{human(preview.role)}</b>. Create a password to activate your access for <b>{preview.email}</b>.
              </p>

            </div>

            <form onSubmit={accept} className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label htmlFor="invite-name">Your Full Name</label>
                <input
                  id="invite-name"
                  name="name"
                  maxLength={100}
                  required
                  defaultValue={preview.name ?? ""}
                  placeholder="Enter your name"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="invite-password">Create Password</label>
                <input
                  id="invite-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  placeholder="12+ characters"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="invite-confirm">Confirm Password</label>
                <input
                  id="invite-confirm"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  placeholder="Repeat your password"
                />
              </div>

              <div className={styles.passwordHint}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <span>Requires uppercase, lowercase, a number, and a symbol.</span>
              </div>

              {error && (
                <div className={styles.errorBox}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <button className={styles.primaryBtn} disabled={state === "accepting"}>
                {state === "accepting" ? "Activating access…" : "Accept invitation & Join"}
              </button>

              <footer className={styles.formFooter}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Single-use security link · Expires {new Date(preview.expiresAt).toLocaleDateString()}</span>
              </footer>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
