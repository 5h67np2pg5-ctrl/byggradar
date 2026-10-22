import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(root, "config/askoy-api-preview.json"), "utf8"));
const reportDir = path.join(root, "reports");
const reportPath = path.join(reportDir, "askoy-api-preview.json");
const userAgent = "NorskByggRadar/1.0 (separat kontrolladapter)";
const now = new Date();
const cutoffMs = now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000;
const include = new RegExp(config.include, "i");
const exclude = new RegExp(config.exclude, "i");
const clean = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const toDate = (value) => {
  const text = clean(value);
  const norwegian = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const parsed = norwegian ? Date.parse(`${norwegian[3]}-${norwegian[2]}-${norwegian[1]}`) : Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
};
const cookiesFrom = (response) => response.headers.getSetCookie?.()
  .map((cookie) => cookie.split(";", 1)[0]).join("; ") || "";
const request = (url, options = {}) => fetch(url, {
  ...options,
  signal: options.signal || AbortSignal.timeout(30000),
  headers: { accept: "application/json", "user-agent": userAgent, ...(options.headers || {}) },
});
const keyFor = (item) => {
  const properties = item.properties || {};
  return clean(properties.dokumentID || properties.saksnummer || item.identifier || item.title).toLocaleLowerCase("nb-NO");
};

const reportBase = {
  generatedAt: now.toISOString(),
  adapter: "askoy-municipality-onacos-api-preview",
  municipality: config.municipality,
  municipalityNumber: config.municipalityNumber,
  source: config.sourceUrl,
  endpoint: config.endpoint,
  doesNotModifyNbrProjectFiles: true,
  filter: { searchTerm: config.searchTerm, lookbackDays: config.lookbackDays, include: config.include, exclude: config.exclude },
};

let report;
try {
  const landingPage = await request(config.sourceUrl, { headers: { accept: "text/html" } });
  if (!landingPage.ok) throw new Error(`Askøy innsynsside svarte ${landingPage.status}`);
  const cookies = cookiesFrom(landingPage);
  const raw = [];
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
          { key: "searchTerm", value: config.searchTerm },
          { key: "page", value: String(page) },
          { key: "pageSize", value: String(config.pageSize) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Askøy API svarte ${response.status}`);
    const payload = await response.json();
    const searchItems = payload?.content?.searchItems;
    const items = Array.isArray(searchItems?.items) ? searchItems.items : [];
    raw.push(...items);
    if (!searchItems?.hasNextPage || !items.length) break;
  }
  const recent = raw.filter((item) => {
    const value = toDate(item.properties?.dato);
    return Number.isFinite(value) && value >= cutoffMs;
  });
  const filtered = recent.filter((item) => {
    const properties = item.properties || {};
    const haystack = [item.title, item.type, properties.avsender, properties.mottaker].map(clean).join(" ");
    return include.test(haystack) && !exclude.test(haystack);
  });
  const unique = [...new Map(filtered.map((item) => [keyFor(item), item])).values()];
  report = {
    ...reportBase,
    status: "ok",
    cutoff: new Date(cutoffMs).toISOString(),
    counts: { rawFetched: raw.length, recentByDate: recent.length, afterNbrPreviewFilter: filtered.length, uniqueAfterCaseDeduplication: unique.length },
    examples: unique.slice(0, 25).map((item) => ({
      identifier: item.identifier || "",
      title: clean(item.title),
      type: clean(item.type),
      caseNumber: clean(item.properties?.saksnummer),
      documentNumber: clean(item.properties?.dokumentID),
      date: clean(item.properties?.dato),
      sender: clean(item.properties?.avsender),
      recipient: clean(item.properties?.mottaker),
    })),
  };
} catch (error) {
  report = { ...reportBase, status: "unavailable", error: error.message, counts: null };
}

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, status: report.status, counts: report.counts, error: report.error || null }, null, 2));
if (report.status !== "ok") process.exitCode = 2;
