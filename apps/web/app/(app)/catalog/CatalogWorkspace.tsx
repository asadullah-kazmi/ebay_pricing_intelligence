"use client";

import Link from "next/link";
import { FormEvent, type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./catalog.module.css";
import { useAuth } from "../../components/AuthProvider";
import { useWorkspacePathname } from "../../components/WorkspaceProvider";
import { apiBase, apiRequest, refreshAccessSession, SessionExpiredError } from "../../lib/auth-session";
import { dismissFitmentJob, isDismissedFitmentJob, isDismissedPricingJob, shouldAutoShowJob } from "../../lib/dismissed-jobs";
import { permissionSet } from "../../lib/organization-access";
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
  const draftTitle = part.listingDrafts?.[0]?.title?.trim();
  if (draftTitle) return draftTitle;

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

function catalogTitle(part: CatalogPartCard) {
  return part.listingTitle?.trim()
    || part.listingDrafts?.[0]?.title?.trim()
    || part.partName?.trim()
    || "Unnamed automotive part";
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
  if (draft?.status === "READY") return { label: "Draft ready", tone: "good" as const };
  if (draft?.status === "BLOCKED") return { label: "Draft needs fixes", tone: "warn" as const };
  if (part.status === "NEEDS_IMAGES") return { label: "Need Images", tone: "warn" as const };
  if (part.status === "READY_FOR_ENRICHMENT") return { label: "Ready for review", tone: "good" as const };
  if (part.status === "ARCHIVED") return { label: "Archived", tone: "muted" as const };
  return { label: humanStatus(part.status), tone: "muted" as const };
}

function cardToDetailPreview(card: CatalogPartCard): CatalogPartDetail {
  return {
    ...card,
    description: null,
    donorMileage: null,
    donorColor: null,
    placement: null,
    notes: null,
    partNumbers: [{ id: "primary", type: "PRIMARY", value: card.primaryPartNumber }],
    inventoryItem: card.inventoryItem
      ? {
          quantity: card.inventoryItem.quantity,
          cost: card.inventoryItem.cost,
          currency: card.inventoryItem.currency,
          warehouse: card.inventoryItem.warehouse ?? null,
          binLocation: card.inventoryItem.binLocation ?? null,
          weight: null,
          weightUnit: null,
          length: null,
          width: null,
          height: null,
          dimensionUnit: null,
        }
      : null,
    media: (card.media.length ? card.media : []).map((item, index) => ({
      id: `preview-${item.mediaAsset.id || index}`,
      displayOrder: index,
      mediaAsset: {
        id: item.mediaAsset.id,
        originalFilename: "",
        mimeType: item.mediaAsset.mimeType ?? "image/jpeg",
      },
    })),
    fitmentApplications: [],
    listingDrafts: [],
  };
}

const detailCache = new Map<string, CatalogPartDetail>();

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

type DetailIconName = "brand" | "condition" | "part" | "price" | "quantity" | "stock" | "team" | "ebay" | "location" | "date";

function DetailIcon({ name }: { name: DetailIconName }) {
  const paths: Record<DetailIconName, ReactNode> = {
    brand: <><path d="M20 13 13 20a2 2 0 0 1-2.8 0L4 13.8A2 2 0 0 1 3.6 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l6 6a2 2 0 0 1 0 2.8Z"/><circle cx="8.5" cy="8.5" r="1.3"/></>,
    condition: <><path d="m12 3-8 4 8 4 8-4-8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
    part: <><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4.5 6.8 7.5 4.3 7.5-4.3M12 11v9"/></>,
    price: <><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.7-1.7-1-3-1-1.7 0-3 .8-3 2s1 1.8 3 2.3 3 1.1 3 2.5-1.3 2.2-3 2.2c-1.2 0-2.3-.4-3-1.2M12 5v14"/></>,
    quantity: <><path d="M9 3 7 21M17 3l-2 18M4 9h16M3 15h16"/></>,
    stock: <><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4.5 6.8 7.5 4.3 7.5-4.3M12 11v9"/></>,
    team: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 4.5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4.5V20"/></>,
    ebay: <><path d="M20 13 13 20a2 2 0 0 1-2.8 0L4 13.8A2 2 0 0 1 3.6 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l6 6a2 2 0 0 1 0 2.8Z"/><circle cx="8.5" cy="8.5" r="1.3"/></>,
    location: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    date: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  };
  return <svg className={styles.detailIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function CatalogWorkspace() {
  const { status: authStatus, token, demo, apiFetch, session } = useAuth();
  const access = permissionSet(session?.role, session?.permissions);
  const canEditCatalog = access.has("catalog.edit");
  const canDeleteCatalog = access.has("catalog.delete");
  const canPublishCatalog = access.has("catalog.publish");
  const canRunPricing = access.has("pricing.run");
  const canManageFitment = access.has("fitment.manage");
  const searchParams = useSearchParams();
  const workspacePathname = useWorkspacePathname();
  const readinessPage = workspacePathname.startsWith("/catalog/readiness");
  const [catalog, setCatalog] = useState<CatalogResponse>(emptyCatalog);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
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
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useState<"table" | "gallery">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CatalogPartDetail | null>(null);
  const [detailHydrating, setDetailHydrating] = useState(false);
  const detailRequestId = useRef(0);
  const [saving, setSaving] = useState(false);
  const [highlightedPartId, setHighlightedPartId] = useState<string | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const skipDefaultSavedViewRef = useRef(
    searchParams.get("from") === "quick-sku" || Boolean(searchParams.get("highlight")),
  );

  function clearCatalogFilters(nextSort = "newest") {
    setSearch("");
    setStatus("");
    setCondition("");
    setBrand("");
    setHasImages("");
    setHasPricing("");
    setHasFitment("");
    setListingState("");
    setHasShippingPolicy("");
    setMarketplaceFilter("");
    setWarehouseId("");
    setMinQuantity("");
    setMaxQuantity("");
    setMinCost("");
    setMaxCost("");
    setCreatedFrom("");
    setCreatedTo("");
    setActiveSavedViewId("");
    setSort(nextSort === "oldest" || nextSort === "updated" || nextSort === "sku" ? nextSort : "newest");
    setPage(1);
  }

  useEffect(() => {
    const fromQuickSku = searchParams.get("from") === "quick-sku";
    const highlight = searchParams.get("highlight");
    const query = searchParams.get("q");
    const sortParam = searchParams.get("sort");

    // Soft-nav keeps Catalog mounted — force a clean newest-first reload after Quick SKU.
    if (fromQuickSku || highlight) {
      skipDefaultSavedViewRef.current = true;
      clearCatalogFilters(sortParam ?? "newest");
      setHighlightedPartId(null);
      setListRefreshKey((key) => key + 1);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", "/catalog?sort=newest");
      }
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
  const [draftPartDetail, setDraftPartDetail] = useState<CatalogPartDetail | null>(null);
  const [draftMode, setDraftMode] = useState<"view" | "edit">("view");
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
    request("/api/listing-drafts?limit=100")
      .then((value) => setDrafts(value as ListingDraft[]))
      .catch(() => undefined);
  }, [authStatus, demo, request]);

  useEffect(() => {
    if (authStatus !== "ready" || demo) return;
    request("/api/catalog/saved-views")
      .then((value) => {
        const views = value as CatalogSavedView[];
        setSavedViews(views);
        // Coming from Quick SKU: show full newest-first list, not a saved filter.
        if (skipDefaultSavedViewRef.current || searchParams.get("from") === "quick-sku" || searchParams.get("highlight")) return;
        const defaultView = views.find(({ isDefault }) => isDefault);
        if (defaultView) {
          setActiveSavedViewId(defaultView.id);
          applySavedFilters(defaultView.filters);
        }
      })
      .catch(() => undefined);
  }, [authStatus, demo, request, searchParams]);

  const queryString = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
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
  }, [brand, condition, createdFrom, createdTo, deferredSearch, hasFitment, hasImages, hasPricing, hasShippingPolicy, listingState, marketplaceFilter, maxCost, maxQuantity, minCost, minQuantity, page, pageSize, sort, status, warehouseId]);

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
  }, [authStatus, demo, queryString, request, listRefreshKey]);

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
        ...cardToDetailPreview(card),
        description: "This used OEM seat track cover was carefully removed from a donor vehicle. Surface wear is consistent with age. Compatible with listed Audi A6 applications. Part number 4F088134701C verified.",
        donorMileage: 48600,
        donorColor: "Black",
        placement: "Rear",
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
          version: 1,
          title: `${card.partName || "Automotive Part"} ${card.primaryPartNumber}`,
          description: "<p>Professionally inspected used OEM automotive part.</p>",
          categoryId: "262201",
          paymentPolicyId: "payment-demo",
          paymentPolicyName: "Standard payment policy",
          returnPolicyId: "return-demo",
          returnPolicyName: "30-day returns",
          shippingPolicyId: "ship-custom",
          shippingPolicyName: "Standard shipping",
          price: Number(card.inventoryItem?.cost ?? 19.58),
          currency: "USD",
          quantity: card.inventoryItem?.quantity ?? 1,
          aspects: { "Country/Region of Manufacture": ["Germany"] },
          teams: [{ id: "team-demo", name: "Catalog Team", color: "#2563EB" }],
          updatedAt: new Date().toISOString(),
        }],
        categoryName: "Other Car & Truck Parts & Accessories",
      });
      return;
    }

    setError("");
    setDetailMode("view");
    const cached = detailCache.get(id);
    const card = catalog.parts.find((part) => part.id === id);
    if (cached) {
      setDetail(cached);
      setDetailHydrating(false);
    } else if (card) {
      setDetail(cardToDetailPreview(card));
      setDetailHydrating(true);
    } else {
      setDetailHydrating(true);
    }

    const requestId = ++detailRequestId.current;
    try {
      const full = await request(`/api/parts/${id}`) as CatalogPartDetail;
      if (requestId !== detailRequestId.current) return;
      detailCache.set(id, full);
      setDetail(full);
    } catch (caught) {
      if (requestId !== detailRequestId.current) return;
      if (!detailCache.has(id) && !card) {
        setError(caught instanceof Error ? caught.message : "Unable to open part");
        setDetail(null);
      } else {
        setNotice(caught instanceof Error ? caught.message : "Unable to refresh part details");
      }
    } finally {
      if (requestId === detailRequestId.current) setDetailHydrating(false);
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
    const draft = detail.listingDrafts?.[0];
    const description = String(form.get("description") ?? "").trim() || null;
    const body = {
      sku: String(form.get("sku")), primaryPartNumber: String(form.get("primaryPartNumber")),
      brand: String(form.get("brand")) || null, partName: String(form.get("partName")) || null,
      description, condition: form.get("condition") as PartCondition,
      status: detail.status, placement: detail.placement,
      notes: detail.notes,
      inventory: {
        quantity: Number(form.get("quantity")), cost: Number(detail.inventoryItem?.cost ?? 0), currency: detail.inventoryItem?.currency ?? "USD",
        warehouseCode: String(form.get("warehouseCode")) || null,
        binLocation: String(form.get("warehouseCode")) === (detail.inventoryItem?.warehouse?.code ?? "") ? detail.inventoryItem?.binLocation?.code ?? null : null,
        weight: detail.inventoryItem?.weight == null ? null : Number(detail.inventoryItem.weight),
        weightUnit: detail.inventoryItem?.weightUnit ?? null,
        length: detail.inventoryItem?.length == null ? null : Number(detail.inventoryItem.length),
        width: detail.inventoryItem?.width == null ? null : Number(detail.inventoryItem.width),
        height: detail.inventoryItem?.height == null ? null : Number(detail.inventoryItem.height),
        dimensionUnit: detail.inventoryItem?.dimensionUnit ?? null,
      },
    };
    setSaving(true);
    setError("");
    try {
      await request(`/api/parts/${detail.id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (draft) {
        const aspects = { ...draft.aspects };
        const countryOfOrigin = String(form.get("countryOfOrigin") ?? "").trim();
        if (countryOfOrigin) aspects["Country/Region of Manufacture"] = [countryOfOrigin];
        else delete aspects["Country/Region of Manufacture"];
        await request(`/api/listing-drafts/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            expectedVersion: draft.version,
            reason: "Catalog part details update",
            title: String(form.get("title") ?? draft.title).trim(),
            description,
            condition: form.get("condition") as PartCondition,
            price: form.get("price") === "" ? null : Number(form.get("price")),
            quantity: Number(form.get("quantity")),
            aspects,
          }),
        });
      }
      detailCache.delete(detail.id); setDetail(null); await loadCatalog();
    }
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

  async function deleteParts(partIds: string[]) {
    if (!partIds.length || demo) return;
    const label = partIds.length === 1 ? "this listing" : `${partIds.length} listings`;
    if (!window.confirm(`Delete ${label}?\n\nThis permanently removes the part from your catalog and cannot be undone.`)) return;
    setLoading(true);
    setError("");
    try {
      if (partIds.length === 1) {
        await request(`/api/parts/${partIds[0]}`, { method: "DELETE" });
      } else {
        await request("/api/parts/bulk-delete", {
          method: "POST",
          body: JSON.stringify({ partIds }),
        });
      }
      for (const id of partIds) detailCache.delete(id);
      if (detail && partIds.includes(detail.id)) setDetail(null);
      setSelected((current) => {
        const next = new Set(current);
        for (const id of partIds) next.delete(id);
        return next;
      });
      setNotice(partIds.length === 1 ? "Listing deleted." : `${partIds.length} listings deleted.`);
      await loadCatalog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete listing");
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelected() {
    await deleteParts([...selected]);
    setBulkMoreOpen(false);
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
      setDrafts((current) => [...created, ...current.filter((draft) => !created.some(({ id }) => id === draft.id))].slice(0, 100));
      if (!partIds) setSelected(new Set());
      setNotice(`${created.length} listing draft${created.length === 1 ? "" : "s"} prepared with the HTML description template. Open a draft to review, then resolve readiness blockers before publishing.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create listing drafts"); }
    finally { setDraftBusy(false); }
  }

  async function openDraft(id: string, mode: "view" | "edit" = "view") {
    setError("");
    setCategoryAspects([]);
    setCategoryConditions([]);
    setInventoryPreparation(null);
    setInventoryPreparationJob(null);
    setInventorySyncJob(null);
    setEbayOffer(null);
    setEbayOfferJob(null);
    setListingOperationJob(null);
    setDraftMode(mode);
    setDraftPartDetail(null);
    try {
      const draft = await request(`/api/listing-drafts/${id}`) as ListingDraft;
      setDraftDetail(draft);
      request(`/api/parts/${draft.partId}`)
        .then((value) => setDraftPartDetail(value as CatalogPartDetail))
        .catch(() => undefined);
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
    const brandValue = String(form.get("aspect-brand") ?? "").trim();
    if (brandValue) aspects.Brand = [brandValue];
    else delete aspects.Brand;
    const partTypeValue = String(form.get("aspect-part-type") ?? "").trim();
    if (partTypeValue) {
      if (aspects.Type || categoryAspects.some((item) => item.name === "Type")) aspects.Type = [partTypeValue];
      else aspects["Part Type"] = [partTypeValue];
    }
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
      setDraftMode("view");
      request(`/api/parts/${updated.partId}`)
        .then((value) => setDraftPartDetail(value as CatalogPartDetail))
        .catch(() => undefined);
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
  const readyDraftCount = drafts.filter(({ status: draftStatus }) => draftStatus === "READY").length;
  const blockedDraftCount = drafts.filter(({ status: draftStatus }) => draftStatus === "BLOCKED").length;

  return <>
    <section className={styles.workspace}>
      {readinessPage && <section className={styles.readinessPage}>
        <header className={styles.readinessPageHeader}>
          <div>
            <span className={styles.eyebrow}>PUBLICATION READINESS</span>
            <h1>Listing drafts</h1>
            <p>Review and resolve listing issues before publishing inventory to eBay.</p>
          </div>
          <Link href="/catalog" className={styles.readinessBack}><span aria-hidden="true">←</span> Back to catalog</Link>
        </header>

        <div className={styles.readinessStats}>
          <div><span>Total drafts</span><b>{drafts.length}</b></div>
          <div className={styles.readinessReadyStat}><span>Ready</span><b>{readyDraftCount}</b></div>
          <div className={styles.readinessBlockedStat}><span>Blocked</span><b>{blockedDraftCount}</b></div>
        </div>

        <section className={styles.readinessPageCard}>
          <div className={styles.readinessPageCardHead}>
            <div><strong>Draft inventory</strong><p>{drafts.length} listing draft{drafts.length === 1 ? "" : "s"} in this workspace</p></div>
          </div>
          <div className={styles.readinessList}>
            {drafts.length === 0 && <div className={styles.readinessEmpty}><b>No listing drafts yet</b><span>Create drafts from selected Catalog items to review publication readiness.</span></div>}
            {drafts.map((draft) => {
              const blockerCount = draft.validationIssues?.filter(({ severity }) => severity === "BLOCKER").length ?? 0;
              const warningCount = draft.validationIssues?.filter(({ severity }) => severity === "WARNING").length ?? 0;
              return <article key={draft.id} className={styles.readinessRow}>
                <div className={styles.readinessRowMain}>
                  <span className={`${styles.readinessStatus} ${draft.status === "READY" ? styles.readinessStatusReady : draft.status === "BLOCKED" ? styles.readinessStatusBlocked : styles.readinessStatusDraft}`}>{humanStatus(draft.status)}</span>
                  <div><b>{draft.title}</b><span>{draft.part.sku} · {draft.marketplace.replace("EBAY_", "eBay ")} · Updated {new Date(draft.updatedAt).toLocaleDateString()}</span></div>
                </div>
                <div className={styles.readinessRowMeta}>
                  <div className={styles.readinessIssueCounts}>
                    {blockerCount > 0 && <span className={styles.readinessBlockers}>{blockerCount} blocker{blockerCount === 1 ? "" : "s"}</span>}
                    {warningCount > 0 && <span className={styles.readinessWarnings}>{warningCount} warning{warningCount === 1 ? "" : "s"}</span>}
                  </div>
                  <b>{draft.price == null ? "—" : money(draft.price, draft.currency)}</b>
                  <button type="button" onClick={() => void openDraft(draft.id, "edit")}>Edit &amp; review</button>
                </div>
              </article>;
            })}
          </div>
        </section>
      </section>}
      <div className={readinessPage ? styles.catalogPageHidden : undefined}>
      <header className={styles.topbar}>
        <div>
          <h1>Catalog</h1>
          <p>Search, review, and manage parts across marketplaces.</p>
        </div>
        <div className={styles.topActions}>
          {drafts.length > 0 && <Link className={styles.readinessTag} href="/catalog/readiness">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>
            <span>Publication readiness</span>
            <b>{readyDraftCount} ready</b>
            {blockedDraftCount > 0 && <i>{blockedDraftCount} blocked</i>}
          </Link>}
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
              {canPublishCatalog && <button type="button" className={styles.bulkPrimary} disabled={selected.size > 25 || draftBusy} onClick={() => void createDrafts()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
                {draftBusy ? "Preparing..." : "Publish"}
              </button>}
              {canPublishCatalog && <button type="button" disabled={draftBusy} onClick={() => void openBulkPolicies()}>Shipping</button>}
              {canEditCatalog && <button type="button" onClick={() => setBulkEditorOpen(true)}>Edit</button>}
              {canDeleteCatalog && <button type="button" className={styles.bulkDanger} disabled={loading} onClick={() => void deleteSelected()}>Delete</button>}
              <div className={styles.bulkMore}>
                <button type="button" className={styles.moreBtn} onClick={() => setBulkMoreOpen((value) => !value)} aria-expanded={bulkMoreOpen}>... More</button>
                {bulkMoreOpen && (
                  <div className={styles.moreMenu}>
                    <label>Marketplace
                      <select aria-label="eBay marketplace" value={pricingMarketplace} onChange={(event) => setPricingMarketplace(event.target.value)}><option value="EBAY_US">eBay US</option><option value="EBAY_GB">eBay UK</option><option value="EBAY_DE">eBay Germany</option></select>
                    </label>
                    {canRunPricing && <button type="button" disabled={selected.size > 25 || pricingBusy || Boolean(pricingJob && ["QUEUED", "RUNNING"].includes(pricingJob.status))} onClick={() => { setBulkMoreOpen(false); void priceSelected(); }}>{pricingBusy ? "Starting..." : "Price selected"}</button>}
                    {canManageFitment && <button type="button" disabled={selected.size > 10 || fitmentBusy || Boolean(fitmentJob && ["QUEUED", "RUNNING"].includes(fitmentJob.status))} onClick={() => { setBulkMoreOpen(false); void findFitment(); }}>{fitmentBusy ? "Working..." : "Find fitment"}</button>}
                    {canEditCatalog && <button type="button" onClick={() => { setBulkMoreOpen(false); void archiveSelected(); }}>Archive</button>}
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
            <table className={styles.listingsTable}>
              <thead>
                <tr>
                  <th className={styles.colCheck}><input aria-label="Select current page" type="checkbox" checked={allPageSelected} onChange={togglePage}/></th>
                  <th className={styles.colSku}>SKU</th>
                  <th className={styles.colProduct}>Product</th>
                  <th>Condition</th>
                  <th>Stock</th>
                  <th>Price</th>
                  <th>Market</th>
                  <th>Added</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {catalog.parts.map((part) => {
                  const latestPrice = part.pricingJobItems[0];
                  const yourPrice = part.inventoryItem?.cost != null ? Number(part.inventoryItem.cost) : null;
                  const priceCurrency = latestPrice?.currency ?? part.inventoryItem?.currency ?? "USD";
                  const qty = part.inventoryItem?.quantity ?? 0;
                  const stockLabel = qty === 0 ? "Out of stock" : qty <= 5 ? "Low stock" : "In stock";
                  const stockTone = qty === 0 ? styles.stockOut : qty <= 5 ? styles.stockLow : styles.stockIn;
                  const needsImages = part.status === "NEEDS_IMAGES" || part._count.media === 0;
                  const catalogDraft = Boolean(part.listingDrafts?.length);
                  const isHighlighted = highlightedPartId === part.id;
                  return (
                    <tr key={part.id} data-part-id={part.id} className={isHighlighted ? styles.highlightedRow : undefined}>
                      <td className={styles.colCheck}>
                        <input aria-label={`Select ${part.sku}`} type="checkbox" checked={selected.has(part.id)} onChange={() => togglePart(part.id)}/>
                      </td>
                      <td className={styles.colSku}>
                        <button type="button" className={styles.skuLink} onClick={() => void openPart(part.id)}>{part.sku}</button>
                      </td>
                      <td className={styles.colProduct}>
                        <div className={styles.productCell}>
                          <CatalogImage mediaId={part.media[0]?.mediaAsset.id} token={token} demo={demo}/>
                          <div className={styles.productCopy}>
                            <button type="button" className={styles.productTitle} onClick={() => void openPart(part.id)}>
                              {catalogTitle(part)}
                            </button>
                            <span className={styles.productMeta}>{part.brand || "Brand not set"}</span>
                          </div>
                        </div>
                      </td>
                      <td className={styles.conditionText}>{part.condition === "NEW" ? "New" : "Used"}</td>
                      <td className={styles.stockCell}>
                        <span className={styles.stockQty}>{qty}</span>
                        <span className={stockTone}>{stockLabel}</span>
                      </td>
                      <td className={styles.priceCell}>
                        {yourPrice != null && yourPrice > 0
                          ? <span className={styles.priceValue}>{money(yourPrice, priceCurrency)}</span>
                          : <span className={styles.emptyValue}>—</span>}
                      </td>
                      <td className={styles.priceCell}>
                        {latestPrice?.recommendedPrice != null
                          ? <span className={styles.marketValue}>{money(latestPrice.recommendedPrice, latestPrice.currency!)}</span>
                          : latestPrice?.status === "NO_MATCHES"
                            ? <span className={styles.emptyValue}>No matches</span>
                            : <span className={styles.emptyValue}>—</span>}
                      </td>
                      <td className={styles.dateCell}>{new Date(part.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td>
                        {needsImages ? (
                          <span className={`${styles.statusChip} ${styles.needs_images}`}>Need images</span>
                        ) : catalogDraft ? (
                          <span className={`${styles.statusChip} ${styles.imported}`}>Catalog draft</span>
                        ) : canPublishCatalog ? (
                          <button type="button" className={styles.publishBtn} disabled={draftBusy} onClick={() => void createDrafts([part.id])}>
                            Create draft
                          </button>
                        ) : <span className={styles.emptyValue}>Ready</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.gallery}>{catalog.parts.map((part) => <article key={part.id} className={styles.partCard}><button type="button" className={styles.cardSelect} aria-label={`Select ${part.sku}`} onClick={() => togglePart(part.id)}>{selected.has(part.id) ? "✓" : "+"}</button><CatalogImage mediaId={part.media[0]?.mediaAsset.id} token={token} demo={demo}/><span className={`${styles.statusPill} ${styles[part.status.toLowerCase()]}`}>{humanStatus(part.status)}</span><h3>{catalogTitle(part)}</h3><p>{part.brand || "Brand not set"} · {part.condition}</p><div><b>{part.sku}</b><span>{part.primaryPartNumber}</span></div><footer><span>{part.inventoryItem?.quantity ?? 0} in stock</span><button type="button" onClick={() => void openManualFitment(part.id)}>Fitment</button><button type="button" onClick={() => void openPart(part.id)}>Edit part</button></footer></article>)}</div>
        )}

        <div className={styles.pagination}>
          <span>Showing {catalog.parts.length ? ((catalog.pagination.page - 1) * catalog.pagination.pageSize) + 1 : 0} to {Math.min(catalog.pagination.page * catalog.pagination.pageSize, catalog.pagination.total)} of {catalog.pagination.total} results</span>
          <div className={styles.pageSize}>
            <span>Rows per page</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className={styles.pageSizeSelect}
              aria-label="Rows per page"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
            </select>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page">‹</button>
            <em className={styles.pageCurrent}>{catalog.pagination.page}</em>
            <button type="button" disabled={page >= catalog.pagination.totalPages} onClick={() => setPage((value) => value + 1)} aria-label="Next page">›</button>
          </div>
        </div>
      </section>
      </div>
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
    {detail && (() => {
      const draft = detail.listingDrafts?.[0];
      const stock = stockStatus(detail.inventoryItem?.quantity ?? 0);
      const ebay = ebayStatusLabel(detail);
      const priceLabel = draft?.price != null ? money(draft.price, draft.currency) : "—";
      const location = [detail.inventoryItem?.warehouse?.code, detail.inventoryItem?.binLocation?.code].filter(Boolean).join(" · ") || "Unassigned";
      const team = draft?.teams?.[0];
      const countryOfOrigin = draft?.aspects?.["Country/Region of Manufacture"]?.[0] ?? "";
      const fitmentItems = detail.fitmentApplications?.length ? detail.fitmentApplications : [];
      const donorLabel = detail.donorVehicle
        ? [detail.donorVehicle.vin, detail.donorVehicle.year, detail.donorVehicle.make, detail.donorVehicle.model].filter(Boolean).join(" · ")
        : "No donor vehicle assigned";
      const categoryLabel = detail.categoryName || draft?.categoryId || "Not assigned";
      const htmlDescription = draft?.description || detail.description || "";
      const detailRows: Array<{ icon: DetailIconName; label: string; value: ReactNode }> = [
        { icon: "brand", label: "Brand", value: detail.brand || "Not assigned" },
        { icon: "condition", label: "Condition", value: humanStatus(detail.condition) },
        { icon: "part", label: "Part type", value: detail.partName || "Not assigned" },
        { icon: "price", label: "Price", value: priceLabel },
        { icon: "location", label: "Country of origin", value: countryOfOrigin || "Not assigned" },
        { icon: "quantity", label: "Quantity", value: detail.inventoryItem?.quantity ?? 0 },
        { icon: "stock", label: "Stock status", value: <span className={styles.signalValue}><i className={styles[`signal_${stock.tone}`]}/>{stock.label}</span> },
        { icon: "team", label: "Team", value: team ? <span className={styles.teamTag}><i style={{ background: team.color }}/>{team.name}</span> : "Unassigned" },
        { icon: "ebay", label: "eBay status", value: <span className={styles.signalValue}><i className={styles[`signal_${ebay.tone}`]}/>{ebay.label}</span> },
        { icon: "location", label: "Storage location", value: location },
        { icon: "date", label: "Date added", value: new Date(detail.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) },
      ];
      return <div className={styles.modalBackdrop} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDetail(null); }}>
        <section className={`${styles.drawer} ${styles.inventoryModal}`} role="dialog" aria-modal="true" aria-labelledby="edit-part-title">
          <header className={styles.inventoryHeader}>
            <div><h2 id="edit-part-title">Inventory details</h2>{detailHydrating ? <span className={styles.detailHydrating}>Refreshing details…</span> : null}</div>
            <div className={styles.inventoryHeaderActions}>
              {detailMode === "view" ? <button type="button" className={styles.editDetailsBtn} disabled={detailHydrating} onClick={() => setDetailMode("edit")}><span>✎</span> Edit details</button> : <span className={styles.editingPill}>✎ Editing</span>}
              <button type="button" className={styles.iconClose} aria-label="Close editor" onClick={() => setDetail(null)}>×</button>
            </div>
          </header>

          {detailMode === "view" ? <div className={styles.inventoryBody}>
            <div className={styles.inventoryHero}>
              <div className={styles.inventoryHeroMedia}><CatalogImage mediaId={detail.media[0]?.mediaAsset.id} token={token} demo={demo}/>{detail.media.length > 1 && <span className={styles.mediaCount}>{detail.media.length}</span>}</div>
              <div className={styles.inventoryHeroCopy}><h3>{detailTitle(detail)}</h3><button type="button" className={styles.skuCopy} onClick={() => void copySku(detail.sku)}><span>SKU</span><code>{detail.sku}</code><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>
            </div>
            <div className={styles.detailMatrix}>{detailRows.map((row) => <div key={row.label} className={styles.detailDatum}><DetailIcon name={row.icon}/><div><span>{row.label}</span><b>{row.value}</b></div></div>)}</div>

            <section className={styles.detailSection}><h4>eBay store &amp; policies</h4><div className={styles.policyGrid}>
              <div><span>Shipping</span><b>{draft?.shippingPolicyName || "Not assigned"}</b></div>
              <div><span>Returns</span><b>{draft?.returnPolicyName || "Not assigned"}</b></div>
              <div><span>Payment</span><b>{draft?.paymentPolicyName || "Not assigned"}</b></div>
            </div></section>
            <section className={styles.detailSection}><h4>Category</h4><p>{categoryLabel}</p></section>
            <section className={styles.detailSection}><div className={styles.sectionHeading}><h4>Product images <span>({detail.media.length}/24)</span></h4><Link href="/media-drive" className={styles.sectionAction}>Manage images</Link></div>{detail.media.length ? <div className={styles.compactImageGrid}>{detail.media.map((item, index) => <div key={item.id} className={styles.compactImage}><CatalogImage mediaId={item.mediaAsset.id} token={token} demo={demo}/>{index === 0 && <span>Primary</span>}</div>)}</div> : <div className={styles.noImagesBox}><b>No images yet</b><span>Add images from Media Drive.</span></div>}</section>
            <section className={styles.detailSection}><div className={styles.sectionHeading}><h4>Fitments / compatibility</h4><button type="button" className={styles.sectionAction} onClick={() => void openManualFitment(detail.id)}>Manage</button></div>{fitmentItems.length ? <div className={styles.fitmentChips}>{fitmentItems.map((application) => <span key={application.id} className={styles.fitmentChip}>{fitmentLabel(application.properties)}</span>)}</div> : <p className={styles.emptyFitment}>No vehicle compatibility assigned.</p>}</section>
            <section className={styles.detailSection}><h4>Donor vehicle</h4><p>{donorLabel}</p></section>
            <section className={styles.detailSection}><h4>HTML description</h4>{htmlDescription ? <div className={styles.compactDescription} dangerouslySetInnerHTML={{ __html: htmlDescription }}/> : <p className={styles.emptyFitment}>No description added.</p>}</section>
          </div> : <form onSubmit={savePart} className={styles.inventoryEditForm}>
            <div className={styles.editHero}><div className={styles.inventoryHeroMedia}><CatalogImage mediaId={detail.media[0]?.mediaAsset.id} token={token} demo={demo}/></div><div><label><span>Listing title</span><input name="title" maxLength={120} defaultValue={detailTitle(detail)} required/></label><label className={styles.inlineSku}><span>SKU</span><input name="sku" defaultValue={detail.sku} required/></label></div></div>
            <input type="hidden" name="primaryPartNumber" value={detail.primaryPartNumber}/>
            <div className={styles.editDetailGrid}>
              <label><span><DetailIcon name="brand"/> Brand</span><input name="brand" defaultValue={detail.brand ?? ""}/></label>
              <label><span><DetailIcon name="condition"/> Condition</span><select name="condition" defaultValue={detail.condition}><option value="NEW">New</option><option value="USED">Used</option></select></label>
              <label><span><DetailIcon name="part"/> Part type</span><input name="partName" defaultValue={detail.partName ?? ""}/></label>
              <label><span><DetailIcon name="price"/> Price</span><input name="price" type="number" min="0" step="0.01" defaultValue={draft?.price == null ? "" : Number(draft.price)}/></label>
              <label><span><DetailIcon name="location"/> Country of origin</span><input name="countryOfOrigin" defaultValue={countryOfOrigin}/></label>
              <label><span><DetailIcon name="quantity"/> Quantity</span><input name="quantity" type="number" min="0" defaultValue={detail.inventoryItem?.quantity ?? 0}/></label>
              <div className={styles.readonlyDatum}><span><DetailIcon name="stock"/> Stock status</span><b><i className={styles[`signal_${stock.tone}`]}/>{stock.label}</b></div>
              <div className={styles.readonlyDatum}><span><DetailIcon name="team"/> Team</span><b>{team?.name || "Unassigned"}</b></div>
              <div className={styles.readonlyDatum}><span><DetailIcon name="ebay"/> eBay status</span><b><i className={styles[`signal_${ebay.tone}`]}/>{ebay.label}</b></div>
              <label><span><DetailIcon name="location"/> Storage location</span><input name="warehouseCode" defaultValue={detail.inventoryItem?.warehouse?.code ?? ""}/></label>
              <div className={styles.readonlyDatum}><span><DetailIcon name="date"/> Date added</span><b>{new Date(detail.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</b></div>
            </div>
            <section className={styles.detailSection}><h4>eBay store &amp; policies</h4><div className={styles.policyGrid}><div><span>Shipping</span><b>{draft?.shippingPolicyName || "Not assigned"}</b></div><div><span>Returns</span><b>{draft?.returnPolicyName || "Not assigned"}</b></div><div><span>Payment</span><b>{draft?.paymentPolicyName || "Not assigned"}</b></div></div></section>
            <section className={styles.detailSection}><h4>Category</h4><p>{categoryLabel}</p></section>
            <section className={styles.detailSection}><div className={styles.sectionHeading}><h4>Product images <span>({detail.media.length}/24)</span></h4><Link href="/media-drive" className={styles.sectionAction}>Manage images</Link></div>{detail.media.length ? <div className={styles.compactImageGrid}>{detail.media.map((item, index) => <div key={item.id} className={styles.compactImage}><CatalogImage mediaId={item.mediaAsset.id} token={token} demo={demo}/>{index === 0 && <span>Primary</span>}</div>)}</div> : <div className={styles.noImagesBox}><b>No images yet</b><span>Add images from Media Drive.</span></div>}</section>
            <section className={styles.detailSection}><div className={styles.sectionHeading}><h4>Fitments / compatibility</h4><button type="button" className={styles.sectionAction} onClick={() => void openManualFitment(detail.id)}>Manage</button></div>{fitmentItems.length ? <div className={styles.fitmentChips}>{fitmentItems.map((application) => <span key={application.id} className={styles.fitmentChip}>{fitmentLabel(application.properties)}</span>)}</div> : <p className={styles.emptyFitment}>No vehicle compatibility assigned.</p>}</section>
            <section className={styles.detailSection}><h4>Donor vehicle</h4><p>{donorLabel}</p></section>
            <section className={styles.detailSection}><label className={styles.htmlField}><span>HTML description</span><textarea name="description" rows={10} defaultValue={htmlDescription}/></label></section>
            <div className={styles.formActions}><button type="button" onClick={() => setDetailMode("view")}>Cancel</button><button className={styles.primary} disabled={saving}>{saving ? "Saving..." : demo ? "Close preview" : "Save changes"}</button></div>
          </form>}
        </section>
      </div>;
    })()}
    {draftDetail && <div className={styles.modalBackdrop} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDraftDetail(null); }}>
      <section className={`${styles.drawer} ${styles.inventoryModal} ${styles.draftReviewModal}`} role="dialog" aria-modal="true" aria-labelledby="edit-draft-title">
        <header className={styles.inventoryHeader}>
          <div><h2 id="edit-draft-title">Inventory details</h2><span className={styles.draftVersion}>Listing draft · v{draftDetail.version}</span></div>
          <div className={styles.inventoryHeaderActions}>
            {draftMode === "view" ? <button type="button" className={styles.editDetailsBtn} onClick={() => setDraftMode("edit")}><span>✎</span> Edit details</button> : <span className={styles.editingPill}>✎ Editing</span>}
            <button type="button" className={styles.iconClose} aria-label="Close draft editor" onClick={() => setDraftDetail(null)}>×</button>
          </div>
        </header>

        {draftMode === "view" ? <div className={`${styles.inventoryBody} ${styles.draftReviewBody}`}>
          <div className={styles.inventoryHero}>
            <div className={styles.inventoryHeroMedia}><CatalogImage mediaId={draftPartDetail?.media[0]?.mediaAsset.id} token={token} demo={demo}/>{draftPartDetail && draftPartDetail.media.length > 1 && <span className={styles.mediaCount}>{draftPartDetail.media.length}</span>}</div>
            <div className={styles.inventoryHeroCopy}>
              <div className={styles.draftReviewTitleLine}><h3>{draftDetail.title}</h3><span className={`${styles.readinessStatus} ${draftDetail.status === "READY" ? styles.readinessStatusReady : styles.readinessStatusBlocked}`}>{humanStatus(draftDetail.status)}</span></div>
              <button type="button" className={styles.skuCopy} onClick={() => void copySku(draftDetail.part.sku)}><span>SKU</span><code>{draftDetail.part.sku}</code><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            </div>
          </div>

          {(draftDetail.validationIssues ?? []).length > 0 && <section className={`${styles.detailSection} ${styles.draftIssueSection}`}>
            <div className={styles.sectionHeading}><h4>Publication issues <span>({draftDetail.validationIssues?.length})</span></h4><span className={styles.issueHelp}>Resolve these fields before publishing</span></div>
            <div className={styles.draftIssueList}>{(draftDetail.validationIssues ?? []).map((issue) => <div key={`${issue.code}-${issue.field}`} className={issue.severity === "BLOCKER" ? styles.draftIssueBlocker : styles.draftIssueWarning}><b>{issue.severity === "BLOCKER" ? "Blocked" : "Warning"}</b><span>{issue.message}</span></div>)}</div>
          </section>}

          <div className={styles.detailMatrix}>
            <div className={styles.detailDatum}><DetailIcon name="brand"/><div><span>Brand</span><b>{draftDetail.aspects.Brand?.[0] || draftDetail.part.brand || "Not assigned"}</b></div></div>
            <div className={styles.detailDatum}><DetailIcon name="condition"/><div><span>Condition</span><b>{humanStatus(draftDetail.condition)}</b></div></div>
            <div className={styles.detailDatum}><DetailIcon name="part"/><div><span>Part type</span><b>{draftDetail.aspects.Type?.[0] || draftDetail.aspects["Part Type"]?.[0] || draftDetail.part.partName || "Not assigned"}</b></div></div>
            <div className={styles.detailDatum}><DetailIcon name="price"/><div><span>Price</span><b>{draftDetail.price == null ? "Not assigned" : money(draftDetail.price, draftDetail.currency)}</b></div></div>
            <div className={styles.detailDatum}><DetailIcon name="quantity"/><div><span>Quantity</span><b>{draftDetail.quantity}</b></div></div>
            <div className={styles.detailDatum}><DetailIcon name="stock"/><div><span>Stock status</span><b><span className={styles.signalValue}><i className={styles[`signal_${draftDetail.quantity <= 0 ? "bad" : draftDetail.quantity <= 2 ? "warn" : "good"}`]}/>{draftDetail.quantity <= 0 ? "Out of stock" : draftDetail.quantity <= 2 ? "Low stock" : "In stock"}</span></b></div></div>
            <div className={styles.detailDatum}><DetailIcon name="ebay"/><div><span>eBay status</span><b>{draftDetail.status === "READY" ? "Ready" : "Draft needs fixes"}</b></div></div>
            <div className={styles.detailDatum}><DetailIcon name="location"/><div><span>Marketplace</span><b>{draftDetail.marketplace.replace("EBAY_", "eBay ")}</b></div></div>
          </div>

          <section className={styles.detailSection}><h4>eBay store &amp; policies</h4><div className={styles.policyGrid}>
            <div><span>Shipping</span><b>{sellerResources?.fulfillmentPolicies.find(({ remoteId }) => remoteId === draftDetail.shippingPolicyId)?.name || "Not assigned"}</b></div>
            <div><span>Returns</span><b>{sellerResources?.returnPolicies.find(({ remoteId }) => remoteId === draftDetail.returnPolicyId)?.name || "Not assigned"}</b></div>
            <div><span>Payment</span><b>{sellerResources?.paymentPolicies.find(({ remoteId }) => remoteId === draftDetail.paymentPolicyId)?.name || "Not assigned"}</b></div>
          </div></section>
          <section className={styles.detailSection}><h4>Category</h4><p>{draftDetail.categoryId ? `eBay category ${draftDetail.categoryId}` : "Not assigned"}</p></section>
          <section className={styles.detailSection}><div className={styles.sectionHeading}><h4>Product images <span>({draftPartDetail?.media.length ?? 0}/24)</span></h4><Link href="/media-drive" className={styles.sectionAction}>Manage images</Link></div>{draftPartDetail?.media.length ? <div className={styles.compactImageGrid}>{draftPartDetail.media.map((item, index) => <div key={item.id} className={styles.compactImage}><CatalogImage mediaId={item.mediaAsset.id} token={token} demo={demo}/>{index === 0 && <span>Primary</span>}</div>)}</div> : <div className={styles.noImagesBox}><b>No images yet</b><span>Add images from Media Drive.</span></div>}</section>
          <section className={styles.detailSection}><div className={styles.sectionHeading}><h4>Fitments / compatibility</h4><button type="button" className={styles.sectionAction} onClick={() => { const partId = draftDetail.partId; setDraftDetail(null); void openManualFitment(partId); }}>Manage</button></div>{draftPartDetail?.fitmentApplications?.length ? <div className={styles.fitmentChips}>{draftPartDetail.fitmentApplications.map((application) => <span key={application.id} className={styles.fitmentChip}>{fitmentLabel(application.properties)}</span>)}</div> : <p className={styles.emptyFitment}>No vehicle compatibility assigned.</p>}</section>
          <section className={styles.detailSection}><h4>HTML description</h4>{draftDetail.description ? <div className={styles.compactDescription} dangerouslySetInnerHTML={{ __html: draftDetail.description }}/> : <p className={styles.emptyFitment}>No description added.</p>}</section>
          <div className={styles.draftReviewActions}><button type="button" onClick={() => setDraftMode("edit")}>Edit details</button><button type="button" className={styles.primary} disabled={draftBusy || !draftDetail.categoryId} onClick={() => void validateDraftLive()}>{draftBusy ? "Contacting eBay..." : "Validate with eBay"}</button></div>
        </div> : <form onSubmit={saveDraft} className={`${styles.listingDrawerBody} ${styles.draftEditBody}`}>
          <section className={styles.listingDetailsCard}>
            <span className={styles.listingSectionLabel}>Listing details</span>

            <label className={styles.listingFieldWide}>
              <span>Title</span>
              <input name="title" maxLength={120} defaultValue={draftDetail.title} required />
              <small>{draftDetail.title.length}/80 recommended for eBay</small>
            </label>

            <div className={styles.listingDetailsGrid}>
              <label className={styles.listingField}>
                <span>Brand</span>
                <input
                  name="aspect-brand"
                  defaultValue={draftDetail.aspects.Brand?.[0] ?? draftDetail.part.brand ?? ""}
                  placeholder="Brand"
                />
              </label>
              <label className={styles.listingField}>
                <span>Condition</span>
                <select name="condition" defaultValue={draftDetail.condition}>
                  <option value="NEW">New</option>
                  <option value="USED">Used</option>
                </select>
              </label>
              <label className={styles.listingField}>
                <span>Part type</span>
                <input
                  name="aspect-part-type"
                  defaultValue={
                    draftDetail.aspects.Type?.[0]
                    ?? draftDetail.aspects["Part Type"]?.[0]
                    ?? draftDetail.part.partName
                    ?? ""
                  }
                  placeholder="Part type"
                />
              </label>
              <label className={styles.listingField}>
                <span>Price</span>
                <div className={styles.listingPriceRow}>
                  <input name="price" type="number" min="0.01" step="0.01" defaultValue={draftDetail.price ?? ""} />
                  <input name="currency" maxLength={3} defaultValue={draftDetail.currency} aria-label="Currency" />
                </div>
              </label>
              <label className={styles.listingField}>
                <span>Quantity</span>
                <input name="quantity" type="number" min="0" defaultValue={draftDetail.quantity} />
              </label>
              <div className={styles.listingField}>
                <span>Stock status</span>
                <div className={`${styles.listingStockStatus} ${draftDetail.quantity <= 2 ? styles.listingStockLow : styles.listingStockOk}`}>
                  {draftDetail.quantity <= 0 ? "Out of stock" : draftDetail.quantity <= 2 ? "Low stock" : "In stock"}
                </div>
              </div>
              <label className={styles.listingField}>
                <span>Shipping policy</span>
                <select name="shippingPolicyId" defaultValue={draftDetail.shippingPolicyId ?? ""}>
                  <option value="">Select fulfillment policy</option>
                  {sellerResources?.fulfillmentPolicies.filter(({ enabled }) => enabled).map((resource) => (
                    <option key={resource.remoteId} value={resource.remoteId}>{resource.name ?? resource.remoteId}</option>
                  ))}
                </select>
              </label>
              <label className={styles.listingField}>
                <span>eBay condition</span>
                <select name="ebayCondition" defaultValue={draftDetail.ebayCondition ?? ""}>
                  <option value="">Validate category to load</option>
                  {categoryConditions.map((option) => (
                    <option key={option.conditionId} value={option.enumValue}>{option.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className={styles.listingFieldWide}>
              <span>Category</span>
              <div className={styles.listingCategoryRow}>
                <input name="categoryId" defaultValue={draftDetail.categoryId ?? ""} placeholder="eBay category ID" />
                <span className={styles.listingCategoryId}>
                  {draftDetail.categoryId ? `ID: ${draftDetail.categoryId}` : "Set an eBay category ID"}
                </span>
              </div>
            </label>
          </section>

          <section className={styles.listingDetailsCard}>
            <span className={styles.listingSectionLabel}>Policies & location</span>
            <div className={styles.listingDetailsGrid}>
              <label className={styles.listingField}>
                <span>Payment policy</span>
                <select name="paymentPolicyId" defaultValue={draftDetail.paymentPolicyId ?? ""}>
                  <option value="">Select payment policy</option>
                  {sellerResources?.paymentPolicies.filter(({ enabled }) => enabled).map((resource) => (
                    <option key={resource.remoteId} value={resource.remoteId}>{resource.name ?? resource.remoteId}</option>
                  ))}
                </select>
              </label>
              <label className={styles.listingField}>
                <span>Return policy</span>
                <select name="returnPolicyId" defaultValue={draftDetail.returnPolicyId ?? ""}>
                  <option value="">Select return policy</option>
                  {sellerResources?.returnPolicies.filter(({ enabled }) => enabled).map((resource) => (
                    <option key={resource.remoteId} value={resource.remoteId}>{resource.name ?? resource.remoteId}</option>
                  ))}
                </select>
              </label>
              <label className={styles.listingFieldWide}>
                <span>Merchant location</span>
                <select name="merchantLocationKey" defaultValue={draftDetail.merchantLocationKey ?? ""}>
                  <option value="">Select location</option>
                  {sellerResources?.inventoryLocations.filter(({ enabled }) => enabled).map((resource) => (
                    <option key={resource.remoteId} value={resource.remoteId}>{resource.name ?? resource.remoteId}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {categoryAspects.filter((requirement) => !["Brand", "Type", "Part Type"].includes(requirement.name)).length > 0 && (
            <section className={styles.listingDetailsCard}>
              <span className={styles.listingSectionLabel}>Item specifics</span>
              <div className={styles.listingDetailsGrid}>
                {categoryAspects.filter((requirement) => !["Brand", "Type", "Part Type"].includes(requirement.name)).map((requirement, index) => {
                  const aspectIndex = categoryAspects.findIndex((item) => item.name === requirement.name);
                  return (
                  <label key={requirement.name} className={requirement.cardinality === "MULTI" ? styles.listingFieldWide : styles.listingField}>
                    <span>{requirement.name}{requirement.required ? " *" : requirement.recommended ? " (recommended)" : ""}</span>
                    {requirement.mode === "SELECTION_ONLY" && requirement.values.length && requirement.cardinality === "SINGLE"
                      ? <select name={`aspect-${aspectIndex}`} defaultValue={draftDetail.aspects[requirement.name]?.[0] ?? ""}><option value="">Select value</option>{requirement.values.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                      : <input name={`aspect-${aspectIndex}`} defaultValue={(draftDetail.aspects[requirement.name] ?? []).join(" | ")} placeholder={requirement.cardinality === "MULTI" ? "Separate multiple values with |" : undefined}/>}
                  </label>
                  );
                })}
              </div>
            </section>
          )}

          <section className={`${styles.detailSection} ${styles.draftEditSection}`}>
            <div className={styles.sectionHeading}>
              <h4>Product images <span>({draftPartDetail?.media.length ?? 0}/24)</span></h4>
              <Link href="/media-drive" className={styles.sectionAction}>Manage images</Link>
            </div>
            {draftPartDetail?.media.length ? (
              <div className={styles.compactImageGrid}>
                {draftPartDetail.media.map((item, index) => (
                  <div key={item.id} className={styles.compactImage}>
                    <CatalogImage mediaId={item.mediaAsset.id} token={token} demo={demo} />
                    {index === 0 && <span>Primary</span>}
                  </div>
                ))}
              </div>
            ) : <div className={styles.noImagesBox}><b>No images yet</b><span>Add images from Media Drive.</span></div>}
          </section>

          <section className={`${styles.detailSection} ${styles.draftEditSection}`}>
            <div className={styles.sectionHeading}>
              <h4>Fitments / compatibility</h4>
              <button type="button" className={styles.sectionAction} onClick={() => { const partId = draftDetail.partId; setDraftDetail(null); void openManualFitment(partId); }}>Manage</button>
            </div>
            {draftPartDetail?.fitmentApplications?.length ? (
              <div className={styles.fitmentChips}>{draftPartDetail.fitmentApplications.map((application) => <span key={application.id} className={styles.fitmentChip}>{fitmentLabel(application.properties)}</span>)}</div>
            ) : <p className={styles.emptyFitment}>No vehicle compatibility assigned.</p>}
          </section>

          <section className={styles.listingDetailsCard}>
            <span className={styles.listingSectionLabel}>Description</span>
            {draftDetail.description && /<\/?[a-z][\s\S]*>/i.test(draftDetail.description) ? (
              <div className={styles.descriptionPreview} dangerouslySetInnerHTML={{ __html: draftDetail.description }} />
            ) : null}
            <label className={styles.listingFieldWide}>
              <span>HTML source</span>
              <textarea name="description" rows={8} defaultValue={draftDetail.description ?? ""} />
            </label>
          </section>

          <section className={styles.listingPublishCard}>
            <div className={styles.listingPublishHead}>
              <div>
                <span className={styles.listingSectionLabel}>Publication</span>
                <b className={draftDetail.status === "READY" ? styles.listingReady : styles.listingBlocked}>
                  {draftDetail.status === "READY" ? "Ready for publication workflow" : "Publication blocked"}
                </b>
                <p>{draftDetail.liveValidatedAt ? `Last checked with eBay ${new Date(draftDetail.liveValidatedAt).toLocaleString()}` : "Live eBay validation is still required."}</p>
              </div>
              <div className={styles.listingPublishActions}>
                <button type="button" disabled={draftBusy} onClick={() => void syncResources()}>Refresh policies</button>
                <button type="button" className={styles.primary} disabled={draftBusy || !draftDetail.categoryId} onClick={() => void validateDraftLive()}>{draftBusy ? "Contacting eBay..." : "Validate with eBay"}</button>
                <button type="button" className={styles.primary} disabled={draftBusy || Boolean(inventoryPreparationJob && ["QUEUED", "RUNNING"].includes(inventoryPreparationJob.status)) || draftDetail.status !== "READY" || !draftDetail.liveValidatedAt} onClick={() => void prepareInventoryPreview()}>{inventoryPreparationJob && ["QUEUED", "RUNNING"].includes(inventoryPreparationJob.status) ? "Worker preparing..." : draftBusy ? "Queueing..." : "Stage images & preview"}</button>
              </div>
            </div>
            {(draftDetail.validationIssues ?? []).length > 0 && (
              <div className={styles.listingIssues}>
                {(draftDetail.validationIssues ?? []).map((issue) => (
                  <span key={`${issue.code}-${issue.field}`} className={issue.severity === "BLOCKER" ? styles.blocker : styles.warning}>
                    {issue.severity}: {issue.message}
                  </span>
                ))}
              </div>
            )}
            {inventoryPreparationJob && ["QUEUED", "RUNNING", "FAILED"].includes(inventoryPreparationJob.status) && (
              <div className={styles.preparationStatus}>
                <b>Image staging: {inventoryPreparationJob.status.toLowerCase()}</b>
                {inventoryPreparationJob.lastError && <span>{inventoryPreparationJob.lastError}</span>}
              </div>
            )}
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
          </section>

          <div className={styles.listingFormActions}>
            <button type="button" onClick={() => setDraftMode("view")}>Cancel</button>
            <button className={styles.primary} disabled={draftBusy}>{draftBusy ? "Saving..." : "Save changes"}</button>
          </div>
        </form>}
      </section>
    </div>}
  </>;
}
