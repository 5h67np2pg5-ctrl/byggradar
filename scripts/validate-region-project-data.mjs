import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await fs.readFile(path.join(root, "config", "region-structure.json"), "utf8"));
const failures = [];
const requested = String(process.env.NBR_REGION || "").trim();
const regions = manifest.regions.filter((region) => !requested || region.id === requested);
if (!regions.length) throw new Error(`Ukjent region: ${requested}`);
const phaseStatus = (project) => String(project.classification?.stage || project.classification?.reason || "").toLocaleLowerCase("nb-NO");
const requiresPhase = (project) => /igangsettingstillatelse gitt|igangsetting søkt|tillatelse gitt|rammetillatelse gitt|saksbehandling pågår|søknad mottatt/.test(phaseStatus(project));
const knownPhase = (project) => /^(Fase 1|Fase 2|Fase 3|Fase 4|Fase 5)$/.test(String(project.phase || ""));
for (const region of regions) {
  const base = path.join(root, "public", "data", "regions", region.id);
  const location = JSON.parse(await fs.readFile(path.join(base, "projects_location_enriched.json"), "utf8"));
  const contact = JSON.parse(await fs.readFile(path.join(base, "projects_contact_enriched.json"), "utf8"));
  const projects = Array.isArray(location.projects) ? location.projects : [];
  const contacts = Array.isArray(contact.projects) ? contact.projects : [];
  if (location.regionId !== region.id || contact.regionId !== region.id) failures.push(`${region.id}: regionId mangler eller avviker`);
  if (projects.length !== contacts.length) failures.push(`${region.id}: prosjekt- og kontaktfiler har ulikt antall`);
  projects.forEach((project, index) => {
    if (!Array.isArray(project.files)) failures.push(`${region.id} rad ${index + 1}: files er ikke liste`);
    if (!project.locationEnrichment || typeof project.locationEnrichment !== "object") failures.push(`${region.id} rad ${index + 1}: locationEnrichment mangler`);
    if (requiresPhase(project) && !knownPhase(project)) failures.push(`${region.id} rad ${index + 1}: byggesaksstatus uten Fase 1/Fase 2`);
  });
}
if (failures.length) {
  console.error("Regionprosjektdata: FEIL");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Regionprosjektdata OK: ${regions.length} region(er) kontrollert.`);
}
