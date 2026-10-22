import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(
  path.join(root, "config/bjornafjorden-api-preview.json"),
  "utf8",
));
const reportDir = path.join(root, "reports");
const reportPath = path.join(reportDir, "bjornafjorden-api-preview.json");
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
  const parsed = Date.parse(candidate);
  if (Number.isFinite(parsed)) return parsed;
  const norwegian = candidate.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return norwegian
    ? Date.parse(`${norwegian[3]}-${norwegian[2]}-${norwegian[1]}`)
    : NaN;
};

const caseKey = (item) => {
  const properties = item.properties || {};
  return text(item.parentIdentifier || properties.saksnummer || properties.dokumentID || item.identifier || item.title)
    .toLocaleLowerCase("nb-NO");
};

const parseCookies = (response) => response.headers.getSetCookie?.()
  .map((cookie) => cookie.split(";", 1)[0])
  .join("; ") || "";

const request = (url, options = {}) => fetch(url, {
  ...options,
  signal: options.signal || AbortSignal.timeout(30000),
  headers: {
    accept: "application/json",
    "user-agent": userAgent,
    ...(options.headers || {}),
  },
});

const reportBase = {
  generatedAt: now.toISOString(),
  adapter: "bjornafjorden-municipality-acos-api-preview",
  municipality: config.municipality,
  municipalityNumber: config.municipalityNumber,
  source: config.sourceUrl,
  endpoint: config.endpoint,
  lookbackDays: config.lookbackDays,
  cutoff: new Date(cutoffMs).toISOString(),
  doesNotModifyNbrProjectFiles: true,
  filter: { include: config.include, exclude: config.exclude },
};

let report;
try {
  const landingPage = await request(config.sourceUrl, { headers: { accept: "text/html" } });
  if (!landingPage.ok) throw new Error(`Bjørnafjorden innsynsside svarte ${landingPage.status}`);
  const cookies = parseCookies(landingPage);
  const raw = [];
  const termCounts = {};

  for (const term of config.searchTerms) {
    const termRows = [];
    for (let page = 1; page <= config.maxPages; page += 1) {
      const response = await request(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          referer: config.sourceUrl,
          origin: new URL(config.sourceUrl).origin,
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
      if (!response.ok) throw new Error(`Bjørnafjorden API svarte ${response.status} for søket «${term}», side ${page}`);
      const payload = await response.json();
      const searchItems = payload?.content?.searchItems;
      const items = Array.isArray(searchItems?.items) ? searchItems.items : [];
      termRows.push(...items);
      if (!searchItems?.hasNextPage || !items.length) break;
    }
    termCounts[term] = termRows.length;
    raw.push(...termRows);
  }

  const recent = raw.filter((item) => {
    const timestamp = dateMs(item.properties?.dato);
    return Number.isFinite(timestamp) && timestamp >= cutoffMs;
  });
  const candidateItems = recent.filter((item) => {
    const properties = item.properties || {};
    const haystack = [item.title, item.type, properties.avsender, properties.mottakar].map(text).join(" ");
    return include.test(haystack) && !exclude.test(haystack);
  });
  const uniqueCases = [...new Map(candidateItems.map((item) => [caseKey(item), item])).values()];
  const typeCounts = recent.reduce((result, item) => {
    const key = text(item.type) || "Ukjent";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});

  report = {
    ...reportBase,
    status: "ok",
    counts: {
      rawFetched: raw.length,
      recentByDate: recent.length,
      afterNbrPreviewFilter: candidateItems.length,
      uniqueAfterCaseDeduplication: uniqueCases.length,
    },
    termCounts,
    typeCounts,
    examples: uniqueCases.slice(0, 25).map((item) => ({
      identifier: item.identifier || "",
      parentIdentifier: item.parentIdentifier || "",
      title: text(item.title),
      type: text(item.type),
      documentNumber: text(item.properties?.dokumentID),
      date: text(item.properties?.dato),
      sender: text(item.properties?.avsendar),
      recipient: text(item.properties?.mottakar),
    })),
  };
} catch (error) {
  report = {
    ...reportBase,
    status: "unavailable",
    error: error instanceof Error ? error.message : String(error),
    counts: null,
  };
}

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, status: report.status, counts: report.counts, error: report.error || null }, null, 2));
if (report.status !== "ok") process.exitCode = 2;
