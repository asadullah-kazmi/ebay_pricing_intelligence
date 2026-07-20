"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import styles from "./catalog.module.css";
import type { CatalogPartCard, CatalogPartDetail, CatalogResponse, CatalogStatus, PartCondition, PricingConditionMode, PricingJob, PricingJobSummary } from "./types";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const statuses: CatalogStatus[] = ["IMPORTED", "NEEDS_IMAGES", "IMPORT_ERROR", "READY_FOR_ENRICHMENT", "ARCHIVED"];
const emptyCatalog: CatalogResponse = { parts: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 }, summary: { total: 0, byStatus: {} }, warehouses: [] };

const demoParts: CatalogPartCard[] = [
  { id: "demo-1", sku: "GM-84178783-A", primaryPartNumber: "84178783", brand: "ACDelco", partName: "HVAC Blower Motor Control Module", condition: "USED", status: "READY_FOR_ENRICHMENT", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), donorVehicle: { vin: "1GNEK13Z43R000001", year: 2021, make: "Chevrolet", model: "Traverse" }, inventoryItem: { quantity: 1, cost: 28, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b1", code: "A-14" } }, media: [], pricingJobItems: [], _count: { media: 4 } },
  { id: "demo-2", sku: "AUD-8K0615301M", primaryPartNumber: "8K0615301M", brand: "Audi", partName: "Rear Brake Caliper", condition: "USED", status: "NEEDS_IMAGES", createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(), donorVehicle: { vin: "WAUZZZ8K9DA000001", year: 2013, make: "Audi", model: "A4" }, inventoryItem: { quantity: 2, cost: 46.5, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b2", code: "C-08" } }, media: [], pricingJobItems: [], _count: { media: 0 } },
  { id: "demo-3", sku: "BMW-64119355981", primaryPartNumber: "64119355981", brand: "BMW", partName: "Air Conditioning Control Panel", condition: "USED", status: "IMPORTED", createdAt: new Date(Date.now() - 172800000).toISOString(), updatedAt: new Date().toISOString(), donorVehicle: null, inventoryItem: { quantity: 1, cost: 65, currency: "USD", warehouse: null, binLocation: null }, media: [], pricingJobItems: [], _count: { media: 2 } },
];

function demoCatalog(): CatalogResponse {
  return { parts: demoParts, pagination: { page: 1, pageSize: 25, total: 3, totalPages: 1 }, summary: { total: 3, byStatus: { READY_FOR_ENRICHMENT: 1, NEEDS_IMAGES: 1, IMPORTED: 1 } }, warehouses: [{ id: "w1", code: "MAIN", name: "Main" }] };
}

function humanStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: string | number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value));
}

function CatalogImage({ mediaId, token, demo }: { mediaId?: string; token: string; demo: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!mediaId || !token || demo) return;
    let active = true;
    fetch(`${apiBase}/api/media/${mediaId}/download-url`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" })
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((data: { downloadUrl: string }) => { if (active) setUrl(data.downloadUrl); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [demo, mediaId, token]);
  return <div className={styles.thumb}>{url ? <img src={url} alt="Catalog part" /> : <span>{demo || mediaId ? "PART" : "NO IMAGE"}</span>}</div>;
}

export default function CatalogWorkspace() {
  const [token, setToken] = useState("");
  const [authState, setAuthState] = useState<"loading" | "required" | "ready">("loading");
  const [tokenInput, setTokenInput] = useState("");
  const [demo, setDemo] = useState(false);
  const [catalog, setCatalog] = useState<CatalogResponse>(emptyCatalog);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("");
  const [condition, setCondition] = useState("");
  const [hasImages, setHasImages] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"table" | "gallery">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CatalogPartDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [pricingMarketplace, setPricingMarketplace] = useState("EBAY_US");
  const [pricingCondition, setPricingCondition] = useState<PricingConditionMode>("MATCH_PART");
  const [pricingJob, setPricingJob] = useState<PricingJob | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [latestPricingLoaded, setLatestPricingLoaded] = useState(false);

  useEffect(() => {
    const localDemo = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("demo") === "1";
    if (localDemo) {
      setDemo(true);
      setCatalog(demoCatalog());
      setToken("demo");
      setAuthState("ready");
      return;
    }
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
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(typeof body === "object" && body?.error ? body.error : "Request failed");
    return body;
  }, [token]);

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25", sort });
    if (deferredSearch.trim()) query.set("q", deferredSearch.trim());
    if (status) query.set("status", status);
    if (condition) query.set("condition", condition);
    if (hasImages) query.set("hasImages", hasImages);
    if (warehouseId) query.set("warehouseId", warehouseId);
    if (createdFrom) query.set("createdFrom", `${createdFrom}T00:00:00.000Z`);
    if (createdTo) query.set("createdTo", `${createdTo}T23:59:59.999Z`);
    return query.toString();
  }, [condition, createdFrom, createdTo, deferredSearch, hasImages, page, sort, status, warehouseId]);

  const loadCatalog = useCallback(async () => {
    if (authState !== "ready" || demo) return;
    setLoading(true);
    setError("");
    try { setCatalog(await request(`/api/parts?${queryString}`) as CatalogResponse); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load catalog"); }
    finally { setLoading(false); }
  }, [authState, demo, queryString, request]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    if (authState !== "ready" || demo || latestPricingLoaded) return;
    setLatestPricingLoaded(true);
    request("/api/pricing/jobs?limit=1")
      .then(async (jobs) => {
        const latest = (jobs as PricingJobSummary[])[0];
        if (latest) setPricingJob(await request(`/api/pricing/jobs/${latest.id}`) as PricingJob);
      })
      .catch(() => undefined);
  }, [authState, demo, latestPricingLoaded, request]);

  useEffect(() => {
    if (!pricingJob || !["QUEUED", "RUNNING"].includes(pricingJob.status) || demo) return;
    const timer = window.setTimeout(() => {
      request(`/api/pricing/jobs/${pricingJob.id}`)
        .then((job) => {
          const updated = job as PricingJob;
          setPricingJob(updated);
          if (!["QUEUED", "RUNNING"].includes(updated.status)) void loadCatalog();
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to refresh pricing job"));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [demo, loadCatalog, pricingJob, request]);

  async function connectToken(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/session`, { headers: { Authorization: `Bearer ${tokenInput.trim()}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Invalid access token");
      setToken(tokenInput.trim());
      setAuthState("ready");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to connect session"); }
  }

  function resetPage() { setPage(1); setSelected(new Set()); }
  function togglePart(id: string) { setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function togglePage() {
    const ids = catalog.parts.map(({ id }) => id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((current) => { const next = new Set(current); ids.forEach((id) => allSelected ? next.delete(id) : next.add(id)); return next; });
  }

  async function openPart(id: string) {
    if (demo) {
      const card = demoParts.find((part) => part.id === id)!;
      setDetail({ ...card, description: "Verified dismantled automotive component ready for enrichment.", donorMileage: 48600, donorColor: "Black", placement: "Rear", notes: null, partNumbers: [{ id: "pn", type: "PRIMARY", value: card.primaryPartNumber }], inventoryItem: card.inventoryItem ? { ...card.inventoryItem, weight: null, weightUnit: null, length: null, width: null, height: null, dimensionUnit: null } : null, media: [] });
      return;
    }
    setError("");
    try { setDetail(await request(`/api/parts/${id}`) as CatalogPartDetail); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to open part"); }
  }

  async function savePart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || demo) { setDetail(null); return; }
    const form = new FormData(event.currentTarget);
    const nullableNumber = (name: string) => form.get(name) === "" ? null : Number(form.get(name));
    const body = {
      sku: String(form.get("sku")), primaryPartNumber: String(form.get("primaryPartNumber")),
      brand: String(form.get("brand")) || null, partName: String(form.get("partName")) || null,
      description: String(form.get("description")) || null, condition: form.get("condition") as PartCondition,
      status: form.get("status") as CatalogStatus, placement: String(form.get("placement")) || null,
      notes: String(form.get("notes")) || null,
      inventory: { quantity: Number(form.get("quantity")), cost: Number(form.get("cost")), currency: String(form.get("currency")).toUpperCase(), warehouseCode: String(form.get("warehouseCode")) || null, binLocation: String(form.get("binLocation")) || null, weight: nullableNumber("weight"), weightUnit: form.get("weight") === "" ? null : form.get("weightUnit"), length: nullableNumber("length"), width: nullableNumber("width"), height: nullableNumber("height"), dimensionUnit: ["length", "width", "height"].every((name) => form.get(name) === "") ? null : form.get("dimensionUnit") },
    };
    setSaving(true);
    setError("");
    try { await request(`/api/parts/${detail.id}`, { method: "PATCH", body: JSON.stringify(body) }); setDetail(null); await loadCatalog(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save part"); }
    finally { setSaving(false); }
  }

  async function archiveSelected() {
    if (!selected.size || demo) return;
    setLoading(true);
    try { await request("/api/parts/bulk-status", { method: "PATCH", body: JSON.stringify({ partIds: [...selected], status: "ARCHIVED" }) }); setSelected(new Set()); await loadCatalog(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update selected parts"); }
    finally { setLoading(false); }
  }

  async function priceSelected() {
    if (!selected.size || selected.size > 25 || demo || pricingBusy) return;
    setPricingBusy(true);
    setError("");
    try {
      const job = await request("/api/pricing/jobs", {
        method: "POST",
        body: JSON.stringify({ partIds: [...selected], marketplace: pricingMarketplace, conditionMode: pricingCondition }),
      }) as PricingJob;
      setPricingJob(job);
      setSelected(new Set());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start pricing"); }
    finally { setPricingBusy(false); }
  }

  async function downloadCsv() {
    if (demo) return;
    try {
      const response = await fetch(`${apiBase}/api/parts/export?${queryString}`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
      if (!response.ok) throw new Error("Unable to export catalog");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "partpulse-catalog.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to export catalog"); }
  }

  if (authState === "loading") return <main className={styles.authScreen}><div className={styles.loader}/><p>Opening your catalog workspace...</p></main>;
  if (authState === "required") return <main className={styles.authScreen}><section className={styles.authCard}><span className={styles.eyebrow}>PARTPULSE WORKSPACE</span><h1>Catalog access required</h1><p>Your secure refresh session is unavailable. Sign in through onboarding, or use a short-lived access token during development.</p><form onSubmit={connectToken}><label htmlFor="access-token">Development access token</label><textarea id="access-token" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} required/><button>Open catalog</button></form>{error && <div className={styles.error}>{error}</div>}<a href="/">Return to pricing search</a></section></main>;

  const ready = catalog.summary.byStatus.READY_FOR_ENRICHMENT ?? 0;
  const needsImages = catalog.summary.byStatus.NEEDS_IMAGES ?? 0;
  const imported = catalog.summary.byStatus.IMPORTED ?? 0;
  const allPageSelected = catalog.parts.length > 0 && catalog.parts.every(({ id }) => selected.has(id));

  return <main className={styles.shell}>
    <aside className={styles.sidebar}><a className={styles.brand} href="/"><b>Part</b>Pulse<span>Automotive operations</span></a><nav><a className={styles.active} href="/catalog"><span>01</span>Catalog</a><a href="/"><span>02</span>Market pricing</a><button disabled><span>03</span>Fitment</button><button disabled><span>04</span>Publishing</button></nav><div className={styles.sideFoot}><i/> eBay connection active</div></aside>
    <section className={styles.workspace}>
      <header className={styles.topbar}><div><span className={styles.eyebrow}>INVENTORY OPERATIONS</span><h1>Parts catalog</h1></div><div className={styles.topActions}><button className={styles.secondary} onClick={() => void downloadCsv()}>Export CSV</button><button className={styles.primary} disabled>+ New import</button></div></header>
      {demo && <div className={styles.demoBanner}>Development preview - sample records are not saved.</div>}
      {error && <div className={styles.error}>{error}</div>}
      <section className={styles.stats}>
        <article><span>Total parts</span><b>{catalog.summary.total}</b><small>Organization catalog</small></article>
        <article><span>Ready to enrich</span><b>{ready}</b><small>Pricing and fitment next</small></article>
        <article><span>Needs images</span><b>{needsImages}</b><small>Action required</small></article>
        <article><span>Newly imported</span><b>{imported}</b><small>Awaiting review</small></article>
      </section>
      {pricingJob && <section className={styles.pricingPanel}>
        <header><div><span className={styles.eyebrow}>BULK MARKET PRICING</span><h2>Job {pricingJob.id.slice(-8)}</h2></div><div><span className={`${styles.jobStatus} ${styles[`job_${pricingJob.status.toLowerCase()}`]}`}>{humanStatus(pricingJob.status)}</span><button onClick={() => setPricingJob(null)} aria-label="Hide pricing job">×</button></div></header>
        <div className={styles.jobProgress}><div><i style={{ width: `${Math.round(((pricingJob.completedItems + pricingJob.noMatchItems + pricingJob.failedItems) / pricingJob.totalItems) * 100)}%` }}/></div><span>{pricingJob.completedItems + pricingJob.noMatchItems + pricingJob.failedItems} of {pricingJob.totalItems} processed · {pricingJob.marketplace} · {humanStatus(pricingJob.conditionMode)}</span></div>
        <div className={styles.pricingItems}>{pricingJob.items.map((item) => <article key={item.id}>
          <div className={styles.pricingItemHead}><div><b>{item.part.sku}</b><span>{item.part.partName || item.queryPartNumber} · {item.condition}</span></div><span className={styles.jobStatus}>{humanStatus(item.status)}</span></div>
          {item.status === "COMPLETED" ? <><div className={styles.priceMetrics}><span>Matches <b>{item.competitorCount}</b></span><span>Lowest <b>{money(item.lowest!, item.currency!)}</b></span><span>Median <b>{money(item.median!, item.currency!)}</b></span><span>Recommended <b>{money(item.recommendedPrice!, item.currency!)}</b></span></div><details><summary>View {item.listings.length} competitor listings</summary><div className={styles.competitors}>{item.listings.map((listing) => <a key={listing.id} href={listing.url} target="_blank" rel="noreferrer"><span><b>{listing.title}</b><small>Listing ID: {listing.listingId} · {listing.seller} · {listing.condition}</small></span><strong>{money(listing.landedPrice, listing.currency)}</strong></a>)}</div></details></> : item.status === "NO_MATCHES" ? <p>No exact item-specific competitor matches found.</p> : item.status === "FAILED" ? <p className={styles.itemError}>{item.error || "Pricing failed"}</p> : <p>Searching eBay and verifying exact item specifics...</p>}
        </article>)}</div>
      </section>}
      <section className={styles.catalogPanel}>
        <div className={styles.panelTitle}><div><span className={styles.eyebrow}>CATALOG RECORDS</span><h2>{catalog.pagination.total} matching parts</h2></div><div className={styles.viewToggle}><button className={view === "table" ? styles.viewActive : ""} onClick={() => setView("table")}>Table</button><button className={view === "gallery" ? styles.viewActive : ""} onClick={() => setView("gallery")}>Gallery</button></div></div>
        <div className={styles.filters}>
          <label className={styles.searchBox}><span>Search</span><input value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="SKU, part number, title or VIN"/></label>
          <label><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{humanStatus(value)}</option>)}</select></label>
          <label><span>Condition</span><select value={condition} onChange={(event) => { setCondition(event.target.value); resetPage(); }}><option value="">Any condition</option><option value="NEW">New</option><option value="USED">Used</option></select></label>
          <label><span>Images</span><select value={hasImages} onChange={(event) => { setHasImages(event.target.value); resetPage(); }}><option value="">Any</option><option value="true">Has images</option><option value="false">Needs images</option></select></label>
          <label><span>Warehouse</span><select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); resetPage(); }}><option value="">All locations</option>{catalog.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code}</option>)}</select></label>
          <label><span>Created from</span><input type="date" value={createdFrom} onChange={(event) => { setCreatedFrom(event.target.value); resetPage(); }}/></label>
          <label><span>Created to</span><input type="date" value={createdTo} onChange={(event) => { setCreatedTo(event.target.value); resetPage(); }}/></label>
          <label><span>Sort</span><select value={sort} onChange={(event) => { setSort(event.target.value); resetPage(); }}><option value="newest">Newest first</option><option value="updated">Recently updated</option><option value="sku">SKU A-Z</option><option value="oldest">Oldest first</option></select></label>
        </div>
        {selected.size > 0 && <div className={styles.bulkBar}><b>{selected.size} selected</b><span>{selected.size > 25 ? "Pricing supports up to 25 parts per job." : "Selection can continue across result pages."}</span><select aria-label="Pricing marketplace" value={pricingMarketplace} onChange={(event) => setPricingMarketplace(event.target.value)}><option value="EBAY_US">eBay US</option><option value="EBAY_GB">eBay UK</option><option value="EBAY_DE">eBay Germany</option></select><select aria-label="Pricing condition" value={pricingCondition} onChange={(event) => setPricingCondition(event.target.value as PricingConditionMode)}><option value="MATCH_PART">Match each part</option><option value="ANY">Any condition</option><option value="NEW">New only</option><option value="USED">Used only</option></select><button className={styles.priceButton} disabled={selected.size > 25 || pricingBusy || Boolean(pricingJob && ["QUEUED", "RUNNING"].includes(pricingJob.status))} onClick={() => void priceSelected()}>{selected.size > 25 ? "Maximum 25" : pricingBusy ? "Starting..." : "Price selected"}</button><button onClick={() => void archiveSelected()}>Archive</button><button onClick={() => setSelected(new Set())}>Clear</button></div>}
        {loading ? <div className={styles.loadingRows}>Refreshing catalog...</div> : catalog.parts.length === 0 ? <div className={styles.empty}><b>No parts found</b><span>Adjust your filters or confirm a catalog import.</span></div> : view === "table" ?
          <div className={styles.tableWrap}><table><thead><tr><th><input aria-label="Select current page" type="checkbox" checked={allPageSelected} onChange={togglePage}/></th><th>Part</th><th>SKU / OEM</th><th>Status</th><th>Condition</th><th>Market</th><th>Location</th><th>Qty</th><th>Cost</th><th/></tr></thead><tbody>{catalog.parts.map((part) => { const latestPrice = part.pricingJobItems[0]; return <tr key={part.id}><td><input aria-label={`Select ${part.sku}`} type="checkbox" checked={selected.has(part.id)} onChange={() => togglePart(part.id)}/></td><td><div className={styles.partCell}><CatalogImage mediaId={part.media[0]?.mediaAsset.id} token={token} demo={demo}/><div><b>{part.partName || "Unnamed automotive part"}</b><span>{part.brand || "Brand not set"} · {part._count.media} image{part._count.media === 1 ? "" : "s"}</span></div></div></td><td><b className={styles.mono}>{part.sku}</b><span className={styles.subtle}>{part.primaryPartNumber}</span></td><td><span className={`${styles.statusPill} ${styles[part.status.toLowerCase()]}`}>{humanStatus(part.status)}</span></td><td><span className={styles.condition}>{part.condition}</span></td><td>{latestPrice?.recommendedPrice != null ? <><b>{money(latestPrice.recommendedPrice, latestPrice.currency!)}</b><span className={styles.subtle}>{latestPrice.competitorCount} matches</span></> : <span className={styles.subtle}>{latestPrice ? "No matches" : "Not priced"}</span>}</td><td>{part.inventoryItem?.warehouse?.code || "—"}<span className={styles.subtle}>{part.inventoryItem?.binLocation?.code || "Unassigned"}</span></td><td>{part.inventoryItem?.quantity ?? 0}</td><td>{part.inventoryItem ? money(part.inventoryItem.cost, part.inventoryItem.currency) : "—"}</td><td><button className={styles.editButton} onClick={() => void openPart(part.id)}>Edit</button></td></tr>; })}</tbody></table></div> :
          <div className={styles.gallery}>{catalog.parts.map((part) => <article key={part.id} className={styles.partCard}><button className={styles.cardSelect} aria-label={`Select ${part.sku}`} onClick={() => togglePart(part.id)}>{selected.has(part.id) ? "✓" : "+"}</button><CatalogImage mediaId={part.media[0]?.mediaAsset.id} token={token} demo={demo}/><span className={`${styles.statusPill} ${styles[part.status.toLowerCase()]}`}>{humanStatus(part.status)}</span><h3>{part.partName || "Unnamed automotive part"}</h3><p>{part.brand || "Brand not set"} · {part.condition}</p><div><b>{part.sku}</b><span>{part.primaryPartNumber}</span></div><footer><span>{part.inventoryItem?.quantity ?? 0} in stock</span><button onClick={() => void openPart(part.id)}>Edit part</button></footer></article>)}</div>}
        <div className={styles.pagination}><span>Page {catalog.pagination.page} of {Math.max(catalog.pagination.totalPages, 1)}</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button disabled={page >= catalog.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
      </section>
    </section>
    {detail && <div className={styles.modalBackdrop} role="presentation"><section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="edit-part-title"><header><div><span className={styles.eyebrow}>CATALOG EDITOR</span><h2 id="edit-part-title">Edit {detail.sku}</h2></div><button aria-label="Close editor" onClick={() => setDetail(null)}>×</button></header><form onSubmit={savePart}><div className={styles.formGrid}><label><span>SKU</span><input name="sku" defaultValue={detail.sku} required/></label><label><span>Primary part number</span><input name="primaryPartNumber" defaultValue={detail.primaryPartNumber} required/></label><label><span>Brand</span><input name="brand" defaultValue={detail.brand ?? ""}/></label><label><span>Part name</span><input name="partName" defaultValue={detail.partName ?? ""}/></label><label><span>Condition</span><select name="condition" defaultValue={detail.condition}><option value="NEW">New</option><option value="USED">Used</option></select></label><label><span>Catalog status</span><select name="status" defaultValue={detail.status}>{statuses.map((value) => <option key={value} value={value}>{humanStatus(value)}</option>)}</select></label><label><span>Quantity</span><input name="quantity" type="number" min="0" defaultValue={detail.inventoryItem?.quantity ?? 0}/></label><label><span>Cost</span><input name="cost" type="number" min="0" step="0.01" defaultValue={Number(detail.inventoryItem?.cost ?? 0)}/></label><label><span>Currency</span><input name="currency" maxLength={3} defaultValue={detail.inventoryItem?.currency ?? "USD"}/></label><label><span>Warehouse</span><input name="warehouseCode" defaultValue={detail.inventoryItem?.warehouse?.code ?? ""}/></label><label><span>Bin location</span><input name="binLocation" defaultValue={detail.inventoryItem?.binLocation?.code ?? ""}/></label><label><span>Placement</span><input name="placement" defaultValue={detail.placement ?? ""}/></label><label><span>Weight</span><input name="weight" type="number" min="0" step="0.001" defaultValue={detail.inventoryItem?.weight == null ? "" : Number(detail.inventoryItem.weight)}/></label><label><span>Weight unit</span><select name="weightUnit" defaultValue={detail.inventoryItem?.weightUnit ?? "LB"}><option value="LB">lb</option><option value="KG">kg</option></select></label><label><span>Length</span><input name="length" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.length == null ? "" : Number(detail.inventoryItem.length)}/></label><label><span>Width</span><input name="width" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.width == null ? "" : Number(detail.inventoryItem.width)}/></label><label><span>Height</span><input name="height" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.height == null ? "" : Number(detail.inventoryItem.height)}/></label><label><span>Dimension unit</span><select name="dimensionUnit" defaultValue={detail.inventoryItem?.dimensionUnit ?? "IN"}><option value="IN">in</option><option value="CM">cm</option></select></label><label className={styles.wide}><span>Description</span><textarea name="description" defaultValue={detail.description ?? ""}/></label><label className={styles.wide}><span>Internal notes</span><textarea name="notes" defaultValue={detail.notes ?? ""}/></label></div><div className={styles.formActions}><button type="button" onClick={() => setDetail(null)}>Cancel</button><button className={styles.primary} disabled={saving}>{saving ? "Saving..." : demo ? "Close preview" : "Save changes"}</button></div></form></section></div>}
  </main>;
}
