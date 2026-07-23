"use client";

import { FormEvent, useState } from "react";
import styles from "../auth-ui.module.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function AccountRecoveryRequest() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [developmentUrl, setDevelopmentUrl] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const email = new FormData(event.currentTarget).get("email");
      const response = await fetch(`${apiBase}/api/auth/account-recovery/request`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to request account recovery");
      setDevelopmentUrl(body.developmentUrl || "");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to request account recovery");
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.page}><section className={styles.card}>
    <a className={styles.brand} href="/"><b>Part</b>Pulse</a>
    <span className={styles.eyebrow}>HIGH-SECURITY RECOVERY</span>
    <h1>{done ? "Check your email" : "Lost account access?"}</h1>
    {done ? <>
      <p>If an account exists for that email, a 15-minute recovery link has been sent.</p>
      <p className={styles.muted}>Using it replaces the password, removes MFA, and revokes every active session.</p>
      {developmentUrl && <a className={styles.devLink} href={developmentUrl}>Development recovery link</a>}
      <a href="/login">Return to sign in</a>
    </> : <>
      <p>Use this only when you cannot sign in with your password, authenticator, or recovery codes.</p>
      {error && <div className={styles.error}>{error}</div>}
      <form className={styles.form} onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="email" required/></label>
        <button disabled={busy}>{busy ? "Sending…" : "Send account recovery link"}</button>
      </form>
      <div className={styles.links}><a href="/forgot-password">Reset password only</a><a href="/login">Return to sign in</a></div>
    </>}
  </section></main>;
}
