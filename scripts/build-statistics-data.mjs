import fs from "node:fs/promises";

const regions = ["bergensregionen", "stavangerregionen", "haugalandsregionen"];

function phaseFor(stage) {
  const value = String(stage || "").toLocaleLowerCase("nb-NO");
  if (["igangsettingstillatelse gitt", "igangsetting søkt", "tillatelse gitt"].includes(value)) return "Fase 2";
  if (["rammetillatelse gitt", "saksbehandling pågår", "søknad mottatt"].includes(value)) return "Fase 1";
  return "Uklassifisert";
}

function projectRecord(project, region) {
  const location = project.locationEnrichment || {};
  const classification = project.classification || {};
  const stage = classification.stage || project.status || project.phase || "Ukjent status";
  const coordinates = Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
    ? { latitude: Number(location.latitude), longitude: Number(location.longitude) }
    : null;

  return {
    id: project.sourceDocumentId,
    region,
    municipality: project.municipality || "Ukjent kommune",
    municipalityNumber: project.municipalityNumber || "",
    title: project.caseTitle || project.documentTitle || project.title || project.shortFacts || "Ukjent prosjekt",
    address: project.address || location.address || "",
    matrikkel: project.matrikkel || "",
    date: project.documentDate || project.recordedDate || project.deadline || "",
    stage,
    phase: phaseFor(stage),
    projectTypes: classification.projectTypes || [],
    sourceStream: project.sourceStream || "",
    documentType: project.documentType || "",
    caseNumber: project.caseNumber || "",
    recordedDate: project.recordedDate || "",
    deadline: project.deadline || "",
    fromName: project.fromName || "",
    toName: project.toName || "",
    fromOrg: project.fromOrg || "",
    toOrg: project.toOrg || "",
    hasMapPoint: Boolean(location.hasMapPoint && coordinates),
    coordinates,
  };
}

function countBy(records, keyFn) {
  const counts = {};
  for (const record of records) {
    const key = keyFn(record) || "Ukjent";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

async function run() {
  const projects = [];
  for (const region of regions) {
    const file = `public/data/regions/${region}/projects_location_enriched.json`;
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    projects.push(...(data.projects || []).map((project) => projectRecord(project, region)));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    regions,
    totalProjects: projects.length,
    projects,
    summary: {
      byRegion: countBy(projects, (project) => project.region),
      byMunicipality: countBy(projects, (project) => `${project.region} / ${project.municipality}`),
      byPhase: countBy(projects, (project) => project.phase),
      byStage: countBy(projects, (project) => project.stage),
      bySource: countBy(projects, (project) => project.sourceStream),
      byProjectType: countBy(projects.flatMap((project) => project.projectTypes.map((type) => ({ type }))), (project) => project.type),
      byMonth: countBy(projects, (project) => String(project.date || "").slice(0, 7)),
    },
  };

  await fs.writeFile("public/data/statistics_projects.json", `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Statistikkgrunnlag: ${projects.length} prosjekter fra ${regions.length} regioner`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
