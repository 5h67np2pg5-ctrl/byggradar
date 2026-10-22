import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const regionDir = path.join(root, "public/data/regions/bergensregionen");
const locationPath = path.join(regionDir, "projects_location_enriched.json");
const contactPath = path.join(regionDir, "projects_contact_enriched.json");
const reportPath = path.join(root, "reports/bergen-dedupe-report.json");

const [locationBundle, contactBundle] = await Promise.all([
  fs.readFile(locationPath, "utf8").then(JSON.parse),
  fs.readFile(contactPath, "utf8").then(JSON.parse),
]);

const text = (value) => Array.isArray(value)
  ? value.map(text).filter(Boolean).join(" ")
  : String(value || "").replace(/\s+/g, " ").trim();
const normalize = (value) => text(value).toLocaleLowerCase("nb-NO").replace(/[^a-z0-9æøå]+/gi, " ").trim();
const dateValue = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const sourcePriority = (source) => ({
  bergen_municipality_direct_api: 5,
  municipal_acos_innsyn: 4,
  samfunnsdata_postjournal: 3,
  postlister_allemannsdata: 2,
  bane_nor_procurement_plan: 1,
}[source] || 0);
const caseBase = (value) => {
  const raw = text(value);
  const match = raw.match(/^(.*?\d{4}\/\d+)(?:-\d+)?$/i);
  return match ? normalize(match[1]) : "";
};
const groupKey = (project) => {
  const caseKey = caseBase(project.caseNumber);
  if (caseKey) return `case:${caseKey}`;
  const content = `${normalize(project.caseTitle || project.documentTitle)}|${normalize(project.address || project.location)}`;
  return content === "|" ? `id:${normalize(project.sourceDocumentId)}` : `content:${content}`;
};
const uniqueValues = (values) => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value]).map(text).filter(Boolean))];
const uniqueObjects = (values, keyFn) => {
  const seen = new Map();
  for (const value of values.flatMap((item) => Array.isArray(item) ? item : [item]).filter(Boolean)) {
    const key = keyFn(value);
    if (!seen.has(key)) seen.set(key, value);
  }
  return [...seen.values()];
};
const mergeFileKey = (file) => text(file?.url || file?.href || file?.title || file?.name);

const groups = new Map();
for (const project of locationBundle.projects || []) {
  const key = groupKey(project);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(project);
}

const contactById = new Map((contactBundle.projects || []).map((project) => [project.projectId, project]));
const oldToCanonical = new Map();
const merged = [];
let mergedGroups = 0;
let mergedRows = 0;

for (const [key, rows] of groups) {
  const ordered = [...rows].sort((a, b) => {
    const sourceDelta = sourcePriority(b.sourceStream) - sourcePriority(a.sourceStream);
    return sourceDelta || dateValue(b.documentDate || b.recordedDate) - dateValue(a.documentDate || a.recordedDate);
  });
  const canonical = { ...ordered[0] };
  const allSourceIds = uniqueValues(ordered.map((row) => row.sourceDocumentId));
  const allCaseNumbers = uniqueValues(ordered.map((row) => row.caseNumber));
  canonical.sourceStreams = uniqueValues(ordered.map((row) => row.sourceStream));
  canonical.relatedSourceDocumentIds = allSourceIds;
  canonical.relatedCaseNumbers = allCaseNumbers;
  canonical.sourceStream = canonical.sourceStreams[0] || canonical.sourceStream;
  canonical.files = uniqueObjects(ordered.map((row) => row.files || []), mergeFileKey);
  canonical.sourceQueries = uniqueValues(ordered.map((row) => row.sourceQueries || []));
  canonical.caseUrls = uniqueValues(ordered.map((row) => row.caseUrl));
  canonical.documentCount = canonical.files.length || rows.length;
  const base = caseBase(canonical.caseNumber);
  if (base && rows.length > 1) canonical.caseNumber = base.replace(/^bygg-/, "BYGG-");
  for (const row of rows) oldToCanonical.set(row.sourceDocumentId, canonical.sourceDocumentId);
  merged.push(canonical);
  if (rows.length > 1) {
    mergedGroups += 1;
    mergedRows += rows.length - 1;
  }
}

const contactGroups = new Map();
for (const project of contactBundle.projects || []) {
  const canonicalId = oldToCanonical.get(project.projectId) || project.projectId;
  if (!contactGroups.has(canonicalId)) contactGroups.set(canonicalId, []);
  contactGroups.get(canonicalId).push(project);
}
const mergedContacts = [...contactGroups.entries()].map(([projectId, rows]) => {
  const ordered = [...rows].sort((a, b) => {
    const aScore = (a.contacts?.length || 0) + (a.displayContact ? 1 : 0);
    const bScore = (b.contacts?.length || 0) + (b.displayContact ? 1 : 0);
    return bScore - aScore;
  });
  const canonical = { ...(ordered[0] || {}), projectId };
  canonical.sourceStreams = uniqueValues(rows.map((row) => row.sourceStream));
  canonical.sourceUrls = uniqueValues(rows.map((row) => row.sourceUrl));
  canonical.relatedProjectIds = uniqueValues(rows.map((row) => row.projectId));
  canonical.contacts = uniqueObjects(rows.map((row) => row.contacts || []), (contact) => normalize(contact.email || contact.phone || contact.name || JSON.stringify(contact)));
  canonical.contactStatus = canonical.contacts.length || canonical.displayContact ? "complete" : "missing";
  return canonical;
});

const report = {
  generatedAt: new Date().toISOString(),
  region: "bergensregionen",
  before: { locationProjects: locationBundle.projects.length, contactProjects: contactBundle.projects.length },
  after: { locationProjects: merged.length, contactProjects: mergedContacts.length },
  mergedGroups,
  removedDuplicateRows: mergedRows,
  preservedDocuments: merged.reduce((count, project) => count + (project.files?.length || 0), 0),
  rule: "Ett prosjekt per saksnummer eller prosjekttekst/adresse; dokumenter og kildekoblinger beholdes.",
};

locationBundle.projects = merged;
contactBundle.projects = mergedContacts;
await Promise.all([
  fs.writeFile(locationPath, `${JSON.stringify(locationBundle, null, 2)}\n`),
  fs.writeFile(contactPath, `${JSON.stringify(contactBundle, null, 2)}\n`),
  fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`),
]);
console.log(JSON.stringify(report, null, 2));
