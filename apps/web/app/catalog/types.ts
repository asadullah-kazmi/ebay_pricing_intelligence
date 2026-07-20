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
  pricingJobItems: Array<{
    id: string;
    status: "COMPLETED" | "NO_MATCHES";
    competitorCount: number;
    recommendedPrice: string | number | null;
    currency: string | null;
    completedAt: string | null;
    pricingJob: { marketplace: string };
  }>;
  fitmentJobItems: Array<{
    id: string;
    status: "APPROVED" | "NO_CANDIDATE";
    applicationCount: number;
    completedAt: string | null;
    fitmentJob: { marketplace: string };
  }>;
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

export type PricingJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
export type PricingJobItemStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "NO_MATCHES" | "FAILED";
export type PricingConditionMode = "MATCH_PART" | "ANY" | "NEW" | "USED";

export interface PricingJobSummary {
  id: string;
  marketplace: string;
  conditionMode: PricingConditionMode;
  status: PricingJobStatus;
  totalItems: number;
  completedItems: number;
  noMatchItems: number;
  failedItems: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PricingJob extends PricingJobSummary {
  items: Array<{
    id: string;
    queryPartNumber: string;
    condition: string;
    status: PricingJobItemStatus;
    competitorCount: number;
    lowest: number | null;
    average: number | null;
    median: number | null;
    highest: number | null;
    recommendedPrice: number | null;
    currency: string | null;
    error: string | null;
    part: { id: string; sku: string; primaryPartNumber: string; partName: string | null; condition: PartCondition };
    listings: Array<{
      id: string;
      listingId: string;
      title: string;
      seller: string;
      price: number;
      shipping: number;
      landedPrice: number;
      currency: string;
      condition: string;
      marketplace: string;
      url: string;
      matchedOn: string[];
    }>;
  }>;
}

export type FitmentJobStatus = "QUEUED" | "RUNNING" | "REVIEW_REQUIRED" | "COMPLETED" | "PARTIAL" | "FAILED";
export type FitmentJobItemStatus = "QUEUED" | "RUNNING" | "REVIEW_REQUIRED" | "NO_CANDIDATE" | "APPROVED" | "FAILED";

export interface FitmentJobSummary {
  id: string;
  marketplace: string;
  status: FitmentJobStatus;
  totalItems: number;
  reviewedItems: number;
  noCandidateItems: number;
  failedItems: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface FitmentJob extends FitmentJobSummary {
  items: Array<{
    id: string;
    query: string;
    status: FitmentJobItemStatus;
    categoryId: string | null;
    categoryName: string | null;
    approvedCandidateId: string | null;
    metadataVersion: string | null;
    applicationCount: number;
    error: string | null;
    part: { id: string; sku: string; primaryPartNumber: string; partName: string | null; brand: string | null };
    candidates: Array<{
      id: string;
      epid: string;
      title: string;
      brand: string | null;
      imageUrl: string | null;
      productWebUrl: string | null;
      score: number;
      matchedOn: string[];
    }>;
    applications: Array<{ id: string; fingerprint: string; properties: Record<string, string>; approvedAt: string }>;
  }>;
}
