export const EBAY_TITLE_MAX_LENGTH = 80;

export type ListingTitleInput = {
  brand: string | null;
  partName: string | null;
  primaryPartNumber: string;
  condition: "NEW" | "USED";
  fitmentApplications?: Array<Record<string, string>>;
  aspects?: Record<string, string[]>;
  /** Raw eBay/catalog title used to infer position or part name when structured fields are sparse. */
  sourceTitle?: string | null;
  placement?: string | null;
};

const POSITION_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfront\s+left\b|\bleft\s+front\b/i, label: "Front Left" },
  { pattern: /\bfront\s+right\b|\bright\s+front\b/i, label: "Front Right" },
  { pattern: /\brear\s+left\b|\bleft\s+rear\b/i, label: "Rear Left" },
  { pattern: /\brear\s+right\b|\bright\s+rear\b/i, label: "Rear Right" },
  { pattern: /\bfront\b/i, label: "Front" },
  { pattern: /\brear\b/i, label: "Rear" },
  { pattern: /\bleft\b/i, label: "Left" },
  { pattern: /\bright\b/i, label: "Right" },
];

function propertyValue(properties: Record<string, string>, ...keys: string[]): string | null {
  const entries = Object.entries(properties);
  for (const key of keys) {
    const match = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

const PRESERVED_ACRONYMS = new Set(["AWD", "OEM", "ABS", "HVAC", "ECU", "TCU", "PCM", "TPMS", "LED", "HID", "SUV", "4WD"]);
const PART_NAME_NOISE = new Set([
  "oem", "new", "used", "genuine", "original", "fits", "fit", "for", "compatible",
  "with", "the", "and", "part", "parts", "auto", "automotive", "car", "vehicle",
  // Common scraped color token that is not a useful English part descriptor.
  "gris",
]);

function isLikelyVehicleModelCode(token: string): boolean {
  const upper = token.toUpperCase();
  if (PRESERVED_ACRONYMS.has(upper) || PART_NAME_NOISE.has(token.toLowerCase())) return false;
  // Audi/VW style: A8, A6, Q5, TT; BMW: X5, M3; chassis: C7, W212, E90
  return /^(?:[A-Z]\d{1,2}|[CEFGSW]\d{2,3}|X\d|[A-Z]{2}\d)$/i.test(token);
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (PRESERVED_ACRONYMS.has(upper)) return upper;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function normalizePartNumberKey(value: string): string {
  return value
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    // Catalog titles often swap letter O / digit 0 (and I / 1).
    .replace(/O/g, "0")
    .replace(/I/g, "1");
}

function parseYear(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isInteger(year) ? year : null;
}

export function yearRangeFromFitment(applications: Array<Record<string, string>>): string | null {
  const years = applications
    .map((application) => parseYear(propertyValue(application, "Year", "year")))
    .filter((year): year is number => year !== null);
  if (!years.length) return null;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}-${max}`;
}

function dominantValue(applications: Array<Record<string, string>>, ...keys: string[]): string | null {
  const counts = new Map<string, number>();
  for (const application of applications) {
    const value = propertyValue(application, ...keys);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function generationFromFitment(applications: Array<Record<string, string>>): string | null {
  const candidate = dominantValue(applications, "Trim", "Submodel", "Platform", "Generation", "Body");
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (/^[A-Z0-9]{1,4}$/i.test(trimmed)) return trimmed.toUpperCase();
  const code = trimmed.match(/\b([A-Z]\d{1,2})\b/i);
  return code?.[1]?.toUpperCase() ?? null;
}

function modelGenerationFromFitment(applications: Array<Record<string, string>>): string | null {
  const model = dominantValue(applications, "Model", "model");
  if (!model) return null;
  const generation = generationFromFitment(applications);
  if (!generation) return titleCaseWords(model);
  const modelUpper = model.toUpperCase();
  const generationUpper = generation.toUpperCase();
  if (modelUpper.includes(generationUpper)) return titleCaseWords(model);
  return `${titleCaseWords(model)} ${generationUpper}`;
}

export function extractPosition(input: {
  partName?: string | null;
  sourceTitle?: string | null;
  placement?: string | null;
  aspects?: Record<string, string[]>;
}): string | null {
  if (input.placement?.trim()) {
    const normalized = extractPosition({ partName: input.placement, aspects: input.aspects });
    if (normalized) return normalized;
  }
  const aspectValues = Object.entries(input.aspects ?? {}).flatMap(([name, values]) => {
    if (!/placement|position|side/i.test(name)) return [];
    return values;
  });
  const corpus = [input.partName, input.sourceTitle, ...aspectValues].filter(Boolean).join(" ");
  for (const rule of POSITION_RULES) {
    if (rule.pattern.test(corpus)) return rule.label;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function yearRangeFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const range = text.match(/\b((?:19|20)\d{2})\s*(?:[-–]|to)\s*((?:19|20)\d{2})\b/i);
  if (range) {
    const left = Number(range[1]);
    const right = Number(range[2]);
    if (!Number.isInteger(left) || !Number.isInteger(right)) return null;
    return left <= right ? `${left}-${right}` : `${right}-${left}`;
  }
  const years = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => Number(match[1]));
  if (!years.length) return null;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}-${max}`;
}

export function modelFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const forMatch = text.match(/\b(?:for|fits?|compatible\s+with)\s+([A-Z]{1,3}\d{1,3}[A-Z]?)\b/i);
  if (forMatch?.[1] && isLikelyVehicleModelCode(forMatch[1])) {
    return forMatch[1].toUpperCase();
  }
  const codes = [...text.matchAll(/\b([A-Z]{1,3}\d{1,3}[A-Z]?)\b/gi)]
    .map((match) => match[1]!)
    .filter((token) => isLikelyVehicleModelCode(token));
  if (!codes.length) return null;
  // Prefer the last model-like token (catalog titles often end with "... Base A8 2004-2010")
  return codes.at(-1)!.toUpperCase();
}

function stripPartNumberVariants(name: string, primaryPartNumber: string): string {
  const target = normalizePartNumberKey(primaryPartNumber);
  if (!target || target.length < 5) return name;

  // Remove hyphen/space separated OEM-looking runs that match the primary MPN.
  return name.replace(/\b[A-Z0-9][A-Z0-9\s._/-]{4,}\b/gi, (token) => {
    const key = normalizePartNumberKey(token);
    if (key === target) return " ";
    // Also drop near-duplicates that only differ by a trailing revision letter already in target.
    if (key.length >= 6 && (target.startsWith(key) || key.startsWith(target))) return " ";
    return token;
  });
}

export function cleanPartNameForTitle(input: {
  partName: string;
  brand?: string | null;
  primaryPartNumber: string;
  position?: string | null;
  /** Extra tokens to strip (model, generation, year range, etc.). */
  extraRemovals?: Array<string | null | undefined>;
}): string {
  let name = input.partName;

  name = name
    .replace(/\b((?:19|20)\d{2})\s*(?:[-–]|to)\s*((?:19|20)\d{2})\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b\d+\.\d+\b/g, " "); // engine size noise like 3.0

  name = stripPartNumberVariants(name, input.primaryPartNumber);

  const removable = [
    input.brand,
    input.primaryPartNumber,
    input.position,
    ...(input.extraRemovals ?? []),
    "OEM",
    "New",
    "Used",
    "Genuine",
    "Original",
    "For",
    "Fits",
    "Compatible",
  ].filter(Boolean) as string[];

  for (const token of removable) {
    name = name.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, "ig"), " ");
  }

  for (const rule of POSITION_RULES) {
    name = name.replace(rule.pattern, " ");
  }

  name = name
    .replace(/[|/·•,;:()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const explicitRemovals = new Set(
    removable
      .flatMap((token) => token.split(/\s+/))
      .map((token) => token.toLowerCase())
      .filter(Boolean),
  );

  const kept = name
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => {
      const lower = word.toLowerCase();
      if (PART_NAME_NOISE.has(lower) || explicitRemovals.has(lower)) return false;
      // Bare interchange / catalog numbers left in titles.
      if (/^\d{5,}$/.test(word)) return false;
      const key = normalizePartNumberKey(word);
      const primaryKey = normalizePartNumberKey(input.primaryPartNumber);
      if (primaryKey && key === primaryKey) return false;
      return true;
    });

  const cleaned = kept.join(" ").trim();
  return titleCaseWords(cleaned || "Automotive Part");
}

export function isWeakPartName(partName: string | null | undefined): boolean {
  const cleaned = (partName ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned) return true;
  const lower = cleaned.toLowerCase();
  if (lower === "automotive part" || lower === "auto part" || lower === "part") return true;
  if (/^automotive parts?$/i.test(cleaned)) return true;
  // Brand-only leftovers like "Audi Automotive Part"
  if (/^(?:[a-z0-9][a-z0-9 .&-]{0,40}\s+)?automotive parts?$/i.test(cleaned)) return true;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0]!.length <= 3) return true;
  return false;
}

function conditionSuffix(condition: "NEW" | "USED"): string {
  return condition === "USED" ? "OEM Used" : "New";
}

function truncateTitle(segments: Array<string | null | undefined>): string {
  const suffix = segments.at(-1) ?? "";
  const partNumber = segments.at(-2) ?? "";
  const partName = segments.at(-3) ?? "Automotive Part";
  const optional = segments.slice(0, -3).map((segment) => segment ?? null);

  let shortenedPartName = partName;
  const partNameWords = partName.split(/\s+/).filter(Boolean);
  while (partNameWords.length > 1) {
    const candidate = [...optional.filter(Boolean), shortenedPartName, partNumber, suffix].join(" ").trim();
    if (candidate.length <= EBAY_TITLE_MAX_LENGTH) return candidate;
    partNameWords.pop();
    shortenedPartName = partNameWords.join(" ");
  }

  const dropOrder = [0, 1, 2, 3];
  const workingOptional = [...optional];
  for (const index of [...dropOrder].reverse()) {
    const candidate = [...workingOptional.filter(Boolean), shortenedPartName, partNumber, suffix].join(" ").trim();
    if (candidate.length <= EBAY_TITLE_MAX_LENGTH) return candidate;
    if (index < workingOptional.length) workingOptional[index] = null;
  }

  const minimal = [workingOptional.find(Boolean), shortenedPartName, partNumber, suffix].filter(Boolean).join(" ").trim();
  return minimal.slice(0, EBAY_TITLE_MAX_LENGTH).trim();
}

export function buildEbayListingTitle(input: ListingTitleInput): string {
  const applications = input.fitmentApplications ?? [];
  const corpus = [input.partName, input.sourceTitle].filter(Boolean).join(" ");
  const position = extractPosition({
    partName: input.partName,
    sourceTitle: input.sourceTitle,
    placement: input.placement,
    aspects: input.aspects,
  });
  const yearRange = yearRangeFromFitment(applications) ?? yearRangeFromText(corpus);
  const modelGeneration = modelGenerationFromFitment(applications) ?? modelFromText(corpus);
  const rawPartName = input.partName?.trim() || input.sourceTitle?.trim() || "Automotive Part";
  const partName = cleanPartNameForTitle({
    partName: rawPartName,
    brand: input.brand,
    primaryPartNumber: input.primaryPartNumber,
    position,
    extraRemovals: [yearRange, modelGeneration, ...(modelGeneration ? modelGeneration.split(/\s+/) : [])],
  });
  const segments = [
    yearRange,
    input.brand?.trim() ? titleCaseWords(input.brand.trim()) : null,
    modelGeneration,
    position,
    partName,
    input.primaryPartNumber.trim(),
    conditionSuffix(input.condition),
  ];

  const title = segments.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (title.length <= EBAY_TITLE_MAX_LENGTH) return title;
  return truncateTitle(segments);
}
