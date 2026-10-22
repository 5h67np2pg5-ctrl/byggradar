import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSupplierRegistry } from "./lib/supplier-registry.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");
const regions = JSON.parse(await fs.readFile(path.join(root, "config", "region-structure.json"), "utf8")).regions || [];
const baseUrl = String(process.env.NBR_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const normalize = (value) => String(value || "").toLocaleLowerCase("nb-NO").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").replace(/[^a-z0-9]+/g, " ").trim();
const identity = (row) => {
  const org = String(row?.orgNumber || row?.organizationNumber || "").replace(/\D/g, "");
  if (org) return `org:${org}`;
  const website = String(row?.website || "").trim().toLocaleLowerCase("nb-NO");
  if (website) return `website:${website}`;
  return `name:${normalize(row?.name)}|address:${normalize(row?.address)}`;
};
const existing = JSON.parse(await fs.readFile(registerPath, "utf8").catch(() => "[]"));
const merged = new Map(existing.map((row) => [identity(row), row]));
const summary = [];

for (const region of regions) {
  const params = new URLSearchParams({ all: "1", regionId: region.id, regionName: region.name, municipalityNames: region.municipalities.join(",") });
  try {
    const response = await fetch(`${baseUrl}/api/mittanbud-suppliers?${params}`, { signal: AbortSignal.timeout(120000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    const candidates = (Array.isArray(payload.suppliers) ? payload.suppliers : []).filter((row) => String(row.source || "").toUpperCase() === "MA");
    let imported = 0;
    let updated = 0;
    let mapped = 0;
    for (const row of candidates) {
      const normalized = { ...row, source: "MA", sourceLabel: "MA", sources: [...new Set([...(row.sources || []), "MA"])], regionId: region.id, regionName: region.name, collectedAt: new Date().toISOString() };
      if (normalized.municipality) mapped += 1;
      const key = identity(normalized);
      const current = merged.get(key);
      if (!current) {
        merged.set(key, normalized);
        imported += 1;
      } else {
        merged.set(key, { ...current, ...normalized, source: current.source || "MA", sourceLabel: current.sourceLabel || current.source || "MA", sources: [...new Set([...(current.sources || []), ...(normalized.sources || []), current.source, "MA"].filter(Boolean))], municipality: normalized.municipality || current.municipality || "", regionId: normalized.regionId || current.regionId, regionName: normalized.regionName || current.regionName, address: normalized.address || current.address || "", phone: normalized.phone || current.phone || "", email: normalized.email || current.email || "" });
        updated += 1;
      }
    }
    summary.push({ regionId: region.id, candidates: candidates.length, imported, updated, mappedToMunicipality: mapped });
  } catch (error) {
    summary.push({ regionId: region.id, status: "error", error: error.message || String(error) });
  }
  await writeSupplierRegistry(registerPath, [...merged.values()]);
}

console.log(JSON.stringify({ totalSuppliers: merged.size, regions: summary }, null, 2));
