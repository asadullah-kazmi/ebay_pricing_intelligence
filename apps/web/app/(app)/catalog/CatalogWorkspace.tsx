"use client";

import Link from "next/link";
import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./catalog.module.css";
import { useAuth } from "../../components/AuthProvider";
import { apiBase, apiRequest, refreshAccessSession, SessionExpiredError } from "../../lib/auth-session";
import { dismissFitmentJob, dismissPricingJob, isDismissedFitmentJob, isDismissedPricingJob, shouldAutoShowJob } from "../../lib/dismissed-jobs";
import type { CatalogPartCard, CatalogPartDetail, CatalogResponse, CatalogSavedView, CatalogStatus, EbayAspectRequirement, EbayConditionOption, EbayConnection, EbayInventorySyncJob, EbayListingOperationJob, EbayOffer, EbayOfferJob, EbaySellerResources, FitmentJob, FitmentJobSummary, InventoryPreparation, InventoryPreparationJob, ListingDraft, LiveDraftValidation, ManualFitmentApplication, PartCondition, PartFitment, PricingConditionMode, PricingJob, PricingJobSummary } from "./types";

const statuses: CatalogStatus[] = ["IMPORTED", "NEEDS_IMAGES", "IMPORT_ERROR", "READY_FOR_ENRICHMENT", "ARCHIVED"];
const emptyCatalog: CatalogResponse = { parts: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 }, summary: { total: 0, byStatus: {} }, warehouses: [] };

const mediaUrlCache = new Map<string, string>();
const mediaUrlWaiters = new Map<string, Array<(url: string | null) => void>>();
let mediaUrlFlushTimer: ReturnType<typeof setTimeout> | null = null;
const mediaUrlPending = new Set<string>();

function flushMediaUrlBatch() {
  mediaUrlFlushTimer = null;
  const ids = [...mediaUrlPending];
  mediaUrlPending.clear();
  if (!ids.length) return;
  void apiRequest("/api/media/download-urls", {
    method: "POST",
    body: JSON.stringify({ ids }),
  })
    .then((data) => {
      const urls = (data as { urls?: Array<{ id: string; downloadUrl: string }> }).urls ?? [];
      const found = new Set<string>();
      for (const item of urls) {
        found.add(item.id);
        mediaUrlCache.set(item.id, item.downloadUrl);
        const waiters = mediaUrlWaiters.get(item.id) ?? [];
        mediaUrlWaiters.delete(item.id);
        for (const resolve of waiters) resolve(item.downloadUrl);
      }
      for (const id of ids) {
        if (found.has(id)) continue;
        const waiters = mediaUrlWaiters.get(id) ?? [];
        mediaUrlWaiters.delete(id);
        for (const resolve of waiters) resolve(null);
      }
    })
    .catch(() => {
      for (const id of ids) {
        const waiters = mediaUrlWaiters.get(id) ?? [];
        mediaUrlWaiters.delete(id);
        for (const resolve of waiters) resolve(null);
      }
    });
}

function requestMediaDownloadUrl(mediaId: string): Promise<string | null> {
  const cached = mediaUrlCache.get(mediaId);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const waiters = mediaUrlWaiters.get(mediaId) ?? [];
    waiters.push(resolve);
    mediaUrlWaiters.set(mediaId, waiters);
    mediaUrlPending.add(mediaId);
    if (!mediaUrlFlushTimer) mediaUrlFlushTimer = setTimeout(flushMediaUrlBatch, 24);
  });
}

const demoParts: CatalogPartCard[] = [
  { id: "demo-1", sku: "GM-84178783-A", primaryPartNumber: "84178783", brand: "ACDelco", partName: "HVAC Blower Motor Control Module", condition: "USED", status: "READY_FOR_ENRICHMENT", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), donorVehicle: { vin: "1GNEK13Z43R000001", year: 2021, make: "Chevrolet", model: "Traverse" }, inventoryItem: { quantity: 1, cost: 28, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b1", code: "A-14" } }, media: [], pricingJobItems: [], fitmentJobItems: [], _count: { media: 4 } },
  { id: "demo-2", sku: "AUD-8K0615301M", primaryPartNumber: "8K0615301M", brand: "Audi", partName: "Rear Brake Caliper", condition: "USED", status: "NEEDS_IMAGES", createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(), donorVehicle: { vin: "WAUZZZ8K9DA000001", year: 2013, make: "Audi", model: "A4" }, inventoryItem: { quantity: 2, cost: 46.5, currency: "USD", warehouse: { id: "w1", code: "MAIN", name: "Main" }, binLocation: { id: "b2", code: "C-08" } }, media: [], pricingJobItems: [], fitmentJobItems: [], _count: { media: 0 } },
  { id: "demo-3", sku: "BMW-64119355981", primaryPartNumber: "64119355981", brand: "BMW", partName: "Air Conditioning Control Panel", condition: "USED", status: "IMPORTED", createdAt: new Date(Date.now() - 172800000).toISOString(), updatedAt: new Date().toISOString(), donorVehicle: null, inventoryItem: { quantity: 1, cost: 65, currency: "USD", warehouse: null, binLocation: null }, media: [], pricingJobItems: [], fitmentJobItems: [], _count: { media: 2 } },
];

function demoCatalog(): CatalogResponse {
  return { parts: demoParts, pagination: { page: 1, pageSize: 25, total: 3, totalPages: 1 }, summary: { total: 3, byStatus: { READY_FOR_ENRICHMENT: 1, NEEDS_IMAGES: 1, IMPORTED: 1 } }, warehouses: [{ id: "w1", code: "MAIN", name: "Main" }] };
}

function humanStatus(status: string) {
  if (status === "NEEDS_IMAGES") return "Need Images";
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: string | number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value));
}

function detailTitle(part: CatalogPartDetail) {
  const donor = part.donorVehicle
    ? [part.donorVehicle.year, part.donorVehicle.make, part.donorVehicle.model].filter(Boolean).join(" ")
    : "";
  const raw = [donor, part.partName || "Automotive Part", part.primaryPartNumber].filter(Boolean).join(" ");
  // Quick SKU / imports often store shouting ALL CAPS titles — soften for the modal.
  if (raw === raw.toUpperCase() && /[A-Z]/.test(raw)) {
    return raw
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return raw;
}

function fitmentLabel(properties: Record<string, string>) {
  const map = new Map(Object.entries(properties).map(([key, value]) => [key.toLowerCase(), value]));
  const year = map.get("year");
  const make = map.get("make");
  const model = map.get("model");
  const trim = map.get("trim");
  const label = [make, model, year].filter(Boolean).join(" ");
  return trim ? `${label} ${trim}` : label || Object.values(properties).slice(0, 3).join(" ");
}

function stockStatus(quantity: number) {
  if (quantity <= 0) return { label: "Out of Stock", tone: "bad" as const };
  if (quantity <= 2) return { label: "Low Stock", tone: "warn" as const };
  return { label: "In Stock", tone: "good" as const };
}

function ebayStatusLabel(part: CatalogPartDetail) {
  const draft = part.listingDrafts?.[0];
  if (draft?.status === "READY") return { label: "Ready to Publish", tone: "good" as const };
  if (draft?.status === "BLOCKED") return { label: "Needs Fixes", tone: "warn" as const };
  if (part.status === "NEEDS_IMAGES") return { label: "Need Images", tone: "warn" as const };
  if (part.status === "READY_FOR_ENRICHMENT") return { label: "Ready to Publish", tone: "good" as const };
  if (part.status === "ARCHIVED") return { label: "Archived", tone: "muted" as const };
  return { label: humanStatus(part.status), tone: "muted" as const };
}

function CatalogImage({ mediaId, demo }: { mediaId?: string; token?: string; demo: boolean }) {
  const [url, setUrl] = useState(() => (mediaId ? mediaUrlCache.get(mediaId) ?? "" : ""));
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || !mediaId || demo) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [demo, mediaId]);

  useEffect(() => {
    if (!mediaId || demo || !visible) return;
    let active = true;
    void requestMediaDownloadUrl(mediaId)
      .then((downloadUrl) => {
        if (active && downloadUrl) setUrl(downloadUrl);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [demo, mediaId, visible]);

  return (
    <div ref={rootRef} className={styles.thumb}>
      {url ? <img src={url} alt="Catalog part" loading="lazy" /> : <span>{demo || mediaId ? "PART" : "NO IMAGE"}</span>}
    </div>
  );
}

export default function CatalogWorkspace() {
  const { status: authStatus, token, demo, apiFetch } = useAuth();
  const searchParams = useSearchParams();
  const [catalog, setCatalog] = useState<CatalogResponse>(emptyCatalog);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const highlightFromUrl = searchParams.get("highlight");
  const [search, setSearch] = useState(() => (highlightFromUrl ? "" : searchParams.get("q") ?? ""));
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("");
  const [condition, setCondition] = useState("");
  const [brand, setBrand] = useState("");
  const [knownBrands, setKnownBrands] = useState<string[]>([]);
  const [bulkMoreOpen, setBulkMoreOpen] = useState(false);
  const [hasImages, setHasImages] = useState("");
  const [hasPricing, setHasPricing] = useState("");
  const [hasFitment, setHasFitment] = useState("");
  const [listingState, setListingState] = useState("");
  const [hasShippingPolicy, setHasShippingPolicy] = useState("");
  const [marketplaceFilter, setMarketplaceFilter] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [maxQuantity, setMaxQuantity] = useState("");
  const [minCost, setMinCost] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [sort, setSort] = useState(() => {
    const value = searchParams.get("sort");
    return value === "oldest" || value === "updated" || value === "sku" ? value : "newest";
  });
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"table" | "gallery">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CatalogPartDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [highlightedPartId, setHighlightedPartId] = useState<string | null>(() => highlightFromUrl);

  useEffect(() => {
    const highlight = searchParams.get("highlight");
    const query = searchParams.get("q");
    const sortParam = searchParams.get("sort");

    if (highlight) {
      setHighlightedPartId(highlight);
      setSearch("");
      setSort(sortParam === "oldest" || sortParam === "updated" || sortParam === "sku" ? sortParam : "newest");
      setPage(1);
      return;
    }

    if (query != null && query !== search) {
      setSearch(query);
      setPage(1);
    }
    if (sortParam === "oldest" || sortParam === "updated" || sortParam === "sku" || sortParam === "newest") {
      setSort(sortParam);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps -- sync URL-driven catalog entry points only
  const [pricingMarketplace, setPricingMarketplace] = useState("EBAY_US");
  const [pricingCondition, setPricingCondition] = useState<PricingConditionMode>("MATCH_PART");
  const [pricingJob, setPricingJob] = useState<PricingJob | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [latestPricingLoaded, setLatestPricingLoaded] = useState(false);
  const [fitmentJob, setFitmentJob] = useState<FitmentJob | null>(null);
  const [fitmentBusy, setFitmentBusy] = useState(false);
  const [latestFitmentLoaded, setLatestFitmentLoaded] = useState(false);
  const [fitmentEditor, setFitmentEditor] = useState<PartFitment | null>(null);
  const [manualFitmentBusy, setManualFitmentBusy] = useState(false);
  const [ebayConnection, setEbayConnection] = useState<EbayConnection>({ connected: false, status: "NOT_CONNECTED" });
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
  const [savedViews, setSavedViews] = useState<CatalogSavedView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState("");
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [bulkPoliciesOpen, setBulkPoliciesOpen] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (demo) {
      setCatalog(demoCatalog());
      setLoading(false);
    }
  }, [authStatus, demo]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => apiFetch(path, init), [apiFetch]);

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    request("/api/ebay/connection").then((value) => setEbayConnection(value as EbayConnection)).catch(() => undefined);
  }, [authStatus, demo, request]);

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    request("/api/listing-drafts?limit=25")
      .then((value) => setDrafts(value as ListingDraft[]))
      .catch(() => undefined);
  }, [authStatus, demo, request]);

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    request("/api/catalog/saved-views")
      .then((value) => {
        const views = value as CatalogSavedView[];
        setSavedViews(views);
        // Coming from Quick SKU with highlight: show full newest-first list, not a saved filter.
        if (searchParams.get("highlight")) return;
        const defaultView = views.find(({ isDefault }) => isDefault);
        if (defaultView) {
          setActiveSavedViewId(defaultView.id);
          applySavedFilters(defaultView.filters);
        }
      })
      .catch(() => undefined);
  }, [authStatus, demo, request, searchParams]);

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: "25", sort });
    if (deferredSearch.trim()) query.set("q", deferredSearch.trim());
    if (brand) query.set("brand", brand);
    if (status) query.set("status", status);
    if (condition) query.set("condition", condition);
    if (hasImages) query.set("hasImages", hasImages);
    if (hasPricing) query.set("hasPricing", hasPricing);
    if (hasFitment) query.set("hasFitment", hasFitment);
    if (listingState === "NONE") query.set("hasDraft", "false");
    else if (listingState) { query.set("hasDraft", "true"); query.set("draftStatus", listingState); }
    if (hasShippingPolicy) query.set("hasShippingPolicy", hasShippingPolicy);
    if (marketplaceFilter) query.set("marketplace", marketplaceFilter);
    if (warehouseId) query.set("warehouseId", warehouseId);
    if (minQuantity) query.set("minQuantity", minQuantity);
    if (maxQuantity) query.set("maxQuantity", maxQuantity);
    if (minCost) query.set("minCost", minCost);
    if (maxCost) query.set("maxCost", maxCost);
    if (createdFrom) query.set("createdFrom", `${createdFrom}T00:00:00.000Z`);
    if (createdTo) query.set("createdTo", `${createdTo}T23:59:59.999Z`);
    return query.toString();
  }, [brand, condition, createdFrom, createdTo, deferredSearch, hasFitment, hasImages, hasPricing, hasShippingPolicy, listingState, marketplaceFilter, maxCost, maxQuantity, minCost, minQuantity, page, sort, status, warehouseId]);

  const catalogRequestId = useRef(0);

  const loadCatalog = useCallback(async () => {
    if (authStatus !== "ready" || demo) return;
    const requestId = ++catalogRequestId.current;
    setLoading(true);
    setError("");
    try {
      const next = await request(`/api/parts?${queryString}`) as CatalogResponse;
      if (requestId !== catalogRequestId.current) return;
      setCatalog(next);
    } catch (caught) {
      if (requestId !== catalogRequestId.current) return;
      if (caught instanceof SessionExpiredError) return;
      setError(caught instanceof Error ? caught.message : "Unable to load catalog");
    } finally {
      if (requestId === catalogRequestId.current) setLoading(false);
    }
  }, [authStatus, demo, queryString, request]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  useEffect(() => {
    if (!highlightedPartId || loading) return;
    const row = document.querySelector<HTMLElement>(`[data-part-id="${highlightedPartId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const timer = window.setTimeout(() => setHighlightedPartId(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [highlightedPartId, catalog.parts, loading]);

  useEffect(() => {
    setKnownBrands((current) => {
      const next = new Set(current);
      for (const part of catalog.parts) if (part.brand) next.add(part.brand);
      return [...next].sort((a, b) => a.localeCompare(b));
    });
  }, [catalog.parts]);

  useEffect(() => {
    if (authStatus !== "ready" || demo || latestPricingLoaded) return;
    setLatestPricingLoaded(true);
    request("/api/pricing/jobs?limit=1")
      .then(async (jobs) => {
        const latest = (jobs as PricingJobSummary[])[0];
        if (!latest || isDismissedPricingJob(latest.id) || !shouldAutoShowJob(latest.status)) return;
        setPricingJob(await request(`/api/pricing/jobs/${latest.id}`) as PricingJob);
      })
      .catch(() => undefined);
  }, [authStatus, demo, latestPricingLoaded, request]);

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
    if (authStatus !== "ready" || demo || latestFitmentLoaded) return;
    setLatestFitmentLoaded(true);
    request("/api/fitment/jobs?limit=1")
      .then(async (jobs) => {
        const latest = (jobs as FitmentJobSummary[])[0];
        if (!latest || isDismissedFitmentJob(latest.id)) return;
        if (["COMPLETED", "PARTIAL", "FAILED"].includes(latest.status)) return;
        setFitmentJob(await request(`/api/fitment/jobs/${latest.id}`) as FitmentJob);
      })
      .catch(() => undefined);
  }, [authStatus, demo, latestFitmentLoaded, request]);

  useEffect(() => {
    if (!fitmentJob || !["QUEUED", "RUNNING"].includes(fitmentJob.status) || demo) return;
    const timer = window.setTimeout(() => {
      request(`/api/fitment/jobs/${fitmentJob.id}`)
        .then((job) => setFitmentJob(job as FitmentJob))
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to refresh fitment job"));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [demo, fitmentJob, request]);

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
      setDetailMode("view");
      setDetail({
        ...card,
        description: "This used OEM seat track cover was carefully removed from a donor vehicle. Surface wear is consistent with age. Compatible with listed Audi A6 applications. Part number 4F088134701C verified.",
        donorMileage: 48600,
        donorColor: "Black",
        placement: "Rear",
        notes: null,
        partNumbers: [{ id: "pn", type: "PRIMARY", value: card.primaryPartNumber }],
        inventoryItem: card.inventoryItem
          ? { ...card.inventoryItem, weight: null, weightUnit: null, length: null, width: null, height: null, dimensionUnit: null }
          : null,
        media: [
          { id: "m1", displayOrder: 0, mediaAsset: { id: "", originalFilename: "main.jpg", mimeType: "image/jpeg" } },
          { id: "m2", displayOrder: 1, mediaAsset: { id: "", originalFilename: "side.jpg", mimeType: "image/jpeg" } },
          { id: "m3", displayOrder: 2, mediaAsset: { id: "", originalFilename: "detail.jpg", mimeType: "image/jpeg" } },
        ],
        fitmentApplications: [
          { id: "f1", marketplace: "EBAY_US", properties: { Year: "2016", Make: "Audi", Model: "A6" }, source: "EBAY_CATALOG", approvedAt: new Date().toISOString() },
          { id: "f2", marketplace: "EBAY_US", properties: { Year: "2015", Make: "Audi", Model: "A6" }, source: "EBAY_CATALOG", approvedAt: new Date().toISOString() },
          { id: "f3", marketplace: "EBAY_US", properties: { Year: "2014", Make: "Audi", Model: "A6" }, source: "DONOR_VEHICLE", approvedAt: new Date().toISOString() },
        ],
        listingDrafts: [{
          id: "d1",
          marketplace: "EBAY_US",
          status: "READY",
          title: `${card.partName || "Automotive Part"} ${card.primaryPartNumber}`,
          categoryId: "262201",
          shippingPolicyId: "ship-custom",
          price: Number(card.inventoryItem?.cost ?? 19.58),
          currency: "USD",
          updatedAt: new Date().toISOString(),
        }],
      });
      return;
    }
    setError("");
    try {
      setDetailMode("view");
      setDetail(await request(`/api/parts/${id}`) as CatalogPartDetail);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to open part");
    }
  }

  async function copySku(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`Copied SKU ${value}`);
    } catch {
      setError("Unable to copy SKU");
    }
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

  function currentSavedFilters(): Record<string, string> {
    return Object.fromEntries(Object.entries({
      q: search.trim(), brand, status, condition, hasImages, hasPricing, hasFitment,
      hasDraft: listingState === "NONE" ? "false" : listingState ? "true" : "",
      draftStatus: listingState === "NONE" ? "" : listingState,
      hasShippingPolicy, marketplace: marketplaceFilter, warehouseId,
      minQuantity, maxQuantity, minCost, maxCost, createdFrom, createdTo, sort,
    }).filter(([, value]) => value));
  }

  function applySavedFilters(filters: Record<string, string>) {
    setSearch(filters.q ?? "");
    setBrand(filters.brand ?? "");
    setStatus(filters.status ?? "");
    setCondition(filters.condition ?? "");
    setHasImages(filters.hasImages ?? "");
    setHasPricing(filters.hasPricing ?? "");
    setHasFitment(filters.hasFitment ?? "");
    setListingState(filters.hasDraft === "false" ? "NONE" : filters.draftStatus ?? "");
    setHasShippingPolicy(filters.hasShippingPolicy ?? "");
    setMarketplaceFilter(filters.marketplace ?? "");
    setWarehouseId(filters.warehouseId ?? "");
    setMinQuantity(filters.minQuantity ?? "");
    setMaxQuantity(filters.maxQuantity ?? "");
    setMinCost(filters.minCost ?? "");
    setMaxCost(filters.maxCost ?? "");
    setCreatedFrom(filters.createdFrom ?? "");
    setCreatedTo(filters.createdTo ?? "");
    setSort(filters.sort ?? "newest");
    resetPage();
  }

  async function saveCurrentView() {
    if (demo) return;
    const name = window.prompt("Name this catalog view:")?.trim();
    if (!name) return;
    try {
      const saved = await request("/api/catalog/saved-views", {
        method: "POST",
        body: JSON.stringify({ name, filters: currentSavedFilters(), isDefault: window.confirm("Make this your default catalog view?") }),
      }) as CatalogSavedView;
      setSavedViews(await request("/api/catalog/saved-views") as CatalogSavedView[]);
      setActiveSavedViewId(saved.id);
      setNotice(`Saved catalog view "${saved.name}".`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save catalog view"); }
  }

  async function deleteCurrentView() {
    const view = savedViews.find(({ id }) => id === activeSavedViewId);
    if (!view || demo || !window.confirm(`Delete saved view "${view.name}"?`)) return;
    try {
      await request(`/api/catalog/saved-views/${view.id}`, { method: "DELETE" });
      setSavedViews(savedViews.filter(({ id }) => id !== view.id));
      setActiveSavedViewId("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to delete saved view"); }
  }

  async function bulkEditSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const changes: Record<string, string | number | null> = {};
    for (const name of ["status", "condition"] as const) {
      const value = String(form.get(name) ?? "");
      if (value) changes[name] = value;
    }
    for (const name of ["placement", "warehouseCode"] as const) {
      const value = String(form.get(name) ?? "");
      if (value) changes[name] = value === "__CLEAR__" ? null : value;
    }
    const quantity = String(form.get("quantity") ?? "");
    if (quantity) changes.quantity = Number(quantity);
    const warehouseCode = String(form.get("warehouseCode") ?? "");
    const binLocation = String(form.get("binLocation") ?? "");
    if (warehouseCode && warehouseCode !== "__CLEAR__") changes.binLocation = binLocation || null;
    if (!Object.keys(changes).length) { setError("Choose at least one bulk change."); return; }
    setSaving(true); setError("");
    try {
      const result = await request("/api/parts/bulk-edit", { method: "PATCH", body: JSON.stringify({ partIds: [...selected], changes }) }) as { updated: number; invalidatedDrafts: number };
      setBulkEditorOpen(false); setSelected(new Set()); await loadCatalog();
      setNotice(`Updated ${result.updated} parts. ${result.invalidatedDrafts} listing drafts require review.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to bulk edit selected parts"); }
    finally { setSaving(false); }
  }

  async function openBulkPolicies() {
    if (!selected.size || demo) return;
    setDraftBusy(true); setError("");
    try {
      setSellerResources(await request(`/api/ebay/resources?marketplace=${encodeURIComponent(pricingMarketplace)}`) as EbaySellerResources);
      setBulkPoliciesOpen(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load eBay policies"); }
    finally { setDraftBusy(false); }
  }

  async function assignBulkPolicies(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDraftBusy(true); setError("");
    try {
      const updated = await request("/api/listing-drafts/bulk-policies", {
        method: "POST",
        body: JSON.stringify({
          partIds: [...selected],
          marketplace: pricingMarketplace,
          paymentPolicyId: String(form.get("paymentPolicyId")),
          returnPolicyId: String(form.get("returnPolicyId")),
          shippingPolicyId: String(form.get("shippingPolicyId")),
          merchantLocationKey: String(form.get("merchantLocationKey")),
        }),
      }) as ListingDraft[];
      setDrafts(updated); setBulkPoliciesOpen(false); setSelected(new Set());
      setNotice(`Assigned policies and locations to ${updated.length} listing drafts.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to assign policies"); }
    finally { setDraftBusy(false); }
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

  async function openManualFitment(partId: string) {
    if (demo) return;
    setError("");
    try {
      setFitmentEditor(await request(`/api/parts/${partId}/fitment?marketplace=${encodeURIComponent(pricingMarketplace)}`) as PartFitment);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load fitment applications"); }
  }

  async function refreshManualFitment() {
    if (!fitmentEditor) return;
    setFitmentEditor(await request(`/api/parts/${fitmentEditor.part.id}/fitment?marketplace=${encodeURIComponent(fitmentEditor.marketplace)}`) as PartFitment);
  }

  async function createManualApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fitmentEditor || manualFitmentBusy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const source = String(form.get("source"));
    setManualFitmentBusy(true); setError("");
    try {
      await request(`/api/parts/${fitmentEditor.part.id}/fitment`, {
        method: "POST",
        body: JSON.stringify({
          marketplace: fitmentEditor.marketplace,
          source,
          properties: {
            Year: String(form.get("year") || ""),
            Make: String(form.get("make") || ""),
            Model: String(form.get("model") || ""),
            Trim: String(form.get("trim") || ""),
            Engine: String(form.get("engine") || ""),
          },
          notes: String(form.get("notes") || "") || undefined,
        }),
      });
      await refreshManualFitment();
      formElement.reset();
      setNotice("Fitment application created for review. Approve it before publication.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create fitment application"); }
    finally { setManualFitmentBusy(false); }
  }

  async function decideManualApplication(application: ManualFitmentApplication, action: "APPROVE" | "REJECT" | "SUPERSEDE", replaceExisting = false) {
    const reason = window.prompt(action === "APPROVE" ? "Approval reason:" : action === "REJECT" ? "Rejection reason:" : "Reason for removing this approved fitment:")?.trim();
    if (!reason || manualFitmentBusy) return;
    setManualFitmentBusy(true); setError("");
    try {
      await request(`/api/fitment/applications/${application.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ action, reason, ...(action === "APPROVE" ? { replaceExisting } : {}) }),
      });
      await refreshManualFitment();
      setNotice(action === "APPROVE" ? "Fitment approved. Existing listing drafts require live validation again." : "Fitment decision recorded.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to decide fitment application"); }
    finally { setManualFitmentBusy(false); }
  }

  async function reviseManualApplication(application: ManualFitmentApplication) {
    if (application.source === "EBAY_CATALOG" || manualFitmentBusy) return;
    const value = (name: string) => window.prompt(name, application.properties[name] ?? "")?.trim();
    const year = value("Year"); if (year === undefined) return;
    const make = value("Make"); if (make === undefined) return;
    const model = value("Model"); if (model === undefined) return;
    const trim = value("Trim"); if (trim === undefined) return;
    const engine = value("Engine"); if (engine === undefined) return;
    const reason = window.prompt("Reason for this revision:")?.trim(); if (!reason) return;
    setManualFitmentBusy(true); setError("");
    try {
      await request(`/api/fitment/applications/${application.id}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: { Year: year, Make: make, Model: model, Trim: trim, Engine: engine }, notes: application.notes, reason }),
      });
      await refreshManualFitment();
      setNotice("Fitment revised and returned to pending review.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to revise fitment application"); }
    finally { setManualFitmentBusy(false); }
  }

  async function createDrafts(partIds?: string[]) {
    const ids = partIds ?? [...selected];
    if (!ids.length || ids.length > 25 || demo || draftBusy) return;
    setDraftBusy(true); setError(""); setNotice("");
    try {
      const created = await request("/api/listing-drafts", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ partIds: ids, marketplace: pricingMarketplace }),
      }) as ListingDraft[];
      setDrafts((current) => [...created, ...current.filter((draft) => !created.some(({ id }) => id === draft.id))].slice(0, 25));
      if (!partIds) setSelected(new Set());
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

  async function downloadCsv() {
    if (demo) return;
    try {
      const access = await refreshAccessSession();
      const response = await fetch(`${apiBase}/api/parts/export?${queryString}`, {
        headers: { Authorization: `Bearer ${access.accessToken}` },
        credentials: "include",
      });
      if (response.status === 401) {
        const retry = await refreshAccessSession({ force: true });
        const again = await fetch(`${apiBase}/api/parts/export?${queryString}`, {
          headers: { Authorization: `Bearer ${retry.accessToken}` },
          credentials: "include",
        });
        if (!again.ok) throw new Error("Unable to export catalog");
        const url = URL.createObjectURL(await again.blob());
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "partpulse-catalog.csv"; anchor.click(); URL.revokeObjectURL(url);
        return;
      }
      if (!response.ok) throw new Error("Unable to export catalog");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "partpulse-catalog.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to export catalog"); }
  }

  if (authStatus !== "ready") return null;

  const allPageSelected = catalog.parts.length > 0 && catalog.parts.every(({ id }) => selected.has(id));

  return <>
    <section className={styles.workspace}>
      <header className={styles.topbar}>
        <div>
          <h1>Catalog</h1>
          <p>Search, review, and manage parts across marketplaces.</p>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => void loadCatalog()} aria-label="Refresh catalog" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => void downloadCsv()}>
            Export
            <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <button type="button" className={styles.ghostBtn} disabled={draftBusy || selected.size === 0} onClick={() => void openBulkPolicies()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>
            Edit Policies
          </button>
          <a className={styles.primary} href="/pipeline">+ Add Part</a>
        </div>
      </header>
      <div className={styles.connectionRow}>
        <i className={ebayConnection.connected ? styles.connectedDot : styles.disconnectedDot}/>
        <span>{ebayConnection.connected ? (ebayConnection.username || ebayConnection.ebayUserId || "eBay connected") : "Seller not connected"}</span>
        <Link href="/channels" className={styles.linkBtn}>Channels</Link>
      </div>
      {demo && <div className={styles.demoBanner}>Development preview - sample records are not saved.</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}
      {pricingJob && <section className={styles.pricingPanel}>

        <header><div><span className={styles.eyebrow}>BULK MARKET PRICING</span><h2>Job {pricingJob.id.slice(-8)}</h2></div><div><span className={`${styles.jobStatus} ${styles[`job_${pricingJob.status.toLowerCase()}`]}`}>{humanStatus(pricingJob.status)}</span><button onClick={() => { dismissPricingJob(pricingJob.id); setPricingJob(null); }} aria-label="Hide pricing job">×</button></div></header>

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

        <header><div><span className={styles.eyebrow}>REVIEW-FIRST FITMENT</span><h2>Job {fitmentJob.id.slice(-8)}</h2></div><div><span className={`${styles.jobStatus} ${styles[`job_${fitmentJob.status.toLowerCase()}`]}`}>{humanStatus(fitmentJob.status)}</span><button onClick={() => { dismissFitmentJob(fitmentJob.id); setFitmentJob(null); }} aria-label="Hide fitment job">×</button></div></header>

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
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span className={styles.srOnly}>Search</span>
            <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} placeholder="Search by SKU, title, or part number..."/>
            <span className={styles.kbdHint}>⌘K</span>
          </label>
          <div className={styles.filterRow}>
            <label className={styles.filterField}>
              <span>Stock Level</span>
              <select value={minQuantity === "1" && !maxQuantity ? "in" : maxQuantity === "0" ? "out" : minQuantity === "1" && maxQuantity === "5" ? "low" : ""} onChange={(event) => {
                const value = event.target.value;
                if (value === "in") { setMinQuantity("1"); setMaxQuantity(""); }
                else if (value === "low") { setMinQuantity("1"); setMaxQuantity("5"); }
                else if (value === "out") { setMinQuantity(""); setMaxQuantity("0"); }
                else { setMinQuantity(""); setMaxQuantity(""); }
                resetPage();
              }}>
                <option value="">All Stock</option>
                <option value="in">In stock</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Marketplace Status</span>
              <select value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }}>
                <option value="">All Status</option>
                {statuses.map((value) => <option key={value} value={value}>{humanStatus(value)}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Brand</span>
              <select value={brand} onChange={(event) => { setBrand(event.target.value); resetPage(); }}>
                <option value="">All Brands</option>
                {knownBrands.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Condition</span>
              <select value={condition} onChange={(event) => { setCondition(event.target.value); resetPage(); }}>
                <option value="">All Conditions</option>
                <option value="NEW">New</option>
                <option value="USED">Used</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Shipping</span>
              <select value={hasShippingPolicy} onChange={(event) => { setHasShippingPolicy(event.target.value); resetPage(); }}>
                <option value="">All Shipping</option>
                <option value="true">Assigned</option>
                <option value="false">Unassigned</option>
              </select>
            </label>
            <label className={styles.filterField}>
              <span>Date Added</span>
              <input type="date" value={createdFrom} onChange={(event) => { setCreatedFrom(event.target.value); resetPage(); }}/>
            </label>
            <button type="button" className={styles.advancedToggle} onClick={() => setShowAdvancedFilters((value) => !value)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></svg>
              Advanced Filters
            </button>
          </div>
          {showAdvancedFilters && <div className={styles.advancedFilters}>
            <label className={styles.filterField}><span>Images</span><select value={hasImages} onChange={(event) => { setHasImages(event.target.value); resetPage(); }}><option value="">All Images</option><option value="true">Has images</option><option value="false">Needs images</option></select></label>
            <label className={styles.filterField}><span>Pricing</span><select value={hasPricing} onChange={(event) => { setHasPricing(event.target.value); resetPage(); }}><option value="">Any pricing</option><option value="true">Approved price</option><option value="false">Needs approved price</option></select></label>
            <label className={styles.filterField}><span>Fitment</span><select value={hasFitment} onChange={(event) => { setHasFitment(event.target.value); resetPage(); }}><option value="">Any fitment</option><option value="true">Approved fitment</option><option value="false">Needs fitment</option></select></label>
            <label className={styles.filterField}><span>Listing readiness</span><select value={listingState} onChange={(event) => { setListingState(event.target.value); resetPage(); }}><option value="">Any listing</option><option value="NONE">No draft</option><option value="DRAFT">Draft</option><option value="BLOCKED">Blocked</option><option value="READY">Ready</option></select></label>
            <label className={styles.filterField}><span>Marketplace</span><select value={marketplaceFilter} onChange={(event) => { setMarketplaceFilter(event.target.value); resetPage(); }}><option value="">All Marketplaces</option><option value="EBAY_US">eBay US</option><option value="EBAY_GB">eBay UK</option><option value="EBAY_DE">eBay Germany</option></select></label>
            <label className={styles.filterField}><span>Location</span><select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); resetPage(); }}><option value="">All Locations</option>{catalog.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code}</option>)}</select></label>
            <label className={styles.filterField}><span>Saved view</span><select value={activeSavedViewId} onChange={(event) => {
              const id = event.target.value; setActiveSavedViewId(id);
              const selectedView = savedViews.find((savedView) => savedView.id === id);
              if (selectedView) applySavedFilters(selectedView.filters);
            }}><option value="">Custom filters</option>{savedViews.map((savedView) => <option key={savedView.id} value={savedView.id}>{savedView.name}{savedView.isDefault ? " (default)" : ""}</option>)}</select></label>
            <label className={styles.filterField}><span>Sort</span><select value={sort} onChange={(event) => { setSort(event.target.value); resetPage(); }}><option value="newest">Newest first</option><option value="updated">Recently updated</option><option value="sku">SKU A-Z</option><option value="oldest">Oldest first</option></select></label>
            <div className={styles.advancedActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => void saveCurrentView()}>Save view</button>
              <div className={styles.viewToggle}><button type="button" className={view === "table" ? styles.viewActive : undefined} onClick={() => setView("table")}>Table</button><button type="button" className={view === "gallery" ? styles.viewActive : undefined} onClick={() => setView("gallery")}>Gallery</button></div>
            </div>
          </div>}
        </div>

        {selected.size > 0 && (
          <div className={styles.bulkBar}>
            <b>{selected.size} item{selected.size === 1 ? "" : "s"} selected</b>
            <div className={styles.bulkActions}>
              <button type="button" className={styles.bulkPrimary} disabled={selected.size > 25 || draftBusy} onClick={() => void createDrafts()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
                {draftBusy ? "Preparing..." : "Publish"}
              </button>
              <button type="button" disabled={draftBusy} onClick={() => void openBulkPolicies()}>Shipping</button>
              <button type="button" onClick={() => setBulkEditorOpen(true)}>Edit</button>
              <div className={styles.bulkMore}>
                <button type="button" className={styles.moreBtn} onClick={() => setBulkMoreOpen((value) => !value)} aria-expanded={bulkMoreOpen}>... More</button>
                {bulkMoreOpen && (
                  <div className={styles.moreMenu}>
                    <label>Marketplace
                      <select aria-label="eBay marketplace" value={pricingMarketplace} onChange={(event) => setPricingMarketplace(event.target.value)}><option value="EBAY_US">eBay US</option><option value="EBAY_GB">eBay UK</option><option value="EBAY_DE">eBay Germany</option></select>
                    </label>
                    <button type="button" disabled={selected.size > 25 || pricingBusy || Boolean(pricingJob && ["QUEUED", "RUNNING"].includes(pricingJob.status))} onClick={() => { setBulkMoreOpen(false); void priceSelected(); }}>{pricingBusy ? "Starting..." : "Price selected"}</button>
                    <button type="button" disabled={selected.size > 10 || fitmentBusy || Boolean(fitmentJob && ["QUEUED", "RUNNING"].includes(fitmentJob.status))} onClick={() => { setBulkMoreOpen(false); void findFitment(); }}>{fitmentBusy ? "Working..." : "Find fitment"}</button>
                    <button type="button" onClick={() => { setBulkMoreOpen(false); void archiveSelected(); }}>Archive</button>
                  </div>
                )}
              </div>
              <button type="button" className={styles.bulkClose} aria-label="Clear selection" onClick={() => { setBulkMoreOpen(false); setSelected(new Set()); }}>×</button>
            </div>
          </div>
        )}

        {loading && catalog.parts.length === 0 ? <div className={styles.loadingRows}>Loading catalog...</div> : catalog.parts.length === 0 ? <div className={styles.empty}><b>No parts found</b><span>Adjust your filters or confirm a catalog import.</span></div> : view === "table" ? (
          <div className={`${styles.tableWrap}${loading ? ` ${styles.tableRefreshing}` : ""}`}>
            {loading && <div className={styles.refreshBanner}>Updating catalog…</div>}
            <table>
              <thead>
                <tr>
                  <th><input aria-label="Select current page" type="checkbox" checked={allPageSelected} onChange={togglePage}/></th>
                  <th>SKU</th>
                  <th>Image</th>
                  <th>Title</th>
                  <th>Condition</th>
                  <th>Stock</th>
                  <th>Price</th>
                  <th>Market price</th>
                  <th>Date Added</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {catalog.parts.map((part) => {
                  const latestPrice = part.pricingJobItems[0];
                  const yourPrice = part.inventoryItem?.cost != null ? Number(part.inventoryItem.cost) : null;
                  const priceCurrency = latestPrice?.currency ?? part.inventoryItem?.currency ?? "USD";
                  const qty = part.inventoryItem?.quantity ?? 0;
                  const stockLabel = qty === 0 ? "Out of Stock" : qty <= 5 ? "Low Stock" : "In Stock";
                  const stockTone = qty === 0 ? styles.stockOut : qty <= 5 ? styles.stockLow : styles.stockIn;
                  const needsImages = part.status === "NEEDS_IMAGES" || part._count.media === 0;
                  const published = part.status === "IMPORTED";
                  const isHighlighted = highlightedPartId === part.id;
                  return (
                    <tr key={part.id} data-part-id={part.id} className={isHighlighted ? styles.highlightedRow : undefined}>
                      <td><input aria-label={`Select ${part.sku}`} type="checkbox" checked={selected.has(part.id)} onChange={() => togglePart(part.id)}/></td>
                      <td>
                        <button type="button" className={styles.skuLink} onClick={() => void openPart(part.id)}>{part.sku}</button>
                        <span className={styles.subtle}>{part.primaryPartNumber}</span>
                      </td>
                      <td><CatalogImage mediaId={part.media[0]?.mediaAsset.id} token={token} demo={demo}/></td>
                      <td>
                        <b className={styles.titleCell}>{part.partName || "Unnamed automotive part"}</b>
                        <span className={styles.subtle}>{part.brand || "Brand not set"}</span>
                      </td>
                      <td className={styles.conditionText}>{part.condition === "NEW" ? "New" : "Used"}</td>
                      <td className={styles.stockCell}>
                        <b>{qty}</b>
                        <span className={stockTone}>{stockLabel}</span>
                      </td>
                      <td>
                        {yourPrice != null && yourPrice > 0
                          ? <span className={styles.priceCell}><b>{money(yourPrice, priceCurrency)}</b></span>
                          : <span className={styles.subtle}>—</span>}
                      </td>
                      <td>
                        {latestPrice?.recommendedPrice != null
                          ? <span className={styles.priceCell}><b>{money(latestPrice.recommendedPrice, latestPrice.currency!)}</b></span>
                          : latestPrice?.status === "NO_MATCHES"
                            ? <span className={styles.subtle}>No matches</span>
                            : <span className={styles.subtle}>—</span>}
                      </td>
                      <td className={styles.dateCell}>{new Date(part.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td>
                        {needsImages ? (
                          <span className={`${styles.statusPill} ${styles.needs_images}`}>Need Images</span>
                        ) : published ? (
                          <span className={`${styles.statusPill} ${styles.imported}`}>Published</span>
                        ) : (
                          <button type="button" className={styles.publishBtn} disabled={draftBusy} onClick={() => void createDrafts([part.id])}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
                            Publish
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.gallery}>{catalog.parts.map((part) => <article key={part.id} className={styles.partCard}><button type="button" className={styles.cardSelect} aria-label={`Select ${part.sku}`} onClick={() => togglePart(part.id)}>{selected.has(part.id) ? "✓" : "+"}</button><CatalogImage mediaId={part.media[0]?.mediaAsset.id} token={token} demo={demo}/><span className={`${styles.statusPill} ${styles[part.status.toLowerCase()]}`}>{humanStatus(part.status)}</span><h3>{part.partName || "Unnamed automotive part"}</h3><p>{part.brand || "Brand not set"} · {part.condition}</p><div><b>{part.sku}</b><span>{part.primaryPartNumber}</span></div><footer><span>{part.inventoryItem?.quantity ?? 0} in stock</span><button type="button" onClick={() => void openManualFitment(part.id)}>Fitment</button><button type="button" onClick={() => void openPart(part.id)}>Edit part</button></footer></article>)}</div>
        )}

        <div className={styles.pagination}>
          <span>Showing {catalog.parts.length ? ((catalog.pagination.page - 1) * catalog.pagination.pageSize) + 1 : 0} to {Math.min(catalog.pagination.page * catalog.pagination.pageSize, catalog.pagination.total)} of {catalog.pagination.total} results</span>
          <div className={styles.pageSize}>
            <span>Rows per page</span>
            <strong>25</strong>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page">‹</button>
            <em className={styles.pageCurrent}>{catalog.pagination.page}</em>
            <button type="button" disabled={page >= catalog.pagination.totalPages} onClick={() => setPage((value) => value + 1)} aria-label="Next page">›</button>
          </div>
        </div>
      </section>
    </section>

    {bulkEditorOpen && <div className={styles.modalBackdrop} role="presentation"><section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="bulk-edit-title"><header><div><span className={styles.eyebrow}>ATOMIC BULK EDIT</span><h2 id="bulk-edit-title">Edit {selected.size} catalog parts</h2></div><button aria-label="Close bulk editor" onClick={() => setBulkEditorOpen(false)}>×</button></header><form onSubmit={bulkEditSelected}><div className={styles.formGrid}>
      <label><span>Status</span><select name="status"><option value="">No change</option>{statuses.map((value) => <option key={value} value={value}>{humanStatus(value)}</option>)}</select></label>
      <label><span>Condition</span><select name="condition"><option value="">No change</option><option value="NEW">New</option><option value="USED">Used</option></select></label>
      <label><span>Quantity</span><input name="quantity" type="number" min="0" placeholder="No change"/></label>
      <label><span>Placement</span><select name="placement"><option value="">No change</option><option value="__CLEAR__">Clear placement</option><option value="Front">Front</option><option value="Rear">Rear</option><option value="Left">Left</option><option value="Right">Right</option><option value="Upper">Upper</option><option value="Lower">Lower</option></select></label>
      <label><span>Warehouse</span><select name="warehouseCode"><option value="">No change</option><option value="__CLEAR__">Clear warehouse and bin</option>{catalog.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.code}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
      <label><span>Bin location</span><input name="binLocation" placeholder="Optional for selected warehouse"/></label>
    </div><p className={styles.bulkWarning}>This operation is all-or-nothing. Listing drafts linked to changed catalog records will be blocked until reviewed.</p><div className={styles.formActions}><button type="button" onClick={() => setBulkEditorOpen(false)}>Cancel</button><button className={styles.primary} disabled={saving}>{saving ? "Updating..." : "Apply to selected"}</button></div></form></section></div>}
    {bulkPoliciesOpen && <div className={styles.modalBackdrop} role="presentation"><section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="bulk-policy-title"><header><div><span className={styles.eyebrow}>EBAY BUSINESS POLICIES</span><h2 id="bulk-policy-title">Assign to {selected.size} {pricingMarketplace} drafts</h2></div><button aria-label="Close policy assignment" onClick={() => setBulkPoliciesOpen(false)}>×</button></header><form onSubmit={assignBulkPolicies}><div className={styles.formGrid}>
      <label><span>Payment policy</span><select name="paymentPolicyId" required defaultValue=""><option value="" disabled>Select policy</option>{sellerResources?.paymentPolicies.filter(({ enabled }) => enabled).map((resource) => <option key={resource.remoteId} value={resource.remoteId}>{resource.name}</option>)}</select></label>
      <label><span>Return policy</span><select name="returnPolicyId" required defaultValue=""><option value="" disabled>Select policy</option>{sellerResources?.returnPolicies.filter(({ enabled }) => enabled).map((resource) => <option key={resource.remoteId} value={resource.remoteId}>{resource.name}</option>)}</select></label>
      <label><span>Shipping policy</span><select name="shippingPolicyId" required defaultValue=""><option value="" disabled>Select policy</option>{sellerResources?.fulfillmentPolicies.filter(({ enabled }) => enabled).map((resource) => <option key={resource.remoteId} value={resource.remoteId}>{resource.name}</option>)}</select></label>
      <label><span>Merchant location</span><select name="merchantLocationKey" required defaultValue=""><option value="" disabled>Select location</option>{sellerResources?.inventoryLocations.filter(({ enabled }) => enabled).map((resource) => <option key={resource.remoteId} value={resource.remoteId}>{resource.name}</option>)}</select></label>
    </div>{sellerResources && !sellerResources.paymentPolicies.length && <p className={styles.bulkWarning}>No cached seller policies were found. Open a listing draft and refresh eBay policies and locations first.</p>}<div className={styles.formActions}><button type="button" onClick={() => setBulkPoliciesOpen(false)}>Cancel</button><button className={styles.primary} disabled={draftBusy}>{draftBusy ? "Assigning..." : "Assign and recalculate readiness"}</button></div></form></section></div>}
    {fitmentEditor && <div className={styles.modalBackdrop} role="presentation"><section className={`${styles.drawer} ${styles.fitmentManager}`} role="dialog" aria-modal="true" aria-labelledby="fitment-editor-title"><header><div><span className={styles.eyebrow}>FITMENT REVIEW</span><h2 id="fitment-editor-title">{fitmentEditor.part.sku} · {fitmentEditor.marketplace}</h2></div><button aria-label="Close fitment editor" onClick={() => setFitmentEditor(null)}>×</button></header>
      {fitmentEditor.part.donorVehicle && <div className={styles.donorEvidence}><b>Donor VIN {fitmentEditor.part.donorVehicle.vin}</b><span>{[fitmentEditor.part.donorVehicle.year, fitmentEditor.part.donorVehicle.make, fitmentEditor.part.donorVehicle.model, fitmentEditor.part.donorVehicle.trim, fitmentEditor.part.donorVehicle.engine].filter(Boolean).join(" · ")}</span></div>}
      <form onSubmit={createManualApplication}><span className={styles.eyebrow}>NEW APPLICATION</span><div className={styles.formGrid}>
        <label><span>Source</span><select name="source" defaultValue={fitmentEditor.part.donorVehicle ? "DONOR_VEHICLE" : "MANUAL"}><option value="MANUAL">Manual research</option>{fitmentEditor.part.donorVehicle && <option value="DONOR_VEHICLE">Donor VIN vehicle</option>}</select></label>
        <label><span>Year</span><input name="year" defaultValue={fitmentEditor.part.donorVehicle?.year ?? ""} required/></label>
        <label><span>Make</span><input name="make" defaultValue={fitmentEditor.part.donorVehicle?.make ?? ""} required/></label>
        <label><span>Model</span><input name="model" defaultValue={fitmentEditor.part.donorVehicle?.model ?? ""} required/></label>
        <label><span>Trim</span><input name="trim" defaultValue={fitmentEditor.part.donorVehicle?.trim ?? ""}/></label>
        <label><span>Engine</span><input name="engine" defaultValue={fitmentEditor.part.donorVehicle?.engine ?? ""}/></label>
        <label className={styles.wide}><span>Evidence / notes</span><textarea name="notes" placeholder="Source, catalog, VIN decoder, or validation notes"/></label>
      </div><button className={styles.primary} disabled={manualFitmentBusy}>{manualFitmentBusy ? "Saving..." : "Create pending application"}</button></form>
      <div className={styles.applicationCards}>{fitmentEditor.applications.map((application) => <article key={application.id} className={styles.applicationCard}>
        <div><span className={`${styles.jobStatus} ${application.status === "APPROVED" ? styles.job_completed : application.status === "PENDING" ? styles.job_queued : styles.job_failed}`}>{humanStatus(application.status)}</span><small>{humanStatus(application.source)} · revision {application.revision}</small></div>
        <h3>{application.properties.Year} {application.properties.Make} {application.properties.Model}</h3>
        <p>{Object.entries(application.properties).map(([name, value]) => `${name}: ${value}`).join(" · ")}</p>
        {application.sourceVehicle && <small>Evidence VIN: {application.sourceVehicle.vin}</small>}
        {application.notes && <small>{application.notes}</small>}
        {application.decisionReason && <small>Decision: {application.decisionReason}</small>}
        <div className={styles.applicationActions}>
          {application.status === "PENDING" && <><button disabled={manualFitmentBusy} onClick={() => void decideManualApplication(application, "APPROVE")}>Approve & add</button><button disabled={manualFitmentBusy} onClick={() => void decideManualApplication(application, "APPROVE", true)}>Approve & replace</button><button disabled={manualFitmentBusy} onClick={() => void decideManualApplication(application, "REJECT")}>Reject</button></>}
          {application.status === "APPROVED" && <button disabled={manualFitmentBusy} onClick={() => void decideManualApplication(application, "SUPERSEDE")}>Remove approval</button>}
          {application.source !== "EBAY_CATALOG" && application.status !== "SUPERSEDED" && <button disabled={manualFitmentBusy} onClick={() => void reviseManualApplication(application)}>Revise</button>}
        </div>
        {application.revisions.length > 0 && <details><summary>Revision history</summary>{application.revisions.map((revision) => <small key={revision.id}>v{revision.revision} · {revision.reason || "Updated"} · {new Date(revision.createdAt).toLocaleString()}</small>)}</details>}
      </article>)}</div>
    </section></div>}
    {detail && <div className={styles.modalBackdrop} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDetail(null); }}>
      <section className={`${styles.drawer} ${styles.inventoryModal}`} role="dialog" aria-modal="true" aria-labelledby="edit-part-title">
        <header className={styles.inventoryHeader}>
          <div>
            <span className={styles.inventoryEyebrow}>Catalog part</span>
            <h2 id="edit-part-title">Inventory details</h2>
          </div>
          <div className={styles.inventoryHeaderActions}>
            {detailMode === "view" ? (
              <button type="button" className={styles.editDetailsBtn} onClick={() => setDetailMode("edit")}>Edit details</button>
            ) : (
              <button type="button" className={styles.ghostBtn} onClick={() => setDetailMode("view")}>Cancel edit</button>
            )}
            <button type="button" className={styles.iconClose} aria-label="Close editor" onClick={() => setDetail(null)}>×</button>
          </div>
        </header>

        {detailMode === "view" ? (
          <div className={styles.inventoryBody}>
            {(() => {
              const stock = stockStatus(detail.inventoryItem?.quantity ?? 0);
              const ebay = ebayStatusLabel(detail);
              const priceLabel = detail.listingDrafts?.[0]?.price != null
                ? money(detail.listingDrafts[0].price, detail.listingDrafts[0].currency)
                : detail.inventoryItem
                  ? money(detail.inventoryItem.cost, detail.inventoryItem.currency)
                  : "—";
              const categoryLabel = detail.listingDrafts?.[0]?.categoryId
                ? `eBay category ${detail.listingDrafts[0].categoryId}`
                : detail.donorVehicle
                  ? [detail.donorVehicle.year, detail.donorVehicle.make, detail.donorVehicle.model].filter(Boolean).join(" ")
                  : "Not assigned";
              const title = detailTitle(detail);
              const partNameDistinct = detail.partName
                && detail.partName.trim().toLowerCase() !== title.trim().toLowerCase();
              const fitmentItems = detail.fitmentApplications && detail.fitmentApplications.length > 0
                ? detail.fitmentApplications
                : detail.donorVehicle
                  ? [{ id: "donor", properties: { Year: String(detail.donorVehicle.year ?? ""), Make: detail.donorVehicle.make ?? "", Model: detail.donorVehicle.model ?? "" } }]
                  : [];
              const addedOn = new Date(detail.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              const shippingPolicy = detail.listingDrafts?.[0]?.shippingPolicyId;

              return (
                <>
                  <div className={styles.inventoryHero}>
                    <div className={styles.inventoryHeroMedia}>
                      <CatalogImage mediaId={detail.media[0]?.mediaAsset.id} token={token} demo={demo} />
                      {detail.media.length > 1 && <span className={styles.mediaCount}>{detail.media.length} photos</span>}
                    </div>
                    <div className={styles.inventoryHeroCopy}>
                      <div className={styles.inventoryBadges}>
                        <span className={`${styles.statusBadge} ${styles[`tone_${stock.tone}`]}`}>{stock.label}</span>
                        <span className={`${styles.statusBadge} ${styles[`tone_${ebay.tone}`]}`}>{ebay.label}</span>
                        <span className={`${styles.statusBadge} ${styles.tone_muted}`}>{humanStatus(detail.condition)}</span>
                      </div>
                      <h3>{title}</h3>
                      <div className={styles.heroMetaRow}>
                        <button type="button" className={styles.skuCopy} onClick={() => void copySku(detail.sku)}>
                          <span>SKU</span>
                          <code>{detail.sku}</code>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        </button>
                        <span className={styles.heroDivider} aria-hidden="true" />
                        <span className={styles.heroMetaItem}>
                          <span>Added</span>
                          <b>{addedOn}</b>
                        </span>
                        <span className={styles.heroDivider} aria-hidden="true" />
                        <span className={styles.heroMetaItem}>
                          <span>Status</span>
                          <b>{humanStatus(detail.status)}</b>
                        </span>
                      </div>
                      <div className={styles.statStrip}>
                        <article>
                          <span>Price</span>
                          <b>{priceLabel}</b>
                        </article>
                        <article>
                          <span>Quantity</span>
                          <b className={styles[`stock_${stock.tone}`]}>{detail.inventoryItem?.quantity ?? 0}</b>
                        </article>
                        <article>
                          <span>OEM</span>
                          <b>{detail.primaryPartNumber}</b>
                        </article>
                        <article>
                          <span>Brand</span>
                          <b>{detail.brand || "—"}</b>
                        </article>
                      </div>
                    </div>
                  </div>

                  <div className={styles.inventorySections}>
                    <section className={styles.inventoryPanel}>
                      <header>
                        <h4>Listing details</h4>
                        <p>Classification shown on drafts and catalogs</p>
                      </header>
                      <dl className={styles.metaList}>
                        {partNameDistinct ? <div><dt>Part name</dt><dd>{detail.partName}</dd></div> : null}
                        <div><dt>Category</dt><dd>{categoryLabel}</dd></div>
                        <div><dt>Condition</dt><dd>{humanStatus(detail.condition)}</dd></div>
                        <div><dt>Placement</dt><dd>{detail.placement || "—"}</dd></div>
                      </dl>
                    </section>

                    <section className={styles.inventoryPanel}>
                      <header>
                        <h4>Warehouse & policies</h4>
                        <p>Where it sits and how it ships</p>
                      </header>
                      <dl className={styles.metaList}>
                        <div><dt>Warehouse</dt><dd>{detail.inventoryItem?.warehouse?.name || detail.inventoryItem?.warehouse?.code || "Unassigned"}</dd></div>
                        <div><dt>Bin</dt><dd>{detail.inventoryItem?.binLocation?.code || "—"}</dd></div>
                        <div>
                          <dt>Shipping</dt>
                          <dd>
                            {shippingPolicy || "Not assigned"}
                            {shippingPolicy ? <em className={styles.infoPill}>Assigned</em> : <em className={styles.mutedPill}>Needed</em>}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  </div>

                  <section className={styles.inventoryPanel}>
                    <header>
                      <h4>Description</h4>
                      <p>Buyer-facing copy and internal notes</p>
                    </header>
                    <p className={styles.descriptionText}>{detail.description || "No description provided."}</p>
                    {detail.notes ? (
                      <div className={styles.notesBlock}>
                        <span>Internal notes</span>
                        <p>{detail.notes}</p>
                      </div>
                    ) : null}
                  </section>

                  <section className={styles.inventoryPanel}>
                    <header className={styles.panelHead}>
                      <div>
                        <h4>Product images</h4>
                        <p>{detail.media.length ? `${detail.media.length} attached` : "No images yet"}</p>
                      </div>
                      <button type="button" className={styles.uploadGhost} onClick={() => setNotice("Image upload is available from the import pipeline for this part.")}>
                        Upload images
                      </button>
                    </header>
                    <div className={styles.detailImages}>
                      {(detail.media.length ? detail.media : [{ id: "placeholder", displayOrder: 0, mediaAsset: { id: "", originalFilename: "", mimeType: "" } }]).slice(0, 8).map((item, index) => (
                        <div key={item.id} className={`${styles.detailImage} ${index === 0 ? styles.detailImageMain : ""}`}>
                          <CatalogImage mediaId={item.mediaAsset.id || undefined} token={token} demo={demo} />
                          <span className={styles.badge}>{index + 1}</span>
                          {index === 0 && <span className={styles.mainTag}>Main</span>}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={styles.inventoryPanel}>
                    <header className={styles.panelHead}>
                      <div>
                        <h4>Fitment</h4>
                        <p>{fitmentItems.length ? `${fitmentItems.length} vehicle application${fitmentItems.length === 1 ? "" : "s"}` : "No approved fitment yet"}</p>
                      </div>
                      <button type="button" className={styles.uploadGhost} onClick={() => void openManualFitment(detail.id)}>Manage</button>
                    </header>
                    <div className={styles.fitmentChips}>
                      {fitmentItems.map((application) => (
                        <span key={application.id} className={styles.fitmentChip}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 13l2-5h14l2 5M5 13v5h2v-2h10v2h2v-5"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/></svg>
                          {fitmentLabel(application.properties)}
                          <i>✓</i>
                        </span>
                      ))}
                      {!fitmentItems.length && (
                        <span className={styles.emptyFitment}>Add vehicle compatibility so this part can publish cleanly.</span>
                      )}
                    </div>
                  </section>
                </>
              );
            })()}
          </div>
        ) : (
          <form onSubmit={savePart}>
            <div className={styles.formGrid}>
              <label><span>SKU</span><input name="sku" defaultValue={detail.sku} required/></label>
              <label><span>Primary part number</span><input name="primaryPartNumber" defaultValue={detail.primaryPartNumber} required/></label>
              <label><span>Brand</span><input name="brand" defaultValue={detail.brand ?? ""}/></label>
              <label><span>Part name</span><input name="partName" defaultValue={detail.partName ?? ""}/></label>
              <label><span>Condition</span><select name="condition" defaultValue={detail.condition}><option value="NEW">New</option><option value="USED">Used</option></select></label>
              <label><span>Catalog status</span><select name="status" defaultValue={detail.status}>{statuses.map((value) => <option key={value} value={value}>{humanStatus(value)}</option>)}</select></label>
              <label><span>Quantity</span><input name="quantity" type="number" min="0" defaultValue={detail.inventoryItem?.quantity ?? 0}/></label>
              <label><span>Cost</span><input name="cost" type="number" min="0" step="0.01" defaultValue={Number(detail.inventoryItem?.cost ?? 0)}/></label>
              <label><span>Currency</span><input name="currency" maxLength={3} defaultValue={detail.inventoryItem?.currency ?? "USD"}/></label>
              <label><span>Warehouse</span><input name="warehouseCode" defaultValue={detail.inventoryItem?.warehouse?.code ?? ""}/></label>
              <label><span>Bin location</span><input name="binLocation" defaultValue={detail.inventoryItem?.binLocation?.code ?? ""}/></label>
              <label><span>Placement</span><input name="placement" defaultValue={detail.placement ?? ""}/></label>
              <label><span>Weight</span><input name="weight" type="number" min="0" step="0.001" defaultValue={detail.inventoryItem?.weight == null ? "" : Number(detail.inventoryItem.weight)}/></label>
              <label><span>Weight unit</span><select name="weightUnit" defaultValue={detail.inventoryItem?.weightUnit ?? "LB"}><option value="LB">lb</option><option value="KG">kg</option></select></label>
              <label><span>Length</span><input name="length" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.length == null ? "" : Number(detail.inventoryItem.length)}/></label>
              <label><span>Width</span><input name="width" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.width == null ? "" : Number(detail.inventoryItem.width)}/></label>
              <label><span>Height</span><input name="height" type="number" min="0" step="0.01" defaultValue={detail.inventoryItem?.height == null ? "" : Number(detail.inventoryItem.height)}/></label>
              <label><span>Dimension unit</span><select name="dimensionUnit" defaultValue={detail.inventoryItem?.dimensionUnit ?? "IN"}><option value="IN">in</option><option value="CM">cm</option></select></label>
              <label className={styles.wide}><span>Description</span><textarea name="description" defaultValue={detail.description ?? ""}/></label>
              <label className={styles.wide}><span>Internal notes</span><textarea name="notes" defaultValue={detail.notes ?? ""}/></label>
            </div>
            <div className={styles.formActions}>
              <button type="button" onClick={() => setDetailMode("view")}>Back</button>
              <button type="button" onClick={() => setDetail(null)}>Cancel</button>
              <button className={styles.primary} disabled={saving}>{saving ? "Saving..." : demo ? "Close preview" : "Save changes"}</button>
            </div>
          </form>
        )}
      </section>
    </div>}
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
  </>;
}
