import cors from "cors";
import express from "express";
import { z } from "zod";
import { calculateAnalytics } from "./domain/analytics.js";
import { matchListing, normalizePartNumber } from "./domain/matching.js";
import { searchEbay } from "./providers/ebay.js";
import { store } from "./store.js";

const searchSchema = z.object({
  oem: z.string().trim().min(2).max(80),
  marketplace: z.enum(["EBAY_US", "EBAY_GB", "EBAY_DE"]).default("EBAY_US"),
});

export const app = express();
app.use(cors());
app.use(express.json());
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/search", async (req, res, next) => {
  try {
    const input = searchSchema.parse(req.body);
    const oem = normalizePartNumber(input.oem);
    const ownSellers = new Set((process.env.OWN_SELLERS ?? "my-parts-store").split(",").map((v) => v.trim().toLowerCase()));
    const candidates = await searchEbay(oem, input.marketplace);
    const listings = candidates.flatMap((item) => {
      const matchedOn = matchListing(item, oem);
      if (!matchedOn.length || ownSellers.has(item.seller.toLowerCase())) return [];
      return [{ ...item, matchedOn, landedPrice: Math.round((item.price + item.shipping) * 100) / 100 }];
    });
    const result = { oem, marketplace: input.marketplace, searchedAt: new Date().toISOString(), listings, analytics: calculateAnalytics(listings) };
    store.save(result);
    res.json(result);
  } catch (error) { next(error); }
});

app.get("/api/listings/:id", (req, res) => {
  const listing = store.listing(req.params.id);
  listing ? res.json(listing) : res.status(404).json({ error: "Listing not found" });
});
app.get("/api/analytics/:oem", (req, res) => {
  const result = store.get(normalizePartNumber(req.params.oem));
  result ? res.json(result.analytics) : res.status(404).json({ error: "Search this OEM first" });
});
app.get("/api/history/:oem", (req, res) => {
  const result = store.get(normalizePartNumber(req.params.oem));
  res.json(result ? [{ capturedAt: result.searchedAt, analytics: result.analytics }] : []);
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid search", issues: error.issues });
  console.error(error);
  res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected error" });
});
