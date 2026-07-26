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

export function cleanPartNameForTitle(input: {
  partName: string;
  brand?: string | null;
  primaryPartNumber: string;
  position?: string | null;
}): string {
  let name = input.partName;
  const removable = [
    input.brand,
    input.primaryPartNumber,
    input.position,
    "OEM",
    "New",
    "Used",
    "Genuine",
    "For",
  ].filter(Boolean) as string[];

  for (const token of removable) {
    name = name.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, "ig"), " ");
  }

  for (const rule of POSITION_RULES) {
    name = name.replace(rule.pattern, " ");
  }

  name = name
    .replace(/\bfor\b/gi, " ")
    .replace(/[|/·•,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return titleCaseWords(name || input.partName);
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
  const position = extractPosition({
    partName: input.partName,
    sourceTitle: input.sourceTitle,
    placement: input.placement,
    aspects: input.aspects,
  });
  const rawPartName = input.partName?.trim() || input.sourceTitle?.trim() || "Automotive Part";
  const partName = cleanPartNameForTitle({
    partName: rawPartName,
    brand: input.brand,
    primaryPartNumber: input.primaryPartNumber,
    position,
  });
  const segments = [
    yearRangeFromFitment(applications),
    input.brand?.trim() ? titleCaseWords(input.brand.trim()) : null,
    modelGenerationFromFitment(applications),
    position,
    partName,
    input.primaryPartNumber.trim(),
    conditionSuffix(input.condition),
  ];

  const title = segments.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (title.length <= EBAY_TITLE_MAX_LENGTH) return title;
  return truncateTitle(segments);
}
