"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./accept.module.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Preview {
  organization: { name: string; slug: string };
  email: string;
  name: string | null;
  role: string;
  permissions: string[];
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
    if (!invitationToken) { setError("This invitation link is incomplete."); setState("error"); return; }
    setToken(invitationToken);
    fetch(`${apiBase}/api/invitations/preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: invitationToken }) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Invitation cannot be opened"); return body; })
      .then((body: Preview) => { setPreview(body); setState("ready"); window.history.replaceState({}, "", window.location.pathname); })
      .catch((caught) => { setError(caught instanceof Error ? caught.message : "Invitation cannot be opened"); setState("error"); });
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password !== String(form.get("confirmPassword") || "")) { setError("Passwords do not match."); return; }
    setState("accepting"); setError("");
    try {
      const response = await fetch(`${apiBase}/api/invitations/accept`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, name: String(form.get("name") || "").trim(), password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to accept invitation");
      setState("complete");
      const routeByTab: Record<string, string> = { "tab.dashboard": "/dashboard", "tab.quick_sku": "/quick-sku", "tab.pipeline": "/pipeline", "tab.catalog": "/catalog", "tab.pricing": "/pricing", "tab.media_drive": "/media-drive", "tab.inventory": "/inventory", "tab.orders": "/orders", "tab.fitment": "/fitment", "tab.shipping": "/shipping" };
      const destination = preview?.permissions.map((permission) => routeByTab[permission]).find(Boolean) ?? "/login";
      window.setTimeout(() => window.location.assign(destination), 900);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to accept invitation"); setState("ready"); }
  }

  return <main className={styles.page}><section className={styles.card}><a className={styles.brand} href="/"><b>Part</b>Pulse</a>
    {state === "loading" && <div className={styles.message}><span>SECURE INVITATION</span><h1>Checking your invitation…</h1></div>}
    {state === "error" && <div className={styles.message}><span>INVITATION UNAVAILABLE</span><h1>This link cannot be used</h1><p>{error}</p><a href="/">Return home</a></div>}
    {state === "complete" && <div className={styles.message}><span>ACCESS CREATED</span><h1>Welcome to {preview?.organization.name}</h1><p>Your password and secure session are ready. Opening your assigned PartPulse workspace.</p></div>}
    {(state === "ready" || state === "accepting") && preview && <><div className={styles.message}><span>ORGANIZATION INVITATION</span><h1>Join {preview.organization.name}</h1><p>You were invited as <b>{human(preview.role)}</b>. Create a password to activate access for <b>{preview.email}</b>. If you already use PartPulse, enter your existing password.</p><div className={styles.accessSummary}>{preview.permissions.filter((permission) => permission.startsWith("tab.")).map((permission) => <span key={permission}>{human(permission.slice(4))}</span>)}</div></div><form onSubmit={accept}><label htmlFor="invite-name">Your name</label><input id="invite-name" name="name" maxLength={100} required defaultValue={preview.name ?? ""} placeholder="Your full name"/><label htmlFor="invite-password">Password</label><input id="invite-password" name="password" type="password" autoComplete="new-password" minLength={12} required placeholder="12+ characters"/><label htmlFor="invite-confirm">Confirm password</label><input id="invite-confirm" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required placeholder="Repeat your password"/><small>New passwords require uppercase, lowercase, a number, and a symbol.</small>{error && <div className={styles.error}>{error}</div>}<button disabled={state === "accepting"}>{state === "accepting" ? "Activating access…" : "Accept invitation"}</button><small>This link is single-use and expires on {new Date(preview.expiresAt).toLocaleDateString()}.</small></form></>}
  </section></main>;
}
