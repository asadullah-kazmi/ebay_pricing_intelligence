"use client";

import { type CSSProperties, FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import styles from "./settings.module.css";

type ListingTeam = {
  id: string;
  name: string;
  color: string;
  isArchived: boolean;
  usageCount: number;
};

const colors = ["#2563EB", "#7C3AED", "#0D9488", "#16A34A", "#D97706", "#DC2626", "#475569"];
const demoTeams: ListingTeam[] = [
  { id: "demo-1", name: "Main warehouse", color: "#2563EB", isArchived: false, usageCount: 28 },
  { id: "demo-2", name: "Aftermarket", color: "#7C3AED", isArchived: false, usageCount: 14 },
];

export default function ListingTeamsManagement() {
  const { apiFetch, demo } = useAuth();
  const [teams, setTeams] = useState<ListingTeam[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(colors[0]);
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(colors[0]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    if (demo) { setTeams(demoTeams); return; }
    try {
      const result = await apiFetch("/api/listing-teams?includeArchived=true") as { teams: ListingTeam[] };
      setTeams(result.teams);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load listing teams");
    }
  }, [apiFetch, demo]);

  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create"); setError(""); setNotice("");
    try {
      if (demo) {
        setTeams((current) => [...current, { id: crypto.randomUUID(), name: name.trim(), color, isArchived: false, usageCount: 0 }]);
      } else {
        const saved = await apiFetch("/api/listing-teams", { method: "POST", body: JSON.stringify({ name, color }) }) as ListingTeam;
        setTeams((current) => [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setName("");
      setNotice("Team created. It is now available as a listing classification tag.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create team"); }
    finally { setBusy(""); }
  }

  function startEdit(team: ListingTeam) {
    setEditingId(team.id); setEditName(team.name); setEditColor(team.color); setError(""); setNotice("");
  }

  async function save(teamId: string) {
    setBusy(teamId); setError(""); setNotice("");
    try {
      const saved = demo
        ? { ...teams.find((team) => team.id === teamId)!, name: editName.trim(), color: editColor }
        : await apiFetch(`/api/listing-teams/${teamId}`, { method: "PATCH", body: JSON.stringify({ name: editName, color: editColor }) }) as ListingTeam;
      setTeams((current) => current.map((team) => team.id === teamId ? saved : team).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingId(""); setNotice("Team updated.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update team"); }
    finally { setBusy(""); }
  }

  async function setArchived(team: ListingTeam, isArchived: boolean) {
    setBusy(team.id); setError(""); setNotice("");
    try {
      const saved = demo
        ? { ...team, isArchived }
        : await apiFetch(`/api/listing-teams/${team.id}/${isArchived ? "archive" : "restore"}`, { method: "POST" }) as ListingTeam;
      setTeams((current) => current.map((item) => item.id === team.id ? saved : item));
      setNotice(isArchived ? "Team archived. Existing listing tags were preserved." : "Team restored.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update team status"); }
    finally { setBusy(""); }
  }

  const visibleTeams = teams.filter((team) => showArchived || !team.isArchived);

  return <div className={styles.teamWorkspace}>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}>{notice}</div>}

    <section className={styles.teamCreateCard}>
      <div className={styles.teamCreateCopy}>
        <span className={styles.eyebrow}>Listing classification</span>
        <h2>Create a team tag</h2>
        <p>Teams are labels for grouping listings. They do not grant user access or change permissions.</p>
      </div>
      <form className={styles.teamCreateForm} onSubmit={create}>
        <label><span>Team name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Main warehouse" maxLength={60} required /></label>
        <fieldset className={styles.colorPicker}><legend>Tag color</legend><div>{colors.map((option) => <button key={option} type="button" aria-label={`Use ${option}`} aria-pressed={color === option} className={color === option ? styles.colorActive : undefined} style={{ "--team-color": option } as CSSProperties} onClick={() => setColor(option)} />)}</div></fieldset>
        <button type="submit" className={styles.primary} disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Create team"}</button>
      </form>
    </section>

    <section className={styles.teamListCard}>
      <header className={styles.teamListHead}>
        <div><span className={styles.eyebrow}>Configured teams</span><h2>Manage team tags</h2><p>{teams.filter((team) => !team.isArchived).length} active team{teams.filter((team) => !team.isArchived).length === 1 ? "" : "s"}</p></div>
        <label className={styles.archiveToggle}><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
      </header>
      <div className={styles.teamTableHead}><span>Team</span><span>Listings</span><span>Status</span><span>Actions</span></div>
      <div className={styles.teamRows}>
        {visibleTeams.length === 0 && <div className={styles.teamEmpty}>No teams yet. Create your first classification tag above.</div>}
        {visibleTeams.map((team) => <div className={styles.teamRow} key={team.id}>
          {editingId === team.id ? <>
            <div className={styles.teamEditFields}><input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={60} /><select value={editColor} onChange={(event) => setEditColor(event.target.value)}>{colors.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
            <span>{team.usageCount}</span><span className={styles.teamStatus}>Active</span>
            <div className={styles.teamActions}><button type="button" className={styles.ghostBtn} onClick={() => setEditingId("")}>Cancel</button><button type="button" className={styles.primary} disabled={!editName.trim() || busy === team.id} onClick={() => void save(team.id)}>Save</button></div>
          </> : <>
            <div className={styles.teamIdentity}><i style={{ background: team.color }} /><div><b>{team.name}</b><small>{team.color}</small></div></div>
            <span>{team.usageCount}</span><span className={`${styles.teamStatus} ${team.isArchived ? styles.teamArchived : ""}`}>{team.isArchived ? "Archived" : "Active"}</span>
            <div className={styles.teamActions}>{!team.isArchived && <button type="button" className={styles.ghostBtn} onClick={() => startEdit(team)}>Edit</button>}<button type="button" className={team.isArchived ? styles.ghostBtn : styles.textDanger} disabled={busy === team.id} onClick={() => void setArchived(team, !team.isArchived)}>{team.isArchived ? "Restore" : "Archive"}</button></div>
          </>}
        </div>)}
      </div>
    </section>
  </div>;
}
