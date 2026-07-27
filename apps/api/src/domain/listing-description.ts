import { yearRangeFromFitment } from "./listing-title.js";

export type ListingDescriptionFitmentRow = {
  make: string;
  model: string;
  year: string;
};

export type ListingDescriptionInput = {
  title: string;
  partName: string | null;
  primaryPartNumber: string;
  condition: "NEW" | "USED";
  brand?: string | null;
  notes?: string | null;
  fitmentApplications?: Array<Record<string, string>>;
};

const ACCENT = "#e07a5f";
const ACCENT_SOFT = "#fdf2ee";
const BORDER = "#e5e7eb";
const TEXT = "#111827";
const MUTED = "#4b5563";
const MAX_FITMENT_ROWS = 120;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function propertyValue(properties: Record<string, string>, ...keys: string[]): string | null {
  const entries = Object.entries(properties);
  for (const key of keys) {
    const match = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
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

export function fitmentRowsFromApplications(
  applications: Array<Record<string, string>>,
): ListingDescriptionFitmentRow[] {
  const rows: ListingDescriptionFitmentRow[] = [];
  const seen = new Set<string>();
  for (const application of applications) {
    const make = propertyValue(application, "Make", "make") ?? "";
    const model = propertyValue(application, "Model", "model") ?? "";
    const year = propertyValue(application, "Year", "year") ?? "";
    if (!make && !model && !year) continue;
    const key = `${make}|${model}|${year}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ make, model, year });
  }
  rows.sort((a, b) => {
    const makeCmp = a.make.localeCompare(b.make);
    if (makeCmp) return makeCmp;
    const modelCmp = a.model.localeCompare(b.model);
    if (modelCmp) return modelCmp;
    return a.year.localeCompare(b.year);
  });
  return rows;
}

function vehicleLabel(applications: Array<Record<string, string>>): string | null {
  const make = dominantValue(applications, "Make", "make");
  const model = dominantValue(applications, "Model", "model");
  if (make && model) return `${make} ${model}`;
  return make ?? model;
}

function uniqueMakes(applications: Array<Record<string, string>>): string[] {
  const makes: string[] = [];
  const seen = new Set<string>();
  for (const application of applications) {
    const make = propertyValue(application, "Make", "make");
    if (!make) continue;
    const key = make.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    makes.push(make);
  }
  return makes;
}

function checkIcon() {
  return `<span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;background:#22c55e;color:#ffffff;font-size:11px;font-weight:700;border-radius:2px;vertical-align:middle;">&#10003;</span>`;
}

function bulletIcon() {
  return `<span style="display:inline-block;width:12px;height:12px;border:2px solid #9ca3af;border-radius:50%;vertical-align:middle;box-sizing:border-box;"></span>`;
}

function sectionHeading(label: string) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:${TEXT};margin:0 0 8px 0;">${escapeHtml(label)}</div>
    <div style="height:2px;background:${ACCENT};margin:0 0 16px 0;"></div>
  `;
}

function cardOpen() {
  return `<div style="background:#ffffff;border:1px solid ${BORDER};border-radius:10px;padding:18px 20px;margin:0 0 16px 0;">`;
}

function cardClose() {
  return `</div>`;
}

function buildProductParagraph(input: ListingDescriptionInput, applications: Array<Record<string, string>>) {
  const partLabel = input.partName?.trim() || "automotive part";
  const conditionLabel = input.condition === "USED" ? "OEM used" : "OEM new";
  const makes = uniqueMakes(applications);
  const years = yearRangeFromFitment(applications);
  const vehicle = vehicleLabel(applications);
  const notes = input.notes?.trim();

  const parts: string[] = [
    `${conditionLabel.slice(0, 1).toUpperCase()}${conditionLabel.slice(1)} ${partLabel}, part number ${input.primaryPartNumber}.`,
  ];

  if (vehicle && years) {
    parts.push(`Compatible with ${vehicle} (${years})${makes.length > 1 ? ` and related applications across ${makes.join(", ")}` : ""}.`);
  } else if (makes.length) {
    parts.push(`Compatible with applications across ${makes.join(", ")}.`);
  } else {
    parts.push("Please verify fitment using the part number and vehicle details before purchase.");
  }

  parts.push("Please review all listing photos of the actual item before purchase.");
  if (notes) parts.push(notes);

  return parts.join(" ");
}

function buildFeatureItems(condition: "NEW" | "USED") {
  if (condition === "USED") {
    return [
      "100% tested and verified by our Quality Team",
      "Genuine OEM, Excellent Condition, inspected and approved",
      "Easy installation",
    ];
  }
  return [
    "100% inspected and verified by our Quality Team",
    "Genuine OEM / Brand New, as described in the listing",
    "Easy installation",
  ];
}

function buildBanner(condition: "NEW" | "USED") {
  const bullets = [
    condition === "USED" ? "GENUINE USED PARTS" : "GENUINE NEW PARTS",
    "WORLDWIDE SHIPPING",
    "QUALITY INSPECTED STOCK",
  ];
  const items = bullets.map((item) => `
    <div style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.04em;color:#ffffff;">
      <span style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;background:#22c55e;color:#ffffff;border-radius:50%;font-size:11px;margin-right:10px;vertical-align:middle;">&#10003;</span>${escapeHtml(item)}
    </div>
  `).join("");

  return `
    <div style="background:linear-gradient(135deg,#1f2937 0%,#111827 55%,#374151 100%);border-radius:10px;padding:22px 24px;margin:0 0 16px 0;">
      ${items}
    </div>
  `;
}

function buildTitleCard(input: ListingDescriptionInput, applications: Array<Record<string, string>>) {
  const vehicle = vehicleLabel(applications);
  const years = yearRangeFromFitment(applications);
  const metaBits = [
    vehicle ? `Vehicle: ${vehicle}` : null,
    years ? `Model Years: ${years}` : null,
    `Part No: ${input.primaryPartNumber}`,
  ].filter(Boolean) as string[];

  return `
    ${cardOpen()}
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.25;font-weight:700;color:${TEXT};margin:0 0 10px 0;">${escapeHtml(input.title)}</div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(metaBits.join(" | "))}</div>
    ${cardClose()}
  `;
}

function buildProductDescriptionCard(input: ListingDescriptionInput, applications: Array<Record<string, string>>) {
  const features = buildFeatureItems(input.condition).map((item) => `
    <div style="margin:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:${TEXT};">
      ${checkIcon()}<span style="margin-left:10px;vertical-align:middle;">${escapeHtml(item)}</span>
    </div>
  `).join("");

  return `
    ${cardOpen()}
      ${sectionHeading("Product Description")}
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${TEXT};margin:0 0 16px 0;">${escapeHtml(buildProductParagraph(input, applications))}</div>
      ${features}
    ${cardClose()}
  `;
}

function policyItem(title: string, body: string) {
  return `
    <div style="margin:0 0 14px 0;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:${TEXT};">
        ${bulletIcon()}
        <span style="margin-left:10px;vertical-align:middle;"><strong>${escapeHtml(title)}:</strong> ${escapeHtml(body)}</span>
      </div>
    </div>
  `;
}

function buildPoliciesCard() {
  return `
    ${cardOpen()}
      ${sectionHeading("Payment, Shipping & Returns")}
      ${policyItem("Payment Policy", "We accept only online payment methods, and you can choose any of the options provided by eBay at the time of checkout. If you have any queries or if you require any clarification, please contact us via eBay messaging service.")}
      ${policyItem("Shipping Policy", "We offer worldwide shipping. All packages are carefully packed and shipped via DHL, FedEx, or Aramex.")}
      ${policyItem("International Buyers Policy", "Please note: Import duties, taxes, and charges are not included in the item price or shipping cost. These charges are the buyer's responsibility.")}
      ${policyItem("Return Policy", "We accept returns within 14 days of the delivery date.")}
      ${policyItem("Handling Time", "We will ship your order within 3 working days.")}
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:${MUTED};margin-top:8px;">
        Trusted by professionals for premium automotive components. Please confirm the part number before purchase. For compatibility checks or bulk orders, feel free to contact us.
      </div>
    ${cardClose()}
  `;
}

function buildFitmentCard(rows: ListingDescriptionFitmentRow[]) {
  if (!rows.length) {
    return `
      ${cardOpen()}
        ${sectionHeading("Vehicle Fitment")}
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:${MUTED};">
          Fitment details were not attached to this listing. Please confirm compatibility using the part number, or message us with your vehicle details before purchase.
        </div>
      ${cardClose()}
    `;
  }

  const limited = rows.slice(0, MAX_FITMENT_ROWS);
  const body = limited.map((row) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT};">${escapeHtml(row.make)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT};">${escapeHtml(row.model)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${TEXT};">${escapeHtml(row.year)}</td>
    </tr>
  `).join("");

  const overflow = rows.length > limited.length
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};margin-top:10px;">Showing ${limited.length} of ${rows.length} compatible applications. Message us if you need a full compatibility check.</div>`
    : "";

  return `
    ${cardOpen()}
      ${sectionHeading("Vehicle Fitment")}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead>
          <tr>
            <th align="left" style="background:#111827;color:#ffffff;padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;">Make</th>
            <th align="left" style="background:#111827;color:#ffffff;padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;">Model</th>
            <th align="left" style="background:#111827;color:#ffffff;padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;">Year</th>
          </tr>
        </thead>
        <tbody>
          ${body}
        </tbody>
      </table>
      ${overflow}
    ${cardClose()}
  `;
}

function buildCompatibilityNotice() {
  return `
    <div style="background:${ACCENT_SOFT};border:1px solid ${ACCENT};border-radius:10px;padding:16px 18px;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${ACCENT};margin:0 0 10px 0;">
        &#9888; Important Compatibility Notice
      </div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:${TEXT};">
        <strong>PLEASE GET IN TOUCH WITH US FIRST IF YOU ARE UNSURE.</strong>
        Compatibility provided by eBay is only a guide. To avoid fitment issues, please compare the part number with your old part, or message us your car registration or VIN/chassis number for a technical check before purchase.
      </div>
    </div>
  `;
}

/** Detects the PartPulse HTML listing description template (so we do not overwrite custom HTML). */
export function isListingDescriptionTemplate(description: string | null | undefined) {
  if (!description) return false;
  return description.includes("Important Compatibility Notice")
    && (description.includes("Payment, Shipping &amp; Returns") || description.includes("Payment, Shipping & Returns"));
}

/** Short plain-text condition blurb for eBay used-item conditionDescription (max 1000 chars). */
export function buildConditionDescriptionPlain(input: {
  condition: "NEW" | "USED";
  partName?: string | null;
  primaryPartNumber: string;
  notes?: string | null;
}) {
  const partLabel = input.partName?.trim() || "automotive part";
  const base = input.condition === "USED"
    ? `Used OEM ${partLabel}. Part number ${input.primaryPartNumber}. Inspected and verified. Review all actual-item photos before purchase.`
    : `New OEM ${partLabel}. Part number ${input.primaryPartNumber}. Review all listing photos before purchase.`;
  const notes = input.notes?.trim();
  const combined = notes ? `${base} ${notes}` : base;
  return combined.slice(0, 1000);
}

/** Unbranded HTML listing description template for eBay product.description. */
export function buildListingDescriptionHtml(input: ListingDescriptionInput) {
  const applications = input.fitmentApplications ?? [];
  const rows = fitmentRowsFromApplications(applications);

  return `
<div style="max-width:900px;margin:0 auto;padding:12px;background:#f8fafc;border:2px solid ${ACCENT};border-radius:12px;box-sizing:border-box;">
  ${buildBanner(input.condition)}
  ${buildTitleCard(input, applications)}
  ${buildProductDescriptionCard(input, applications)}
  ${buildPoliciesCard()}
  ${buildFitmentCard(rows)}
  ${buildCompatibilityNotice()}
</div>
  `.trim();
}
