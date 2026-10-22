import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(root, "config/vestfold-kongsberg-postlist-sources.json"), "utf8"));
const outputDir = path.join(root, "public/data/regions", config.regionId);
const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
const userAgent = "NorskByggRadar/1.0 (åpen kommunal innsynskilde)";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const terms = ["bygg", "bygge", "byggesak", "byggesøknad", "byggetillatelse", "rammetillatelse", "igangsetting", "tilbygg"];
const excluded = new RegExp(config.filter.exclude.join("|"), "i");
const included = new RegExp(config.filter.include.join("|"), "i");
const onlyMunicipality = String(process.env.NBR_MUNICIPALITY || "").trim().toLocaleLowerCase("nb-NO");

const text = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const rowKey = (municipality, caseNumber, title, date) => `${municipality}|${text(caseNumber).toLocaleLowerCase("nb-NO") || `${text(title).toLocaleLowerCase("nb-NO")}|${date}`}`;
const isoDate = (value) => {
  const match = String(value || "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
};
const parseCookies = (response) => response.headers.getSetCookie?.().map((cookie) => cookie.split(";", 1)[0]).join("; ") || "";
const request = async (url, options = {}) => fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(30000), headers: { accept: "application/json", "user-agent": userAgent, ...(options.headers || {}) } });

async function collectAcos(source) {
  const page = await request(source.sourceUrl);
  const cookies = parseCookies(page);
  const host = new URL(source.sourceUrl).origin;
  const rows = new Map();
  for (const term of terms) {
    await delay(400);
    for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
      const response = await request(`${host}/api/presentation/v2/nye-innsyn/overview`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-anti-csrf": "1", ...(cookies ? { cookie: cookies } : {}) },
        body: JSON.stringify({ type: 4, keyValues: [{ key: "searchTerm", value: term }, { key: "page", value: String(pageNumber) }] }),
      });
      if (!response.ok) break;
      const payload = await response.json();
      const items = payload?.content?.searchItems?.items || [];
      if (!items.length) break;
      for (const item of items) {
        const title = text(item.title);
        const date = isoDate(item.properties?.dato);
        if (!title || excluded.test(title) || !included.test(`${title} ${item.type || ""}`)) continue;
        if (date && new Date(date) < cutoff) continue;
        const haystack = `${title} ${item.type || ""}`;
        if (!new RegExp(terms.join("|"), "i").test(haystack)) continue;
        const caseNumber = item.properties?.saksnummer || item.properties?.dokumentID || "";
        const id = rowKey(source.name, caseNumber, title, date);
        const existing = rows.get(id);
        const candidate = {
          sourceStream: "municipal_acos_innsyn",
          sourceKey: `${source.name.replace(/ kommune$/, "").toLocaleLowerCase("nb-NO")}_acos_innsyn`,
          sourceDocumentId: caseNumber || item.identifier || `${title}|${date}`,
          municipality: source.name,
          caseTitle: title,
          documentTitle: title,
          shortFacts: title,
          caseNumber,
          documentType: item.type || "",
          documentDate: date,
          recordedDate: date,
          fromName: item.properties?.avsender || "",
          toName: item.properties?.mottaker || "",
          actorVisibility: "åpent i kilde",
          hasAnonymizedActor: /xxxx|anonym/i.test(title),
          caseUrl: source.sourceUrl,
          files: [],
          sourceQueries: terms.filter((candidate) => new RegExp(candidate, "i").test(title)),
          address: "",
          matrikkel: "",
          classification: { status: "lead", reason: "kommunal byggesak eller planinformasjon", stage: "saksbehandling pågår", projectTypes: [], excludedReasons: [], leadScore: 0, priority: "B" },
          locationEnrichment: { hasMapPoint: false, mapLabel: "Ikke bekreftet lokasjon", addressSource: "adresse/matrikkel må hentes fra sakens metadata" },
        };
        if (!existing || candidate.caseTitle.length > existing.caseTitle.length) rows.set(id, candidate);
      }
      if (!payload?.content?.searchItems?.hasNextPage) break;
    }
  }
  return [...rows.values()];
}

async function collectElements(source) {
  const parsed = new URL(source.sourceUrl);
  const tenant = parsed.pathname.split("/").filter(Boolean).at(-1);
  const rows = new Map();
  for (const term of terms) {
    const query = new URLSearchParams({ Query: term, IncludeCases: "true", IncludeSenderRecipient: "true", DateFrom: cutoff.toISOString().slice(0, 10), DateTo: new Date().toISOString().slice(0, 10) });
    const response = await request(`${parsed.origin}/publikum/api/PredefinedQuery/CasesAndRegistryEntries?${query}`, { headers: { Tenant: tenant } });
    if (!response.ok) console.warn(`${source.name}: Elements API svarte ${response.status} for søket ${term}`);
    if (!response.ok) continue;
    const payload = await response.json();
    for (const item of payload.Items || []) {
      const title = text(item.SA_TITTEL || item.JP_TITTEL || item.Title);
      const date = String(item.SA_DATO || item.JP_DATO || "").slice(0, 10);
      if (!title || excluded.test(title) || !included.test(title)) continue;
      const caseNumber = item.SA_SAKSNR_XX || item.JP_SAKSNR_XX || "";
      const id = rowKey(source.name, caseNumber, title, date);
      const candidate = {
        sourceStream: "municipal_elements_innsyn",
        sourceKey: `${source.name.replace(/ kommune$/, "").replace(/ herad$/, "").toLocaleLowerCase("nb-NO")}_elements_innsyn`,
        sourceDocumentId: caseNumber || String(item.JP_ID || item.SA_ID || `${title}|${date}`),
        municipality: source.name,
        caseTitle: title,
        documentTitle: title,
        shortFacts: title,
        caseNumber,
        documentType: item.JP_NDOKTYPE_ND || "",
        documentDate: date,
        recordedDate: date,
        actorVisibility: "åpent i kilde",
        hasAnonymizedActor: /xxxx|anonym/i.test(title),
        caseUrl: source.sourceUrl,
        files: [],
        sourceQueries: terms.filter((candidate) => new RegExp(candidate, "i").test(title)),
        address: "",
        matrikkel: "",
        classification: { status: "lead", reason: "kommunal byggesak eller planinformasjon", stage: "saksbehandling pågår", projectTypes: [], excludedReasons: [], leadScore: 0, priority: "B" },
        locationEnrichment: { hasMapPoint: false, mapLabel: "Ikke bekreftet lokasjon", addressSource: "adresse/matrikkel må hentes fra sakens metadata" },
      };
      const existing = rows.get(id);
      if (!existing || candidate.caseTitle.length > existing.caseTitle.length) rows.set(id, candidate);
    }
  }
  return [...rows.values()];
}

const collected = [];
const status = [];
let existingProjects = [];
let existingStatus = [];
try {
  const previous = JSON.parse(await fs.readFile(path.join(outputDir, "projects_location_enriched.json"), "utf8"));
  existingProjects = (previous.projects || []).filter((row) => !["municipal_acos_innsyn", "municipal_elements_innsyn"].includes(row.sourceStream));
} catch { /* Første uttrekk for regionen. */ }
if (onlyMunicipality) {
  try {
    const previousStatus = JSON.parse(await fs.readFile(path.join(outputDir, "region_status.json"), "utf8"));
    existingStatus = previousStatus.municipalities || [];
  } catch { /* Statusfil kan mangle ved første kjøring. */ }
}
for (const source of config.municipalities.filter((item) => !onlyMunicipality || item.name.toLocaleLowerCase("nb-NO").includes(onlyMunicipality))) {
  if (!['acos', 'elements'].includes(source.adapter)) {
    status.push({ municipality: source.name, adapter: source.adapter, status: "adapter registrert, uttrekk kjøres i egen kildeadapter", count: 0, sourceUrl: source.sourceUrl });
    continue;
  }
  try {
    const rows = source.adapter === "acos" ? await collectAcos(source) : source.adapter === "elements" ? await collectElements(source) : [];
    if (source.adapter === "drammen-postjournal" || source.adapter === "onacos") {
      status.push({ municipality: source.name, adapter: source.adapter, status: "adapter registrert, uttrekk kjøres i egen kildeadapter", count: 0, sourceUrl: source.sourceUrl });
      continue;
    }
    collected.push(...rows);
    status.push({ municipality: source.name, adapter: source.adapter, status: rows.length ? "hentet" : "ingen treff/krever kontroll", count: rows.length, sourceUrl: source.sourceUrl });
    console.log(`${source.name}: ${rows.length} bygg-/plansaker`);
  } catch (error) {
    status.push({ municipality: source.name, adapter: source.adapter, status: "feil", count: 0, sourceUrl: source.sourceUrl, error: error.message });
    console.error(`${source.name}: ${error.message}`);
  }
}

const unique = [...new Map([...existingProjects, ...collected].map((row) => [`${row.municipality}|${row.sourceDocumentId}|${row.caseNumber || ""}`, row])).values()];
const mergedStatus = [...new Map([...existingStatus, ...status].map((row) => [row.municipality, row])).values()];
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "projects_location_enriched.json"), JSON.stringify({ regionId: config.regionId, regionName: "Vestfold- og Kongsbergregionen", generatedAt: new Date().toISOString(), filter: config.filter, projects: unique }, null, 2));
await fs.writeFile(path.join(outputDir, "projects_contact_enriched.json"), JSON.stringify({ regionId: config.regionId, generatedAt: new Date().toISOString(), projects: unique }, null, 2));
await fs.writeFile(path.join(outputDir, "region_status.json"), JSON.stringify({ regionId: config.regionId, generatedAt: new Date().toISOString(), filter: config.filter, municipalities: mergedStatus, projectCount: unique.length }, null, 2));
await import("./enrich-map-points.mjs");
await import("./enrich-all-project-contacts.mjs");
console.log(`Totalt: ${unique.length} unike saker. Kommuner med egne adaptere må kjøres før de kan regnes som ferdig hentet.`);
