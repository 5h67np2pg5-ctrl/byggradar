import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTrondheimPostjournalCases } from "./lib/trondheim-postjournal-adapter.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const regionId = "trondheim";
const regionName = "Trondheim";
const outputDir = path.join(root, "public", "data", "regions", regionId);
const report = await fetchTrondheimPostjournalCases({ includeDetails: false });
const extractAddress = (title = "") => (title.match(/^([^,]+?\s+\d+[A-Za-z]?)(?:\s|,|$)/)?.[1] || "").trim();
const projects = report.projects.map((project) => {
  const address = project.address || extractAddress(project.title);
  const sourceUrl = project.documentUrl || project.caseUrl || "";
  const sourceDocumentId = project.sourceDocumentId || project.documentNumber || "";
  const caseNumber = project.caseNumber || project.documentNumber || "";
  return {
    sourceStream: project.sourceStream,
    sourceKey: project.sourceKey,
    sourceDocumentId,
    sourceType: "kommunal postjournal",
    municipality: "Trondheim kommune",
    municipalityNumber: "5001",
    marketRole: "core",
    caseTitle: project.title,
    title: project.title,
    project: project.title,
    documentTitle: project.documentTitle || project.title,
    shortFacts: project.shortFacts || project.title,
    description: project.shortFacts || project.title,
    caseNumber,
    documentNumber: project.documentNumber || sourceDocumentId,
    documentType: project.documentType || "",
    documentDate: project.documentDate || "",
    recordedDate: project.recordedDate || "",
    fromName: project.fromName || "",
    toName: project.toName || project.recipient || "",
    fromOrg: project.fromOrg || "",
    toOrg: project.toOrg || "",
    actorVisibility: project.actorVisibility || "åpent i kilde",
    hasAnonymizedActor: Boolean(project.hasAnonymizedActor),
    caseUrl: project.caseUrl || "",
    caseUrls: project.caseUrl ? [project.caseUrl] : [],
    sourceUrl,
    status: project.status || "",
    owner: "",
    buyer: "",
    marketArea: "Trondheim",
    procurementType: "",
    tradeRelevance: "",
    estimatedValue: "",
    deadline: "",
    pilot: false,
    isFutureOrActive: true,
    isProjectLead: true,
    files: sourceUrl ? [{ title: "Saksdokument", url: sourceUrl }] : [],
    sourceQueries: project.sourceQueries || ["portal: Bygg og Plan; fritekstfilter ikke brukt"],
    address,
    location: address,
    addressLookupStatus: address ? "adresse funnet i sakstittel; geokoding ikke kjørt" : "adresse ikke funnet",
    personLookupPolicy: "bruk åpne aktørnavn fra kilde; ikke berik privatpersoner med privat telefon/e-post",
    matrikkel: "",
    gnr: "",
    bnr: "",
    fnr: "",
    snr: "",
    classification: { status: "lead", reason: "direkte uttrekk fra Trondheim kommunes postjournal", stage: "saksbehandling pågår", projectTypes: [], excludedReasons: [], leadScore: 0, priority: "B" },
    locationEnrichment: {
      hasMapPoint: false,
      mapLabel: "Ikke bekreftet lokasjon",
      address: address || "",
      addressSource: address ? "Trondheim sakstittel; geokoding utføres separat" : "ikke oppgitt i uttrekket",
      lookupStatus: "ikke geokodet",
      lookupKey: "",
    },
    phase: "Fase 1",
    projectType: "",
    contactName: project.toName || project.recipient || "",
    sourceStreams: [project.sourceStream],
    relatedSourceDocumentIds: sourceDocumentId ? [sourceDocumentId] : [],
    relatedCaseNumbers: caseNumber ? [caseNumber] : [],
    documentCount: sourceUrl ? 1 : 0,
    phaseBasis: "illustrative",
    phaseReason: "Trondheim-uttaket inneholder ikke verifisert fasehistorikk i denne kjøringen",
    phaseStartDate: project.documentDate || project.recordedDate || "",
    phaseTimelineScope: "same-case-only",
    phaseIllustrative: true,
  };
});
const location = { dateFrom: report.dateWindow.from, dateTo: report.dateWindow.to, regionId, regionName, generatedAt: report.generatedAt, projects };
const contact = { dateFrom: report.dateWindow.from, dateTo: report.dateWindow.to, regionId, regionName, generatedAt: report.generatedAt, projects: projects.map((project) => ({ projectId: project.sourceDocumentId, sourceStream: project.sourceStream, title: project.title, status: project.status || "", municipality: project.municipality, location: project.address, fromName: project.sender || "", toName: project.recipient || "", sourceUrl: project.caseUrl, sourceUrls: [project.caseUrl], contacts: [], contactStatus: "missing", personContactPolicy: "Ikke berik privatpersoner med privat telefon/e-post." })) };
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "projects_location_enriched.json"), `${JSON.stringify(location, null, 2)}\n`);
await fs.writeFile(path.join(outputDir, "projects_contact_enriched.json"), `${JSON.stringify(contact, null, 2)}\n`);
await fs.writeFile(path.join(outputDir, "region_status.json"), `${JSON.stringify({ regionId, regionName, generatedAt: report.generatedAt, projectCount: projects.length, source: report.source, sourceType: report.sourceType, status: report.status, dateWindow: report.dateWindow, counts: report.counts }, null, 2)}\n`);
await fs.writeFile(path.join(root, "reports", "trondheim-region-preview.json"), `${JSON.stringify({ ...report, projectCount: projects.length }, null, 2)}\n`);
console.log(JSON.stringify({ regionId, regionName, status: report.status, dateWindow: report.dateWindow, counts: report.counts, outputDir }, null, 2));
