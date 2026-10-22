import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(root, "config/bergen-api-preview.json"), "utf8"));
const reportDir = path.join(root, "reports");
const reportPath = path.join(reportDir, "bergen-api-preview.json");
const userAgent = "NorskByggRadar/1.0 (separat kontrolladapter)";
const now = new Date();
const cutoffMs = now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000;
const include = new RegExp(config.include.join("|"), "i");
const exclude = new RegExp(config.exclude.join("|"), "i");

const text = (value) => Array.isArray(value)
  ? value.map(text).filter(Boolean).join(" ")
  : String(value || "").replace(/\s+/g, " ").trim();
const dateMs = (value) => {
  if (typeof value === "number") return value;
  const valueText = String(value || "");
  return /^\d+$/.test(valueText) ? Number(valueText) : Date.parse(valueText);
};
const activeStatus = (value) => !/^(avsluttet|utgår|utga)/i.test(text(value));
const caseKey = (item) => {
  const caseNumber = text(item.saksnr || item.bk360saksnr || item.kildeid);
  if (caseNumber) return `case:${caseNumber.toLocaleLowerCase("nb-NO")}`;
  return `item:${text(item.id || item.tittel).toLocaleLowerCase("nb-NO")}`;
};

const fetchPage = async (start) => {
  const url = new URL(config.endpoint);
  url.search = new URLSearchParams({
    tekst: config.query,
    start: String(start),
    rows: String(config.pageSize),
    orderBy: "statusDato",
    asc: "false",
  });
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": userAgent }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Bergen API svarte ${response.status}`);
  return response.json();
};

const raw = [];
for (let start = 0; start < 100000; start += config.pageSize) {
  const payload = await fetchPage(start);
  const items = Array.isArray(payload.items) ? payload.items : [];
  raw.push(...items);
  const timestamps = items.map((item) => dateMs(item.statusDato)).filter(Number.isFinite);
  if (!items.length || (timestamps.length && Math.min(...timestamps) < cutoffMs)) break;
}

const recent = raw.filter((item) => {
  const timestamp = dateMs(item.statusDato);
  return Number.isFinite(timestamp) && timestamp >= cutoffMs;
});
const buildingCases = recent.filter((item) => text(item.sakstypenavn).toLocaleLowerCase("nb-NO") === "byggesak");
const activeBuildingCases = buildingCases.filter((item) => activeStatus(item.status));
const candidateCases = activeBuildingCases.filter((item) => {
  const haystack = [item.tittel, item.adresse, item.gnrBnr, item.soketekst].map(text).join(" ");
  return include.test(haystack) && !exclude.test(haystack);
});
const unique = [...new Map(candidateCases.map((item) => [caseKey(item), item])).values()];
const countBy = (items, selector) => items.reduce((result, item) => {
  const key = selector(item) || "Ukjent";
  result[key] = (result[key] || 0) + 1;
  return result;
}, {});
const cleanItem = (item) => ({
  id: item.id,
  caseNumber: item.saksnr || "",
  title: item.tittel || "",
  address: item.adresse || [],
  status: item.status || "",
  statusDate: item.statusDato || "",
  caseType: item.sakstypenavn || "",
  applicant: item.soker || [],
  propertyNumbers: item.gnrBnr || [],
});

const report = {
  generatedAt: now.toISOString(),
  adapter: "bergen-municipality-api-preview",
  source: config.endpoint,
  query: config.query,
  lookbackDays: config.lookbackDays,
  cutoff: new Date(cutoffMs).toISOString(),
  doesNotModifyNbrProjectFiles: true,
  counts: {
    rawFetched: raw.length,
    recentByStatusDate: recent.length,
    buildingCaseType: buildingCases.length,
    activeBuildingCaseType: activeBuildingCases.length,
    afterNbrPreviewFilter: candidateCases.length,
    uniqueAfterCaseDeduplication: unique.length,
  },
  statusCounts: countBy(activeBuildingCases, (item) => item.status),
  caseTypeCounts: countBy(recent, (item) => item.sakstypenavn),
  examples: unique.slice(0, 20).map(cleanItem),
  filter: { include: config.include, exclude: config.exclude },
};

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, counts: report.counts, statusCounts: report.statusCounts }, null, 2));
