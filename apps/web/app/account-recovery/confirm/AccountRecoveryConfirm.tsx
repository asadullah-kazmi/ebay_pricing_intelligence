"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "../../auth-ui.module.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function AccountRecoveryConfirm() {
  const [token, setToken] = useState("");
  const [state, setState] = useState<"ready" | "busy" | "done" | "invalid">("ready");
  const [error, setError] = useState("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    window.history.replaceState({}, "", window.location.pathname);
    if (!value) setState("invalid");
    else setToken(value);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) {
      setError("Passwords do not match");
      return;
    }
    setState("busy");
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/auth/account-recovery/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: form.get("password") }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to recover account");
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to recover account");
      setState("ready");
    }
  }

  return <main className={styles.page}><section className={styles.card}>
    <a className={styles.brand} href="/"><b>Part</b>Pulse</a>
    <span className={styles.eyebrow}>ACCOUNT RECOVERY</span>
    <h1>{state === "done" ? "Access recovered" : "Secure your account"}</h1>
    {state === "invalid" ? <>
      <div className={styles.error}>This recovery link is incomplete.</div>
      <a href="/account-recovery">Request another link</a>
    </> : state === "done" ? <>
      <p>Your password was replaced, MFA was removed, and all existing sessions were revoked.</p>
      <a href="/login">Sign in and configure MFA again</a>
    </> : <>
      <p>Choose a new password. This operation also removes the inaccessible authenticator.</p>
      {error && <div className={styles.error}>{error}</div>}
      <form className={styles.form} onSubmit={submit}>
        <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} required/></label>
        <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" required/></label>
        <span className={styles.requirements}>Use uppercase, lowercase, number, symbol, and at least 12 characters.</span>
        <button disabled={state === "busy"}>{state === "busy" ? "Recovering…" : "Replace credentials and recover"}</button>
      </form>
    </>}
  </section></main>;
}
