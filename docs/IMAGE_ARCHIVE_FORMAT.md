# Image archive format

Upload one ZIP archive after the spreadsheet has been validated. The ZIP should contain JPEG, PNG, or WebP images and may contain an optional root-level `manifest.csv`.

## Preferred structure

```text
images.zip
â”œâ”€â”€ VIN-1GNEK13Z43R000001
â”‚   â”œâ”€â”€ SKU-001
â”‚   â”‚   â”œâ”€â”€ 01.jpg
â”‚   â”‚   â””â”€â”€ 02.jpg
â”‚   â””â”€â”€ SKU-002
â”‚       â””â”€â”€ 01.jpg
â””â”€â”€ SKU-003_01.jpg
```

The VIN folder is organizational. Mapping is based on the exact SKU folder, spreadsheet `ImageGroup`, or SKU filename prefix.

## Optional manifest

```csv
filename,sku,displayOrder
VIN-1GNEK13Z43R000001/SKU-001/01.jpg,SKU-001,1
VIN-1GNEK13Z43R000001/SKU-001/02.jpg,SKU-001,2
```

- `filename` may be an exact archive path or a basename when that basename is unique.
- `sku` must exactly match a staged spreadsheet SKU, case-insensitively.
- `displayOrder` is an optional non-negative integer.
- Ambiguous filenames or unknown SKUs are sent to review and are never silently assigned.

## Mapping precedence

1. Exact manifest entry.
2. Exact SKU folder.
3. Exact `ImageGroup` folder.
4. SKU filename prefix such as `SKU-001_01.jpg`.
5. Unmatched/manual review.

No visual guessing is used. Multiple candidates result in `REVIEW_REQUIRED`.

## Safety limits

- ZIP paths may not be absolute or contain `.` or `..` segments.
- macOS metadata files are ignored.
- Executables and unsupported extensions are skipped without extraction to disk.
- Image bytes must match the `.jpg`, `.jpeg`, `.png`, or `.webp` extension.
- Individual images use `STORAGE_MAX_IMAGE_BYTES`.
- The compressed request uses `STORAGE_MAX_IMAGE_ARCHIVE_BYTES`.
- A ZIP may contain at most 2,000 files and expand to at most 250 MB.
- Exact duplicate image content reuses one organization-owned media asset.

## Upload API

Send the ZIP as the raw body of `POST /api/imports/:id/images`, where `:id` is the staged import batch ID. Include an access token, `Content-Type: application/zip`, and `X-File-Name: images.zip`. Re-uploading the same archive returns the saved result; uploading a different archive to the same batch is rejected until replacement review is implemented.
