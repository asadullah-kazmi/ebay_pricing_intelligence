"use client";

import { useEffect, useState } from "react";
import styles from "../auth-ui.module.css";
import BrandMark from "../components/BrandMark";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function VerifyEmail() {
  const [state, setState] = useState<"checking" | "done" | "error">("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    window.history.replaceState({}, "", window.location.pathname);
    if (!token) {
      setError("This verification link is incomplete.");
      setState("error");
      return;
    }
    fetch(`${apiBase}/api/auth/email-verification/confirm`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to verify email");
      })
      .then(() => setState("done"))
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Unable to verify email");
        setState("error");
      });
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <a className={styles.brand} href="/">
          <BrandMark />
        </a>
        <div className={styles.statusPanel}>
          {state === "checking" && (
            <>
              <div className={styles.statusIcon} data-tone="pending" aria-hidden="true">
                <span className={styles.statusSpinner} />
              </div>
              <span className={styles.eyebrow}>EMAIL VERIFICATION</span>
              <h1>Verifying your email</h1>
              <p>Please wait while we confirm this secure, single-use link.</p>
            </>
          )}
          {state === "done" && (
            <>
              <div className={styles.statusIcon} data-tone="success" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <span className={styles.eyebrow}>EMAIL VERIFIED</span>
              <h1>You&apos;re all set</h1>
              <p>Your email is confirmed. Sign in to open your PartPulse workspace.</p>
              <a className={styles.primary} href="/login">
                Continue to sign in
              </a>
            </>
          )}
          {state === "error" && (
            <>
              <div className={styles.statusIcon} data-tone="error" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </div>
              <span className={styles.eyebrow}>VERIFICATION FAILED</span>
              <h1>Link unavailable</h1>
              <div className={styles.error}>{error}</div>
              <p>Request a fresh verification email from the sign-in page, then try again.</p>
              <a className={styles.primary} href="/login">
                Back to sign in
              </a>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
