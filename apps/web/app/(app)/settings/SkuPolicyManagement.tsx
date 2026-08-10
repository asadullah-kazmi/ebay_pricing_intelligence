"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import styles from "./settings.module.css";

type SkuMode = "SEQUENTIAL" | "PART_NUMBER";

type SkuPolicy = {
  mode: SkuMode;
  prefix: string;
  nextNumber: number;
  preview: string;
};

const demoPolicy: SkuPolicy = { mode: "SEQUENTIAL", prefix: "BLAP", nextNumber: 1000, preview: "BLAP-1000" };

export default function SkuPolicyManagement() {
  const { apiFetch, demo } = useAuth();
  const [mode, setMode] = useState<SkuMode>("SEQUENTIAL");
  const [prefix, setPrefix] = useState("SKU");
  const [nextNumber, setNextNumber] = useState(1000);
  const [savedPolicy, setSavedPolicy] = useState<SkuPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const applyPolicy = useCallback((policy: SkuPolicy) => {
    setSavedPolicy(policy);
    setMode(policy.mode);
    setPrefix(policy.prefix);
    setNextNumber(policy.nextNumber);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      applyPolicy(demo ? demoPolicy : await apiFetch("/api/settings/sku-policy") as SkuPolicy);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load the SKU policy");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, applyPolicy, demo]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const normalizedPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const payload = mode === "SEQUENTIAL"
        ? { mode, prefix: normalizedPrefix, nextNumber }
        : { mode };
      const policy = demo
        ? { mode, prefix: normalizedPrefix || savedPolicy?.prefix || "SKU", nextNumber, preview: mode === "PART_NUMBER" ? "Uses each uploaded part number" : `${normalizedPrefix}-${nextNumber}` }
        : await apiFetch("/api/settings/sku-policy", { method: "PATCH", body: JSON.stringify(payload) }) as SkuPolicy;
      applyPolicy(policy);
      setNotice(mode === "PART_NUMBER"
        ? "Part numbers will now be used as SKUs for Quick SKU and Basic Pipeline uploads."
        : `The next generated SKU will be ${policy.preview}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the SKU policy");
    } finally {
      setSaving(false);
    }
  }

  const cleanPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const preview = mode === "PART_NUMBER" ? "8K0615301M" : `${cleanPrefix || "PREFIX"}-${nextNumber}`;

  return <div className={styles.skuWorkspace}>
    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}>{notice}</div>}

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <span className={styles.eyebrow}>Catalog identifiers</span>
          <h2>SKU generation</h2>
        </div>
        <p>Choose how PartPulse assigns SKUs when Quick SKU or the Basic Pipeline template does not provide one.</p>
      </div>

      {loading ? <div className={styles.skuLoading}>Loading SKU policy…</div> : <form className={styles.skuForm} onSubmit={save}>
        <fieldset className={styles.skuModeFieldset}>
          <legend>Generation method</legend>
          <div className={styles.skuModeGrid}>
            <label className={`${styles.skuModeCard} ${mode === "SEQUENTIAL" ? styles.skuModeCardActive : ""}`}>
              <input type="radio" name="skuMode" value="SEQUENTIAL" checked={mode === "SEQUENTIAL"} onChange={() => setMode("SEQUENTIAL")} />
              <span><b>Sequential SKU</b><small>Generate a controlled prefix and increasing suffix, such as BLAP-1000.</small></span>
            </label>
            <label className={`${styles.skuModeCard} ${mode === "PART_NUMBER" ? styles.skuModeCardActive : ""}`}>
              <input type="radio" name="skuMode" value="PART_NUMBER" checked={mode === "PART_NUMBER"} onChange={() => setMode("PART_NUMBER")} />
              <span><b>Use part number</b><small>Assign the normalized part number directly as the SKU.</small></span>
            </label>
          </div>
        </fieldset>

        {mode === "SEQUENTIAL" && <div className={styles.skuFields}>
          <label>
            <span>SKU prefix</span>
            <input value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} placeholder="BLAP" minLength={2} maxLength={20} pattern="[A-Za-z0-9 -]+" required />
            <small>2–20 letters or numbers. Spaces and punctuation are removed.</small>
          </label>
          <label>
            <span>Next suffix number</span>
            <input type="number" value={nextNumber} onChange={(event) => setNextNumber(Number(event.target.value))} min={0} max={999999999} step={1} required />
            <small>Saving this value controls the next SKU in the sequence.</small>
          </label>
        </div>}

        <div className={styles.skuPreview}>
          <span>Next SKU preview</span>
          <strong>{preview}</strong>
          <small>{mode === "PART_NUMBER" ? "Example using an uploaded part number" : "The counter advances only after an item is successfully created"}</small>
        </div>

        <div className={styles.skuScope}>
          <b>Where this policy applies</b>
          <span>Quick SKU</span>
          <span>Basic Pipeline template</span>
          <small>SKUs explicitly supplied in the Standard Pipeline template are preserved.</small>
        </div>

        <button type="submit" className={styles.primary} disabled={saving || (mode === "SEQUENTIAL" && (cleanPrefix.length < 2 || !Number.isSafeInteger(nextNumber)))}>
          {saving ? "Saving…" : "Save SKU policy"}
        </button>
      </form>}
    </section>
  </div>;
}
