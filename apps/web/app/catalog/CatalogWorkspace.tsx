"use client";

import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import styles from "./catalog.module.css";
import type { CatalogPartCard, CatalogPartDetail, CatalogResponse, CatalogStatus, EbayAspectRequirement, EbayConditionOption, EbayConnection, EbayInventorySyncJob, EbayListingOperationJob, EbayOffer, EbayOfferJob, EbaySellerResources, FitmentJob, FitmentJobSummary, InventoryPreparation, InventoryPreparationJob, ListingDraft, LiveDraftValidation, PartCondition, PricingConditionMode, PricingJob, PricingJobSummary, PricingRule } from "./types";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const statuses: CatalogStatus[] = ["IMPORTED", "NEEDS_IMAGES", "IMPORT_ERROR", "READY_FOR_ENRICHMENT", "ARCHIVED"];
const emptyCatalog: CatalogResponse = { parts: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 }, summary: { total: 0, byStatus: {} }, warehouses: [] };

const demoParts: CatalogPartCard[] = [
  { id: "demo-1", sku: "GM-84178783-A", primaryPartNumber: "84178783", brand: "ACDelco", partName: "HVAC Blower Motor Control Module", condition: "USED", status: "READY_FOR_ENRICHMENT", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), donorVehicle: { vin: "1GNEK13Z43R000001", year: 2021, make: "Chevrolet", model: "Traverse" }, inventoryItem: { quantity: 1, cost: 28, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b1", code: "A-14" } }, media: [], pricingJobItems: [], fitmentJobItems: [], _count: { media: 4 } },
  { id: "demo-2", sku: "AUD-8K0615301M", primaryPartNumber: "8K0615301M", brand: "Audi", partName: "Rear Brake Caliper", condition: "USED", status: "NEEDS_IMAGES", createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(), donorVehicle: { vin: "WAUZZZ8K9DA000001", year: 2013, make: "Audi", model: "A4" }, inventoryItem: { quantity: 2, cost: 46.5, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b2", code: "C-08" } }, media: [], pricingJobItems: [], fitmentJobItems: [], _count: { media: 0 } },
  { id: "demo-3", sku: "BMW-64119355981", primaryPartNumber: "64119355981", brand: "BMW", partName: "Air Conditioning Control Panel", condition: "USED", status: "IMPORTED", createdAt: new Date(Date.now() - 172800000).toISOString(), updatedAt: new Date().toISOString(), donorVehicle: null, inventoryItem: { quantity: 1, cost: 65, currency: "USD", warehouse: null, binLocation: null }, media: [], pricingJobItems: [], fitmentJobItems: [], _count: { media: 2 } },
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
  const [notice, setNotice] = useState("");
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
  const [pricingRule, setPricingRule] = useState<PricingRule | null>(null);
  const [pricingRuleBusy, setPricingRuleBusy] = useState(false);
  const [fitmentJob, setFitmentJob] = useState<FitmentJob | null>(null);
  const [fitmentBusy, setFitmentBusy] = useState(false);
  const [latestFitmentLoaded, setLatestFitmentLoaded] = useState(false);
  const [ebayConnection, setEbayConnection] = useState<EbayConnection>({ connected: false, status: "NOT_CONNECTED" });
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [drafts, setDrafts] = useState<ListingDraft[]>([]);
  const [draftDetail, setDraftDetail] = useState<ListingDraft | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [sellerResources, setSellerResources] = useState<EbaySellerResources | null>(null);
  const [categoryAspects, setCategoryAspects] = useState<EbayAspectRequirement[]>([]);
  const [categoryConditions, setCategoryConditions] = useState<EbayConditionOption[]>([]);
  const [inventoryPreparation, setInventoryPreparation] = useState<InventoryPreparation | null>(null);
  const [inventoryPreparationJob, setInventoryPreparationJob] = useState<InventoryPreparationJob | null>(null);
  const [inventorySyncJob, setInventorySyncJob] = useState<EbayInventorySyncJob | null>(null);
  const [ebayOffer, setEbayOffer] = useState<EbayOffer | null>(null);
  const [ebayOfferJob, setEbayOfferJob] = useState<EbayOfferJob | null>(null);
  const [listingOperationJob, setListingOperationJob] = useState<EbayListingOperationJob | null>(null);

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

  useEffect(() => {
    if (authState !== "ready" || demo) return;
    const result = new URLSearchParams(window.location.search).get("ebay");
    if (result) {
      setNotice(result === "connected" ? "eBay seller account connected successfully." : result === "declined" ? "eBay authorization was cancelled." : "eBay connection could not be completed. Please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    request("/api/ebay/connection").then((value) => setEbayConnection(value as EbayConnection)).catch(() => undefined);
  }, [authState, demo, request]);

  useEffect(() => {
    if (authState !== "ready" || demo) return;
    request("/api/listing-drafts?limit=25")
      .then((value) => setDrafts(value as ListingDraft[]))
      .catch(() => undefined);
    request("/api/pricing/rule")
      .then((value) => setPricingRule(value as PricingRule))
      .catch(() => undefined);
  }, [authState, demo, request]);

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

  useEffect(() => {
    if (authState !== "ready" || demo || latestFitmentLoaded) return;
    setLatestFitmentLoaded(true);
    request("/api/fitment/jobs?limit=1")
      .then(async (jobs) => {
        const latest = (jobs as FitmentJobSummary[])[0];
        if (latest) setFitmentJob(await request(`/api/fitment/jobs/${latest.id}`) as FitmentJob);
      })
      .catch(() => undefined);
  }, [authState, demo, latestFitmentLoaded, request]);

  useEffect(() => {
    if (!fitmentJob || !["QUEUED", "RUNNING"].includes(fitmentJob.status) || demo) return;
    const timer = window.setTimeout(() => {
      request(`/api/fitment/jobs/${fitmentJob.id}`)
        .then((job) => setFitmentJob(job as FitmentJob))
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to refresh fitment job"));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [demo, fitmentJob, request]);

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

  async function savePricingRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo || pricingRuleBusy) return;
    const form = new FormData(event.currentTarget);
    setPricingRuleBusy(true); setError(""); setNotice("");
    try {
      setPricingRule(await request("/api/pricing/rule", {
        method: "PUT",
        body: JSON.stringify({
          marketAdjustmentPercent: Number(form.get("marketAdjustmentPercent")),
          minimumMarginPercent: Number(form.get("minimumMarginPercent")),
          minimumProfitAmount: Number(form.get("minimumProfitAmount")),
          requireApproval: form.get("requireApproval") === "on",
        }),
      }) as PricingRule);
      setNotice("Pricing governance rule updated. It applies to future pricing proposals.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update pricing rule"); }
    finally { setPricingRuleBusy(false); }
  }

  async function decidePrice(proposalId: string, action: "APPROVE" | "REJECT" | "OVERRIDE") {
    if (demo || pricingBusy) return;
    let reason: string | undefined;
    let overridePrice: number | undefined;
    if (action === "REJECT") {
      reason = window.prompt("Why are you rejecting this price?")?.trim();
      if (!reason) return;
    }
    if (action === "OVERRIDE") {
      const entered = window.prompt("Enter the approved override price:");
      if (!entered) return;
      overridePrice = Number(entered);
      if (!Number.isFinite(overridePrice) || overridePrice <= 0) { setError("Enter a valid positive override price."); return; }
      reason = window.prompt("Give a reason for this override:")?.trim();
      if (!reason) return;
    }
    setPricingBusy(true); setError("");
    try {
      await request(`/api/pricing/proposals/${proposalId}/decision`, {
        method: "POST",
        body: JSON.stringify({ action, ...(overridePrice ? { overridePrice } : {}), ...(reason ? { reason } : {}) }),
      });
      setPricingJob(await request(`/api/pricing/jobs/${pricingJob!.id}`) as PricingJob);
      setNotice(action === "APPROVE" ? "Price approved for listing preparation." : action === "REJECT" ? "Price proposal rejected." : "Price override recorded with audit evidence.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to decide pricing proposal"); }
    finally { setPricingBusy(false); }
  }

  async function findFitment() {
    if (!selected.size || selected.size > 10 || demo || fitmentBusy) return;
    setFitmentBusy(true);
    setError("");
    try {
      const job = await request("/api/fitment/jobs", {
        method: "POST", body: JSON.stringify({ partIds: [...selected], marketplace: pricingMarketplace }),
      }) as FitmentJob;
      setFitmentJob(job);
      setSelected(new Set());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start fitment discovery"); }
    finally { setFitmentBusy(false); }
  }

  async function approveCandidate(itemId: string, candidateId: string) {
    if (demo || fitmentBusy) return;
    setFitmentBusy(true);
    setError("");
    try {
      setFitmentJob(await request(`/api/fitment/items/${itemId}/approve`, {
        method: "POST", body: JSON.stringify({ candidateId }),
      }) as FitmentJob);
      await loadCatalog();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to approve fitment candidate"); }
    finally { setFitmentBusy(false); }
  }

  async function createDrafts() {
    if (!selected.size || selected.size > 25 || demo || draftBusy) return;
    setDraftBusy(true); setError(""); setNotice("");
    try {
      const created = await request("/api/listing-drafts", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ partIds: [...selected], marketplace: pricingMarketplace }),
      }) as ListingDraft[];
      setDrafts((current) => [...created, ...current.filter((draft) => !created.some(({ id }) => id === draft.id))].slice(0, 25));
      setSelected(new Set());
      setNotice(`${created.length} listing draft${created.length === 1 ? "" : "s"} prepared. Resolve readiness blockers before publishing.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create listing drafts"); }
    finally { setDraftBusy(false); }
  }

  async function openDraft(id: string) {
    setError("");
    setCategoryAspects([]);
    setCategoryConditions([]);
    setInventoryPreparation(null);
    setInventoryPreparationJob(null);
    setInventorySyncJob(null);
    setEbayOffer(null);
    setEbayOfferJob(null);
    setListingOperationJob(null);
    try {
      const draft = await request(`/api/listing-drafts/${id}`) as ListingDraft;
      setDraftDetail(draft);
      setSellerResources(await request(`/api/ebay/resources?marketplace=${encodeURIComponent(draft.marketplace)}`) as EbaySellerResources);
      request(`/api/listing-drafts/${id}/inventory-preparation`)
        .then((value) => setInventoryPreparation(value as InventoryPreparation))
        .catch(() => undefined);
      request(`/api/listing-drafts/${id}/inventory-sync`)
        .then((value) => setInventorySyncJob(value as EbayInventorySyncJob))
        .catch(() => undefined);
      request(`/api/listing-drafts/${id}/ebay-offer`)
        .then((value) => setEbayOffer(value as EbayOffer))
        .catch(() => undefined);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to open listing draft"); }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftDetail || demo || draftBusy) return;
    const form = new FormData(event.currentTarget);
    const aspects = { ...draftDetail.aspects };
    categoryAspects.forEach((requirement, index) => {
      const value = String(form.get(`aspect-${index}`) ?? "").trim();
      if (value) aspects[requirement.name] = requirement.cardinality === "MULTI" ? value.split("|").map((item) => item.trim()).filter(Boolean) : [value];
      else delete aspects[requirement.name];
    });
    const body = {
      expectedVersion: draftDetail.version,
      reason: "Listing editor update",
      title: String(form.get("title")),
      description: String(form.get("description")) || null,
      categoryId: String(form.get("categoryId")) || null,
      condition: form.get("condition") as PartCondition,
      ebayCondition: String(form.get("ebayCondition")) || null,
      price: form.get("price") === "" ? null : Number(form.get("price")),
      currency: String(form.get("currency")).toUpperCase(),
      quantity: Number(form.get("quantity")),
      paymentPolicyId: String(form.get("paymentPolicyId")) || null,
      returnPolicyId: String(form.get("returnPolicyId")) || null,
      shippingPolicyId: String(form.get("shippingPolicyId")) || null,
      merchantLocationKey: String(form.get("merchantLocationKey")) || null,
      aspects,
    };
    setDraftBusy(true); setError("");
    try {
      const updated = await request(`/api/listing-drafts/${draftDetail.id}`, { method: "PATCH", body: JSON.stringify(body) }) as ListingDraft;
      setDraftDetail(updated);
      setInventoryPreparation(null);
      setInventoryPreparationJob(null);
      setInventorySyncJob(null);
      setEbayOffer((current) => current && ["PUBLISHED", "DRIFTED", "WITHDRAWN"].includes(current.status) ? current : null);
      setEbayOfferJob(null);
      setListingOperationJob(null);
      setDrafts((current) => current.map((draft) => draft.id === updated.id ? updated : draft));
      setNotice(updated.status === "READY" ? "Draft is ready for the future publish step." : "Draft saved. Review the remaining blockers.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save listing draft"); }
    finally { setDraftBusy(false); }
  }

  async function syncResources() {
    if (!draftDetail || demo || draftBusy) return;
    setDraftBusy(true); setError("");
    try {
      setSellerResources(await request("/api/ebay/resources/sync", {
        method: "POST", body: JSON.stringify({ marketplace: draftDetail.marketplace }),
      }) as EbaySellerResources);
      setNotice("eBay business policies and inventory locations refreshed.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to refresh eBay seller resources"); }
    finally { setDraftBusy(false); }
  }

  async function validateDraftLive() {
    if (!draftDetail || demo || draftBusy) return;
    setDraftBusy(true); setError("");
    try {
      const result = await request(`/api/listing-drafts/${draftDetail.id}/validate-live`, {
        method: "POST", body: JSON.stringify({ expectedVersion: draftDetail.version }),
      }) as LiveDraftValidation;
      setDraftDetail(result.draft);
      setInventoryPreparation(null);
      setInventoryPreparationJob(null);
      setInventorySyncJob(null);
      setEbayOffer((current) => current && ["PUBLISHED", "DRIFTED", "WITHDRAWN"].includes(current.status) ? current : null);
      setEbayOfferJob(null);
      setListingOperationJob(null);
      setDrafts((current) => current.map((draft) => draft.id === result.draft.id ? result.draft : draft));
      setSellerResources(result.resources);
      setCategoryAspects(result.categoryMetadata.aspects);
      setCategoryConditions(result.categoryMetadata.conditions);
      setNotice(result.draft.status === "READY" ? "Draft passed live eBay validation." : "Live eBay metadata loaded. Resolve the displayed blockers and validate again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to validate with eBay"); }
    finally { setDraftBusy(false); }
  }

  async function prepareInventoryPreview() {
    if (!draftDetail || demo || draftBusy) return;
    setDraftBusy(true); setError("");
    try {
      const job = await request(`/api/listing-drafts/${draftDetail.id}/prepare-inventory`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: draftDetail.version }),
      }) as InventoryPreparationJob;
      setInventoryPreparationJob(job);
      if (job.preparation) setInventoryPreparation(job.preparation);
      setNotice("Inventory preparation was queued. The worker will stage approved images and build the preview; nothing will be listed.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to prepare eBay inventory preview"); }
    finally { setDraftBusy(false); }
  }

  useEffect(() => {
    if (!inventoryPreparationJob || !["QUEUED", "RUNNING"].includes(inventoryPreparationJob.status) || demo) return;
    const timer = window.setTimeout(() => {
      request(`/api/inventory-preparation-jobs/${inventoryPreparationJob.id}`)
        .then((value) => {
          const job = value as InventoryPreparationJob;
          setInventoryPreparationJob(job);
          if (job.preparation) {
            setInventoryPreparation(job.preparation);
            setNotice("Approved images are staged on eBay and the Inventory API payload preview is ready. Nothing has been listed.");
          } else if (job.status === "FAILED") {
            setError(job.lastError ?? "Inventory preparation failed");
          }
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to refresh inventory preparation"));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [demo, inventoryPreparationJob, request]);

  async function applyInventoryToEbay() {
    if (!inventoryPreparation || !draftDetail || demo || draftBusy || inventoryPreparation.draftVersion !== draftDetail.version) return;
    const impact = ebayOffer?.publishedAt
      ? "This SKU is already used by a published listing. The inventory and compatibility records will be replaced now; the offer-level revision remains a separate approval."
      : "This does not create or publish an offer.";
    if (!window.confirm(`This will create or replace this SKU and its compatibility data in the connected eBay seller inventory.\n\n${impact}\n\nContinue?`)) return;
    setDraftBusy(true); setError("");
    try {
      const job = await request(`/api/inventory-preparations/${inventoryPreparation.id}/apply`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ confirmInventoryWrite: true }),
      }) as EbayInventorySyncJob;
      setInventorySyncJob(job);
      setNotice("The eBay inventory write was queued. This does not publish a listing.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to write eBay inventory"); }
    finally { setDraftBusy(false); }
  }

  useEffect(() => {
    if (!inventorySyncJob || !["QUEUED", "RUNNING"].includes(inventorySyncJob.status) || demo) return;
    const timer = window.setTimeout(() => {
      request(`/api/ebay/inventory-sync-jobs/${inventorySyncJob.id}`)
        .then((value) => {
          const job = value as EbayInventorySyncJob;
          setInventorySyncJob(job);
          if (job.status === "COMPLETED") setNotice(`SKU ${job.sku} and compatibility were written to eBay inventory. It is not published.`);
          else if (job.status === "FAILED") setError(job.lastError ?? "eBay inventory write failed");
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to refresh eBay inventory sync"));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [demo, inventorySyncJob, request]);

  async function prepareEbayOffer() {
    if (!inventorySyncJob || inventorySyncJob.status !== "COMPLETED" || demo || draftBusy) return;
    setDraftBusy(true); setError("");
    try {
      const job = await request(`/api/ebay/inventory-sync-jobs/${inventorySyncJob.id}/offer`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({}),
      }) as EbayOfferJob;
      setEbayOfferJob(job);
      setEbayOffer(job.ebayOffer);
      setNotice("Unpublished eBay offer preparation and fee preview were queued. Nothing has been published.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to prepare eBay offer"); }
    finally { setDraftBusy(false); }
  }

  async function publishEbayOffer() {
    if (!ebayOffer || ebayOffer.status !== "FEES_READY" || demo || draftBusy) return;
    const fee = ebayOffer.feeTotal == null ? "eBay returned no charge total" : `${money(ebayOffer.feeTotal, ebayOffer.feeCurrency ?? draftDetail?.currency ?? "USD")} expected listing fees`;
    if (!window.confirm(`Publish SKU ${ebayOffer.sku} as a live eBay listing now?\n\n${fee}\n\nThis action makes the item visible and purchasable on eBay.`)) return;
    setDraftBusy(true); setError("");
    try {
      const job = await request(`/api/ebay/offers/${ebayOffer.id}/publish`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ confirmPublish: true, confirmation: "PUBLISH" }),
      }) as EbayOfferJob;
      setEbayOfferJob(job);
      setEbayOffer(job.ebayOffer);
      setNotice("Publication was explicitly approved and queued.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to publish eBay offer"); }
    finally { setDraftBusy(false); }
  }

  useEffect(() => {
    if (!ebayOfferJob || !["QUEUED", "RUNNING"].includes(ebayOfferJob.status) || demo) return;
    const timer = window.setTimeout(() => {
      request(`/api/ebay/offer-jobs/${ebayOfferJob.id}`)
        .then((value) => {
          const job = value as EbayOfferJob;
          setEbayOfferJob(job);
          setEbayOffer(job.ebayOffer);
          if (job.status === "COMPLETED" && job.action === "PREPARE") setNotice("Unpublished offer is ready. Review the expected fees before publishing.");
          else if (job.status === "COMPLETED" && job.action === "PUBLISH") setNotice(`eBay listing ${job.ebayOffer.ebayListingId} is live.`);
          else if (job.status === "FAILED") setError(job.lastError ?? "eBay offer operation failed");
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to refresh eBay offer job"));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [demo, ebayOfferJob, request]);

  async function reviseLiveListing() {
    if (!ebayOffer || ebayOffer.status !== "PUBLISHED" || !inventorySyncJob || inventorySyncJob.status !== "COMPLETED" || demo || draftBusy) return;
    if (!window.confirm(`Revise live eBay listing ${ebayOffer.ebayListingId} to draft version ${inventorySyncJob.draftVersion} now?\n\nThe current inventory, compatibility, price, quantity, policies, and offer settings will replace the live listing immediately.`)) return;
    setDraftBusy(true); setError("");
    try {
      const job = await request(`/api/ebay/offers/${ebayOffer.id}/revise`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ inventorySyncJobId: inventorySyncJob.id, confirmRevision: true, confirmation: "REVISE" }),
      }) as EbayListingOperationJob;
      setListingOperationJob(job);
      setEbayOffer(job.ebayOffer);
      setNotice("The live listing revision was explicitly approved and queued.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to revise live listing"); }
    finally { setDraftBusy(false); }
  }

  async function withdrawLiveListing() {
    if (!ebayOffer || !["PUBLISHED", "DRIFTED"].includes(ebayOffer.status) || demo || draftBusy) return;
    if (!window.confirm(`Withdraw eBay listing ${ebayOffer.ebayListingId} now?\n\nThis ends the active listing. The eBay offer is retained as unpublished for a future controlled relist workflow.`)) return;
    setDraftBusy(true); setError("");
    try {
      const job = await request(`/api/ebay/offers/${ebayOffer.id}/withdraw`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ confirmWithdraw: true, confirmation: "WITHDRAW" }),
      }) as EbayListingOperationJob;
      setListingOperationJob(job);
      setEbayOffer(job.ebayOffer);
      setNotice("Listing withdrawal was explicitly approved and queued.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to withdraw live listing"); }
    finally { setDraftBusy(false); }
  }

  async function reconcileLiveListing() {
    if (!ebayOffer?.ebayOfferId || demo || draftBusy) return;
    setDraftBusy(true); setError("");
    try {
      const job = await request(`/api/ebay/offers/${ebayOffer.id}/reconcile`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({}),
      }) as EbayListingOperationJob;
      setListingOperationJob(job);
      setNotice("Remote eBay offer reconciliation was queued.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to reconcile eBay listing"); }
    finally { setDraftBusy(false); }
  }

  useEffect(() => {
    if (!listingOperationJob || !["QUEUED", "RUNNING"].includes(listingOperationJob.status) || demo) return;
    const timer = window.setTimeout(() => {
      request(`/api/ebay/listing-operation-jobs/${listingOperationJob.id}`)
        .then((value) => {
          const job = value as EbayListingOperationJob;
          setListingOperationJob(job);
          setEbayOffer(job.ebayOffer);
          if (job.status === "COMPLETED" && job.action === "REVISE") setNotice(`Live listing revised to draft version ${job.targetDraftVersion}.`);
          else if (job.status === "COMPLETED" && job.action === "WITHDRAW") setNotice("The eBay listing is withdrawn and its offer is retained.");
          else if (job.status === "COMPLETED" && job.action === "RECONCILE") setNotice(job.driftIssues?.length ? `Reconciliation found ${job.driftIssues.length} differences.` : "Local listing state matches eBay.");
          else if (job.status === "FAILED") setError(job.lastError ?? "eBay listing operation failed");
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to refresh eBay listing operation"));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [demo, listingOperationJob, request]);

  async function connectEbay() {
    if (demo || connectionBusy) return;
    setConnectionBusy(true); setError("");
    try {
      const response = await request("/api/ebay/connection/authorize", { method: "POST" }) as { authorizationUrl: string };
      window.location.assign(response.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start eBay authorization");
      setConnectionBusy(false);
    }
  }

  async function disconnectEbay() {
    if (demo || connectionBusy || !window.confirm("Disconnect this eBay seller account? Publishing access will stop until it is reconnected.")) return;
    setConnectionBusy(true); setError(""); setNotice("");
    try {
      setEbayConnection(await request("/api/ebay/connection", { method: "DELETE" }) as EbayConnection);
      setNotice("eBay seller account disconnected and stored tokens removed.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to disconnect eBay"); }
    finally { setConnectionBusy(false); }
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

  async function logout() {
    if (demo) {
      window.location.assign("/login");
      return;
    }
    await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setToken("");
    window.location.assign("/login");
  }

  if (authState === "loading") return <main className={styles.authScreen}><div className={styles.loader}/><p>Opening your catalog workspace...</p></main>;
  if (authState === "required") return <main className={styles.authScreen}><section className={styles.authCard}><span className={styles.eyebrow}>PARTPULSE WORKSPACE</span><h1>Catalog access required</h1><p>Your secure session is unavailable. Sign in, or use a short-lived access token during development.</p><a href="/login">Sign in to PartPulse</a><form onSubmit={connectToken}><label htmlFor="access-token">Development access token</label><textarea id="access-token" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} required/><button>Open catalog</button></form>{error && <div className={styles.error}>{error}</div>}<a href="/">Return to pricing search</a></section></main>;

  const ready = catalog.summary.byStatus.READY_FOR_ENRICHMENT ?? 0;
  const needsImages = catalog.summary.byStatus.NEEDS_IMAGES ?? 0;
  const imported = catalog.summary.byStatus.IMPORTED ?? 0;
  const allPageSelected = catalog.parts.length > 0 && catalog.parts.every(({ id }) => selected.has(id));

  return <main className={styles.shell}>
    <aside className={styles.sidebar}><a className={styles.brand} href="/"><b>Part</b>Pulse<span>Automotive operations</span></a><nav><a className={styles.active} href="/catalog"><span>01</span>Catalog</a><a href="/"><span>02</span>Market pricing</a><a href="#fitment-workflow"><span>03</span>Fitment</a><a href="#listing-drafts"><span>04</span>Publishing</a><a href="/admin"><span>05</span>Admin</a><a href="/account/security"><span>06</span>Account</a><button type="button" onClick={() => void logout()}><span>07</span>Sign out</button></nav><div className={styles.sideFoot}><i className={ebayConnection.connected ? styles.connectedDot : styles.disconnectedDot}/> {ebayConnection.connected ? "eBay connection active" : "eBay not connected"}</div></aside>
    <section className={styles.workspace}>
      <header className={styles.topbar}><div><span className={styles.eyebrow}>INVENTORY OPERATIONS</span><h1>Parts catalog</h1></div><div className={styles.topActions}><div className={styles.connectionStatus}><i className={ebayConnection.connected ? styles.connectedDot : styles.disconnectedDot}/><span>{ebayConnection.connected ? (ebayConnection.username || ebayConnection.ebayUserId || "eBay connected") : "Seller not connected"}</span>{ebayConnection.connected ? <button className={styles.secondary} disabled={connectionBusy} onClick={() => void disconnectEbay()}>Disconnect</button> : <button className={styles.primary} disabled={connectionBusy || demo} onClick={() => void connectEbay()}>{connectionBusy ? "Opening..." : "Connect eBay"}</button>}</div><button className={styles.secondary} onClick={() => void downloadCsv()}>Export CSV</button><button className={styles.primary} disabled>+ New import</button></div></header>
      {demo && <div className={styles.demoBanner}>Development preview - sample records are not saved.</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}
      <section className={styles.stats}>
        <article><span>Total parts</span><b>{catalog.summary.total}</b><small>Organization catalog</small></article>
        <article><span>Ready to enrich</span><b>{ready}</b><small>Pricing and fitment next</small></article>
        <article><span>Needs images</span><b>{needsImages}</b><small>Action required</small></article>
        <article><span>Newly imported</span><b>{imported}</b><small>Awaiting review</small></article>
      </section>
      {pricingRule && <section className={`${styles.pricingPanel} ${styles.rulePanel}`}>
        <header><div><span className={styles.eyebrow}>PRICING GOVERNANCE</span><h2>Cost floors and approval</h2></div><span className={styles.jobStatus}>{pricingRule.requireApproval ? "Human approval required" : "Automatic approval"}</span></header>
        <form key={pricingRule.updatedAt ?? "default"} onSubmit={savePricingRule}>
          <label><span>Market adjustment %</span><input name="marketAdjustmentPercent" type="number" min="-50" max="100" step="0.01" defaultValue={pricingRule.marketAdjustmentPercent}/></label>
          <label><span>Minimum margin %</span><input name="minimumMarginPercent" type="number" min="0" max="95" step="0.01" defaultValue={pricingRule.minimumMarginPercent}/></label>
          <label><span>Minimum profit</span><input name="minimumProfitAmount" type="number" min="0" step="0.01" defaultValue={pricingRule.minimumProfitAmount}/></label>
          <label className={styles.ruleCheck}><input name="requireApproval" type="checkbox" defaultChecked={pricingRule.requireApproval}/><span>Require approval before listing</span></label>
          <button className={styles.primary} disabled={pricingRuleBusy || demo}>{pricingRuleBusy ? "Saving..." : "Save rule"}</button>
        </form>
        <p>The price floor is the higher of minimum profit or minimum margin. Only owners/admins can approve a below-floor override.</p>
      </section>}
      {pricingJob && <section className={styles.pricingPanel}>
        <header><div><span className={styles.eyebrow}>BULK MARKET PRICING</span><h2>Job {pricingJob.id.slice(-8)}</h2></div><div><span className={`${styles.jobStatus} ${styles[`job_${pricingJob.status.toLowerCase()}`]}`}>{humanStatus(pricingJob.status)}</span><button onClick={() => setPricingJob(null)} aria-label="Hide pricing job">×</button></div></header>
        <div className={styles.jobProgress}><div><i style={{ width: `${Math.round(((pricingJob.completedItems + pricingJob.noMatchItems + pricingJob.failedItems) / pricingJob.totalItems) * 100)}%` }}/></div><span>{pricingJob.completedItems + pricingJob.noMatchItems + pricingJob.failedItems} of {pricingJob.totalItems} processed · {pricingJob.marketplace} · {humanStatus(pricingJob.conditionMode)}</span></div>
        <div className={styles.pricingItems}>{pricingJob.items.map((item) => <article key={item.id}>
          <div className={styles.pricingItemHead}><div><b>{item.part.sku}</b><span>{item.part.partName || item.queryPartNumber} · {item.condition}</span></div><span className={styles.jobStatus}>{humanStatus(item.status)}</span></div>
          {item.status === "COMPLETED" ? <><div className={styles.priceMetrics}><span>Matches <b>{item.competitorCount}</b></span><span>Lowest <b>{money(item.lowest!, item.currency!)}</b></span><span>Median <b>{money(item.median!, item.currency!)}</b></span><span>Recommended <b>{money(item.recommendedPrice!, item.currency!)}</b></span></div>
            {item.proposal && <div className={styles.proposalBox}>
              <div><span>Governed proposal</span><b>{money(item.proposal.proposedPrice, item.proposal.currency)}</b><small>Floor {item.proposal.floorPrice === null ? "unavailable" : money(item.proposal.floorPrice, item.proposal.currency)} · {humanStatus(item.proposal.status)}</small></div>
              {item.proposal.status === "PENDING" && item.proposal.floorPrice !== null ? <div><button disabled={pricingBusy} onClick={() => void decidePrice(item.proposal!.id, "APPROVE")}>Approve</button><button disabled={pricingBusy} onClick={() => void decidePrice(item.proposal!.id, "OVERRIDE")}>Override</button><button disabled={pricingBusy} onClick={() => void decidePrice(item.proposal!.id, "REJECT")}>Reject</button></div> : item.proposal.floorUnavailableReason ? <small>Update inventory cost/currency before approval: {humanStatus(item.proposal.floorUnavailableReason)}</small> : item.proposal.approvedPrice !== null ? <strong>Approved {money(item.proposal.approvedPrice, item.proposal.currency)}{item.proposal.belowFloor ? " · below-floor override" : ""}</strong> : null}
            </div>}
            <details><summary>View {item.listings.length} competitor listings</summary><div className={styles.competitors}>{item.listings.map((listing) => <a key={listing.id} href={listing.url} target="_blank" rel="noreferrer"><span><b>{listing.title}</b><small>Listing ID: {listing.listingId} · {listing.seller} · {listing.condition}</small></span><strong>{money(listing.landedPrice, listing.currency)}</strong></a>)}</div></details></> : item.status === "NO_MATCHES" ? <p>No exact item-specific competitor matches found.</p> : item.status === "FAILED" ? <p className={styles.itemError}>{item.error || "Pricing failed"}</p> : <p>Searching eBay and verifying exact item specifics...</p>}
        </article>)}</div>
      </section>}
      {fitmentJob && <section id="fitment-workflow" className={`${styles.pricingPanel} ${styles.fitmentPanel}`}>
        <header><div><span className={styles.eyebrow}>REVIEW-FIRST FITMENT</span><h2>Job {fitmentJob.id.slice(-8)}</h2></div><div><span className={`${styles.jobStatus} ${styles[`job_${fitmentJob.status.toLowerCase()}`]}`}>{humanStatus(fitmentJob.status)}</span><button onClick={() => setFitmentJob(null)} aria-label="Hide fitment job">×</button></div></header>
        <div className={styles.jobProgress}><div><i style={{ width: `${Math.round(((fitmentJob.items.filter(({ status: itemStatus }) => !["QUEUED", "RUNNING"].includes(itemStatus)).length) / fitmentJob.totalItems) * 100)}%` }}/></div><span>{fitmentJob.reviewedItems} approved · {fitmentJob.noCandidateItems} without candidates · {fitmentJob.marketplace}</span></div>
        <div className={styles.fitmentItems}>{fitmentJob.items.map((item) => <article key={item.id}>
          <div className={styles.pricingItemHead}><div><b>{item.part.sku}</b><span>{item.part.partName || item.part.primaryPartNumber}{item.categoryName ? ` · ${item.categoryName}` : ""}</span></div><span className={styles.jobStatus}>{humanStatus(item.status)}</span></div>
          {item.status === "REVIEW_REQUIRED" ? <div className={styles.candidateList}>{item.candidates.map((candidate) => <div key={candidate.id} className={styles.candidate}>
            <div><b>{candidate.title}</b><span>ePID {candidate.epid} · score {candidate.score}/100</span><small>{candidate.matchedOn.join(" · ") || "Weak catalog match"}</small></div>
            <button disabled={fitmentBusy} onClick={() => void approveCandidate(item.id, candidate.id)}>Approve &amp; import</button>
          </div>)}</div> : item.status === "APPROVED" ? <details><summary>{item.applicationCount} vehicle applications imported</summary><div className={styles.applicationList}>{item.applications.map((application) => <span key={application.id}>{Object.entries(application.properties).map(([name, value]) => `${name}: ${value}`).join(" · ")}</span>)}</div></details> : item.status === "NO_CANDIDATE" ? <p>No credible eBay catalog product candidate found. Keep this part for manual fitment.</p> : item.status === "FAILED" ? <p className={styles.itemError}>{item.error || "Fitment discovery failed"}</p> : <p>Searching eBay categories and catalog products...</p>}
        </article>)}</div>
      </section>}
      {drafts.length > 0 && <section id="listing-drafts" className={`${styles.pricingPanel} ${styles.draftPanel}`}>
        <header><div><span className={styles.eyebrow}>PUBLICATION READINESS</span><h2>Listing drafts</h2></div><span className={styles.draftSummary}>{drafts.filter(({ status: draftStatus }) => draftStatus === "READY").length} ready · {drafts.filter(({ status: draftStatus }) => draftStatus === "BLOCKED").length} blocked</span></header>
        <div className={styles.draftGrid}>{drafts.map((draft) => {
          const blockers = (draft.validationIssues ?? []).filter(({ severity }) => severity === "BLOCKER");
          const warnings = (draft.validationIssues ?? []).filter(({ severity }) => severity === "WARNING");
          return <article key={draft.id}><div><span className={`${styles.jobStatus} ${draft.status === "READY" ? styles.job_completed : styles.job_failed}`}>{humanStatus(draft.status)}</span><small>{draft.marketplace} · v{draft.version}</small></div><h3>{draft.title}</h3><p>{draft.part.sku} · {draft.part.primaryPartNumber}</p><div className={styles.readinessCounts}><b>{blockers.length} blockers</b><span>{warnings.length} warnings</span>{draft.price != null && <strong>{money(draft.price, draft.currency)}</strong>}</div>{blockers[0] && <small className={styles.firstBlocker}>{blockers[0].message}</small>}<button onClick={() => void openDraft(draft.id)}>Edit &amp; review</button></article>;
        })}</div>
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
        {selected.size > 0 && <div className={styles.bulkBar}><b>{selected.size} selected</b><span>{selected.size > 10 ? "Fitment supports 10; pricing and drafts support 25 parts." : "Selection can continue across result pages."}</span><select aria-label="eBay marketplace" value={pricingMarketplace} onChange={(event) => setPricingMarketplace(event.target.value)}><option value="EBAY_US">eBay US</option><option value="EBAY_GB">eBay UK</option><option value="EBAY_DE">eBay Germany</option></select><select aria-label="Pricing condition" value={pricingCondition} onChange={(event) => setPricingCondition(event.target.value as PricingConditionMode)}><option value="MATCH_PART">Match each part</option><option value="ANY">Any condition</option><option value="NEW">New only</option><option value="USED">Used only</option></select><button className={styles.priceButton} disabled={selected.size > 25 || pricingBusy || Boolean(pricingJob && ["QUEUED", "RUNNING"].includes(pricingJob.status))} onClick={() => void priceSelected()}>{selected.size > 25 ? "Maximum 25" : pricingBusy ? "Starting..." : "Price selected"}</button><button className={styles.fitmentButton} disabled={selected.size > 10 || fitmentBusy || Boolean(fitmentJob && ["QUEUED", "RUNNING"].includes(fitmentJob.status))} onClick={() => void findFitment()}>{selected.size > 10 ? "Maximum 10" : fitmentBusy ? "Working..." : "Find fitment"}</button><button className={styles.draftButton} disabled={selected.size > 25 || draftBusy} onClick={() => void createDrafts()}>{draftBusy ? "Preparing..." : "Create drafts"}</button><button onClick={() => void archiveSelected()}>Archive</button><button onClick={() => setSelected(new Set())}>Clear</button></div>}
        {loading ? <div className={styles.loadingRows}>Refreshing catalog...</div> : catalog.parts.length === 0 ? <div className={styles.empty}><b>No parts found</b><span>Adjust your filters or confirm a catalog import.</span></div> : view === "table" ?
          <div className={styles.tableWrap}><table><thead><tr><th><input aria-label="Select current page" type="checkbox" checked={allPageSelected} onChange={togglePage}/></th><th>Part</th><th>SKU / OEM</th><th>Status</th><th>Condition</th><th>Market</th><th>Location</th><th>Qty</th><th>Cost</th><th/></tr></thead><tbody>{catalog.parts.map((part) => { const latestPrice = part.pricingJobItems[0]; return <tr key={part.id}><td><input aria-label={`Select ${part.sku}`} type="checkbox" checked={selected.has(part.id)} onChange={() => togglePart(part.id)}/></td><td><div className={styles.partCell}><CatalogImage mediaId={part.media[0]?.mediaAsset.id} token={token} demo={demo}/><div><b>{part.partName || "Unnamed automotive part"}</b><span>{part.brand || "Brand not set"} · {part._count.media} image{part._count.media === 1 ? "" : "s"}</span></div></div></td><td><b className={styles.mono}>{part.sku}</b><span className={styles.subtle}>{part.primaryPartNumber}</span></td><td><span className={`${styles.statusPill} ${styles[part.status.toLowerCase()]}`}>{humanStatus(part.status)}</span></td><td><span className={styles.condition}>{part.condition}</span></td><td>{latestPrice?.recommendedPrice != null ? <><b>{money(latestPrice.recommendedPrice, latestPrice.currency!)}</b><span className={styles.subtle}>{latestPrice.competitorCount} matches</span></> : <span className={styles.subtle}>{latestPrice ? "No matches" : "Not priced"}</span>}</td><td>{part.inventoryItem?.warehouse?.code || "—"}<span className={styles.subtle}>{part.inventoryItem?.binLocation?.code || "Unassigned"}</span></td><td>{part.inventoryItem?.quantity ?? 0}</td><td>{part.inventoryItem ? money(part.inventoryItem.cost, part.inventoryItem.currency) : "—"}</td><td><button className={styles.editButton} onClick={() => void openPart(part.id)}>Edit</button></td></tr>; })}</tbody></table></div> :
          <div className={styles.gallery}>{catalog.parts.map((part) => <article key={part.id} className={styles.partCard}><button className={styles.cardSelect} aria-label={`Select ${part.sku}`} onClick={() => togglePart(part.id)}>{selected.has(part.id) ? "✓" : "+"}</button><CatalogImage mediaId={part.media[0]?.mediaAsset.id} token={token} demo={demo}/><span className={`${styles.statusPill} ${styles[part.status.toLowerCase()]}`}>{humanStatus(part.status)}</span><h3>{part.partName || "Unnamed automotive part"}</h3><p>{part.brand || "Brand not set"} · {part.condition}</p><div><b>{part.sku}</b><span>{part.primaryPartNumber}</span></div><footer><span>{part.inventoryItem?.quantity ?? 0} in stock</span><button onClick={() => void openPart(part.id)}>Edit part</button></footer></article>)}</div>}
        <div className={styles.pagination}><span>Page {catalog.pagination.page} of {Math.max(catalog.pagination.totalPages, 1)}</span><div><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button disabled={page >= catalog.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
      </section>
    </section>
    {detail && <div className={styles.modalBackdrop} role="presentation"><section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="edit-part-title"><header><div><span className={styles.eyebrow}>CATALOG EDITOR</span><h2 id="edit-part-title">Edit {detail.sku}</h2></div><button aria-label="Close editor" onClick={() => setDetail(null)}>×</button></header><form onSubmit={savePart}><div className={styles.formGrid}><label><span>SKU</span><input name="sku" defaultValue={detail.sku} required/></label><label><span>Primary part number</span><input name="primaryPartNumber" defaultValue={detail.primaryPartNumber} required/></label><label><span>Brand</span><input name="brand" defaultValue={detail.brand ?? ""}/></label><label><span>Part name</span><input name="partName" defaultValue={detail.partName ?? ""}/></label><label><span>Condition</span><select name="condition" defaultValue={detail.condition}><option value="NEW">New</option><option value="USED">Used</option></select></label><label><span>Catalog status</span><select name="status" defaultValue={detail.status}>{statuses.map((value) => <option key={value} value={value}>{humanStatus(value)}</option>)}</select></label><label><span>Quantity</span><input name="quantity" type="number" min="0" defaultValue={detail.inventoryItem?.quantity ?? 0}/></label><label><span>Cost</span><input name="cost" type="number" min="0" step="0.01" defaultValue={Number(detail.inventoryItem?.cost ?? 0)}/></label><label><span>Currency</span><input name="currency" maxLength={3} defaultValue={detail.inventoryItem?.currency ?? "USD"}/></label><label><span>Warehouse</span><input name="warehouseCode" defaultValue={detail.inventoryItem?.warehouse?.code ?? ""}/></label><label><span>Bin location</span><input name="binLocation" defaultValue={detail.inventoryItem?.binLocation?.code ?? ""}/></label><label><span>Placement</span><input name="placement" defaultValue={detail.placement ?? ""}/></label><label><span>Weight</span><input name="weight" type="number" min="0" step="0.001" defaultValue={detail.inventoryItem?.weight == null ? "" : Number(detail.inventoryItem.weight)}/></label><label><span>Weight unit</span><select name="weightUnit" defaultValue={detail.inventoryItem?.weightUnit ?? "LB"}><option value="LB">lb</option><option value="KG">kg</option></select></label><label><span>Length</span><input name="length" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.length == null ? "" : Number(detail.inventoryItem.length)}/></label><label><span>Width</span><input name="width" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.width == null ? "" : Number(detail.inventoryItem.width)}/></label><label><span>Height</span><input name="height" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.height == null ? "" : Number(detail.inventoryItem.height)}/></label><label><span>Dimension unit</span><select name="dimensionUnit" defaultValue={detail.inventoryItem?.dimensionUnit ?? "IN"}><option value="IN">in</option><option value="CM">cm</option></select></label><label className={styles.wide}><span>Description</span><textarea name="description" defaultValue={detail.description ?? ""}/></label><label className={styles.wide}><span>Internal notes</span><textarea name="notes" defaultValue={detail.notes ?? ""}/></label></div><div className={styles.formActions}><button type="button" onClick={() => setDetail(null)}>Cancel</button><button className={styles.primary} disabled={saving}>{saving ? "Saving..." : demo ? "Close preview" : "Save changes"}</button></div></form></section></div>}
    {draftDetail && <div className={styles.modalBackdrop} role="presentation">
      <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="edit-draft-title">
        <header>
          <div><span className={styles.eyebrow}>EBAY LISTING DRAFT · VERSION {draftDetail.version}</span><h2 id="edit-draft-title">{draftDetail.part.sku}</h2></div>
          <button aria-label="Close draft editor" onClick={() => setDraftDetail(null)}>×</button>
        </header>
        <div className={styles.readinessBox}>
          <b>{draftDetail.status === "READY" ? "Ready for publication workflow" : "Publication blocked"}</b>
          <span>{draftDetail.liveValidatedAt ? `Last checked with eBay ${new Date(draftDetail.liveValidatedAt).toLocaleString()}` : "Live eBay validation is still required."}</span>
          {(draftDetail.validationIssues ?? []).map((issue) => <span key={`${issue.code}-${issue.field}`} className={issue.severity === "BLOCKER" ? styles.blocker : styles.warning}>{issue.severity}: {issue.message}</span>)}
        </div>
        <div className={styles.metadataActions}>
          <button type="button" disabled={draftBusy} onClick={() => void syncResources()}>Refresh policies & locations</button>
          <button type="button" className={styles.primary} disabled={draftBusy || !draftDetail.categoryId} onClick={() => void validateDraftLive()}>{draftBusy ? "Contacting eBay..." : "Validate with eBay"}</button>
          <button type="button" className={styles.primary} disabled={draftBusy || Boolean(inventoryPreparationJob && ["QUEUED", "RUNNING"].includes(inventoryPreparationJob.status)) || draftDetail.status !== "READY" || !draftDetail.liveValidatedAt} onClick={() => void prepareInventoryPreview()}>{inventoryPreparationJob && ["QUEUED", "RUNNING"].includes(inventoryPreparationJob.status) ? "Worker preparing..." : draftBusy ? "Queueing..." : "Stage images & preview"}</button>
        </div>
        {inventoryPreparationJob && ["QUEUED", "RUNNING", "FAILED"].includes(inventoryPreparationJob.status) && <div className={styles.preparationStatus}><b>Image staging: {inventoryPreparationJob.status.toLowerCase()}</b>{inventoryPreparationJob.lastError && <span>{inventoryPreparationJob.lastError}</span>}</div>}
        {inventoryPreparation && <section className={styles.inventoryPreview}>
          <div><b>Inventory payload · {inventoryPreparation.sku}</b><span>{inventoryPreparation.draftVersion === draftDetail.version ? "Current draft version" : "Outdated — prepare this draft version again"}</span></div>
          <small>SHA-256 {inventoryPreparation.payloadHash}</small>
          {inventoryPreparation.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          <details><summary>View Inventory API JSON</summary><pre>{JSON.stringify(inventoryPreparation.inventoryPayload, null, 2)}</pre></details>
          {inventoryPreparation.compatibilityPayload && <details><summary>View compatibility JSON</summary><pre>{JSON.stringify(inventoryPreparation.compatibilityPayload, null, 2)}</pre></details>}
          <button type="button" className={styles.primary} disabled={draftBusy || inventoryPreparation.draftVersion !== draftDetail.version || Boolean(inventorySyncJob && ["QUEUED", "RUNNING"].includes(inventorySyncJob.status))} onClick={() => void applyInventoryToEbay()}>
            {inventorySyncJob && ["QUEUED", "RUNNING"].includes(inventorySyncJob.status) ? "Writing inventory..." : "Write inventory to eBay"}
          </button>
          {inventorySyncJob && <p><b>eBay inventory sync: {inventorySyncJob.status.toLowerCase()}</b>{inventorySyncJob.status === "COMPLETED" ? " — inventory only; not published." : inventorySyncJob.lastError ? ` — ${inventorySyncJob.lastError}` : ""}</p>}
          {inventorySyncJob?.status === "COMPLETED" && (!ebayOffer || ["PREPARING", "FAILED"].includes(ebayOffer.status)) && <button type="button" onClick={() => void prepareEbayOffer()} disabled={draftBusy || Boolean(ebayOfferJob && ["QUEUED", "RUNNING"].includes(ebayOfferJob.status))}>
            {ebayOfferJob?.action === "PREPARE" && ["QUEUED", "RUNNING"].includes(ebayOfferJob.status) ? "Preparing offer..." : "Prepare offer & preview fees"}
          </button>}
        </section>}
        {ebayOffer && <div className={styles.preparationStatus}>
          <b>Offer: {ebayOffer.status.toLowerCase().replaceAll("_", " ")}</b>
          {ebayOffer.ebayOfferId && <span>eBay offer ID: {ebayOffer.ebayOfferId}</span>}
          {ebayOffer.ebayListingId && <span>Listing ID: {ebayOffer.ebayListingId}</span>}
          {ebayOffer.feeTotal != null && <span>Expected listing fees: {money(ebayOffer.feeTotal, ebayOffer.feeCurrency ?? draftDetail.currency)}</span>}
          {ebayOffer.remoteListingStatus && <span>Remote status: {humanStatus(ebayOffer.remoteListingStatus)}{ebayOffer.lastReconciledAt ? ` · checked ${new Date(ebayOffer.lastReconciledAt).toLocaleString()}` : ""}</span>}
          {ebayOffer.revisionCount > 0 && <span>{ebayOffer.revisionCount} controlled revision{ebayOffer.revisionCount === 1 ? "" : "s"}</span>}
          {ebayOffer.status === "FEES_READY" && <button type="button" className={styles.primary} disabled={draftBusy} onClick={() => void publishEbayOffer()}>Approve fees & publish live</button>}
          {ebayOffer.status === "PUBLISHED" && inventorySyncJob?.status === "COMPLETED" && inventorySyncJob.draftVersion > ebayOffer.draftVersion && <button type="button" className={styles.primary} disabled={draftBusy || Boolean(listingOperationJob && ["QUEUED", "RUNNING"].includes(listingOperationJob.status))} onClick={() => void reviseLiveListing()}>Approve & revise live listing</button>}
          {["PUBLISHED", "DRIFTED"].includes(ebayOffer.status) && <button type="button" disabled={draftBusy || Boolean(listingOperationJob && ["QUEUED", "RUNNING"].includes(listingOperationJob.status))} onClick={() => void withdrawLiveListing()}>Withdraw listing</button>}
          {ebayOffer.ebayOfferId && <button type="button" disabled={draftBusy || Boolean(listingOperationJob && ["QUEUED", "RUNNING"].includes(listingOperationJob.status))} onClick={() => void reconcileLiveListing()}>Reconcile with eBay</button>}
          {listingOperationJob && ["QUEUED", "RUNNING"].includes(listingOperationJob.status) && <span>{humanStatus(listingOperationJob.action)} job: {listingOperationJob.status.toLowerCase()}</span>}
          {ebayOffer.ebayListingId && <a href={`https://${ebayOffer.marketplace === "EBAY_GB" ? "www.ebay.co.uk" : ebayOffer.marketplace === "EBAY_DE" ? "www.ebay.de" : "www.ebay.com"}/itm/${ebayOffer.ebayListingId}`} target="_blank" rel="noreferrer">Open eBay listing {ebayOffer.ebayListingId}</a>}
          {ebayOffer.driftIssues?.map((issue) => <span key={issue} className={styles.warning}>DRIFT: {issue}</span>)}
          {ebayOffer.lastError && <span>{ebayOffer.lastError}</span>}
          {ebayOffer.feeResponse && <details><summary>View eBay fee response</summary><pre>{JSON.stringify(ebayOffer.feeResponse, null, 2)}</pre></details>}
          {ebayOffer.remoteSnapshot && <details><summary>View last remote offer snapshot</summary><pre>{JSON.stringify(ebayOffer.remoteSnapshot, null, 2)}</pre></details>}
        </div>}
        <form onSubmit={saveDraft}>
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>Title ({draftDetail.title.length}/80)</span><input name="title" maxLength={120} defaultValue={draftDetail.title} required/></label>
            <label><span>eBay category ID</span><input name="categoryId" defaultValue={draftDetail.categoryId ?? ""}/></label>
            <label><span>Condition</span><select name="condition" defaultValue={draftDetail.condition}><option value="NEW">New</option><option value="USED">Used</option></select></label>
            <label><span>eBay condition</span><select name="ebayCondition" defaultValue={draftDetail.ebayCondition ?? ""}><option value="">Validate category to load conditions</option>{categoryConditions.map((option) => <option key={option.conditionId} value={option.enumValue}>{option.name}</option>)}</select></label>
            <label><span>Price</span><input name="price" type="number" min="0.01" step="0.01" defaultValue={draftDetail.price ?? ""}/></label>
            <label><span>Currency</span><input name="currency" maxLength={3} defaultValue={draftDetail.currency}/></label>
            <label><span>Quantity</span><input name="quantity" type="number" min="0" defaultValue={draftDetail.quantity}/></label>
            <label><span>Merchant location</span><select name="merchantLocationKey" defaultValue={draftDetail.merchantLocationKey ?? ""}><option value="">Select location</option>{sellerResources?.inventoryLocations.filter(({ enabled }) => enabled).map((resource) => <option key={resource.remoteId} value={resource.remoteId}>{resource.name ?? resource.remoteId}</option>)}</select></label>
            <label><span>Payment policy</span><select name="paymentPolicyId" defaultValue={draftDetail.paymentPolicyId ?? ""}><option value="">Select payment policy</option>{sellerResources?.paymentPolicies.filter(({ enabled }) => enabled).map((resource) => <option key={resource.remoteId} value={resource.remoteId}>{resource.name ?? resource.remoteId}</option>)}</select></label>
            <label><span>Return policy</span><select name="returnPolicyId" defaultValue={draftDetail.returnPolicyId ?? ""}><option value="">Select return policy</option>{sellerResources?.returnPolicies.filter(({ enabled }) => enabled).map((resource) => <option key={resource.remoteId} value={resource.remoteId}>{resource.name ?? resource.remoteId}</option>)}</select></label>
            <label><span>Shipping policy</span><select name="shippingPolicyId" defaultValue={draftDetail.shippingPolicyId ?? ""}><option value="">Select fulfillment policy</option>{sellerResources?.fulfillmentPolicies.filter(({ enabled }) => enabled).map((resource) => <option key={resource.remoteId} value={resource.remoteId}>{resource.name ?? resource.remoteId}</option>)}</select></label>
            {categoryAspects.map((requirement, index) => <label key={requirement.name} className={requirement.cardinality === "MULTI" ? styles.wide : undefined}>
              <span>{requirement.name}{requirement.required ? " *" : requirement.recommended ? " (recommended)" : ""}</span>
              {requirement.mode === "SELECTION_ONLY" && requirement.values.length && requirement.cardinality === "SINGLE"
                ? <select name={`aspect-${index}`} defaultValue={draftDetail.aspects[requirement.name]?.[0] ?? ""}><option value="">Select value</option>{requirement.values.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                : <input name={`aspect-${index}`} defaultValue={(draftDetail.aspects[requirement.name] ?? []).join(" | ")} placeholder={requirement.cardinality === "MULTI" ? "Separate multiple values with |" : undefined}/>}
            </label>)}
            <label className={styles.wide}><span>Description</span><textarea name="description" defaultValue={draftDetail.description ?? ""}/></label>
          </div>
          <div className={styles.formActions}><button type="button" onClick={() => setDraftDetail(null)}>Close</button><button className={styles.primary} disabled={draftBusy}>{draftBusy ? "Validating..." : "Save & validate"}</button></div>
        </form>
      </section>
    </div>}
  </main>;
}
