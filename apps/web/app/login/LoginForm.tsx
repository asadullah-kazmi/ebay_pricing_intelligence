"use client";

import { FormEvent, useState } from "react";
import styles from "../auth-ui.module.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Organization = { name: string; slug: string };

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        window.location.assign("/catalog");
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
      window.location.assign("/catalog");
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

  return <main className={styles.page}><section className={styles.card}><a className={styles.brand} href="/"><b>Part</b>Pulse</a><span className={styles.eyebrow}>SECURE WORKSPACE</span><h1>{challengeToken ? "Verify it’s you" : "Welcome back"}</h1><p>{challengeToken ? "Multi-factor authentication protects this account." : "Sign in with your verified email and account password."}</p>
    {error && <div className={styles.error}>{error}</div>}{notice && <div className={styles.notice}>{notice}</div>}
    {challengeToken ? <form className={styles.form} onSubmit={completeMfa}><label>Authenticator or recovery code<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" required autoFocus/></label><button disabled={busy}>{busy ? "Checking…" : "Verify and sign in"}</button><button type="button" onClick={() => { setChallengeToken(""); setCode(""); }} disabled={busy}>Start again</button></form>
    : <form className={styles.form} onSubmit={login}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required/></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required/></label>{organizations.length > 0 && <label>Organization<select value={organizationSlug} onChange={(event) => setOrganizationSlug(event.target.value)}>{organizations.map((organization) => <option key={organization.slug} value={organization.slug}>{organization.name}</option>)}</select></label>}<button disabled={busy}>{busy ? "Signing in…" : organizations.length ? "Open organization" : "Sign in"}</button></form>}
    {verificationRequired && <button className={styles.primary} disabled={busy} onClick={() => void resendVerification()}>Resend verification email</button>}
    <div className={styles.links}><a href="/forgot-password">Forgot password?</a><a href="/account-recovery">Lost MFA access?</a><a href="/register">Create organization</a></div>
  </section></main>;
}
