"use client";

import { useEffect, useState, type ComponentType } from "react";

type WorkspaceKey = "dashboard" | "catalog" | "pipeline";

function resolveWorkspace(pathname: string): WorkspaceKey {
  const path = pathname.split("#")[0] ?? pathname;
  if (path.startsWith("/pipeline")) return "pipeline";
  if (path.startsWith("/catalog")) return "catalog";
  return "dashboard";
}

export default function WorkspaceViews({ pathname }: { pathname: string }) {
  const active = resolveWorkspace(pathname);
  const [mounted, setMounted] = useState<Record<WorkspaceKey, boolean>>({
    dashboard: active === "dashboard",
    catalog: active === "catalog",
    pipeline: active === "pipeline",
  });
  const [shown, setShown] = useState<WorkspaceKey>(active);
  const [Dashboard, setDashboard] = useState<ComponentType | null>(null);
  const [Catalog, setCatalog] = useState<ComponentType | null>(null);
  const [Pipeline, setPipeline] = useState<ComponentType | null>(null);

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
    const ready =
      (active === "dashboard" && Dashboard) ||
      (active === "catalog" && Catalog) ||
      (active === "pipeline" && Pipeline);
    if (ready) setShown(active);
  }, [Dashboard, Catalog, Pipeline, active]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import("../(app)/dashboard/DashboardWorkspace");
      void import("../(app)/catalog/CatalogWorkspace");
      void import("../(app)/pipeline/PipelineWorkspace");
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
      {mounted.pipeline && Pipeline ? (
        <div hidden={shown !== "pipeline"}>
          <Pipeline />
        </div>
      ) : null}
    </>
  );
}
