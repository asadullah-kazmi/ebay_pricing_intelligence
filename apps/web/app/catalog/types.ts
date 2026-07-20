export type CatalogStatus = "IMPORTED" | "NEEDS_IMAGES" | "IMPORT_ERROR" | "READY_FOR_ENRICHMENT" | "ARCHIVED";
export type PartCondition = "NEW" | "USED";

export interface CatalogPartCard {
  id: string;
  sku: string;
  primaryPartNumber: string;
  brand: string | null;
  partName: string | null;
  condition: PartCondition;
  status: CatalogStatus;
  createdAt: string;
  updatedAt: string;
  donorVehicle: { vin: string; year: number | null; make: string | null; model: string | null } | null;
  inventoryItem: {
    quantity: number;
    cost: string | number;
    currency: string;
    warehouse: { id: string; code: string; name: string } | null;
    binLocation: { id: string; code: string } | null;
  } | null;
  media: Array<{ mediaAsset: { id: string; mimeType: string; width: number | null; height: number | null } }>;
  _count: { media: number };
}

export interface CatalogResponse {
  parts: CatalogPartCard[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { total: number; byStatus: Partial<Record<CatalogStatus, number>> };
  warehouses: Array<{ id: string; code: string; name: string }>;
}

export interface CatalogPartDetail extends Omit<CatalogPartCard, "media" | "inventoryItem"> {
  description: string | null;
  donorMileage: number | null;
  donorColor: string | null;
  placement: string | null;
  notes: string | null;
  partNumbers: Array<{ id: string; type: string; value: string }>;
  inventoryItem: {
    quantity: number;
    cost: string | number;
    currency: string;
    warehouse: { id: string; code: string; name: string } | null;
    binLocation: { id: string; code: string } | null;
    weight: string | number | null;
    weightUnit: "LB" | "KG" | null;
    length: string | number | null;
    width: string | number | null;
    height: string | number | null;
    dimensionUnit: "IN" | "CM" | null;
  } | null;
  media: Array<{ id: string; displayOrder: number; mediaAsset: { id: string; originalFilename: string; mimeType: string } }>;
}
