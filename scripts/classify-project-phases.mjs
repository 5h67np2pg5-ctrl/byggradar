import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await fs.readFile(path.join(root, "config", "region-structure.json"), "utf8"));
const requested = String(process.env.NBR_REGION || "").trim();
const regions = manifest.regions.filter((region) => !requested || region.id === requested);
if (!regions.length) throw new Error(`Ukjent region: ${requested}`);

const normalize = (value) => String(value || "")
  .toLocaleLowerCase("nb-NO")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/å/g, "a");

const textFor = (project) => {
  const placeholderStage = project.classification?.stage === "saksbehandling pågår"
    && /direkte uttrekk fra trondheim/i.test(String(project.classification?.reason || ""));
  return normalize([
  project.documentTitle,
  project.caseTitle,
  project.shortFacts,
  project.status,
  placeholderStage ? "" : project.classification?.stage,
  project.classification?.reason,
  project.phase,
  ].filter(Boolean).join(" | "));
};

const firstDate = (project) => [
  project.documentDate,
  project.recordedDate,
  project.createdDate,
  project.publishedDate,
].find((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) || "";

const classify = (project) => {
  const text = textFor(project);
  const applicationOnly = /(søknad|soknad)[^|]{0,100}(tillatelse|løyve|loyve)/.test(text)
    && !/(gitt|godkjent|innvilget|vedtak|tillatelse til tiltak med ansvarsrett)/.test(text);
  // A decision always outranks an application or a supplementary document.
  if (!applicationOnly && (/(igangsettingstillatelse|igangsettingsloyve|igangsettingsløyve).*(gitt|godkjent|innvilget|løyve|loyve)|tillatelse til tiltak(?!\s*uten)|loyve til tiltak|løyve til tiltak|godkjenning.*soknad|godkjenning.*søknad/.test(text))) {
    return { phase: "Fase 5", basis: "dokumentert", reason: "Tillatelse eller godkjenning registrert" };
  }
  if (/(søknad|soknad).*(om )?(igangsettingstillatelse|igangsettingsloyve|igangsettingsløyve)|igangsettingssoknad|igangsettingssøknad/.test(text)) {
    return { phase: "Fase 4", basis: "dokumentert", reason: "Søknad om igangsetting registrert" };
  }
  if (/(rammetillatelse|rammeloyve|rammeløyve).*(gitt|godkjent|innvilget|løyve|loyve)|\b(vedtak|tillatelse|løyve|loyve)\b.*(ramme|rammesoknad|rammesøknad)/.test(text)) {
    return { phase: "Fase 3", basis: "dokumentert", reason: "Rammetillatelse eller rammeløyve registrert" };
  }
  if (/(mangler|supplering|tilleggsopplys|saksbehand|uttale|uttalelse|høring|hoyring|behov for|oversending.*uttale)/.test(text)) {
    return { phase: "Fase 2", basis: "dokumentert", reason: "Saksbehandling eller supplering registrert" };
  }
  if (/(søknad|soknad|mottatt|bekreftelse på mottatt|ett-trinns|eitt-trinns)/.test(text)) {
    return { phase: "Fase 1", basis: "dokumentert", reason: "Søknad eller mottak registrert" };
  }
  return { phase: "", basis: "illustrativ", reason: "Fase fordeles etter dato fordi dokumentert fase mangler" };
};

const illustrativeDistribution = [
  ["Fase 1", 0.20],
  ["Fase 2", 0.20],
  ["Fase 3", 0.20],
  ["Fase 4", 0.20],
  ["Fase 5", 0.20],
];

const stableKey = (project, index) => String(project.caseNumber || project.sourceDocumentId || project.id || `${index}`);
const assignIllustrativePhases = (projects) => {
  const unclear = projects
    .map((entry, index) => ({ ...entry, index }))
    .filter(({ result }) => !result.phase)
    .sort((a, b) => String(a.phaseStartDate || "9999-12-31").localeCompare(String(b.phaseStartDate || "9999-12-31")) || stableKey(a.project, a.index).localeCompare(stableKey(b.project, b.index)));
  const counts = illustrativeDistribution.map(([, share]) => Math.floor(unclear.length * share));
  let remainder = unclear.length - counts.reduce((sum, count) => sum + count, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % counts.length, remainder -= 1) counts[index] += 1;
  let cursor = 0;
  illustrativeDistribution.forEach(([phase], index) => {
    for (const entry of unclear.slice(cursor, cursor + counts[index])) {
      entry.result.phase = phase;
      entry.result.reason = "Illustrativ fordeling etter dokumentdato";
      entry.result.basis = "illustrativ";
    }
    cursor += counts[index];
  });
  return projects;
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
  const location = await readJson(locationPath);
  const classified = (Array.isArray(location.projects) ? location.projects : []).map((project) => ({
    project,
    result: classify(project),
    phaseStartDate: firstDate(project),
  }));
  assignIllustrativePhases(classified);
  const projects = classified.map(({ project, result, phaseStartDate }) => ({
      ...project,
      phase: result.phase,
      phaseBasis: result.basis,
      phaseReason: result.reason,
      phaseStartDate,
      phaseIllustrative: result.basis === "illustrativ",
      phaseTimelineScope: project.caseNumber ? "same-case-only" : "project-record-only",
  }));
  await atomicWrite(locationPath, { ...location, projects });

  const contactPath = path.join(directory, "projects_contact_enriched.json");
  try {
    const contact = await readJson(contactPath);
    const byKey = new Map(projects.map((project) => [String(project.caseNumber || project.sourceDocumentId || project.id), project]));
    const contactProjects = (Array.isArray(contact.projects) ? contact.projects : []).map((project) => {
      const match = byKey.get(String(project.caseNumber || project.sourceDocumentId || project.id));
      return match ? { ...project, phase: match.phase, phaseBasis: match.phaseBasis, phaseReason: match.phaseReason, phaseStartDate: match.phaseStartDate, phaseTimelineScope: match.phaseTimelineScope } : project;
    });
    await atomicWrite(contactPath, { ...contact, projects: contactProjects });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const summary = projects.reduce((result, project) => {
    result[project.phase] = (result[project.phase] || 0) + 1;
    return result;
  }, {});
  const basis = projects.reduce((result, project) => {
    result[project.phaseBasis] = (result[project.phaseBasis] || 0) + 1;
    return result;
  }, {});
  console.log(JSON.stringify({ region: region.id, projects: projects.length, phases: summary, basis }, null, 2));
}
