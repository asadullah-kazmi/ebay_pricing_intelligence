"use client";

import { FormEvent, useState } from "react";
import styles from "../auth-ui.module.css";
import BrandMark from "../components/BrandMark";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Organization = { name: string; slug: string };

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [notice, setNotice] = useState("");

  async function post(path: string, body: unknown) {
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(result.error || "Unable to sign in") as Error & { details?: { verificationRequired?: boolean } };
      failure.details = result.details;
      throw failure;
    }
    return result;
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await post("/api/auth/login", { email, password, organizationSlug: organizationSlug || undefined });
      if (result.organizationRequired) {
        setOrganizations(result.organizations);
        setOrganizationSlug(result.organizations[0]?.slug || "");
        setNotice("Choose the organization you want to open, then continue.");
      } else if (result.mfaRequired) {
        setChallengeToken(result.challengeToken);
        setNotice("Enter the code from your authenticator app or a recovery code.");
      } else {
        window.location.assign("/dashboard");
      }
    } catch (caught) {
      const failure = caught as Error & { details?: { verificationRequired?: boolean } };
      setError(failure.message);
      setVerificationRequired(Boolean(failure.details?.verificationRequired));
    } finally { setBusy(false); }
  }

  async function completeMfa(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await post("/api/auth/login/mfa", { challengeToken, code });
      window.location.assign("/dashboard");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to verify code"); }
    finally { setBusy(false); }
  }

  async function resendVerification() {
    setBusy(true); setError("");
    try {
      await post("/api/auth/email-verification/request", { email });
      setNotice("If the account is awaiting verification, a new email has been sent.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to request verification"); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <section className={styles.card}>
      <a className={styles.brand} href="/"><BrandMark /></a>
      <span className={styles.eyebrow}>SECURE WORKSPACE</span>
      <h1>{challengeToken ? "Verify it’s you" : "Welcome back"}</h1>
      <p>{challengeToken ? "Multi-factor authentication protects this account." : "Sign in to continue to your PartPulse workspace."}</p>
      {error && <div className={styles.error}>{error}</div>}{notice && <div className={styles.notice}>{notice}</div>}
      {challengeToken ? <form className={styles.form} onSubmit={completeMfa}>
        <label>Authenticator or recovery code<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" required autoFocus/></label>
        <button disabled={busy}>{busy ? "Checking…" : "Verify and sign in"}</button>
        <button className={styles.secondaryButton} type="button" onClick={() => { setChallengeToken(""); setCode(""); }} disabled={busy}>Start again</button>
      </form> : <form className={styles.form} onSubmit={login}>
        <label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" required/></label>
        <label>Password<span className={styles.labelAction}><a href="/forgot-password">Forgot password?</a></span>
          <span className={styles.passwordField}>
            <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" required/>
            <button type="button" className={styles.passwordToggle} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </span>
        </label>
        {organizations.length > 0 && <label>Organization<select value={organizationSlug} onChange={(event) => setOrganizationSlug(event.target.value)}>{organizations.map((organization) => <option key={organization.slug} value={organization.slug}>{organization.name}</option>)}</select></label>}
        <button disabled={busy}>{busy ? "Signing in…" : organizations.length ? "Open organization" : "Sign in to PartPulse"}</button>
      </form>}
      {verificationRequired && <button className={styles.primary} disabled={busy} onClick={() => void resendVerification()}>Resend verification email</button>}
      <div className={styles.links}>
        <span className={styles.linkLine}>New to PartPulse? <a href="/register">Create your workspace</a></span>
      </div>
    </section>
  </main>;
}
