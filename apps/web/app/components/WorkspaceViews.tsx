"use client";

import { useEffect, useState, type ComponentType } from "react";

type WorkspaceKey =
  | "dashboard"
  | "catalog"
  | "quickSku"
  | "inventory"
  | "pricing"
  | "fitment"
  | "mediaDrive"
  | "shipping"
  | "pipeline"
  | "orders"
  | "channels"
  | "reports"
  | "settings";

function resolveWorkspace(pathname: string): WorkspaceKey {
  const path = pathname.split("#")[0] ?? pathname;
  if (path.startsWith("/media-drive")) return "mediaDrive";
  if (path.startsWith("/pipeline")) return "pipeline";
  if (path.startsWith("/orders")) return "orders";
  if (path.startsWith("/channels")) return "channels";
  if (path.startsWith("/inventory")) return "inventory";
  if (path.startsWith("/pricing")) return "pricing";
  if (path.startsWith("/fitment")) return "fitment";
  if (path.startsWith("/shipping")) return "shipping";
  if (path.startsWith("/reports")) return "reports";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/quick-sku")) return "quickSku";
  if (path.startsWith("/catalog")) return "catalog";
  return "dashboard";
}

export default function WorkspaceViews({ pathname }: { pathname: string }) {
  const active = resolveWorkspace(pathname);
  const [mounted, setMounted] = useState<Record<WorkspaceKey, boolean>>({
    dashboard: active === "dashboard",
    catalog: active === "catalog",
    quickSku: active === "quickSku",
    inventory: active === "inventory",
    pricing: active === "pricing",
    fitment: active === "fitment",
    mediaDrive: active === "mediaDrive",
    shipping: active === "shipping",
    pipeline: active === "pipeline",
    orders: active === "orders",
    channels: active === "channels",
    reports: active === "reports",
    settings: active === "settings",
  });
  const [shown, setShown] = useState<WorkspaceKey>(active);
  const [Dashboard, setDashboard] = useState<ComponentType | null>(null);
  const [Catalog, setCatalog] = useState<ComponentType | null>(null);
  const [QuickSku, setQuickSku] = useState<ComponentType | null>(null);
  const [Inventory, setInventory] = useState<ComponentType | null>(null);
  const [Pricing, setPricing] = useState<ComponentType | null>(null);
  const [Fitment, setFitment] = useState<ComponentType | null>(null);
  const [MediaDrive, setMediaDrive] = useState<ComponentType | null>(null);
  const [Shipping, setShipping] = useState<ComponentType | null>(null);
  const [Pipeline, setPipeline] = useState<ComponentType | null>(null);
  const [Orders, setOrders] = useState<ComponentType | null>(null);
  const [Channels, setChannels] = useState<ComponentType | null>(null);
  const [Reports, setReports] = useState<ComponentType | null>(null);
  const [Settings, setSettings] = useState<ComponentType | null>(null);

  useEffect(() => {
    setMounted((current) => (current[active] ? current : { ...current, [active]: true }));
  }, [active]);

  useEffect(() => {
    if (!mounted.dashboard || Dashboard) return;
    let cancelled = false;
    void import("../(app)/dashboard/DashboardWorkspace").then((mod) => {
      if (!cancelled) setDashboard(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Dashboard, mounted.dashboard]);

  useEffect(() => {
    if (!mounted.catalog || Catalog) return;
    let cancelled = false;
    void import("../(app)/catalog/CatalogWorkspace").then((mod) => {
      if (!cancelled) setCatalog(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Catalog, mounted.catalog]);

  useEffect(() => {
    if (!mounted.quickSku || QuickSku) return;
    let cancelled = false;
    void import("../(app)/quick-sku/QuickSkuWorkspace").then((mod) => {
      if (!cancelled) setQuickSku(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [QuickSku, mounted.quickSku]);

  useEffect(() => {
    if (!mounted.inventory || Inventory) return;
    let cancelled = false;
    void import("../(app)/inventory/InventoryWorkspace").then((mod) => {
      if (!cancelled) setInventory(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Inventory, mounted.inventory]);

  useEffect(() => {
    if (!mounted.pricing || Pricing) return;
    let cancelled = false;
    void import("../(app)/pricing/PricingWorkspace").then((mod) => {
      if (!cancelled) setPricing(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Pricing, mounted.pricing]);

  useEffect(() => {
    if (!mounted.fitment || Fitment) return;
    let cancelled = false;
    void import("../(app)/fitment/FitmentWorkspace").then((mod) => {
      if (!cancelled) setFitment(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Fitment, mounted.fitment]);

  useEffect(() => {
    if (!mounted.mediaDrive || MediaDrive) return;
    let cancelled = false;
    void import("../(app)/media-drive/MediaDriveWorkspace").then((mod) => {
      if (!cancelled) setMediaDrive(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [MediaDrive, mounted.mediaDrive]);

  useEffect(() => {
    if (!mounted.shipping || Shipping) return;
    let cancelled = false;
    void import("../(app)/shipping/ShippingWorkspace").then((mod) => {
      if (!cancelled) setShipping(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Shipping, mounted.shipping]);

  useEffect(() => {
    if (!mounted.pipeline || Pipeline) return;
    let cancelled = false;
    void import("../(app)/pipeline/PipelineWorkspace").then((mod) => {
      if (!cancelled) setPipeline(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Pipeline, mounted.pipeline]);

  useEffect(() => {
    if (!mounted.orders || Orders) return;
    let cancelled = false;
    void import("../(app)/orders/OrdersWorkspace").then((mod) => {
      if (!cancelled) setOrders(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Orders, mounted.orders]);

  useEffect(() => {
    if (!mounted.channels || Channels) return;
    let cancelled = false;
    void import("../(app)/channels/ChannelsWorkspace").then((mod) => {
      if (!cancelled) setChannels(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Channels, mounted.channels]);

  useEffect(() => {
    if (!mounted.reports || Reports) return;
    let cancelled = false;
    void import("../(app)/reports/ReportsWorkspace").then((mod) => {
      if (!cancelled) setReports(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Reports, mounted.reports]);

  useEffect(() => {
    if (!mounted.settings || Settings) return;
    let cancelled = false;
    void import("../(app)/settings/SettingsWorkspace").then((mod) => {
      if (!cancelled) setSettings(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [Settings, mounted.settings]);

  useEffect(() => {
    if (!mounted[active]) return;
    setShown(active);
  }, [active, mounted]);

  useEffect(() => {
    if (active === "dashboard") void import("../(app)/dashboard/DashboardWorkspace");
    if (active === "catalog") void import("../(app)/catalog/CatalogWorkspace");
    if (active === "quickSku") void import("../(app)/quick-sku/QuickSkuWorkspace");
    if (active === "inventory") void import("../(app)/inventory/InventoryWorkspace");
    if (active === "pricing") void import("../(app)/pricing/PricingWorkspace");
    if (active === "fitment") void import("../(app)/fitment/FitmentWorkspace");
    if (active === "mediaDrive") void import("../(app)/media-drive/MediaDriveWorkspace");
    if (active === "shipping") void import("../(app)/shipping/ShippingWorkspace");
    if (active === "pipeline") void import("../(app)/pipeline/PipelineWorkspace");
    if (active === "orders") void import("../(app)/orders/OrdersWorkspace");
    if (active === "channels") void import("../(app)/channels/ChannelsWorkspace");
    if (active === "reports") void import("../(app)/reports/ReportsWorkspace");
    if (active === "settings") void import("../(app)/settings/SettingsWorkspace");
  }, [active]);

  return (
    <>
      {mounted.dashboard && Dashboard ? (
        <div hidden={shown !== "dashboard"}>
          <Dashboard />
        </div>
      ) : null}
      {mounted.catalog && Catalog ? (
        <div hidden={shown !== "catalog"}>
          <Catalog />
        </div>
      ) : null}
      {mounted.quickSku && QuickSku ? (
        <div hidden={shown !== "quickSku"}>
          <QuickSku />
        </div>
      ) : null}
      {mounted.inventory && Inventory ? (
        <div hidden={shown !== "inventory"}>
          <Inventory />
        </div>
      ) : null}
      {mounted.pricing && Pricing ? (
        <div hidden={shown !== "pricing"}>
          <Pricing />
        </div>
      ) : null}
      {mounted.fitment && Fitment ? (
        <div hidden={shown !== "fitment"}>
          <Fitment />
        </div>
      ) : null}
      {mounted.mediaDrive && MediaDrive ? (
        <div hidden={shown !== "mediaDrive"}>
          <MediaDrive />
        </div>
      ) : null}
      {mounted.shipping && Shipping ? (
        <div hidden={shown !== "shipping"}>
          <Shipping />
        </div>
      ) : null}
      {mounted.pipeline && Pipeline ? (
        <div hidden={shown !== "pipeline"}>
          <Pipeline />
        </div>
      ) : null}
      {mounted.orders && Orders ? (
        <div hidden={shown !== "orders"}>
          <Orders />
        </div>
      ) : null}
      {mounted.channels && Channels ? (
        <div hidden={shown !== "channels"}>
          <Channels />
        </div>
      ) : null}
      {mounted.reports && Reports ? (
        <div hidden={shown !== "reports"}>
          <Reports />
        </div>
      ) : null}
      {mounted.settings && Settings ? (
        <div hidden={shown !== "settings"}>
          <Settings />
        </div>
      ) : null}
    </>
  );
}
