"use client";
import { useEffect, useState } from "react";
import styles from "../auth-ui.module.css";
const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export default function VerifyEmail() {
  const [state, setState] = useState<"checking"|"done"|"error">("checking"); const [error, setError] = useState("");
  useEffect(() => { const token = new URLSearchParams(window.location.hash.slice(1)).get("token") || ""; window.history.replaceState({}, "", window.location.pathname); if (!token) { setError("This verification link is incomplete."); setState("error"); return; } fetch(`${apiBase}/api/auth/email-verification/confirm`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to verify email"); }).then(() => setState("done")).catch((caught) => { setError(caught instanceof Error ? caught.message : "Unable to verify email"); setState("error"); }); }, []);
  return <main className={styles.page}><section className={styles.card}><a className={styles.brand} href="/"><b>Part</b>Pulse</a><div className={styles.center}><span className={styles.eyebrow}>EMAIL VERIFICATION</span><h1>{state === "checking" ? "Verifying…" : state === "done" ? "Email verified" : "Verification failed"}</h1>{state === "done" ? <><p>Your account can now sign in securely.</p><a href="/login">Continue to sign in</a></> : state === "error" ? <><div className={styles.error}>{error}</div><a href="/login">Request a new link from sign in</a></> : <p>Please wait while the single-use link is checked.</p>}</div></section></main>;
}
