import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");
const baseUrl = String(process.env.NBR_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const regionId = process.env.NBR_IMPORT_REGION || "bergensregionen";
const municipality = process.env.NBR_IMPORT_MUNICIPALITY || "Bergen kommune";
const trades = [
  ["snekker", "213"],
  ["elektriker", "123"],
  ["rorlegger", "207"],
  ["bad", "153"],
  ["tak", "229"],
];
const requestedTrade = String(process.env.NBR_IMPORT_TRADE || "").trim().toLocaleLowerCase("nb-NO");
const selectedTrades = requestedTrade === "all"
  ? [["all", ""]]
  : requestedTrade
    ? trades.filter(([trade]) => trade === requestedTrade)
    : trades;
if (requestedTrade && !selectedTrades.length) {
  throw new Error(`Ukjent MA-fag: ${requestedTrade}`);
}
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

for (const [trade, workTypes] of selectedTrades) {
  const params = new URLSearchParams({ regionId, regionName: regionId, municipalityNames: municipality });
  if (trade === "all") params.set("all", "1");
  else {
    params.set("trade", trade);
    params.set("workTypes", workTypes);
  }
  try {
    const response = await fetch(`${baseUrl}/api/mittanbud-suppliers?${params}`, { signal: AbortSignal.timeout(120000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    const candidates = (Array.isArray(payload.suppliers) ? payload.suppliers : []).filter((row) => String(row.source || "").toUpperCase() === "MA");
    let imported = 0;
    let updated = 0;
    let correctlyMapped = 0;
    for (const row of candidates) {
      const normalized = { ...row, source: "MA", sourceLabel: "MA", sources: [...new Set([...(row.sources || []), "MA"])], regionId, municipality, collectedAt: new Date().toISOString() };
      if (normalized.regionId === regionId && normalized.municipality === municipality) correctlyMapped += 1;
      const key = identity(normalized);
      const current = merged.get(key);
      if (!current) {
        merged.set(key, normalized);
        imported += 1;
      } else {
        merged.set(key, { ...current, ...normalized, source: current.source || "MA", sourceLabel: current.sourceLabel || current.source || "MA", sources: [...new Set([...(current.sources || []), ...(normalized.sources || []), current.source, "MA"].filter(Boolean))], regionId, municipality: normalized.municipality || current.municipality || municipality });
        updated += 1;
      }
    }
    summary.push({ trade, candidates: candidates.length, imported, updated, correctlyMapped });
  } catch (error) {
    summary.push({ trade, status: "error", error: error.message || String(error) });
  }
  await fs.writeFile(registerPath, `${JSON.stringify([...merged.values()], null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ regionId, municipality, totalSuppliers: merged.size, trades: summary }, null, 2));
