import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSupplierRegistry } from "./lib/supplier-registry.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");
const structure = JSON.parse(await fs.readFile(path.join(root, "config", "region-structure.json"), "utf8"));
const allowedRegions = new Set((structure.regions || []).map((region) => region.id));
const rows = await readSupplierRegistry(registerPath);
const failures = [];
const normalized = (value) => String(value || "").trim().toLocaleLowerCase("nb-NO").replace(/\s+/g, " ");
const identity = (row) => {
  const orgNumber = String(row.orgNumber || row.organizationNumber || "").replace(/\D/g, "");
  if (orgNumber) return `org:${orgNumber}`;
  const website = normalized(row.website || row.url);
  if (website) return `website:${website}`;
  const name = normalized(row.name || row.companyName);
  const address = normalized(row.address || row.registeredAddress);
  return name ? `name:${name}|address:${address}` : "";
};

const identitiesByRegion = new Map();
for (const [index, row] of rows.entries()) {
  if (!row || typeof row !== "object") failures.push(`rad ${index + 1}: er ikke et objekt`);
  if (!allowedRegions.has(row.regionId)) failures.push(`rad ${index + 1}: ukjent regionId ${row.regionId || "(mangler)"}`);
  if (!identity(row)) failures.push(`rad ${index + 1}: mangler organisasjonsnummer, nettsted eller navn`);
  const key = identity(row);
  if (key) {
    const regionKeys = identitiesByRegion.get(row.regionId) || new Set();
    if (regionKeys.has(key)) failures.push(`rad ${index + 1}: duplikat i ${row.regionId} (${key})`);
    regionKeys.add(key);
    identitiesByRegion.set(row.regionId, regionKeys);
  }
}

if (failures.length) {
  console.error("Leverandørregister: FEIL");
  failures.slice(0, 50).forEach((failure) => console.error(`- ${failure}`));
  if (failures.length > 50) console.error(`- ... og ${failures.length - 50} flere`);
  process.exitCode = 1;
} else {
  console.log(`Leverandørregister OK: ${rows.length} poster, ${allowedRegions.size} tillatte regioner kontrollert.`);
}
