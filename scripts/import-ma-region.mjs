import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSupplierRegistry } from "./lib/supplier-registry.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");
const inputPath = process.env.NBR_MA_INPUT || "/tmp/ma-region.json";
const regionId = process.env.NBR_IMPORT_REGION || "grenlandsregionen";

const municipalityByPlace = {
  grenlandsregionen: {
    skien: "Skien kommune",
    porsgrunn: "Porsgrunn kommune",
    stathelle: "Bamble kommune",
    langesund: "Bamble kommune",
    brevik: "Porsgrunn kommune",
    langangen: "Porsgrunn kommune",
    herre: "Bamble kommune",
    kragero: "Kragerø kommune",
    jomfruland: "Kragerø kommune",
    drangedal: "Drangedal kommune",
    siljan: "Siljan kommune",
  },
};

const normalize = (value) => String(value || "")
  .toLocaleLowerCase("nb-NO")
  .replace(/æ/g, "ae")
  .replace(/ø/g, "o")
  .replace(/å/g, "a")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const identity = (row) => {
  const website = String(row.website || "").trim().toLocaleLowerCase("nb-NO");
  if (website) return `website:${website}`;
  const org = String(row.orgNumber || row.organizationNumber || "").replace(/\D/g, "");
  if (org) return `org:${org}`;
  return `name:${normalize(row.name)}|address:${normalize(row.address)}`;
};

const municipalityFor = (address) => {
  const place = normalize(String(address || "").split(",").pop()?.trim());
  const aliases = municipalityByPlace[regionId] || {};
  return aliases[place] || "";
};

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const incoming = Array.isArray(payload.suppliers) ? payload.suppliers : [];
const existing = JSON.parse(await fs.readFile(registerPath, "utf8"));
const merged = new Map(existing.map((row) => [identity(row), row]));
let imported = 0;
let updated = 0;

for (const row of incoming) {
  const normalized = {
    ...row,
    source: "MA",
    sourceLabel: "MA",
    sources: [...new Set([...(Array.isArray(row.sources) ? row.sources : []), "MA"])],
    regionId,
    municipality: municipalityFor(row.address),
    collectedAt: new Date().toISOString(),
  };
  const key = identity(normalized);
  if (merged.has(key)) {
    const current = merged.get(key);
    merged.set(key, {
      ...current,
      ...normalized,
      source: current.source || "MA",
      sourceLabel: current.sourceLabel || current.source || "MA",
      address: normalized.address || current.address || "",
      municipality: normalized.municipality || current.municipality || "",
      phone: normalized.phone || current.phone || "",
      email: normalized.email || current.email || "",
      website: normalized.website || current.website || "",
      sources: [...new Set([...(Array.isArray(current.sources) ? current.sources : []), current.source, "MA"].filter(Boolean))],
    });
    updated += 1;
  } else {
    merged.set(key, normalized);
    imported += 1;
  }
}

await writeSupplierRegistry(registerPath, [...merged.values()]);
console.log(JSON.stringify({ regionId, sourceCandidates: incoming.length, imported, updated, totalSuppliers: merged.size }, null, 2));
