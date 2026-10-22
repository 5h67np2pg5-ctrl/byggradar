import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await fs.readFile(path.join(root, "config", "region-structure.json"), "utf8"));
const municipalityNumbers = JSON.parse(await fs.readFile(path.join(root, "config", "municipality-numbers.json"), "utf8"));
const requested = String(process.env.NBR_REGION || "").trim();
const regions = manifest.regions.filter((region) => !requested || region.id === requested);
if (!regions.length) throw new Error(`Ukjent region: ${requested}`);

const phaseFor = (project) => {
  const stage = String(project.phase || project.classification?.stage || project.classification?.reason || "").toLocaleLowerCase("nb-NO");
  if (/igangsettingstillatelse gitt|igangsetting søkt|tillatelse gitt/.test(stage)) return "Fase 2";
  if (/rammetillatelse gitt|saksbehandling pågår|søknad mottatt/.test(stage)) return "Fase 1";
  return project.phase || "";
};
const projectTypeFor = (project) => {
  if (project.projectType) return project.projectType;
  const types = project.classification?.projectTypes;
  return Array.isArray(types) ? types.filter(Boolean).join(", ") : String(types || "");
};
const atomicWrite = async (filePath, payload) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
};
const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

for (const region of regions) {
  const directory = path.join(root, "public", "data", "regions", region.id);
  const locationPath = path.join(directory, "projects_location_enriched.json");
  const contactPath = path.join(directory, "projects_contact_enriched.json");
  const location = await readJson(locationPath);
  const contact = await readJson(contactPath);
  const now = new Date().toISOString();
  const projects = (Array.isArray(location.projects) ? location.projects : []).map((project) => {
    const locationEnrichment = project.locationEnrichment && typeof project.locationEnrichment === "object" ? project.locationEnrichment : {};
    const municipality = project.municipality || "";
    const fromName = project.fromName || "";
    const toName = project.toName || "";
    return {
      ...project,
      municipalityNumber: project.municipalityNumber || municipalityNumbers[municipality] || "",
      phase: phaseFor(project),
      projectType: projectTypeFor(project),
      files: Array.isArray(project.files) ? project.files : [],
      contactName: project.contactName || toName || fromName || "",
      locationEnrichment,
    };
  });
  const contactProjects = (Array.isArray(contact.projects) ? contact.projects : []).map((project) => ({
    ...project,
    contacts: Array.isArray(project.contacts) ? project.contacts : [],
    displayContact: project.displayContact || "",
  }));
  await atomicWrite(locationPath, { ...location, regionId: region.id, regionName: region.name, generatedAt: location.generatedAt || now, projects });
  await atomicWrite(contactPath, { ...contact, regionId: region.id, regionName: region.name, generatedAt: contact.generatedAt || now, projects: contactProjects });
  const phases = projects.reduce((counts, project) => { if (project.phase) counts[project.phase] = (counts[project.phase] || 0) + 1; return counts; }, {});
  console.log(JSON.stringify({ regionId: region.id, projects: projects.length, phases, municipalityNumbers: projects.filter((project) => project.municipalityNumber).length, files: projects.filter((project) => project.files.length).length }, null, 2));
}
