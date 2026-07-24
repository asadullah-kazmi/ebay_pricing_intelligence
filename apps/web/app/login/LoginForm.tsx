"use client";

import { FormEvent, useState } from "react";
import styles from "../auth-ui.module.css";
import BrandMark from "../components/BrandMark";

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

  return <main className={styles.page}>
    <aside className={styles.authAside}>
      <a href="/"><BrandMark inverse tagline="Automotive commerce workspace"/></a>
      <div><span>BUILT FOR AUTOMOTIVE TEAMS</span><h2>Run your parts operation from one secure workspace.</h2><p>Catalog, price, enrich, and publish inventory with a workflow your whole team can trust.</p></div>
      <ul><li>Secure organization access</li><li>eBay marketplace operations</li><li>Inventory workflows at scale</li></ul>
    </aside>
    <section className={styles.card}>
      <a className={styles.mobileBrand} href="/"><BrandMark /></a>
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
        <label>Password<span className={styles.labelAction}><a href="/forgot-password">Forgot password?</a></span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" required/></label>
        {organizations.length > 0 && <label>Organization<select value={organizationSlug} onChange={(event) => setOrganizationSlug(event.target.value)}>{organizations.map((organization) => <option key={organization.slug} value={organization.slug}>{organization.name}</option>)}</select></label>}
        <button disabled={busy}>{busy ? "Signing in…" : organizations.length ? "Open organization" : "Sign in to PartPulse"}</button>
      </form>}
      {verificationRequired && <button className={styles.primary} disabled={busy} onClick={() => void resendVerification()}>Resend verification email</button>}
      <div className={styles.links}><span>New to PartPulse? <a href="/register">Create your workspace</a></span><a href="/account-recovery">Recover account</a></div>
    </section>
  </main>;
}
