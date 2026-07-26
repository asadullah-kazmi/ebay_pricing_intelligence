"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../components/AuthProvider";
import styles from "./quick-sku.module.css";

type QuickSkuResult = {
  part: {
    id: string;
    sku: string;
    primaryPartNumber: string;
    brand: string | null;
    partName: string | null;
    description: string | null;
    condition: string;
    status: string;
    createdAt: string;
    inventoryItem: { quantity: number; cost: number; currency: string } | null;
  };
  identification: {
    matched: boolean;
    title: string;
    brand: string;
    partName: string;
    categoryId: string | null;
    categoryName: string | null;
    epid: string | null;
    score: number | null;
    matchedOn: string[];
    aspects: Record<string, string[]>;
    fitmentCount: number;
    marketplace: string;
  };
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
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

  async function upload(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      if (demo) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const demoPartNumber = partNumber.trim() || "8K0615301M";
        const demoBrand = brand.trim() || "Audi";
        setResult({
          part: {
            id: "demo-quick-1",
            sku: `${demoBrand.toUpperCase().slice(0, 8)}-${demoPartNumber.toUpperCase()}`,
            primaryPartNumber: demoPartNumber,
            brand: demoBrand,
            partName: "Rear Brake Caliper",
            description: "Category: Brake Calipers\nManufacturer Part Number: 8K0615301M\nBrand: Audi\nPlacement on Vehicle: Rear",
            condition,
            status: "READY_FOR_ENRICHMENT",
            createdAt: new Date().toISOString(),
            inventoryItem: {
              quantity: Number(quantity) || 1,
              cost: Number(price) || 89.5,
              currency: "USD",
            },
          },
          identification: {
            matched: true,
            title: `OEM ${demoBrand} Rear Brake Caliper ${demoPartNumber}`,
            brand: demoBrand,
            partName: "Rear Brake Caliper",
            categoryId: "33596",
            categoryName: "Brake Calipers",
            epid: "demo-epid",
            score: 90,
            matchedOn: ["exact part-number aspect", "brand"],
            aspects: {
              "Manufacturer Part Number": [demoPartNumber],
              Brand: [demoBrand],
              "Placement on Vehicle": ["Rear"],
            },
            fitmentCount: 2,
            marketplace,
          },
        });
        return;
      }

      const created = await apiFetch("/api/parts/quick-sku", {
        method: "POST",
        body: JSON.stringify({
          partNumber: partNumber.trim(),
          brand: brand.trim(),
          price: Number(price),
          quantity: Number(quantity),
          condition,
          marketplace,
        }),
      }) as QuickSkuResult;
      setResult(created);
      setPartNumber("");
      setBrand("");
      setPrice("");
      setQuantity("1");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to upload Quick SKU");
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
            />
          </label>
          <div className={styles.row}>
            <label>
              <span>Price</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0.00"
                required
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
              />
            </label>
          </div>
          <div className={styles.row}>
            <label>
              <span>Condition</span>
              <select value={condition} onChange={(event) => setCondition(event.target.value as "USED" | "NEW")}>
                <option value="USED">Used</option>
                <option value="NEW">New</option>
              </select>
            </label>
            <label>
              <span>Marketplace</span>
              <select value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
                <option value="EBAY_US">eBay US</option>
                <option value="EBAY_GB">eBay UK</option>
                <option value="EBAY_DE">eBay DE</option>
              </select>
            </label>
          </div>

          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Identifying…" : "Upload"}
          </button>
        </form>

        <section className={styles.resultCard}>
          {!result ? (
            <div className={styles.empty}>
              <b>Ready when you are</b>
              <span>After upload, the identified title, specs, and fitment summary appear here — and the part shows in Catalog.</span>
            </div>
          ) : (
            <>
              <div className={styles.resultHead}>
                <div>
                  <span className={styles.eyebrow}>{result.identification.matched ? "Identified" : "Created"}</span>
                  <h2>{result.identification.title}</h2>
                  <p>
                    SKU {result.part.sku}
                    {" · "}
                    {result.identification.marketplace.replace("EBAY_", "eBay ")}
                    {result.identification.categoryName ? ` · ${result.identification.categoryName}` : ""}
                  </p>
                </div>
                <Link className={styles.primary} href={`/catalog?q=${encodeURIComponent(result.part.sku)}`}>
                  View in catalog
                </Link>
              </div>

              <div className={styles.metrics}>
                <article>
                  <span>Part name</span>
                  <b>{result.part.partName || "—"}</b>
                </article>
                <article>
                  <span>Price</span>
                  <b>{result.part.inventoryItem ? money(result.part.inventoryItem.cost, result.part.inventoryItem.currency) : "—"}</b>
                </article>
                <article>
                  <span>Quantity</span>
                  <b>{result.part.inventoryItem?.quantity ?? 0}</b>
                </article>
                <article>
                  <span>Fitment</span>
                  <b>{result.identification.fitmentCount}</b>
                  <small>vehicles attached</small>
                </article>
              </div>

              {Object.keys(result.identification.aspects).length > 0 && (
                <div className={styles.specs}>
                  <span className={styles.eyebrow}>Specs</span>
                  <dl>
                    {Object.entries(result.identification.aspects).slice(0, 12).map(([name, values]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>{values.join(", ")}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {!result.identification.matched && (
                <div className={styles.notice}>
                  No confident eBay catalog match was found. The part was still added to Catalog with your brand and part number — refine title or fitment from Catalog or Fitment.
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
