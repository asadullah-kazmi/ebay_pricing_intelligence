"use client";

import { FormEvent, useState } from "react";
import styles from "../auth-ui.module.css";
import BrandMark from "../components/BrandMark";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function RegisterForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ emailDelivery: string; developmentUrl?: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          name: form.get("name"),
          organizationName: form.get("organizationName"),
          password,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.issues?.[0]?.message || "Unable to register");
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to register");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <a className={styles.brand} href="/">
          <BrandMark />
        </a>
        {result ? (
          <div className={styles.center}>
            <span className={styles.eyebrow}>CHECK YOUR EMAIL</span>
            <h1>Verify your account</h1>
            <p>Registration is complete. Open the verification link before signing in.</p>
            {result.emailDelivery === "failed" && (
              <div className={styles.error}>
                The account was created, but email delivery failed. Check SMTP configuration and request another verification email.
              </div>
            )}
            {result.developmentUrl && (
              <a className={styles.devLink} href={result.developmentUrl}>
                Development verification link
              </a>
            )}
            <a className={styles.continueLink} href="/login">
              Continue to sign in
            </a>
          </div>
        ) : (
          <>
            <span className={styles.eyebrow}>CREATE YOUR ACCOUNT</span>
            <h1>Create your workspace</h1>
            <p>Set up your organization and become its first owner.</p>
            {error && <div className={styles.error}>{error}</div>}
            <form className={styles.form} onSubmit={submit}>
              <label>
                Your name
                <input name="name" autoComplete="name" placeholder="Your full name" required maxLength={100} />
              </label>
              <label>
                Work email
                <input name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
              </label>
              <label>
                Organization name
                <input name="organizationName" placeholder="Your automotive business" required maxLength={120} />
              </label>
              <label>
                Password
                <span className={styles.passwordField}>
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Create a secure password"
                    required
                    minLength={12}
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </span>
              </label>
              <label>
                Confirm password
                <span className={styles.passwordField}>
                  <input
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    required
                    minLength={12}
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    onClick={() => setShowConfirmPassword((value) => !value)}
                  >
                    <EyeIcon open={showConfirmPassword} />
                  </button>
                </span>
              </label>
              <span className={styles.requirements}>12–128 characters with uppercase, lowercase, a number, and a symbol.</span>
              <button disabled={busy}>{busy ? "Creating…" : "Create PartPulse workspace"}</button>
            </form>
            <div className={styles.links}>
              <span className={styles.linkLine}>
                Already have an account? <a href="/login">Sign in</a>
              </span>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
