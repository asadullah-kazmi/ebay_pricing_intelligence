import { getConfig } from "../config.js";
import { EbayApiError, getEbayApplicationToken } from "./ebay.js";

export interface EbayImageUpload {
  imageId: string;
  imageUrl: string;
  maxDimensionImageUrl: string | null;
  expirationDate: Date | null;
}

function mediaBase(): string {
  return getConfig().ebay.environment === "production"
    ? "https://apim.ebay.com"
    : "https://apim.sandbox.ebay.com";
}

async function providerError(response: Response): Promise<EbayApiError> {
  let detail = "";
  try {
    const body = await response.json() as { errors?: Array<{ message?: string; longMessage?: string }> };
    detail = body.errors?.[0]?.longMessage ?? body.errors?.[0]?.message ?? "";
  } catch { /* Some eBay gateway responses have no JSON body. */ }
  return new EbayApiError(`eBay image upload failed (${response.status})${detail ? `: ${detail}` : ""}`, response.status, "upload image");
}

export function normalizeEbayImageResponse(
  location: string | null,
  body: { imageUrl?: unknown; maxDimensionImageUrl?: unknown; expirationDate?: unknown },
): EbayImageUpload {
  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.startsWith("https://") ? body.imageUrl : "";
  const imageId = location?.split("/").filter(Boolean).at(-1) ?? "";
  if (!imageId || !/^[A-Za-z0-9_-]+$/.test(imageId) || !imageUrl) throw new Error("eBay returned an invalid image response");
  const parsedExpiration = typeof body.expirationDate === "string" ? new Date(body.expirationDate) : null;
  return {
    imageId,
    imageUrl,
    maxDimensionImageUrl: typeof body.maxDimensionImageUrl === "string" && body.maxDimensionImageUrl.startsWith("https://")
      ? body.maxDimensionImageUrl
      : null,
    expirationDate: parsedExpiration && Number.isFinite(parsedExpiration.getTime()) ? parsedExpiration : null,
  };
}

export async function uploadImageToEbay(input: {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}): Promise<EbayImageUpload> {
  const token = await getEbayApplicationToken();
  const form = new FormData();
  const imageBuffer = new ArrayBuffer(input.bytes.byteLength);
  new Uint8Array(imageBuffer).set(input.bytes);
  form.append("image", new Blob([imageBuffer], { type: input.mimeType }), input.filename);
  const response = await fetch(`${mediaBase()}/commerce/media/v1_beta/image/create_image_from_file`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: form,
  });
  if (!response.ok) throw await providerError(response);
  const body = await response.json() as { imageUrl?: unknown; maxDimensionImageUrl?: unknown; expirationDate?: unknown };
  try {
    return normalizeEbayImageResponse(response.headers.get("location"), body);
  } catch {
    throw new EbayApiError("eBay returned an invalid image response", 502, "upload image");
  }
}
