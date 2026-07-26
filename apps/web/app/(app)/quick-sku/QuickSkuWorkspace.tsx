"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./quick-sku.module.css";

type QuickSkuResult = {
  part: { id: string; sku: string };
  identification: { title: string };
};

type IdentifyResponse = {
  partNumber: string;
  brand: string;
  marketplace: string;
  matched: boolean;
  identifiedBrand: string;
  partName: string;
  best: {
    epid: string;
    title: string;
    score: number;
    matchedOn: string[];
    aspects: Record<string, string[]>;
  } | null;
  discovery: {
    categoryId: string | null;
    categoryName: string | null;
    source: string | null;
  };
};

type FitmentResponse = {
  applications: Array<{ fingerprint: string; properties: Record<string, string> }>;
  fitmentCount: number;
  fitmentReason: string | null;
};

type ProgressStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
};

const STEP_DEFS = [
  { id: "identify", label: "Identifying part in eBay catalog" },
  { id: "fitment", label: "Applying vehicle fitment" },
  { id: "title", label: "Building listing title" },
  { id: "catalog", label: "Adding to your catalog" },
  { id: "pricing", label: "Starting market pricing" },
] as const;

function initialSteps(): ProgressStep[] {
  return STEP_DEFS.map((step) => ({ ...step, status: "pending" }));
}

function setStepStatus(steps: ProgressStep[], id: string, status: ProgressStep["status"]) {
  return steps.map((step) => (step.id === id ? { ...step, status } : step));
}

function activateNext(steps: ProgressStep[], doneId: string) {
  const nextIndex = STEP_DEFS.findIndex((step) => step.id === doneId) + 1;
  let updated = setStepStatus(steps, doneId, "done");
  if (nextIndex < STEP_DEFS.length) {
    updated = setStepStatus(updated, STEP_DEFS[nextIndex]!.id, "active");
  }
  return updated;
}

export default function QuickSkuWorkspace() {
  const { status: authStatus, demo, apiFetch } = useAuth();
  const [partNumber, setPartNumber] = useState("");
  const [brand, setBrand] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState<"USED" | "NEW">("USED");
  const [marketplace, setMarketplace] = useState("EBAY_US");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QuickSkuResult | null>(null);
  const [steps, setSteps] = useState<ProgressStep[]>(initialSteps());

  const showProgress = busy || (!result && steps.some((step) => step.status !== "pending"));
  const completedSteps = steps.filter((step) => step.status === "done").length;
  const progressPercent = Math.round((completedSteps / STEP_DEFS.length) * 100);
  const activeStep = steps.find((step) => step.status === "active");

  async function upload(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    let progress = setStepStatus(initialSteps(), "identify", "active");
    setSteps(progress);

    const payload = {
      partNumber: partNumber.trim(),
      brand: brand.trim(),
      price: Number(price),
      quantity: Number(quantity),
      condition,
      marketplace,
    };

    try {
      if (demo) {
        for (const step of STEP_DEFS) {
          await new Promise((resolve) => window.setTimeout(resolve, 420));
          progress = activateNext(progress, step.id);
          setSteps([...progress]);
        }
        const demoPartNumber = payload.partNumber || "8K0615301M";
        const demoBrand = payload.brand || "Audi";
        setResult({
          part: {
            id: "demo-quick-1",
            sku: `${demoBrand.toUpperCase().slice(0, 8)}-${demoPartNumber.toUpperCase()}`,
          },
          identification: {
            title: `2012-2018 ${demoBrand} A6 C7 Front Left Rear Brake Caliper ${demoPartNumber} OEM Used`,
          },
        });
        return;
      }

      const identify = await apiFetch("/api/parts/quick-sku/identify", {
        method: "POST",
        body: JSON.stringify({
          partNumber: payload.partNumber,
          brand: payload.brand,
          marketplace: payload.marketplace,
        }),
      }) as IdentifyResponse;
      progress = activateNext(progress, "identify");
      setSteps([...progress]);

      const fitment = await apiFetch("/api/parts/quick-sku/fitment", {
        method: "POST",
        body: JSON.stringify({
          partNumber: payload.partNumber,
          brand: payload.brand,
          marketplace: payload.marketplace,
          epid: identify.best?.epid ?? null,
        }),
      }) as FitmentResponse;
      progress = activateNext(progress, "fitment");
      setSteps([...progress]);

      const prepared = await apiFetch("/api/parts/quick-sku/prepare", {
        method: "POST",
        body: JSON.stringify({ condition: payload.condition, identify, fitment }),
      });
      progress = activateNext(progress, "title");
      setSteps([...progress]);

      const created = await apiFetch("/api/parts/quick-sku", {
        method: "POST",
        body: JSON.stringify({ ...payload, prepared }),
      }) as { part: { id: string; sku: string }; identification: { title: string } };

      progress = activateNext(progress, "catalog");
      setSteps([...progress]);
      progress = activateNext(progress, "pricing");
      setSteps([...progress]);

      setResult({
        part: { id: created.part.id, sku: created.part.sku },
        identification: { title: created.identification.title },
      });
      setPartNumber("");
      setBrand("");
      setPrice("");
      setQuantity("1");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to upload Quick SKU");
      setSteps((current) => current.map((step) =>
        step.status === "active" ? { ...step, status: "error" } : step,
      ));
    } finally {
      setBusy(false);
    }
  }

  if (authStatus !== "ready") return null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1>Quick SKU</h1>
          <p>Enter a part number and brand — PartPulse identifies the title, specs, and vehicle compatibility, then adds it to your catalog.</p>
        </div>
        <Link className={styles.ghostBtn} href="/catalog">Open catalog</Link>
      </header>

      {error && <div className={styles.error}>{error}</div>}
      {demo && <div className={styles.notice}>Development preview — sample identification is shown without writing to the live catalog.</div>}

      <div className={styles.layout}>
        <form className={styles.formCard} onSubmit={upload}>
          <span className={styles.eyebrow}>Upload part</span>
          <h2>Create from OEM / MPN</h2>
          <p className={styles.formLead}>We match against eBay catalog data, generate a listing-ready title, and attach fitment when available.</p>

          <label>
            <span>Part number</span>
            <input
              value={partNumber}
              onChange={(event) => setPartNumber(event.target.value)}
              placeholder="e.g. 8K0615301M"
              required
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            <span>Brand</span>
            <input
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              placeholder="e.g. Audi"
              required
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <div className={styles.row}>
            <label>
              <span>Your price</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0.00"
                required
                disabled={busy}
              />
            </label>
            <label>
              <span>Quantity</span>
              <input
                type="number"
                min="0"
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
                disabled={busy}
              />
            </label>
          </div>
          <div className={styles.row}>
            <label>
              <span>Condition</span>
              <select value={condition} onChange={(event) => setCondition(event.target.value as "USED" | "NEW")} disabled={busy}>
                <option value="USED">Used</option>
                <option value="NEW">New</option>
              </select>
            </label>
            <label>
              <span>Marketplace</span>
              <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)} disabled={busy}>
                <option value="EBAY_US">eBay US</option>
                <option value="EBAY_GB">eBay UK</option>
                <option value="EBAY_DE">eBay DE</option>
              </select>
            </label>
          </div>

          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Working…" : "Upload"}
          </button>
        </form>

        <section className={styles.resultCard}>
          {showProgress && !result && (
            <div className={styles.progressPanel}>
              <div className={styles.progressBackdrop} aria-hidden="true">
                <div className={styles.gridOverlay} />
                <div className={styles.scanLine} />
              </div>
              <div className={styles.progressContent}>
                <div className={styles.progressHeader}>
                  <div>
                    <span className={styles.progressEyebrow}>Live pipeline</span>
                    <h3 className={styles.progressTitle}>Processing part</h3>
                    <p className={styles.progressLead}>
                      {activeStep ? activeStep.label : "Finalizing…"}
                    </p>
                  </div>
                  <span className={styles.liveBadge}>
                    <span className={styles.liveDot} />
                    Live
                  </span>
                </div>

                <div className={styles.progressTrack} aria-hidden="true">
                  <span className={styles.progressFill} style={{ width: `${Math.max(progressPercent, busy ? 8 : 0)}%` }} />
                </div>
                <p className={styles.progressMeta}>{completedSteps} of {STEP_DEFS.length} stages complete</p>

                <ol className={styles.checklist}>
                  {steps.map((step, index) => (
                    <li key={step.id} className={styles[`step_${step.status}`]}>
                      <div className={styles.stepRail}>
                        <span className={styles.stepIcon} aria-hidden="true">
                          {step.status === "done" ? (
                            <svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.2 6.4 11 12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          ) : step.status === "active" ? (
                            <span className={styles.stepSpinner} />
                          ) : step.status === "error" ? "!" : (
                            <span className={styles.stepIndex}>{index + 1}</span>
                          )}
                        </span>
                        {index < steps.length - 1 && <span className={styles.stepLine} />}
                      </div>
                      <div className={styles.stepCopy}>
                        <strong>{step.label}</strong>
                        <span>
                          {step.status === "done"
                            ? "Complete"
                            : step.status === "active"
                              ? "Running…"
                              : step.status === "error"
                                ? "Failed"
                                : "Queued"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {!showProgress && !result && (
            <div className={styles.empty}>
              <div className={styles.emptyIcon} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <b>Ready when you are</b>
              <span>Upload a part to identify it and add it to Catalog.</span>
            </div>
          )}

          {result && (
            <div className={styles.successPanel}>
              <div className={styles.successBackdrop} aria-hidden="true">
                <div className={styles.gridOverlay} />
              </div>
              <div className={styles.successContent}>
                <div className={styles.successHeader}>
                  <span className={styles.successIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                  <div>
                    <span className={styles.progressEyebrow}>Ready in catalog</span>
                    <h3 className={styles.successTitle}>Part created successfully</h3>
                    <p className={styles.successLead}>Your listing title is saved and ready to review in Catalog.</p>
                  </div>
                </div>

                <article className={styles.listingPreview}>
                  <span className={styles.listingPreviewLabel}>Listing title</span>
                  <p className={styles.listingTitle}>{result.identification.title}</p>
                  <div className={styles.listingMeta}>
                    <span className={styles.listingSkuChip}>{result.part.sku}</span>
                  </div>
                </article>

                <div className={styles.successSummary}>
                  <span className={styles.successSummaryIcon} aria-hidden="true">✓</span>
                  <span>All 5 pipeline stages completed</span>
                </div>

                <Link className={styles.catalogBtn} href={`/catalog?q=${encodeURIComponent(result.part.sku)}`}>
                  View in catalog
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
