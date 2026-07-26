import { describe, expect, it } from "vitest";
import { parseAiPartIdentification, resolveGeminiModels } from "./gemini-part-identification.js";

describe("gemini part identification parsing", () => {
  it("parses clean JSON responses", () => {
    expect(parseAiPartIdentification(JSON.stringify({
      partName: "Driver Door Window Regulator",
      placement: "Front Left",
      confidence: "high",
      titleHint: "Window regulator assembly",
    }), "gemini-3.5-flash-lite")).toEqual({
      partName: "Driver Door Window Regulator",
      placement: "Front Left",
      confidence: "high",
      model: "gemini-3.5-flash-lite",
      titleHint: "Window regulator assembly",
    });
  });

  it("parses fenced JSON and normalizes weak fields", () => {
    const text = "```json\n{\"partName\":\"Brake Caliper\",\"placement\":\"null\",\"confidence\":\"maybe\"}\n```";
    expect(parseAiPartIdentification(text, "gemini-3.1-flash-lite")).toEqual({
      partName: "Brake Caliper",
      placement: null,
      confidence: "low",
      model: "gemini-3.1-flash-lite",
      titleHint: null,
    });
  });

  it("returns null when partName is missing", () => {
    expect(parseAiPartIdentification('{"placement":"Front"}', "gemini-3.5-flash-lite")).toBeNull();
  });

  it("defaults to the Lite cascade models", () => {
    expect(resolveGeminiModels()).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ]);
  });
});
