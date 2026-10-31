import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const regionDir = path.join(root, "public/data/regions/bergensregionen");
const locationPath = path.join(regionDir, "projects_location_enriched.json");
const contactPath = path.join(regionDir, "projects_contact_enriched.json");
const reportPath = path.join(root, "reports/bergens-direct-adapter-import.json");
const userAgent = "NorskByggRadar/1.0 (kommunal kontrollimport)";
const now = new Date();
const cutoffMs = now.getTime() - 90 * 24 * 60 * 60 * 1000;
const configs = [
  JSON.parse(await fs.readFile(path.join(root, "config/askoy-api-preview.json"), "utf8")),
  JSON.parse(await fs.readFile(path.join(root, "config/oygarden-api-preview.json"), "utf8")),
  JSON.parse(await fs.readFile(path.join(root, "config/alver-api-preview.json"), "utf8")),
];

const clean = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const dateMs = (value) => {
  const raw = clean(value);
  const norwegian = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const parsed = norwegian ? Date.parse(`${norwegian[3]}-${norwegian[2]}-${norwegian[1]}`) : Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
};
const isoDate = (value) => {
  const ms = dateMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
};
const normalize = (value) => clean(value).toLocaleLowerCase("nb-NO").replace(/[^a-z0-9æøå]+/gi, " ").trim();
const request = (url, options = {}) => fetch(url, {
  ...options,
  signal: options.signal || AbortSignal.timeout(30000),
  headers: { accept: "application/json", "user-agent": userAgent, ...(options.headers || {}) },
});
const parseCookies = (response) => response.headers.getSetCookie?.().map((cookie) => cookie.split(";", 1)[0]).join("; ") || "";
const phaseFor = (value) => /igangsetting|igangsetjing|tillatelse|løyve|rammetillatelse|rammeløyve|anbud|kontrakt/i.test(clean(value)) ? "Fase 2" : "Fase 1";
const keyFor = (row) => `${row.municipality}|${row.caseNumber || row.sourceDocumentId || `${row.title}|${row.documentDate}`}`.toLocaleLowerCase("nb-NO");

async function collectOnacos(config) {
  const landing = await request(config.sourceUrl, { headers: { accept: "text/html" } });
  if (!landing.ok) throw new Error(`${config.municipality} innsynsside svarte ${landing.status}`);
  const cookies = parseCookies(landing);
  const include = new RegExp(Array.isArray(config.include) ? config.include.join("|") : config.include, "i");
  const exclude = new RegExp(config.exclude, "i");
  const raw = [];
  for (let page = 1; page <= 40; page += 1) {
    const response = await request(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-anti-csrf": "1", referer: config.sourceUrl, ...(cookies ? { cookie: cookies } : {}) },
      body: JSON.stringify({ type: config.overviewType, keyValues: [{ key: "searchTerm", value: config.searchTerm || "bygg" }, { key: "page", value: String(page) }, { key: "pageSize", value: String(config.pageSize) }] }),
    });
    if (!response.ok) throw new Error(`${config.municipality} API svarte ${response.status}`);
    const payload = await response.json();
    const searchItems = payload?.content?.searchItems;
    const items = Array.isArray(searchItems?.items) ? searchItems.items : [];
    raw.push(...items);
    if (!searchItems?.hasNextPage || !items.length) break;
  }
  const recent = raw.filter((item) => dateMs(item.properties?.dato) >= cutoffMs);
  const filtered = recent.filter((item) => {
    const p = item.properties || {};
    const haystack = [item.title, item.type, p.avsender, p.mottaker].map(clean).join(" ");
    return include.test(haystack) && !exclude.test(haystack);
  });
  const unique = [...new Map(filtered.map((item) => {
    const p = item.properties || {};
    return [clean(p.saksnummer || p.dokumentID || item.identifier || item.title).toLocaleLowerCase("nb-NO"), { item, p }];
  })).values()];
  return { raw: raw.length, recent: recent.length, filtered: filtered.length, unique: unique.length, rows: unique.map(({ item, p }) => ({
    sourceStream: "municipal_acos_innsyn",
    sourceDocumentId: clean(p.saksnummer || p.dokumentID || item.identifier),
    municipality: config.municipality,
    municipalityNumber: config.municipalityNumber,
    title: clean(item.title),
    caseNumber: clean(p.saksnummer || p.dokumentID),
    documentType: clean(item.type),
    documentDate: isoDate(p.dato),
    recordedDate: isoDate(p.dato),
    fromName: clean(p.avsender),
    toName: clean(p.mottaker),
    sourceUrl: config.sourceUrl,
    address: "",
    files: [],
    phase: phaseFor(item.title),
    classification: { phase: phaseFor(item.title), stage: "saksbehandling pågår", reason: `Direkte ${config.municipality} API` },
    locationEnrichment: { status: "pending", source: "municipal_acos_innsyn" },
  })) };
}

async function collectAlver(config) {
  const include = new RegExp(config.include, "i");
  const exclude = new RegExp(config.exclude, "i");
  const queryUrl = (term, startrow) => {
    const url = new URL(config.sourceUrl);
    url.search = new URLSearchParams({ response: "arkivsak_sok_tomdefault", showresults: "true", startrow: String(startrow), tomtsok: "false", simple: "false", tittel: term, sok: "Søk" });
    return url;
  };
  const raw = [];
  for (const term of ["bygg", "byggesak", "byggjesak", "søknad"]) {
    for (let startrow = 0; startrow < 5000; startrow += config.pageSize) {
      const response = await request(queryUrl(term, startrow), { headers: { accept: "text/html" } });
      if (!response.ok) throw new Error(`${config.municipality} WebSak svarte ${response.status}`);
      const html = await response.text();
      const containers = html.match(/<tr\b[\s\S]*?<\/tr>/gi)
        || html.match(/<a\b[^>]+href=["'][^"']*response=arkivsak_detaljer[^"']*["'][\s\S]*?<\/a>/gi)
        || [];
      const parsed = containers.map((rowHtml) => {
        const link = rowHtml.match(/href=["']([^"']*response=arkivsak_detaljer[^"']*)["']/i)?.[1] || "";
        if (!link) return null;
        const rowText = clean(rowHtml);
        const caseNumber = rowText.match(/\b\d{4}\/\d+\b/)?.[0] || "";
        return { title: rowText, caseNumber, documentDate: isoDate(rowText), sourceUrl: new URL(link, config.sourceUrl).toString() };
      }).filter(Boolean);
      raw.push(...parsed);
      if (!parsed.length || parsed.length < config.pageSize) break;
    }
  }
  const recent = raw.filter((row) => dateMs(row.documentDate) >= cutoffMs);
  const filtered = recent.filter((row) => include.test(row.title) && !exclude.test(row.title));
  const unique = [...new Map(filtered.map((row) => [keyFor({ municipality: config.municipality, ...row }), row])).values()];
  return { raw: raw.length, recent: recent.length, filtered: filtered.length, unique: unique.length, rows: unique.map((row) => ({
    sourceStream: "municipal_sing_innsyn",
    sourceDocumentId: row.caseNumber || row.sourceUrl,
    municipality: config.municipality,
    municipalityNumber: config.municipalityNumber,
    title: row.title,
    caseNumber: row.caseNumber,
    documentType: "Byggesak",
    documentDate: row.documentDate,
    recordedDate: row.documentDate,
    fromName: config.municipality,
    toName: "",
    sourceUrl: row.sourceUrl,
    address: "",
    files: [],
    phase: phaseFor(row.title),
    classification: { phase: phaseFor(row.title), stage: "saksbehandling pågår", reason: `Direkte ${config.municipality} WebSak` },
    locationEnrichment: { status: "pending", source: "municipal_sing_innsyn" },
  })) };
}

const [locationBundle, contactBundle] = await Promise.all([
  fs.readFile(locationPath, "utf8").then(JSON.parse),
  fs.readFile(contactPath, "utf8").then(JSON.parse),
]);
const existing = new Set(locationBundle.projects.map((row) => keyFor({ municipality: row.municipality, caseNumber: row.caseNumber || row.sourceDocumentId, title: row.caseTitle || row.documentTitle, documentDate: row.documentDate })));
const report = { generatedAt: now.toISOString(), lookbackDays: 90, imported: {}, skipped: {}, errors: {} };
const importedRows = [];
for (const config of configs) {
  try {
    const result = config.municipality === "Alver kommune" ? await collectAlver(config) : await collectOnacos(config);
    let added = 0;
    for (const row of result.rows) {
      const key = keyFor(row);
      if (existing.has(key)) continue;
      existing.add(key);
      importedRows.push(row);
      added += 1;
    }
    report.imported[config.municipality] = { ...result, added };
    report.skipped[config.municipality] = result.unique - added;
  } catch (error) {
    report.errors[config.municipality] = error.message;
  }
}

const toLocation = (row) => ({
  ...row,
  projectId: `${row.municipalityNumber}:${row.sourceDocumentId}`,
  sourceKey: `${row.municipalityNumber}:${row.sourceDocumentId}`,
  caseTitle: row.title,
  documentTitle: row.title,
  shortFacts: row.title,
  marketRole: "municipal_building_case",
  actorVisibility: "source",
  hasAnonymizedActor: false,
  sourceQueries: ["bygg"],
  personLookupPolicy: "Privatpersoner skal ikke berikes med privat telefon/e-post.",
  addressLookupStatus: "pending",
});
const toContact = (row) => ({
  projectId: row.projectId,
  sourceStream: row.sourceStream,
  title: row.title,
  status: row.classification.stage,
  municipality: row.municipality,
  location: row.address,
  fromName: row.fromName,
  toName: row.toName,
  fromOrg: "",
  toOrg: row.toName,
  hasAnonymizedActor: false,
  sourceUrl: row.sourceUrl,
  displayContact: row.toName || null,
  contacts: [],
  personContactPolicy: "Privatpersoner skal ikke berikes med privat telefon/e-post.",
  contactStatus: row.toName ? "name_only" : "missing",
  contactSearchSubject: row.toName || row.address || row.title,
});
locationBundle.projects.push(...importedRows.map(toLocation));
contactBundle.projects.push(...importedRows.map(toContact));
await Promise.all([
  fs.writeFile(locationPath, `${JSON.stringify(locationBundle, null, 2)}\n`),
  fs.writeFile(contactPath, `${JSON.stringify(contactBundle, null, 2)}\n`),
]);
report.totalAdded = importedRows.length;
report.regionProjectTotal = locationBundle.projects.length;
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
