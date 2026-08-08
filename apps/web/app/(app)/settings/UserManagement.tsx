"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { accessOptions, accessRoles, defaultPermissionsForRole, roleLabel, type AccessRole } from "../../lib/organization-access";
import styles from "./settings.module.css";

type Member = {
  id: string;
  role: string;
  permissions: string[];
  createdAt: string;
  user: { id: string; email: string; name: string | null };
};

type Invitation = {
  id: string;
  invitedName: string | null;
  email: string;
  role: string;
  permissions: string[];
  status: "PENDING" | "EXPIRED";
  expiresAt: string;
};

function AccessMatrix({ selected, onChange, disabled = false }: { selected: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const values = useMemo(() => new Set(selected), [selected]);
  function toggle(permission: string, checked: boolean) {
    const next = new Set(values);
    if (checked) next.add(permission); else next.delete(permission);
    onChange([...next]);
  }
  function toggleTab(tabPermission: string, actionPermissions: string[], checked: boolean) {
    const next = new Set(values);
    for (const permission of [tabPermission, ...actionPermissions]) checked ? next.add(permission) : next.delete(permission);
    onChange([...next]);
  }
  return <div className={styles.permissionMatrix}>
    {accessOptions.map((option) => {
      const actionPermissions = option.actions.map((action) => action.permission);
      const enabled = values.has(option.permission);
      return <section key={option.permission} className={`${styles.permissionGroup}${enabled ? ` ${styles.permissionEnabled}` : ""}`}>
        <label className={styles.permissionTab}>
          <input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => toggleTab(option.permission, actionPermissions, event.target.checked)} />
          <span><b>{option.label}</b><small>{enabled ? `${option.actions.filter((action) => values.has(action.permission)).length}/${option.actions.length} actions` : "No access"}</small></span>
        </label>
        {enabled && <div className={styles.permissionActions}>{option.actions.map((action) => <label key={action.permission}><input type="checkbox" checked={values.has(action.permission)} disabled={disabled} onChange={(event) => toggle(action.permission, event.target.checked)} /><span>{action.label}</span></label>)}</div>}
      </section>;
    })}
  </div>;
}

export default function UserManagement() {
  const { apiFetch, session } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [role, setRole] = useState<AccessRole>("LISTING_MANAGER");
  const [permissions, setPermissions] = useState<string[]>(() => defaultPermissionsForRole("LISTING_MANAGER"));
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRole, setEditRole] = useState<AccessRole>("LISTING_MANAGER");
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fallbackLink, setFallbackLink] = useState("");
  const canManage = session?.role === "OWNER" || session?.role === "ADMIN" || session?.permissions?.includes("team.manage");

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      const result = await apiFetch("/api/team") as { members: Member[]; invitations: Invitation[] };
      setMembers(result.members);
      setInvitations(result.invitations);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load users"); }
  }, [apiFetch, canManage]);

  useEffect(() => { void load(); }, [load]);

  function selectRole(next: AccessRole) {
    setRole(next);
    setPermissions(defaultPermissionsForRole(next));
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("invite"); setError(""); setNotice(""); setFallbackLink("");
    try {
      const result = await apiFetch("/api/team/invitations", { method: "POST", body: JSON.stringify({ name: form.get("name"), email: form.get("email"), role, permissions }) }) as { invitationUrl: string; emailDelivery: string };
      setFallbackLink(result.emailDelivery === "sent" ? "" : result.invitationUrl);
      setNotice(result.emailDelivery === "sent" ? "Invitation sent successfully." : "Invitation created, but SMTP delivery failed. Use the secure link below.");
      event.currentTarget.reset();
      selectRole("LISTING_MANAGER");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to invite user"); }
    finally { setBusy(""); }
  }

  function openEditor(member: Member) {
    if (member.role === "OWNER") return;
    const nextRole = accessRoles.includes(member.role as AccessRole) ? member.role as AccessRole : "LISTING_MANAGER";
    setEditing(member); setEditRole(nextRole); setEditPermissions(member.permissions?.length ? member.permissions : defaultPermissionsForRole(nextRole));
  }

  async function saveMember() {
    if (!editing) return;
    setBusy(editing.id); setError("");
    try {
      await apiFetch(`/api/team/members/${editing.id}`, { method: "PATCH", body: JSON.stringify({ role: editRole, permissions: editPermissions }) });
      setNotice(`${editing.user.name || editing.user.email}'s access was updated.`); setEditing(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update access"); }
    finally { setBusy(""); }
  }

  async function removeMember(member: Member) {
    if (!confirm(`Remove ${member.user.email} from this organization?`)) return;
    setBusy(member.id); setError("");
    try { await apiFetch(`/api/team/members/${member.id}`, { method: "DELETE" }); setNotice("User access removed."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to remove user"); }
    finally { setBusy(""); }
  }

  async function revoke(invitation: Invitation) {
    setBusy(invitation.id); setError("");
    try { await apiFetch(`/api/team/invitations/${invitation.id}`, { method: "DELETE" }); setNotice("Invitation revoked."); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to revoke invitation"); }
    finally { setBusy(""); }
  }

  if (!canManage) return <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>User management</span><h2>Admin access required</h2></div><p>Your administrator controls organization users and permissions.</p></div></section>;

  return <div className={styles.userManagement}>
    {error && <div className={styles.error}>{error}</div>}{notice && <div className={styles.notice}>{notice}</div>}
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span className={styles.eyebrow}>New access</span><h2>Invite a user</h2></div><p>The user receives a branded email and creates a password from a secure, seven-day link.</p></div>
      <form className={styles.inviteForm} onSubmit={invite}>
        <div className={styles.inviteIdentity}><label><span>Name</span><input name="name" required maxLength={100} placeholder="e.g. Sarah Ahmed" /></label><label><span>Email</span><input name="email" type="email" required maxLength={320} placeholder="sarah@company.com" /></label></div>
        <div><span className={styles.fieldLabel}>Access role</span><div className={styles.roleCards}>{accessRoles.map((item) => <button key={item} type="button" className={role === item ? styles.roleSelected : ""} onClick={() => selectRole(item)}><b>{roleLabel(item)}</b><small>{item === "ADMIN" ? "All organization access" : item === "LISTING_MANAGER" ? "Listing preparation and catalog" : "Store operations and fulfillment"}</small></button>)}</div></div>
        <div className={styles.accessHeading}><div><span className={styles.fieldLabel}>Tabs and actions</span><small>Review the preset and add or remove access before sending.</small></div><b>{permissions.filter((permission) => permission.startsWith("tab.")).length} tabs selected</b></div>
        <AccessMatrix selected={permissions} onChange={setPermissions} disabled={role === "ADMIN"} />
        <div className={styles.inviteActions}><button className={styles.primary} disabled={busy === "invite"}>{busy === "invite" ? "Sending invitation…" : "Send invitation"}</button></div>
      </form>
      {fallbackLink && <div className={styles.fallbackLink}><span>Secure invitation link</span><input readOnly value={fallbackLink}/><button type="button" className={styles.ghostBtn} onClick={() => void navigator.clipboard.writeText(fallbackLink)}>Copy</button></div>}
    </section>

    <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>Organization users</span><h2>Active access</h2></div><p>{members.length} active {members.length === 1 ? "user" : "users"}</p></div><div className={styles.memberList}>{members.map((member) => <article key={member.id} className={styles.memberRow}><span className={styles.memberAvatar}>{(member.user.name || member.user.email).slice(0,2).toUpperCase()}</span><div><b>{member.user.name || "Unnamed user"}{member.user.id === session?.user.id ? " (you)" : ""}</b><small>{member.user.email}</small></div><span className={styles.rolePill}>{roleLabel(member.role)}</span><span className={styles.memberTabs}>{member.role === "OWNER" || member.role === "ADMIN" ? "All tabs" : `${member.permissions.filter((permission) => permission.startsWith("tab.")).length} tabs`}</span><div className={styles.memberActions}><button type="button" className={styles.ghostBtn} disabled={member.role === "OWNER"} onClick={() => openEditor(member)}>Edit access</button><button type="button" className={styles.textDanger} disabled={member.role === "OWNER" || busy === member.id} onClick={() => void removeMember(member)}>Remove</button></div></article>)}</div></section>

    {invitations.length > 0 && <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.eyebrow}>Pending</span><h2>Invitations</h2></div></div><div className={styles.memberList}>{invitations.map((invitation) => <article className={styles.memberRow} key={invitation.id}><span className={styles.memberAvatar}>@</span><div><b>{invitation.invitedName || invitation.email}</b><small>{invitation.email} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</small></div><span className={styles.rolePill}>{roleLabel(invitation.role)}</span><span className={styles.memberTabs}>{invitation.permissions.filter((permission) => permission.startsWith("tab.")).length} tabs</span><div className={styles.memberActions}><button type="button" className={styles.textDanger} disabled={busy === invitation.id} onClick={() => void revoke(invitation)}>Revoke</button></div></article>)}</div></section>}

    {editing && <div className={styles.accessOverlay} role="dialog" aria-modal="true"><section className={styles.accessDialog}><div className={styles.dialogHead}><div><span className={styles.eyebrow}>Edit access</span><h2>{editing.user.name || editing.user.email}</h2><p>{editing.user.email}</p></div><button type="button" className={styles.ghostBtn} onClick={() => setEditing(null)}>Close</button></div><label className={styles.dialogRole}><span>Role</span><select value={editRole} onChange={(event) => { const next = event.target.value as AccessRole; setEditRole(next); setEditPermissions(defaultPermissionsForRole(next)); }}>{accessRoles.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select></label><AccessMatrix selected={editPermissions} onChange={setEditPermissions} disabled={editRole === "ADMIN"}/><div className={styles.dialogActions}><button type="button" className={styles.ghostBtn} onClick={() => setEditing(null)}>Cancel</button><button type="button" className={styles.primary} disabled={busy === editing.id} onClick={() => void saveMember()}>Save access</button></div></section></div>}
  </div>;
}
