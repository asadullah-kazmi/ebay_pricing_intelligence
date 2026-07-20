import type { Metadata } from "next";
import CatalogWorkspace from "./CatalogWorkspace";

export const metadata: Metadata = { title: "Parts Catalog | PartPulse", description: "Manage imported automotive parts inventory" };

export default function CatalogPage() {
  return <CatalogWorkspace/>;
}
