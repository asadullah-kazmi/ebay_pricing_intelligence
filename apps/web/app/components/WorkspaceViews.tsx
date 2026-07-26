"use client";

import { useEffect, useState, type ComponentType } from "react";

type WorkspaceKey =
  | "dashboard"
  | "catalog"
  | "inventory"
  | "pricing"
  | "fitment"
  | "shipping"
  | "pipeline"
  | "orders"
  | "reports"
  | "settings";

function resolveWorkspace(pathname: string): WorkspaceKey {
  const path = pathname.split("#")[0] ?? pathname;
  if (path.startsWith("/pipeline")) return "pipeline";
  if (path.startsWith("/orders")) return "orders";
  if (path.startsWith("/inventory")) return "inventory";
  if (path.startsWith("/pricing")) return "pricing";
  if (path.startsWith("/fitment")) return "fitment";
  if (path.startsWith("/shipping")) return "shipping";
  if (path.startsWith("/reports")) return "reports";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/catalog")) return "catalog";
  return "dashboard";
}

export default function WorkspaceViews({ pathname }: { pathname: string }) {
  const active = resolveWorkspace(pathname);
  const [mounted, setMounted] = useState<Record<WorkspaceKey, boolean>>({
    dashboard: active === "dashboard",
    catalog: active === "catalog",
    inventory: active === "inventory",
    pricing: active === "pricing",
    fitment: active === "fitment",
    shipping: active === "shipping",
    pipeline: active === "pipeline",
    orders: active === "orders",
    reports: active === "reports",
    settings: active === "settings",
  });
  const [shown, setShown] = useState<WorkspaceKey>(active);
  const [Dashboard, setDashboard] = useState<ComponentType | null>(null);
  const [Catalog, setCatalog] = useState<ComponentType | null>(null);
  const [Inventory, setInventory] = useState<ComponentType | null>(null);
  const [Pricing, setPricing] = useState<ComponentType | null>(null);
  const [Fitment, setFitment] = useState<ComponentType | null>(null);
  const [Shipping, setShipping] = useState<ComponentType | null>(null);
  const [Pipeline, setPipeline] = useState<ComponentType | null>(null);
  const [Orders, setOrders] = useState<ComponentType | null>(null);
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
    const ready =
      (active === "dashboard" && Dashboard) ||
      (active === "catalog" && Catalog) ||
      (active === "inventory" && Inventory) ||
      (active === "pricing" && Pricing) ||
      (active === "fitment" && Fitment) ||
      (active === "shipping" && Shipping) ||
      (active === "pipeline" && Pipeline) ||
      (active === "orders" && Orders) ||
      (active === "reports" && Reports) ||
      (active === "settings" && Settings);
    if (ready) setShown(active);
  }, [Dashboard, Catalog, Inventory, Pricing, Fitment, Shipping, Pipeline, Orders, Reports, Settings, active]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import("../(app)/dashboard/DashboardWorkspace");
      void import("../(app)/catalog/CatalogWorkspace");
      void import("../(app)/inventory/InventoryWorkspace");
      void import("../(app)/pricing/PricingWorkspace");
      void import("../(app)/fitment/FitmentWorkspace");
      void import("../(app)/shipping/ShippingWorkspace");
      void import("../(app)/pipeline/PipelineWorkspace");
      void import("../(app)/orders/OrdersWorkspace");
      void import("../(app)/reports/ReportsWorkspace");
      void import("../(app)/settings/SettingsWorkspace");
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);

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
