import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await fs.readFile(path.join(root, "config/region-structure.json"), "utf8"));
const generic = /^(kommune|kommunen|herad|flere mottakere|mottaker|avsender|postmottak|pbe|byggesak|saksbehandler|ukjent)$/i;
const clean = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).toLocaleLowerCase("nb-NO");
const unique = (values) => [...new Map(values.filter(Boolean).map((value) => [normalized(value), value])).values()];
const isCompany = (value) => /\b(as|asa|ans|da|sa|ba|nuf)\b|entrepren|arkitekt|bygg|anlegg|eiendom|bolig|prosjekt|konsulent|install|rør|ror|elektro|tak|ventilasjon/i.test(value);
const isMunicipal = (name, project) => {
  const value = normalized(name);
  const municipality = normalized(project.municipality).replace(/[^a-z0-9]+/g, "");
  return /kommune|herad|pbe|postmottak|byggesak|servicetorg/i.test(value) || (municipality && value.includes(municipality));
};

function sourceActors(project) {
  return unique([
    project.responsibleApplicant,
    project.responsibleApplicantName,
    project.applicant,
    project.applicantName,
    project.applicantCompany,
    project.developer,
    project.owner,
    project.contactName,
    project.toOrg,
    project.toName,
    project.fromOrg,
    project.fromName,
  ].map(clean).filter((value) => value && !generic.test(value)));
}

function sourceContact(project, name) {
  const isCompanyName = isCompany(name);
  return {
    queryName: name,
    matchStatus: "source",
    name,
    orgNumber: isCompanyName ? clean(project.organizationNumber) : "",
    phone: clean(project.contactPhone),
    email: clean(project.contactEmail),
    website: clean(project.contactWebsite),
    address: clean(project.address || project.location),
    municipality: clean(project.municipality),
    source: "kommunal sakskilde",
    sourceUrl: clean(project.caseUrl || project.sourceUrl),
  };
}

function mergeContactRecord(project, existing = {}) {
  const sourceNames = sourceActors(project);
  const existingContacts = Array.isArray(existing.contacts) ? existing.contacts : [];
  const namedContacts = sourceNames.map((name) => sourceContact(project, name));
  const contacts = [...new Map([...existingContacts, ...namedContacts].map((contact) => [normalized(`${contact.name}|${contact.email}|${contact.phone}`), contact])).values()]
    .filter((contact) => contact.name || contact.phone || contact.email);
  const displayContact = existing.displayContact?.name
    ? { ...existing.displayContact }
    : contacts.find((contact) => !isMunicipal(contact.name, project)) || contacts[0] || null;
  const hasPhone = Boolean(displayContact?.phone || contacts.some((contact) => contact.phone));
  const hasEmail = Boolean(displayContact?.email || contacts.some((contact) => contact.email));
  const hasActor = Boolean(displayContact?.name || contacts.length);
  return {
    ...existing,
    projectId: existing.projectId || project.sourceDocumentId,
    sourceStream: project.sourceStream,
    title: project.title || project.caseTitle || project.documentTitle || existing.title || "",
    municipality: project.municipality,
    location: project.address || project.location || existing.location || "",
    fromName: project.fromName || existing.fromName || "",
    toName: project.toName || existing.toName || "",
    fromOrg: project.fromOrg || existing.fromOrg || "",
    toOrg: project.toOrg || existing.toOrg || "",
    displayContact,
    contacts,
    contactStatus: hasPhone && hasEmail ? "complete" : hasActor ? (hasPhone || hasEmail ? "partial" : "name_only") : "missing",
    contactSearchSubject: displayContact?.name || sourceNames[0] || project.address || project.matrikkel || project.caseTitle || "",
    personContactPolicy: "Privatpersoner skal ikke berikes med privat telefon/e-post. Vis bare åpne navn fra kilden eller virksomhetskontakt.",
  };
}

let totalProjects = 0;
let actorRecords = 0;
let completeRecords = 0;
let partialRecords = 0;
for (const region of manifest.regions) {
  const dir = path.join(root, "public/data/regions", region.id);
  const locationPath = path.join(dir, "projects_location_enriched.json");
  const contactPath = path.join(dir, "projects_contact_enriched.json");
  const location = JSON.parse(await fs.readFile(locationPath, "utf8"));
  let contact;
  try { contact = JSON.parse(await fs.readFile(contactPath, "utf8")); } catch { contact = { regionId: region.id, projects: [] }; }
  const existing = new Map((contact.projects || []).map((project) => [project.projectId, project]));
  const projects = (location.projects || []).map((project) => {
    const enriched = mergeContactRecord(project, existing.get(project.sourceDocumentId));
    totalProjects += 1;
    if (enriched.displayContact?.name || enriched.contacts.length) actorRecords += 1;
    if (enriched.contactStatus === "complete") completeRecords += 1;
    if (enriched.contactStatus === "partial") partialRecords += 1;
    return enriched;
  });
  await fs.writeFile(contactPath, JSON.stringify({ ...contact, regionId: region.id, generatedAt: new Date().toISOString(), projects }, null, 2));
}

console.log(JSON.stringify({ totalProjects, actorRecords, completeRecords, partialRecords }, null, 2));
