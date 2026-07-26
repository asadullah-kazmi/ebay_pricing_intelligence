const PRICING_KEY = "partpulse:dismissed-pricing-jobs";
const FITMENT_KEY = "partpulse:dismissed-fitment-jobs";

function readIds(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeIds(key: string, ids: Set<string>) {
  sessionStorage.setItem(key, JSON.stringify([...ids]));
}

export function isDismissedPricingJob(id: string) {
  return readIds(PRICING_KEY).has(id);
}

export function dismissPricingJob(id: string) {
  const ids = readIds(PRICING_KEY);
  ids.add(id);
  writeIds(PRICING_KEY, ids);
}

export function isDismissedFitmentJob(id: string) {
  return readIds(FITMENT_KEY).has(id);
}

export function dismissFitmentJob(id: string) {
  const ids = readIds(FITMENT_KEY);
  ids.add(id);
  writeIds(FITMENT_KEY, ids);
}

export function shouldAutoShowJob(status: string) {
  return status === "QUEUED" || status === "RUNNING";
}
