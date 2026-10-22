import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(root, "config/oygarden-api-preview.json"), "utf8"));
const reportDir = path.join(root, "reports");
const reportPath = path.join(reportDir, "oygarden-api-preview.json");
const userAgent = "NorskByggRadar/1.0 (separat kontrolladapter)";
const now = new Date();
const cutoffMs = now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000;
const include = new RegExp(config.include.join("|"), "i");
const exclude = new RegExp(config.exclude.join("|"), "i");
const text = (value) => Array.isArray(value)
  ? value.map(text).filter(Boolean).join(" ")
  : String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const dateMs = (value) => {
  const candidate = String(value || "");
  if (/^\d+$/.test(candidate)) return Number(candidate);
  const parsed = Date.parse(candidate);
  if (Number.isFinite(parsed)) return parsed;
  const norwegian = candidate.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return norwegian ? Date.parse(`${norwegian[3]}-${norwegian[2]}-${norwegian[1]}`) : NaN;
};
const caseKey = (item) => {
  const properties = item.properties || {};
  return text(properties.saksnummer || properties.dokumentID || item.identifier || item.title)
    .toLocaleLowerCase("nb-NO");
};
const parseCookies = (response) => response.headers.getSetCookie?.()
  .map((cookie) => cookie.split(";", 1)[0]).join("; ") || "";
const request = (url, options = {}) => fetch(url, {
  ...options,
  signal: options.signal || AbortSignal.timeout(30000),
  headers: {
    accept: "application/json",
    "user-agent": userAgent,
    ...(options.headers || {}),
  },
});

const landingPage = await request(config.sourceUrl, { headers: { accept: "text/html" } });
if (!landingPage.ok) throw new Error(`Øygarden innsynsside svarte ${landingPage.status}`);
const cookies = parseCookies(landingPage);
// ACOS returns hundreds of pages for broad searches. These seed terms cover
// both language forms without multiplying the municipality's API load for
// every individual filter word. The final NBR filter still runs over all
// returned title/type/sender/recipient text, and results are deduplicated.
const terms = ["bygg"];
const raw = [];
const termCounts = {};

async function fetchTerm(term) {
  const rows = [];
  for (let page = 1; page <= 40; page += 1) {
    const response = await request(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-anti-csrf": "1",
        referer: config.sourceUrl,
        ...(cookies ? { cookie: cookies } : {}),
      },
      body: JSON.stringify({
        type: config.overviewType,
        keyValues: [
          { key: "searchTerm", value: term },
          { key: "page", value: String(page) },
          { key: "pageSize", value: String(config.pageSize) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`API svarte ${response.status} for søket «${term}»`);
    const payload = await response.json();
    const searchItems = payload?.content?.searchItems;
    const items = Array.isArray(searchItems?.items) ? searchItems.items : [];
    rows.push(...items);
    if (!searchItems?.hasNextPage || !items.length) break;
  }
  termCounts[term] = rows.length;
  return rows;
}

for (const term of terms) raw.push(...await fetchTerm(term));

const recent = raw.filter((item) => {
  const timestamp = dateMs(item.properties?.dato);
  return Number.isFinite(timestamp) && timestamp >= cutoffMs;
});
const candidateItems = recent.filter((item) => {
  const properties = item.properties || {};
  const haystack = [item.title, item.type, properties.avsender, properties.mottaker].map(text).join(" ");
  return include.test(haystack) && !exclude.test(haystack);
});
const unique = [...new Map(candidateItems.map((item) => [caseKey(item), item])).values()];
const countBy = (items, selector) => items.reduce((result, item) => {
  const key = selector(item) || "Ukjent";
  result[key] = (result[key] || 0) + 1;
  return result;
}, {});
const cleanItem = (item) => ({
  identifier: item.identifier || "",
  title: text(item.title),
  type: text(item.type),
  caseNumber: text(item.properties?.saksnummer),
  documentNumber: text(item.properties?.dokumentID),
  date: text(item.properties?.dato),
  sender: text(item.properties?.avsender),
  recipient: text(item.properties?.mottaker),
  parentIdentifier: item.parentIdentifier || "",
});

const report = {
  generatedAt: now.toISOString(),
  adapter: "oygarden-municipality-acos-api-preview",
  municipality: config.municipality,
  municipalityNumber: config.municipalityNumber,
  source: config.sourceUrl,
  endpoint: config.endpoint,
  lookbackDays: config.lookbackDays,
  cutoff: new Date(cutoffMs).toISOString(),
  doesNotModifyNbrProjectFiles: true,
  counts: {
    rawFetched: raw.length,
    recentByDate: recent.length,
    afterNbrPreviewFilter: candidateItems.length,
    uniqueAfterCaseDeduplication: unique.length,
  },
  termCounts,
  typeCounts: countBy(recent, (item) => text(item.type)),
  examples: unique.slice(0, 25).map(cleanItem),
  filter: { include: config.include, exclude: config.exclude },
};

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, counts: report.counts, termCounts }, null, 2));
