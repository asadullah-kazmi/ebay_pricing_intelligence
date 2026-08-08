import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MediaDriveError, parseMediaDriveArchive } from "./media-drive-service.js";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("media drive archive parsing", () => {
  it("groups images by the part-number subfolder", () => {
    const archive = Buffer.from(zipSync({
      "Photos/8K0615301M/front.jpg": jpeg,
      "Photos/8K0615301M/side_02.png": png,
      "Photos/84178783/module.webp": webp,
      "Photos/8K0615301M/nested/extra.jpg": jpeg,
    }));
    const result = parseMediaDriveArchive(archive);
    const byPath = Object.fromEntries(result.images.map((image) => [image.sourcePath, image]));

    expect(result.images).toHaveLength(4);
    expect(byPath["Photos/8K0615301M/front.jpg"]).toMatchObject({ partFolder: "8K0615301M", mimeType: "image/jpeg", displayOrder: 0 });
    expect(byPath["Photos/8K0615301M/side_02.png"]).toMatchObject({ partFolder: "8K0615301M", mimeType: "image/png", displayOrder: 2 });
    expect(byPath["Photos/84178783/module.webp"]).toMatchObject({ partFolder: "84178783", mimeType: "image/webp" });
    expect(byPath["Photos/8K0615301M/nested/extra.jpg"]).toMatchObject({ partFolder: "NESTED", folderPath: "Photos/8K0615301M/nested" });
  });

  it("skips files that are not inside a part-number subfolder", () => {
    const archive = Buffer.from(zipSync({ "top-level.jpg": jpeg }));
    const result = parseMediaDriveArchive(archive);
    expect(result.images).toHaveLength(0);
    expect(result.issues.some((issue) => issue.code === "IMAGE_NOT_IN_SUBFOLDER")).toBe(true);
  });

  it("skips unsupported files and invalid image content", () => {
    const archive = Buffer.from(zipSync({
      "PART-1/notes.txt": new TextEncoder().encode("hello"),
      "PART-1/fake.jpg": new TextEncoder().encode("not an image"),
    }));
    const result = parseMediaDriveArchive(archive);
    expect(result.images).toHaveLength(0);
    expect(result.issues.some((issue) => issue.code === "UNSUPPORTED_FILE_SKIPPED")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "INVALID_IMAGE_CONTENT")).toBe(true);
  });

  it("rejects traversal paths and unsafe archives", () => {
    const traversal = Buffer.from(zipSync({ "PART-1/../outside.jpg": jpeg }));
    expect(() => parseMediaDriveArchive(traversal)).toThrow(MediaDriveError);
    const notZip = Buffer.from("not a zip archive at all");
    expect(() => parseMediaDriveArchive(notZip)).toThrow(MediaDriveError);
  });

  it("enforces the per-image byte limit", () => {
    const archive = Buffer.from(zipSync({ "PART-1/big.jpg": jpeg }));
    const result = parseMediaDriveArchive(archive, { maxImageBytes: 2 });
    expect(result.images).toHaveLength(0);
    expect(result.issues.some((issue) => issue.code === "IMAGE_TOO_LARGE")).toBe(true);
  });
});
