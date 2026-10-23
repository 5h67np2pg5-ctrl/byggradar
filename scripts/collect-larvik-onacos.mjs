import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir = path.join(root, "public/data/regions/vestfoldkongsbergregionen");
const portalUrl = "https://innsynpluss.onacos.no/larvik/sok/";
const apiUrl = "https://innsynpluss.onacos.no/api/presentation/v2/nye-innsyn/overview";
const sourceId = "a33aa9ba-e239-4da4-bb8a-c08ce91d309f";
const buildingCaseType = "at-a33aa9ba__e239__4da4__bb8a__c08ce91d309f-BS!qstXWj";
const today = new Date();
const from = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
const iso = (value) => value.toISOString().slice(0, 10);
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const toIsoDate = (value) => {
  const match = String(value || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
};
const include = /byggesak|byggjesak|byggesøknad|byggjesøknad|byggetillatelse|byggjeløyve|rammetillatelse|rammeløyve|igangsetting|igangsetjing|igangsettingstillatelse|igangsettingsløyve|igangsetjingsløyve|fasade|påbygg|tilbygg|rivning|fradeling|frådeling|seksjonering|reguleringsplan|planinitiativ|dispensasjon|oppføring|oppføre|garasje|bolig|bustad|næring|terreng|forstøtningsmur|bruksendring|nabovarsel|forhåndskonferanse|førehandskonferanse|tillatelse|løyve|nytt bygg|søknad/i;
const exclude = /adress(?:e)?endring|avslag|klage|ferdigmelding|ferdigattest|tilsyn|ulovlighetsoppfølging|ulovleg|innsyn|dokumenter fra tidligere|dokument frå tidlegare|møteinnkalling|postmottak|oversendelse|oversending|arkiv|anmodning om dokument|bero|stanset|stansa|avsluttet|avslutta|trukket|trekt|tilbakekalt|tilbakekalla|spørsmål|veiledning|gebyrregulativ|gebyr|høring|høyring|prioritering av byggesaker|saksbehandling pågår|^tilbud\b|ikkje operativt|ikke operativt|cv\b|stilling|ansettelse|tilsetjing/i;
const extractMatrikkel = (title) => (title.match(/\b(?:gbnr|gnr\.?\s*\/?)\s*([0-9]+\s*\/\s*[0-9]+(?:\s*\/\s*[0-9]+)?)/i)?.[1] || "").replace(/\s+/g, "");
const extractAddress = (title) => {
  const match = title.match(/(?:-|,)\s*([^,-]+?\s+\d+[A-Za-z]?)\s*(?:-|,|$)/i);
  return clean(match?.[1] || "");
};
const canonicalKey = (row) => `${row.municipality}|${row.caseNumber || row.sourceDocumentId}`.toLocaleLowerCase("nb-NO");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(portalUrl, { waitUntil: "networkidle", timeout: 30000 });
  const rows = new Map();
  const baseKeys = [
    { key: "Datasource", value: sourceId },
    { key: "Dato", value: "Other" },
    { key: "FromDate", value: iso(from) },
    { key: "ToDate", value: iso(today) },
    { key: "FilterContent", value: "CaseOnly" },
    { key: "Sakstype", value: buildingCaseType },
    { key: "searchTerm", value: "bygg" },
    { key: "pageSize", value: "100" },
  ];

  let pageNumber = 1;
  let hasNextPage = true;
  while (hasNextPage) {
    const response = await context.request.post(apiUrl, {
      data: { type: 0, keyValues: [...baseKeys, { key: "page", value: String(pageNumber) }] },
      headers: { accept: "application/json" },
    });
    if (!response.ok()) throw new Error(`Larvik API svarte ${response.status()}`);
    const payload = await response.json();
    const result = payload?.content?.searchItems;
    for (const item of result?.items || []) {
      const title = clean(item.title);
      const documentDate = toIsoDate(item.properties?.dato);
      if (!title || !documentDate || !include.test(title) || exclude.test(title)) continue;
      const caseNumber = clean(item.properties?.saksnummer);
      const sourceDocumentId = clean(item.identifier);
      const row = {
        sourceStream: "municipal_onacos_innsyn",
        sourceKey: "larvik_onacos_byggesak",
        sourceDocumentId,
        municipality: "Larvik kommune",
        caseTitle: title,
        documentTitle: title,
        shortFacts: title,
        caseNumber,
        documentType: "Byggesak",
        documentDate,
        recordedDate: documentDate,
        fromName: "",
        actorVisibility: "åpent i kilde",
        hasAnonymizedActor: /xxxx|anonym/i.test(title),
        caseUrl: portalUrl,
        files: [],
        sourceQueries: ["bygg", "Byggesak"],
        address: extractAddress(title),
        matrikkel: extractMatrikkel(title),
        classification: { status: "lead", reason: "kommunal byggesak", stage: "saksbehandling pågår", projectTypes: [], excludedReasons: [], leadScore: 0, priority: "B" },
        locationEnrichment: { hasMapPoint: false, mapLabel: "Ikke bekreftet lokasjon", addressSource: "adresse/matrikkel hentet fra Larvik sakstittel" },
      };
      rows.set(canonicalKey(row), row);
    }
    hasNextPage = Boolean(result?.hasNextPage);
    pageNumber += 1;
  }

  const locationPath = path.join(outputDir, "projects_location_enriched.json");
  const contactPath = path.join(outputDir, "projects_contact_enriched.json");
  const statusPath = path.join(outputDir, "region_status.json");
  const previous = JSON.parse(await fs.readFile(locationPath, "utf8"));
  const existing = (previous.projects || []).filter((row) => row.municipality !== "Larvik kommune");
  const projects = [...new Map([...existing, ...rows.values()].map((row) => [canonicalKey(row), row])).values()];
  const contact = JSON.parse(await fs.readFile(contactPath, "utf8"));
  const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
  const municipalities = [...new Map([...status.municipalities, { municipality: "Larvik kommune", adapter: "onacos", status: "hentet", count: rows.size, sourceUrl: portalUrl }].map((row) => [row.municipality, row])).values()];
  await fs.writeFile(locationPath, JSON.stringify({ ...previous, generatedAt: new Date().toISOString(), projects }, null, 2));
  await fs.writeFile(contactPath, JSON.stringify({ ...contact, generatedAt: new Date().toISOString(), projects }, null, 2));
  await fs.writeFile(statusPath, JSON.stringify({ ...status, generatedAt: new Date().toISOString(), municipalities, projectCount: projects.length }, null, 2));
  await import("./enrich-map-points.mjs");
  await import("./enrich-all-project-contacts.mjs");
  console.log(`Larvik: ${rows.size} NBR-filtrerte byggesaker, totalt ${projects.length} regionale saker`);
} finally {
  await browser.close();
}
