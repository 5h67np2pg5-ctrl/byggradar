import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGION_ROOT = path.join(ROOT, "public", "data", "regions");

const jsonHeaders = { Accept: "application/json", "User-Agent": "Norsk-ByggRadar/1.0" };

export const procurementSourceRegistry = [
  {
    id: "doffin",
    label: "Doffin",
    kind: "api",
    url: "https://www.doffin.no/",
    env: "DOFFIN_API_KEY",
    note: "Nasjonal kunngjøringsdatabase. Public API krever registrert API-nøkkel.",
  },
  {
    id: "ted",
    label: "TED",
    kind: "api",
    url: "https://ted.europa.eu/en/simap/developers-corner-for-reusers",
    env: "TED_QUERY",
    note: "EUs kunngjøringsdatabase. Standardspørringen er avgrenset til Norge, ikke til bygg/anlegg.",
  },
  {
    id: "bane_nor",
    label: "Bane NOR",
    kind: "json",
    url: "https://www.banenor.no/leverandor/anskaffelser/",
    note: "Planlagte og pågående anskaffelser fra eksisterende lokal datakilde.",
  },
  {
    id: "statens_vegvesen",
    label: "Statens vegvesen",
    kind: "html",
    url: "https://www.vegvesen.no/fag/veg-og-gate/konkurranser-og-kontraktsdokumenter/framtidige-konkurranser/planlagte-anskaffelser-drift-og-vedlikehold/",
    env: "STATENS_VEGVESEN_PROCUREMENT_URL",
    note: "Planlagte og pågående anskaffelser. Endelig uttrekk bør kobles til publisert feed eller eksport.",
  },
  {
    id: "statsbygg",
    label: "Statsbygg",
    kind: "html",
    url: "https://www.statsbygg.no/for-leverandorer/leverandorguiden/",
    env: "STATSBYGG_PROCUREMENT_URL",
    note: "Supplerende leverandør- og markedsdialog; konkurranser kunngjøres normalt via Doffin.",
  },
  {
    id: "avinor",
    label: "Avinor",
    kind: "html",
    url: "https://om.avinor.no/innovasjon/nylufthavnbodo/leverandorer/",
    env: "AVINOR_PROCUREMENT_URL",
    note: "Supplerende leverandørkilde. URL kan endres og konfigureres i miljøvariabel.",
  },
  {
    id: "kystverket",
    label: "Kystverket",
    kind: "html",
    url: "https://www.kystverket.no/om-kystverket/innkjop-og-anskaffelser/",
    env: "KYSTVERKET_PROCUREMENT_URL",
    note: "Planlagte anskaffelser og kunngjøringer; Doffin er hovedkanal for konkurranser.",
  },
  {
    id: "nye_veier",
    label: "Nye Veier",
    kind: "html",
    url: "https://www.nyeveier.no/for-leverandoerene/",
    env: "NYE_VEIER_PROCUREMENT_URL",
    note: "Supplerende markeds- og leverandørinformasjon.",
  },
  {
    id: "forsvarsbygg",
    label: "Forsvarsbygg",
    kind: "html",
    url: "https://www.forsvarsbygg.no/for-leverandorer/anskaffelser",
    env: "FORSVARSBYGG_PROCUREMENT_URL",
    note: "Supplerende leverandørinformasjon; konkurranser bør hentes fra Doffin/TED.",
  },
  {
    id: "nve",
    label: "NVE",
    kind: "html",
    url: "https://www.nve.no/om-nve/",
    env: "NVE_PROCUREMENT_URL",
    note: "Supplerende anskaffelsesinformasjon.",
  },
  {
    id: "sykehusinnkjop",
    label: "Sykehusinnkjøp",
    kind: "html",
    url: "https://www.sykehusinnkjop.no/",
    env: "SYKEHUSINNKJOP_PROCUREMENT_URL",
    note: "Bred offentlig innkjøpskilde; tas med uten fagfilter.",
  },
];

function text(value) {
  if (value && typeof value === "object") {
    const preferred = value.nob || value.nor || value.nb || value.eng || value.en || Object.values(value)[0];
    return text(preferred);
  }
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function first(...values) {
  return values.map(text).find(Boolean) || "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return value ? [value] : [];
}

function normalizeRecord(record, source, index) {
  const noticeId = first(record.id, record.noticeId, record.noticeID, record.identifier, record.ocid, record.reference);
  const title = first(record.title, record.name, record.subject, record.projectTitle, record.noticeTitle) || `Anskaffelse fra ${source.label}`;
  const sourceUrl = first(record.sourceUrl, record.url, record.noticeUrl, record.link, record.href, source.url);
  return {
    id: `${source.id}:${noticeId || index + 1}`,
    sourceStream: source.id === "bane_nor" ? "bane_nor_procurement_plan" : `national_${source.id}`,
    sourceLabel: source.label,
    title,
    description: first(record.description, record.shortDescription, record.summary, record.text),
    status: first(record.status, record.noticeStatus, record.phase, "Publisert"),
    procurementType: first(record.procurementType, record.type, record.noticeType),
    buyer: first(record.buyer, record.buyerName, record.contractingAuthority, record.organization),
    organizationNumber: first(record.organizationNumber, record.buyerOrgNumber),
    documentNumber: first(record.documentNumber, record.caseNumber, noticeId),
    documentDate: first(record.documentDate, record.publishedDate, record.publicationDate, record.date),
    deadline: first(record.deadline, record.tenderDeadline, record.submissionDeadline),
    municipality: first(record.municipality, record.place, record.location),
    address: first(record.address, record.streetAddress),
    sourceUrl,
    files: asArray(record.files || record.attachments).map((file) => ({
      title: first(file.title, file.name, file.filename),
      url: first(file.url, file.href, file.link),
    })).filter((file) => file.url),
    isFutureOrActive: true,
    nationalProcurement: true,
  };
}

async function readRegionRecords() {
  const entries = await fs.readdir(REGION_ROOT, { withFileTypes: true });
  const records = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const file = path.join(REGION_ROOT, entry.name, "projects_location_enriched.json");
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      records.push(...asArray(data.projects).filter((project) => project.sourceStream === "bane_nor_procurement_plan"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return records;
}

export async function collectBaneNor() {
  const source = procurementSourceRegistry.find((item) => item.id === "bane_nor");
  const records = await readRegionRecords();
  return {
    source: source.id,
    status: "ok",
    records: records.map((record, index) => normalizeRecord(record, source, index)),
    detail: `${records.length} poster fra eksisterende datagrunnlag`,
  };
}

function tedRecord(value) {
  const notice = value?.notice || value;
  const fields = notice?.publicationNumber ? notice : value;
  const publicationNumber = first(fields?.publicationNumber, fields?.["publication-number"], fields?.noticeId, fields?.id);
  return {
    id: publicationNumber,
    title: first(fields?.title, fields?.["notice-title"], fields?.titleEnglish, fields?.titleNorwegian, fields?.["title-english"]),
    description: first(fields?.description, fields?.descriptionEnglish, fields?.descriptionNorwegian),
    buyer: first(fields?.buyerName, fields?.["buyer-name"], fields?.contractingAuthorityName, fields?.buyer),
    procurementType: first(fields?.procedureType, fields?.["notice-type"], fields?.noticeType),
    documentDate: first(fields?.publicationDate, fields?.["publication-date"], fields?.noticeDate),
    deadline: first(fields?.deadlineDate, fields?.["deadline-date"], fields?.submissionDeadline),
    sourceUrl: first(fields?.url, fields?.noticeUrl, fields?.["notice-url"], fields?.links?.html?.NOR, fields?.links?.html?.ENG, fields?.links?.xml?.MUL)
      || (publicationNumber ? `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(publicationNumber)}` : ""),
  };
}

export async function collectTed({ fetchImpl = fetch } = {}) {
  const source = procurementSourceRegistry.find((item) => item.id === "ted");
  const query = process.env.TED_QUERY || "buyer-country=NOR";
  const response = await fetchImpl("https://api.ted.europa.eu/v3/notices/search", {
    method: "POST",
    headers: { ...jsonHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ query, fields: ["publication-number", "notice-title", "buyer-name", "notice-type"], page: 1, limit: 250, paginationMode: "PAGE_NUMBER" }),
  });
  if (!response.ok) throw new Error(`TED svarte med HTTP ${response.status}`);
  const payload = await response.json();
  const values = asArray(payload.notices || payload.results || payload.data || payload);
  return { source: source.id, status: "ok", records: values.map(tedRecord).map((record, index) => normalizeRecord(record, source, index)), detail: `TED-spørring: ${query}` };
}

async function collectConfiguredJson(source, { fetchImpl = fetch } = {}) {
  const endpoint = text(process.env[source.env]);
  if (!endpoint) return { source: source.id, status: "not_configured", records: [], detail: `Mangler ${source.env}` };
  const response = await fetchImpl(endpoint, { headers: jsonHeaders });
  if (!response.ok) throw new Error(`${source.label} svarte med HTTP ${response.status}`);
  const payload = await response.json();
  return { source: source.id, status: "ok", records: asArray(payload.projects || payload.records || payload.data || payload).map((record, index) => normalizeRecord(record, source, index)), detail: endpoint };
}

async function collectDoffin({ fetchImpl = fetch } = {}) {
  const source = procurementSourceRegistry.find((item) => item.id === "doffin");
  const apiKey = text(process.env.DOFFIN_API_KEY);
  if (!apiKey) return { source: source.id, status: "not_configured", records: [], detail: "Mangler DOFFIN_API_KEY" };
  const apiBase = (text(process.env.DOFFIN_API_BASE_URL) || "https://dof-notices-prod-api.developer.azure-api.net/public/v2/search").replace(/\/$/, "");
  const records = [];
  for (let page = 1; page <= 10; page += 1) {
    const query = new URLSearchParams({ numHitsPerPage: "100", page: String(page), sortBy: "PUBLICATION_DATE_DESC" });
    const response = await fetchImpl(`${apiBase}?${query}`, {
      headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": apiKey, "User-Agent": "Norsk-ByggRadar/1.0" },
    });
    if (!response.ok) throw new Error(`Doffin svarte med HTTP ${response.status}`);
    const payload = await response.json();
    const hits = asArray(payload.hits || payload.results || payload.data);
    records.push(...hits.map((hit, index) => normalizeRecord({
      id: first(hit.id, hit.doffinId, hit.noticeId),
      title: first(hit.heading, hit.title, hit.subject),
      buyer: first(hit.buyer, hit.buyerName, hit.contractingAuthority),
      procurementType: first(hit.type, hit.noticeType),
      documentDate: first(hit.publicationDate, hit.issueDate),
      deadline: first(hit.deadline, hit.tenderDeadline),
      municipality: first(hit.municipality, hit.place),
      sourceUrl: first(hit.url, hit.noticeUrl, hit.link),
      files: hit.files || hit.attachments || hit.documents || [],
    }, source, records.length + index)));
    if (hits.length < 100) break;
  }
  return { source: source.id, status: "ok", records, detail: `${records.length} kunngjøringer fra Doffin Public API (${apiBase})` };
}

async function collectConfiguredHtml(source, { fetchImpl = fetch } = {}) {
  const endpoint = text(process.env[source.env]) || source.url;
  const response = await fetchImpl(endpoint, { headers: { Accept: "text/html", "User-Agent": "Norsk-ByggRadar/1.0" } });
  if (!response.ok) throw new Error(`${source.label} svarte med HTTP ${response.status}`);
  const html = await response.text();
  const links = [...html.matchAll(/href=["']([^"']+)["'][^>]*>([^<]{8,200})</gi)]
    .map((match) => ({ href: match[1], title: text(match[2]) }))
    .filter((link) => /anskaff|konkurr|anbud|utlys|leverandør|prosjekt|kontrakt|marked|mercell|doffin|tender/i.test(`${link.title} ${link.href}`))
    .filter((link) => !/personvern|cookies|tilgjengelighet|kontakt|om oss|meny|søk|logg inn|abonner|konkurranser og kontraktsdokumenter|framtidige konkurranser$/i.test(link.title));
  return { source: source.id, status: "ok", records: links.map((link, index) => normalizeRecord({ title: link.title, sourceUrl: new URL(link.href, endpoint).href }, source, index)), detail: `${links.length} lenker funnet fra ${endpoint}` };
}

export async function collectAllNationalProcurements(options = {}) {
  const results = [];
  for (const source of procurementSourceRegistry) {
    try {
      if (source.id === "bane_nor") results.push(await collectBaneNor(options));
      else if (source.id === "ted") results.push(await collectTed(options));
      else if (source.id === "doffin") results.push(await collectDoffin(options));
      else if (source.kind === "api") results.push(await collectConfiguredJson(source, options));
      else results.push(await collectConfiguredHtml(source, options));
    } catch (error) {
      results.push({ source: source.id, status: "error", records: [], detail: error.message || String(error) });
    }
  }
  const records = results.flatMap((result) => result.records || []);
  const unique = [...new Map(records.map((record) => [`${record.sourceStream}:${record.documentNumber || record.title}`, record])).values()];
  return { generatedAt: new Date().toISOString(), scope: "Alle anskaffelser; ingen fagfilter", sources: results, total: unique.length, projects: unique };
}
