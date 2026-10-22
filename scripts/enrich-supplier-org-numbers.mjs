import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");

const normalizeOrgNumber = (value) => String(value || "").replace(/\D/g, "").slice(0, 9);
const extractOrgNumber = (value) => {
  const match = String(value || "").match(/(?:^|[^0-9])(\d{9})(?:[^0-9]|$)/);
  return match?.[1] || "";
};

const suppliers = JSON.parse(await fs.readFile(registerPath, "utf8"));
let fromExisting = 0;
let fromHpUrl = 0;
let skipped = 0;
const skippedRows = [];

const enriched = suppliers.map((supplier) => {
  const existing = normalizeOrgNumber(supplier.orgNumber || supplier.organizationNumber);
  if (existing) {
    fromExisting += 1;
    return { ...supplier, orgNumber: existing };
  }

  // HP detail URLs contain the registered organization number. Only accept an
  // exact nine-digit value from the official detail URL pattern.
  const isHpDetailUrl = /^https?:\/\/haandverkerportalen\.no\/bedrift\/[^/?#]+-\d{9}$/i.test(String(supplier.website || ""));
  const orgNumber = isHpDetailUrl ? extractOrgNumber(supplier.website) : "";
  if (!orgNumber) {
    skipped += 1;
    skippedRows.push({ name: supplier.name, website: supplier.website, source: supplier.source });
    return supplier;
  }

  fromHpUrl += 1;
  return {
    ...supplier,
    orgNumber,
    orgNumberSource: "HP-kildelenke",
    orgNumberCheckedAt: new Date().toISOString(),
  };
});

await fs.writeFile(registerPath, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(root, "data", "supplier-org-number-enrichment-report.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  total: enriched.length,
  withOrganizationNumber: enriched.filter((supplier) => normalizeOrgNumber(supplier.orgNumber)).length,
  fromExisting,
  fromHpUrl,
  skipped,
  skippedRows,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  total: enriched.length,
  withOrganizationNumber: enriched.filter((supplier) => normalizeOrgNumber(supplier.orgNumber)).length,
  fromExisting,
  fromHpUrl,
  skipped,
}, null, 2));
