"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./accept.module.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Preview {
  organization: { name: string; slug: string };
  email: string;
  role: string;
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
      setError("This invitation link is incomplete.");
      setState("error");
      return;
    }
    setToken(invitationToken);
    fetch(`${apiBase}/api/invitations/preview`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: invitationToken }),
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Invitation cannot be opened");
      return body;
    }).then((body: Preview) => {
      setPreview(body);
      setState("ready");
      window.history.replaceState({}, "", window.location.pathname);
    }).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Invitation cannot be opened");
      setState("error");
    });
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("accepting");
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/invitations/accept`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: String(form.get("name") || "").trim() || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to accept invitation");
      setState("complete");
      window.setTimeout(() => window.location.assign("/account/security?welcome=1"), 900);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to accept invitation");
      setState("ready");
    }
  }

  return <main className={styles.page}><section className={styles.card}><a className={styles.brand} href="/"><b>Part</b>Pulse</a>
    {state === "loading" && <div className={styles.message}><span>SECURE INVITATION</span><h1>Checking your invitation…</h1></div>}
    {state === "error" && <div className={styles.message}><span>INVITATION UNAVAILABLE</span><h1>This link cannot be used</h1><p>{error}</p><a href="/">Return home</a></div>}
    {state === "complete" && <div className={styles.message}><span>ACCESS CREATED</span><h1>Welcome to {preview?.organization.name}</h1><p>Your secure session is ready. Opening account security so you can create a password…</p></div>}
    {(state === "ready" || state === "accepting") && preview && <><div className={styles.message}><span>YOU HAVE BEEN INVITED</span><h1>Join {preview.organization.name}</h1><p>This invitation grants <b>{human(preview.role)}</b> access to <b>{preview.email}</b>.</p></div><form onSubmit={accept}><label htmlFor="invite-name">Your name <small>Optional</small></label><input id="invite-name" name="name" maxLength={100} placeholder="How your team will recognize you"/>{error && <div className={styles.error}>{error}</div>}<button disabled={state === "accepting"}>{state === "accepting" ? "Creating access…" : "Accept and open workspace"}</button><small>By continuing, this single-use invitation will be permanently consumed.</small></form></>}
  </section></main>;
}
