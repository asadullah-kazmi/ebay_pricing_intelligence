# Catalog intake spreadsheet v1.0

Use [partpulse-catalog-import-v1.csv](../templates/partpulse-catalog-import-v1.csv) as the authoritative import template. Keep the header names unchanged and save the completed file as UTF-8 CSV. One row represents one catalog part/SKU.

## Required columns

| Column | Format |
|---|---|
| `TemplateVersion` | Always `1.0`. |
| `VIN` | A 17-character donor VIN or the exact value `UNAVAILABLE`. |
| `SKU` | Non-empty and unique inside the company. Comparisons are case-insensitive. |
| `PartNumber` | Primary OEM, MPN, or interchange number. Original punctuation is retained. |
| `Condition` | `NEW` or `USED`. |
| `Quantity` | Whole number greater than or equal to zero. |
| `Cost` | Decimal greater than or equal to zero, without a currency symbol. |
| `Currency` | Three-letter ISO 4217 code such as `USD`. |
| `ImageGroup` | Exact folder or manifest group used for image matching. Prefer the SKU. |

## Optional columns

| Column | Format |
|---|---|
| `Brand` | Verified manufacturer or brand. |
| `PartName` | Human-readable part name. |
| `InterchangeNumbers` | Multiple values separated by `|`, for example `13598091|F011500138`. |
| `Description` | Verified part and condition information. |
| `DonorMileage` | Whole number greater than or equal to zero. |
| `DonorColor` | Vehicle or part color. |
| `Placement` | Vehicle placement such as `Front Left`. |
| `Warehouse` | Existing or import-created warehouse code. |
| `BinLocation` | Bin code belonging to `Warehouse`. |
| `Weight` | Non-negative packaged weight. |
| `WeightUnit` | `LB` or `KG`; required when `Weight` is supplied. |
| `Length`, `Width`, `Height` | Non-negative package dimensions. |
| `DimensionUnit` | `IN` or `CM`; required when any dimension is supplied. |
| `Notes` | Internal notes; never automatically included in an eBay description. |

## Data rules

- Do not rename, merge, or duplicate headers.
- Do not include title rows above the header.
- Do not use formulas. Store their calculated values instead.
- Preserve leading zeroes by formatting identifier columns as text before exporting from Excel.
- The importer trims surrounding whitespace but does not silently invent missing required data.
- Part-number search normalization removes punctuation and uses uppercase, while the original value is preserved for display and publishing.
- Reusing a SKU updates nothing automatically; the import preview must identify the conflict for user review.
- Re-uploading the exact same file is identified by its SHA-256 checksum and must not create another batch.
- `VIN=UNAVAILABLE` creates no donor-vehicle record and limits automatic fitment options.

## Download API

Authenticated users can retrieve the current template from `GET /api/imports/template` and its machine-readable field contract from `GET /api/imports/template/schema`. The CSV response includes `X-Template-Version: 1.0`.
