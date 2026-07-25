"use client";

import { FormEvent, useState } from "react";
import styles from "../auth-ui.module.css";
import BrandMark from "../components/BrandMark";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function RegisterForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ emailDelivery: string; developmentUrl?: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiBase}/api/auth/register`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), name: form.get("name"), organizationName: form.get("organizationName"), password: form.get("password") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.issues?.[0]?.message || "Unable to register");
      setResult(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to register"); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <section className={styles.card}>
      <a className={styles.brand} href="/"><BrandMark /></a>
      {result ? <div className={styles.center}><span className={styles.eyebrow}>CHECK YOUR EMAIL</span><h1>Verify your account</h1><p>Registration is complete. Open the verification link before signing in.</p>{result.emailDelivery === "failed" && <div className={styles.error}>The account was created, but email delivery failed. Check SMTP configuration and request another verification email.</div>}{result.developmentUrl && <a className={styles.devLink} href={result.developmentUrl}>Development verification link</a>}<a className={styles.continueLink} href="/login">Continue to sign in</a></div> : <>
        <span className={styles.eyebrow}>CREATE YOUR ACCOUNT</span><h1>Create your workspace</h1><p>Set up your organization and become its first owner.</p>
        {error && <div className={styles.error}>{error}</div>}
        <form className={styles.form} onSubmit={submit}>
          <label>Your name<input name="name" autoComplete="name" placeholder="Your full name" required maxLength={100}/></label>
          <label>Work email<input name="email" type="email" autoComplete="email" placeholder="you@company.com" required/></label>
          <label>Organization name<input name="organizationName" placeholder="Your automotive business" required maxLength={120}/></label>
          <label>Password<input name="password" type="password" autoComplete="new-password" placeholder="Create a secure password" required minLength={12}/></label>
          <span className={styles.requirements}>12–128 characters with uppercase, lowercase, a number, and a symbol.</span>
          <button disabled={busy}>{busy ? "Creating…" : "Create PartPulse workspace"}</button>
        </form>
        <div className={styles.links}><span>Already have an account? <a href="/login">Sign in</a></span></div>
      </>}
    </section>
  </main>;
}
