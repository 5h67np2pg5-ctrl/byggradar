import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const regionDir = path.join(root, "public/data/regions/bergensregionen");
const reportPath = path.join(root, "reports/bergen-api-preview.json");
const locationPath = path.join(regionDir, "projects_location_enriched.json");
const contactPath = path.join(regionDir, "projects_contact_enriched.json");
const outputPath = path.join(root, "reports/bergen-api-pilot-import.json");

const [report, locationBundle, contactBundle] = await Promise.all([
  fs.readFile(reportPath, "utf8").then(JSON.parse),
  fs.readFile(locationPath, "utf8").then(JSON.parse),
  fs.readFile(contactPath, "utf8").then(JSON.parse),
]);

const existingCases = new Set(
  locationBundle.projects.map((project) => String(project.caseNumber || "").trim()).filter(Boolean),
);
const existingIds = new Set(locationBundle.projects.map((project) => project.sourceDocumentId).filter(Boolean));
const candidates = report.examples
  .filter((item) => item.id && item.caseNumber && !existingCases.has(item.caseNumber) && !existingIds.has(`bergen-api:${item.id}`))
  .slice(0, 20);

const phaseFor = (status) => /igangsetting|tillatelse|rammetillatelse|anbud|kontrakt/i.test(status)
  ? "Fase 2"
  : "Fase 1";
const isoDate = (value) => new Date(Number(value)).toISOString().slice(0, 10);
const addressText = (value) => Array.isArray(value) ? value.filter(Boolean).join(", ") : String(value || "");
const actorText = (value) => Array.isArray(value) ? value.map((item) => String(item).replace(/\s*\(\d+\)\s*$/, "")).join(", ") : String(value || "");

const locationProjects = candidates.map((item) => ({
  sourceStream: "bergen_municipality_direct_api_pilot",
  sourceKey: `bergen-api:${item.caseNumber}`,
  sourceDocumentId: `bergen-api:${item.id}`,
  municipality: "Bergen kommune",
  municipalityNumber: "4601",
  marketRole: "municipal_building_case",
  caseTitle: item.title,
  documentTitle: item.title,
  shortFacts: item.title,
  caseNumber: item.caseNumber,
  documentType: item.caseType || "Byggesak",
  documentDate: isoDate(item.statusDate),
  recordedDate: isoDate(item.statusDate),
  fromName: "Bergen kommune",
  toName: actorText(item.applicant),
  fromOrg: "",
  toOrg: actorText(item.applicant),
  actorVisibility: actorText(item.applicant) ? "source" : "missing",
  hasAnonymizedActor: false,
  caseUrl: `https://www.bergen.kommune.no/omkommunen/offentlig-innsyn/innsynplanogbyggesak/saksinnsyn?q=${encodeURIComponent(item.caseNumber)}`,
  files: [],
  sourceQueries: ["bygg"],
  address: addressText(item.address),
  addressLookupStatus: "not_enriched",
  personLookupPolicy: "Privatpersoner skal ikke berikes med privat telefon/e-post.",
  matrikkel: item.propertyNumbers?.[0] || "",
  gnr: item.propertyNumbers?.[0]?.split("/")[0] || "",
  bnr: item.propertyNumbers?.[0]?.split("/")[1] || "",
  fnr: "",
  snr: "",
  classification: { phase: phaseFor(item.status), stage: item.status, reason: "Direkte Bergen API-pilot" },
  locationEnrichment: { status: "pending", source: "bergen_municipality_direct_api_pilot" },
  phase: phaseFor(item.status),
  projectType: item.title,
  contactName: actorText(item.applicant),
  pilot: true,
}));

const contactProjects = candidates.map((item) => ({
  projectId: `bergen-api:${item.id}`,
  sourceStream: "bergen_municipality_direct_api_pilot",
  title: item.title,
  status: item.status,
  municipality: "Bergen kommune",
  location: addressText(item.address),
  fromName: "Bergen kommune",
  toName: actorText(item.applicant),
  fromOrg: "",
  toOrg: actorText(item.applicant),
  hasAnonymizedActor: false,
  sourceUrl: `https://www.bergen.kommune.no/omkommunen/offentlig-innsyn/innsynplanogbyggesak/saksinnsyn?q=${encodeURIComponent(item.caseNumber)}`,
  displayContact: actorText(item.applicant),
  contacts: [],
  personContactPolicy: "Privatpersoner skal ikke berikes med privat telefon/e-post.",
  contactStatus: actorText(item.applicant) ? "name_only" : "missing",
  contactSearchSubject: actorText(item.applicant) || addressText(item.address),
  pilot: true,
}));

locationBundle.projects.push(...locationProjects);
contactBundle.projects.push(...contactProjects);
await Promise.all([
  fs.writeFile(locationPath, `${JSON.stringify(locationBundle, null, 2)}\n`),
  fs.writeFile(contactPath, `${JSON.stringify(contactBundle, null, 2)}\n`),
]);

const result = {
  imported: candidates.length,
  phaseCounts: locationProjects.reduce((counts, project) => {
    counts[project.phase] = (counts[project.phase] || 0) + 1;
    return counts;
  }, {}),
  source: "Bergen kommune direkte API",
  pilot: true,
  duplicatesSkipped: report.examples.length - candidates.length,
  caseNumbers: candidates.map((item) => item.caseNumber),
  files: { locationPath, contactPath },
};
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
