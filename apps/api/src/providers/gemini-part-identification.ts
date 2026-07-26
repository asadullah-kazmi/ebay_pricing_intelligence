import { getConfig } from "../config.js";

export type AiPartConfidence = "high" | "medium" | "low";

export type AiPartIdentificationInput = {
  partNumber: string;
  brand: string;
  condition?: "NEW" | "USED";
  marketplace?: string;
  /** Optional weak/messy catalog title for extra context. */
  sourceTitle?: string | null;
};

export type AiPartIdentificationResult = {
  partName: string;
  placement: string | null;
  confidence: AiPartConfidence;
  model: string;
  titleHint: string | null;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;

function buildPrompt(input: AiPartIdentificationInput): string {
  return [
    "You are an automotive parts expert helping build eBay used-OEM listing titles.",
    "Identify the part from brand + OEM part number only.",
    "Do NOT invent vehicle fitment years, makes, or models.",
    "Return ONLY valid JSON with this shape:",
    '{"partName":"Driver Door Window Regulator","placement":"Front Left","confidence":"high","titleHint":"short part description without brand or part number"}',
    "Rules:",
    "- partName: concise common English part name (max 60 chars), no brand, no OEM number, no condition words",
    "- placement: Front Left / Front Right / Rear Left / Rear Right / Front / Rear / Left / Right, or null if unknown",
    "- confidence: high | medium | low",
    "- titleHint: optional short phrase; null if unsure",
    "- If uncertain, use a conservative partName and confidence low",
    "",
    `Brand: ${input.brand}`,
    `Part number: ${input.partNumber}`,
    `Condition: ${input.condition ?? "USED"}`,
    `Marketplace: ${input.marketplace ?? "EBAY_US"}`,
    input.sourceTitle?.trim() ? `Catalog title hint: ${input.sourceTitle.trim().slice(0, 160)}` : "",
  ].filter(Boolean).join("\n");
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI response did not contain JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeConfidence(value: unknown): AiPartConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "low";
}

function normalizePlacement(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || /^null$/i.test(cleaned) || /^unknown$/i.test(cleaned)) return null;
  return cleaned.slice(0, 40);
}

export function parseAiPartIdentification(
  text: string,
  model: string,
): AiPartIdentificationResult | null {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const partName = typeof record.partName === "string" ? record.partName.trim().replace(/\s+/g, " ") : "";
  if (!partName) return null;
  const titleHint = typeof record.titleHint === "string" ? record.titleHint.trim() : null;
  return {
    partName: partName.slice(0, 120),
    placement: normalizePlacement(record.placement),
    confidence: normalizeConfidence(record.confidence),
    model,
    titleHint: titleHint ? titleHint.slice(0, 120) : null,
  };
}

function shouldTryNextModel(status: number, body: GeminiGenerateResponse): boolean {
  if (status === 404 || status === 429) return true;
  const message = body.error?.message?.toLowerCase() ?? "";
  return body.error?.status === "RESOURCE_EXHAUSTED"
    || message.includes("quota")
    || message.includes("rate limit")
    || message.includes("no longer available");
}

async function callGeminiModel(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; retryable: boolean; error: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    }),
  });

  const body = await response.json().catch(() => ({})) as GeminiGenerateResponse;
  if (!response.ok) {
    return {
      ok: false,
      retryable: shouldTryNextModel(response.status, body),
      error: body.error?.message ?? `Gemini HTTP ${response.status}`,
    };
  }

  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
  if (!text) {
    return { ok: false, retryable: true, error: "Gemini returned an empty response" };
  }
  return { ok: true, text };
}

export function resolveGeminiModels(configured?: string[]): string[] {
  const models = (configured?.length ? configured : [...DEFAULT_MODELS])
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(models)];
}

export async function identifyPartWithGemini(
  input: AiPartIdentificationInput,
): Promise<AiPartIdentificationResult | null> {
  const config = getConfig().gemini;
  if (!config.enabled || !config.apiKey) return null;

  const models = resolveGeminiModels(config.models);
  const prompt = buildPrompt(input);
  const errors: string[] = [];

  for (const model of models) {
    try {
      const result = await callGeminiModel(config.apiKey, model, prompt);
      if (!result.ok) {
        errors.push(`${model}: ${result.error}`);
        if (result.retryable) continue;
        break;
      }
      const parsed = parseAiPartIdentification(result.text, model);
      if (!parsed) {
        errors.push(`${model}: unparseable response`);
        continue;
      }
      return parsed;
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  console.warn(JSON.stringify({
    type: "gemini_part_identification_failed",
    brand: input.brand,
    partNumber: input.partNumber,
    errors,
  }));
  return null;
}
