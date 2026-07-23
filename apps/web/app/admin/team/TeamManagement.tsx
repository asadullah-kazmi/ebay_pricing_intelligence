"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./team.module.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const roles = ["OWNER", "ADMIN", "MANAGER", "CATALOG_OPERATOR", "PRICING_OPERATOR", "PUBLISHER", "VIEWER"] as const;
type Role = typeof roles[number];

interface Session {
  user: { id: string; email: string; name: string | null };
  organization: { id: string; name: string; slug: string };
  role: Role;
}

interface Member {
  id: string;
  role: Role;
  createdAt: string;
  user: { id: string; email: string; name: string | null };
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  status: "PENDING" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
  invitedBy: { email: string; name: string | null };
}

function human(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function date(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

export default function TeamManagement() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [authState, setAuthState] = useState<"loading" | "required" | "ready">("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteLink, setInviteLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch(`${apiBase}/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((data: { accessToken: string }) => { setToken(data.accessToken); setAuthState("ready"); })
      .catch(() => setAuthState("required"));
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
    if (authState !== "ready") return;
    setLoading(true);
    setError("");
    try {
      const [sessionResult, teamResult] = await Promise.all([request("/api/session"), request("/api/team")]);
      setSession(sessionResult as Session);
      setMembers((teamResult as { members: Member[] }).members);
      setInvitations((teamResult as { invitations: Invitation[] }).invitations);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load team");
    } finally {
      setLoading(false);
    }
  }, [authState, request]);

  useEffect(() => { void load(); }, [load]);

  function connectToken(event: FormEvent) {
    event.preventDefault();
    setToken(tokenInput.trim());
    setAuthState("ready");
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("invite");
    setError("");
    setNotice("");
    setInviteLink("");
    try {
      const result = await request("/api/team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: String(form.get("email")), role: String(form.get("role")) }),
      }) as { invitationUrl: string; emailDelivery: "sent" | "failed" | "not_configured" };
      setInviteLink(result.invitationUrl);
      setNotice(result.emailDelivery === "sent"
        ? "Invitation emailed successfully. You can also copy the link below."
        : "Invitation created, but email was not delivered. Copy the link below and send it through a trusted channel.");
      event.currentTarget.reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create invitation");
    } finally {
      setBusy("");
    }
  }

  async function regenerate(invitation: Invitation) {
    setBusy(invitation.id);
    setInviteLink("");
    setError("");
    try {
      const result = await request("/api/team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: invitation.email, role: invitation.role }),
      }) as { invitationUrl: string; emailDelivery: "sent" | "failed" | "not_configured" };
      setInviteLink(result.invitationUrl);
      setNotice(result.emailDelivery === "sent"
        ? "A new link replaced the previous one and was emailed successfully."
        : "A new link replaced the previous one, but email was not delivered. Copy it below.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to regenerate invitation");
    } finally {
      setBusy("");
    }
  }

  async function revoke(invitation: Invitation) {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
    setBusy(invitation.id);
    setError("");
    try {
      await request(`/api/team/invitations/${invitation.id}`, { method: "DELETE" });
      setNotice("Invitation revoked.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to revoke invitation");
    } finally {
      setBusy("");
    }
  }

  async function changeRole(member: Member, role: Role) {
    setBusy(member.id);
    setError("");
    try {
      await request(`/api/team/members/${member.id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      setNotice(`${member.user.email} is now ${human(role)}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change role");
    } finally {
      setBusy("");
    }
  }

  async function remove(member: Member) {
    if (!window.confirm(`Remove ${member.user.email} from this organization? Their active refresh sessions will be revoked.`)) return;
    setBusy(member.id);
    setError("");
    try {
      await request(`/api/team/members/${member.id}`, { method: "DELETE" });
      setNotice(`${member.user.email} was removed.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove member");
    } finally {
      setBusy("");
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(inviteLink);
    setNotice("Invitation link copied.");
  }

  if (authState === "loading") return <main className={styles.center}>Loading secure team workspace…</main>;
  if (authState === "required") return <main className={styles.center}><section className={styles.authCard}><span>PARTPULSE TEAM</span><h1>Team access required</h1><p>Sign in as an organization owner or administrator, or use a short-lived development token.</p><form onSubmit={connectToken}><label htmlFor="team-token">Development access token</label><textarea id="team-token" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} required/><button>Open team workspace</button></form><a href="/catalog">Return to catalog</a></section></main>;

  const assignableRoles = session?.role === "OWNER" ? roles : roles.filter((role) => !["OWNER", "ADMIN"].includes(role));
  return <main className={styles.shell}>
    <aside className={styles.sidebar}><a className={styles.brand} href="/"><b>Part</b>Pulse<span>Organization access</span></a><nav><a href="/catalog"><span>01</span>Catalog</a><a href="/admin"><span>02</span>Operations</a><a className={styles.active} href="/admin/team"><span>03</span>Team</a></nav><div className={styles.identity}>{session?.organization.name}<span>{session ? human(session.role) : ""}</span></div></aside>
    <section className={styles.content}>
      <header><div><span className={styles.eyebrow}>ORGANIZATION ACCESS</span><h1>Team management</h1><p>Invite people and give each person only the access their work requires.</p></div><button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></header>
      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}

      <section className={styles.invitePanel}>
        <div><span className={styles.eyebrow}>NEW MEMBER</span><h2>Create invitation</h2><p>Links are single-use and expire after seven days. The link is shown only when it is created or regenerated.</p></div>
        <form onSubmit={invite}><label>Email<input name="email" type="email" required placeholder="person@company.com"/></label><label>Role<select name="role" defaultValue="VIEWER">{assignableRoles.filter((role) => role !== "OWNER").map((role) => <option value={role} key={role}>{human(role)}</option>)}</select></label><button disabled={busy === "invite"}>{busy === "invite" ? "Creating…" : "Create invitation"}</button></form>
      </section>
      {inviteLink && <section className={styles.linkBox}><div><b>Copy this invitation link now</b><span>The original token cannot be retrieved later.</span></div><input aria-label="Invitation link" readOnly value={inviteLink}/><button onClick={() => void copyLink()}>Copy link</button></section>}

      <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>ACTIVE ACCESS</span><h2>Members</h2></div><b>{members.length} people</b></div><div className={styles.rows}>
        {members.map((member) => {
          const protectedFromAdmin = session?.role === "ADMIN" && ["OWNER", "ADMIN"].includes(member.role);
          return <article key={member.id}><div className={styles.avatar}>{(member.user.name || member.user.email).slice(0, 2).toUpperCase()}</div><div className={styles.person}><b>{member.user.name || "Unnamed member"}{member.user.id === session?.user.id ? " (you)" : ""}</b><span>{member.user.email} · Joined {date(member.createdAt)}</span></div><select aria-label={`Role for ${member.user.email}`} value={member.role} disabled={busy === member.id || protectedFromAdmin} onChange={(event) => void changeRole(member, event.target.value as Role)}>{roles.map((role) => <option key={role} value={role} disabled={session?.role === "ADMIN" && ["OWNER", "ADMIN"].includes(role)}>{human(role)}</option>)}</select><button className={styles.remove} disabled={busy === member.id || protectedFromAdmin} onClick={() => void remove(member)}>Remove</button></article>;
        })}
      </div></section>

      <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>PENDING ACCESS</span><h2>Invitations</h2></div><b>{invitations.length} records</b></div><div className={styles.rows}>
        {invitations.map((invitation) => <article key={invitation.id}><div className={`${styles.avatar} ${styles.pending}`}>@</div><div className={styles.person}><b>{invitation.email}</b><span>{human(invitation.role)} · {invitation.status === "EXPIRED" ? "Expired" : `Expires ${date(invitation.expiresAt)}`}</span></div><button disabled={busy === invitation.id} onClick={() => void regenerate(invitation)}>{invitation.status === "EXPIRED" ? "Create new link" : "Replace link"}</button>{invitation.status === "PENDING" && <button className={styles.remove} disabled={busy === invitation.id} onClick={() => void revoke(invitation)}>Revoke</button>}</article>)}
        {!invitations.length && <p className={styles.empty}>No pending or expired invitations.</p>}
      </div></section>
    </section>
  </main>;
}
