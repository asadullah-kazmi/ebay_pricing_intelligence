"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./notifications.module.css";
import BrandMark from "../components/BrandMark";
import { refreshAccessSession } from "../lib/auth-session";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Notification {
  id: string;
  category: "PRICING" | "FITMENT" | "PUBLISHING" | "SYSTEM";
  severity: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  actionUrl: string | null;
  resourceType: string | null;
  resourceId: string | null;
  emailStatus: "NOT_REQUESTED" | "PENDING" | "SENT" | "FAILED";
  readAt: string | null;
  createdAt: string;
}

interface NotificationResponse {
  notifications: Notification[];
  unreadCount: number;
}

interface Preferences {
  emailPricing: boolean;
  emailFitment: boolean;
  emailPublishing: boolean;
  emailFailures: boolean;
}

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function time(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function NotificationCenter() {
  const [token, setToken] = useState("");
  const [auth, setAuth] = useState<"loading" | "ready" | "required">("loading");
  const [result, setResult] = useState<NotificationResponse>({ notifications: [], unreadCount: 0 });
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [category, setCategory] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void refreshAccessSession()
      .then((session) => {
        if (cancelled) return;
        setToken(session.accessToken);
        setAuth("ready");
      })
      .catch(() => {
        if (!cancelled) setAuth("required");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: "include",
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers, Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }, [token]);

  const load = useCallback(async () => {
    if (auth !== "ready") return;
    setBusy("load"); setError("");
    try {
      const query = new URLSearchParams({ limit: "100", unreadOnly: String(unreadOnly) });
      if (category) query.set("category", category);
      const [notifications, preferenceResult] = await Promise.all([
        request(`/api/notifications?${query}`),
        request("/api/notification-preferences"),
      ]);
      setResult(notifications as NotificationResponse);
      setPreferences(preferenceResult as Preferences);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load notifications"); }
    finally { setBusy(""); }
  }, [auth, category, request, unreadOnly]);

  useEffect(() => { void load(); }, [load]);

  async function markRead(notification: Notification) {
    if (notification.readAt) return;
    setBusy(notification.id);
    try { await request(`/api/notifications/${notification.id}/read`, { method: "POST" }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to mark notification read"); }
    finally { setBusy(""); }
  }

  async function markAllRead() {
    setBusy("all");
    try { await request("/api/notifications/read-all", { method: "POST" }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to mark notifications read"); }
    finally { setBusy(""); }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("preferences"); setError(""); setNotice("");
    try {
      setPreferences(await request("/api/notification-preferences", {
        method: "PUT",
        body: JSON.stringify({
          emailPricing: form.get("emailPricing") === "on",
          emailFitment: form.get("emailFitment") === "on",
          emailPublishing: form.get("emailPublishing") === "on",
          emailFailures: form.get("emailFailures") === "on",
        }),
      }) as Preferences);
      setNotice("Notification preferences saved.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save preferences"); }
    finally { setBusy(""); }
  }

  if (auth === "loading") return <main className={styles.center}>Opening notifications…</main>;
  if (auth === "required") return <main className={styles.center}><section><h1>Sign in required</h1><p>Open a secure PartPulse session to view your notifications.</p><a href="/login">Sign in</a></section></main>;

  return <main className={styles.page}>
    <aside>
      <a className={styles.brand} href="/catalog"><BrandMark inverse tagline="Operational inbox"/></a>
      <nav><a href="/catalog">Catalog</a><a href="/admin">Admin</a><a href="/account/security">Account security</a></nav>
      <div className={styles.unread}><strong>{result.unreadCount}</strong><span>unread alerts</span></div>
    </aside>
    <section className={styles.content}>
      <header><div><span className={styles.eyebrow}>PERSONAL OPERATIONS</span><h1>Notifications</h1><p>Durable pricing, fitment, inventory, and publishing updates for your organization role.</p></div><button disabled={!result.unreadCount || busy === "all"} onClick={() => void markAllRead()}>{busy === "all" ? "Updating…" : "Mark all read"}</button></header>
      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      <section className={styles.filters}>
        <select aria-label="Notification category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option><option value="PRICING">Pricing</option><option value="FITMENT">Fitment</option><option value="PUBLISHING">Publishing</option><option value="SYSTEM">System</option></select>
        <label><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)}/> Unread only</label>
        {busy === "load" && <span>Refreshing…</span>}
      </section>
      <div className={styles.grid}>
        <section className={styles.feed}>
          {result.notifications.map((notification) => <article key={notification.id} className={`${styles.card} ${notification.readAt ? styles.read : ""} ${styles[notification.severity.toLowerCase()]}`}>
            <div className={styles.cardHead}><span>{human(notification.category)}</span><time>{time(notification.createdAt)}</time></div>
            <h2>{notification.title}</h2><p>{notification.message}</p>
            <footer><span>Email: {human(notification.emailStatus)}</span><div>{!notification.readAt && <button disabled={busy === notification.id} onClick={() => void markRead(notification)}>Mark read</button>}{notification.actionUrl && <a href={notification.actionUrl} onClick={() => void markRead(notification)}>Open workflow</a>}</div></footer>
          </article>)}
          {!result.notifications.length && <div className={styles.empty}><b>No notifications found</b><span>New operational events will appear here.</span></div>}
        </section>
        {preferences && <form className={styles.preferences} key={JSON.stringify(preferences)} onSubmit={savePreferences}><span className={styles.eyebrow}>EMAIL DELIVERY</span><h2>Choose what reaches your inbox</h2><p>In-app notifications remain available. Email is optional and uses your verified account address.</p>
          <label><input name="emailPricing" type="checkbox" defaultChecked={preferences.emailPricing}/><span><b>Pricing</b><small>Proposals and approvals</small></span></label>
          <label><input name="emailFitment" type="checkbox" defaultChecked={preferences.emailFitment}/><span><b>Fitment</b><small>Compatibility approvals</small></span></label>
          <label><input name="emailPublishing" type="checkbox" defaultChecked={preferences.emailPublishing}/><span><b>Publishing</b><small>Inventory, fees, publication, revisions</small></span></label>
          <label><input name="emailFailures" type="checkbox" defaultChecked={preferences.emailFailures}/><span><b>Critical alerts</b><small>Drift and high-risk operational failures</small></span></label>
          <button disabled={busy === "preferences"}>{busy === "preferences" ? "Saving…" : "Save preferences"}</button>
        </form>}
      </div>
    </section>
  </main>;
}
