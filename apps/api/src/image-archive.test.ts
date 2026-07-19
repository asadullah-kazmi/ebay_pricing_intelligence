import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ImageArchiveError, parseAndMapImageArchive } from "./image-archive.js";

const rows = [
  { id: "row-1", rowNumber: 2, sku: "SKU-001", imageGroup: "GROUP-A", vin: "1GNEK13Z43R000001" },
  { id: "row-2", rowNumber: 3, sku: "SKU-002", imageGroup: "GROUP-B", vin: null },
];

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("image archive mapping", () => {
  it("applies manifest, SKU folder, image-group folder, and filename precedence", () => {
    const archive = Buffer.from(zipSync({
      "manifest.csv": new TextEncoder().encode("filename,sku,displayOrder\nSKU-001/override.jpg,SKU-002,7\n"),
      "SKU-001/override.jpg": jpeg,
      "SKU-001/01.jpg": jpeg,
      "GROUP-B/02.png": png,
      "SKU-001_03.webp": webp,
      "unknown.jpg": jpeg,
    }));
    const result = parseAndMapImageArchive(archive, rows);
    const byPath = Object.fromEntries(result.images.map((image) => [image.sourcePath, image]));

    expect(byPath["SKU-001/override.jpg"]).toMatchObject({ importRowId: "row-2", strategy: "MANIFEST", displayOrder: 7, status: "MATCHED" });
    expect(byPath["SKU-001/01.jpg"]).toMatchObject({ importRowId: "row-1", strategy: "SKU_FOLDER", displayOrder: 1 });
    expect(byPath["GROUP-B/02.png"]).toMatchObject({ importRowId: "row-2", strategy: "IMAGE_GROUP_FOLDER", displayOrder: 2 });
    expect(byPath["SKU-001_03.webp"]).toMatchObject({ importRowId: "row-1", strategy: "SKU_FILENAME", displayOrder: 3 });
    expect(byPath["unknown.jpg"]).toMatchObject({ importRowId: null, strategy: "UNMATCHED", status: "UNMATCHED" });
  });

  it("sends duplicate image-group matches to review", () => {
    const archive = Buffer.from(zipSync({ "SHARED/01.jpg": jpeg }));
    const result = parseAndMapImageArchive(archive, [
      { ...rows[0]!, imageGroup: "SHARED" },
      { ...rows[1]!, imageGroup: "SHARED" },
    ]);
    expect(result.images[0]).toMatchObject({ importRowId: null, strategy: "AMBIGUOUS", status: "REVIEW_REQUIRED" });
  });

  it("matches manifest paths exactly when duplicate filenames exist", () => {
    const archive = Buffer.from(zipSync({
      "manifest.csv": new TextEncoder().encode("filename,sku\nA/01.jpg,SKU-001\n"),
      "A/01.jpg": jpeg,
      "B/01.jpg": jpeg,
    }));
    const result = parseAndMapImageArchive(archive, rows);
    const byPath = Object.fromEntries(result.images.map((image) => [image.sourcePath, image]));

    expect(byPath["A/01.jpg"]).toMatchObject({ importRowId: "row-1", strategy: "MANIFEST" });
    expect(byPath["B/01.jpg"]).toMatchObject({ importRowId: null, strategy: "UNMATCHED" });
  });

  it("rejects traversal paths instead of extracting them", () => {
    const archive = Buffer.from(zipSync({ "../outside.jpg": jpeg }));
    expect(() => parseAndMapImageArchive(archive, rows)).toThrow(ImageArchiveError);
  });

  it("skips files whose bytes do not match their image extension", () => {
    const archive = Buffer.from(zipSync({ "SKU-001/fake.jpg": new TextEncoder().encode("not an image") }));
    const result = parseAndMapImageArchive(archive, rows);
    expect(result.images).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "INVALID_IMAGE_CONTENT", sourcePath: "SKU-001/fake.jpg" }));
  });

  it("enforces expanded archive and file-count limits before mapping", () => {
    const archive = Buffer.from(zipSync({ "SKU-001/01.jpg": jpeg, "SKU-001/02.jpg": jpeg }));
    expect(() => parseAndMapImageArchive(archive, rows, { maxFiles: 1 })).toThrow("file limit");
    expect(() => parseAndMapImageArchive(archive, rows, { maxExpandedBytes: 5 })).toThrow("safety limit");
  });
});
