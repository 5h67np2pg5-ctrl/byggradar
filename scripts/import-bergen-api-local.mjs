import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(root, "config/bergen-api-preview.json"), "utf8"));
const regionDir = path.join(root, "public/data/regions/bergensregionen");
const locationPath = path.join(regionDir, "projects_location_enriched.json");
const contactPath = path.join(regionDir, "projects_contact_enriched.json");
const reportPath = path.join(root, "reports/bergen-api-local-import.json");
const userAgent = "NorskByggRadar/1.0 (lokal Bergen-import)";
const now = new Date();
const cutoffMs = now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000;
const include = new RegExp(config.include.join("|"), "i");
const exclude = new RegExp(config.exclude.join("|"), "i");
const text = (value) => Array.isArray(value)
  ? value.map(text).filter(Boolean).join(" ")
  : String(value || "").replace(/\s+/g, " ").trim();
const normalize = (value) => text(value).toLocaleLowerCase("nb-NO").replace(/[^a-z0-9æøå]+/gi, " ").trim();
const dateMs = (value) => {
  if (typeof value === "number") return value;
  const raw = String(value || "");
  return /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
};
const dateText = (value) => {
  const ms = dateMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
};
const phaseFor = (status) => /igangsetting|tillatelse|rammetillatelse|anbud|kontrakt/i.test(text(status)) ? "Fase 2" : "Fase 1";
const addressText = (value) => Array.isArray(value) ? value.filter(Boolean).join(", ") : text(value);
const actorText = (value) => Array.isArray(value) ? value.map((item) => text(item).replace(/\s*\(\d+\)\s*$/, "")).filter(Boolean).join(", ") : text(value);
const caseKey = (item) => normalize(item.caseNumber || item.saksnr || item.id || item.title);
const contentKey = (title, address) => `${normalize(title)}|${normalize(address)}`;

const [locationBundle, contactBundle] = await Promise.all([
  fs.readFile(locationPath, "utf8").then(JSON.parse),
  fs.readFile(contactPath, "utf8").then(JSON.parse),
]);

const fetchPage = async (start) => {
  const url = new URL(config.endpoint);
  url.search = new URLSearchParams({
    tekst: config.query,
    start: String(start),
    rows: String(config.pageSize),
    orderBy: "statusDato",
    asc: "false",
  });
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": userAgent },
    signal: AbortSignal.timeout(30000),
  });
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

const recent = raw.filter((item) => Number.isFinite(dateMs(item.statusDato)) && dateMs(item.statusDato) >= cutoffMs);
const building = recent.filter((item) => text(item.sakstypenavn).toLocaleLowerCase("nb-NO") === "byggesak");
const active = building.filter((item) => !/^(avsluttet|utgår|utga)/i.test(text(item.status)));
const filtered = active.filter((item) => {
  const haystack = [item.tittel, item.adresse, item.gnrBnr, item.soketekst].map(text).join(" ");
  return include.test(haystack) && !exclude.test(haystack);
});
const directUnique = [...new Map(filtered.map((item) => [caseKey({ caseNumber: item.saksnr, id: item.id, title: item.tittel }), item])).values()];
const existingCaseKeys = new Set(locationBundle.projects.map((item) => normalize(item.caseNumber || item.sourceKey)).filter(Boolean));
const existingContentKeys = new Set(locationBundle.projects.map((item) => contentKey(item.caseTitle || item.documentTitle, item.address)).filter((key) => key !== "|"));
const newItems = directUnique.filter((item) => {
  const caseNumber = normalize(item.saksnr);
  const address = addressText(item.adresse);
  const key = contentKey(item.tittel, address);
  return !existingCaseKeys.has(caseNumber) && !existingContentKeys.has(key);
});

const locationProjects = newItems.map((item) => {
  const address = addressText(item.adresse);
  const actor = actorText(item.soker);
  const phase = phaseFor(item.status);
  const sourceId = `bergen-api:${item.id}`;
  return {
    sourceStream: "bergen_municipality_direct_api",
    sourceKey: sourceId,
    sourceDocumentId: sourceId,
    municipality: "Bergen kommune",
    municipalityNumber: "4601",
    marketRole: "municipal_building_case",
    caseTitle: item.tittel || "",
    documentTitle: item.tittel || "",
    shortFacts: item.tittel || "",
    caseNumber: item.saksnr || "",
    documentType: item.sakstypenavn || "Byggesak",
    documentDate: dateText(item.statusDato),
    recordedDate: dateText(item.statusDato),
    fromName: "Bergen kommune",
    toName: actor,
    fromOrg: "",
    toOrg: actor,
    actorVisibility: actor ? "source" : "missing",
    hasAnonymizedActor: false,
    caseUrl: `https://www.bergen.kommune.no/omkommunen/offentlig-innsyn/innsynplanogbyggesak/saksinnsyn?q=${encodeURIComponent(item.saksnr || item.tittel || "")}`,
    files: [],
    sourceQueries: [config.query],
    address,
    addressLookupStatus: "not_enriched",
    personLookupPolicy: "Privatpersoner skal ikke berikes med privat telefon/e-post.",
    matrikkel: item.gnrBnr?.[0] || "",
    gnr: item.gnrBnr?.[0]?.split("/")[0] || "",
    bnr: item.gnrBnr?.[0]?.split("/")[1] || "",
    fnr: "",
    snr: "",
    classification: { phase, stage: item.status || "", reason: "Direkte Bergen API" },
    locationEnrichment: { status: "pending", source: "bergen_municipality_direct_api" },
    phase,
    projectType: item.tittel || "",
    contactName: actor,
  };
});

const contactProjects = newItems.map((item) => {
  const actor = actorText(item.soker);
  const address = addressText(item.adresse);
  const sourceId = `bergen-api:${item.id}`;
  return {
    projectId: sourceId,
    sourceStream: "bergen_municipality_direct_api",
    title: item.tittel || "",
    status: item.status || "",
    municipality: "Bergen kommune",
    location: address,
    fromName: "Bergen kommune",
    toName: actor,
    fromOrg: "",
    toOrg: actor,
    hasAnonymizedActor: false,
    sourceUrl: `https://www.bergen.kommune.no/omkommunen/offentlig-innsyn/innsynplanogbyggesak/saksinnsyn?q=${encodeURIComponent(item.saksnr || item.tittel || "")}`,
    displayContact: actor,
    contacts: [],
    personContactPolicy: "Privatpersoner skal ikke berikes med privat telefon/e-post.",
    contactStatus: actor ? "name_only" : "missing",
    contactSearchSubject: actor || address,
  };
});

locationBundle.projects.push(...locationProjects);
contactBundle.projects.push(...contactProjects);
await Promise.all([
  fs.writeFile(locationPath, `${JSON.stringify(locationBundle, null, 2)}\n`),
  fs.writeFile(contactPath, `${JSON.stringify(contactBundle, null, 2)}\n`),
]);

const result = {
  imported: newItems.length,
  rawFetched: raw.length,
  recentByStatusDate: recent.length,
  activeBuildingCaseType: active.length,
  afterNbrFilter: filtered.length,
  uniqueDirect: directUnique.length,
  skippedAsExistingOrDuplicate: directUnique.length - newItems.length,
  phaseCounts: locationProjects.reduce((counts, item) => {
    counts[item.phase] = (counts[item.phase] || 0) + 1;
    return counts;
  }, {}),
  regionProjectTotal: locationBundle.projects.length,
  source: "Bergen kommune direkte API",
  filter: { lookbackDays: config.lookbackDays, include: config.include, exclude: config.exclude },
  files: { locationPath, contactPath },
};
await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
