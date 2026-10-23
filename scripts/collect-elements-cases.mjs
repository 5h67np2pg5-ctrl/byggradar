import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir = path.join(root, "public/data/regions/vestfoldkongsbergregionen");
const config = JSON.parse(await fs.readFile(path.join(root, "config/vestfold-kongsberg-postlist-sources.json"), "utf8"));
const sources = config.municipalities.filter((item) => item.adapter === "elements");
const terms = ["bygg", "bygge", "byggje", "byggesak", "byggjesak", "byggesøknad", "byggjesøknad", "byggetillatelse", "byggjeløyve", "rammetillatelse", "rammeløyve", "igangsetting", "igangsetjing", "igangsettingstillatelse", "igangsettingsløyve", "igangsetjingsløyve", "tilbygg", "påbygg", "fradeling", "frådeling", "løyve"];
const excluded = new RegExp(config.filter.exclude.join("|"), "i");
const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const clean = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const canonicalKey = (row) => {
  const title = clean(row.caseTitle || row.documentTitle).toLocaleLowerCase("nb-NO");
  const caseNumber = clean(row.caseNumber).toLocaleLowerCase("nb-NO");
  const date = clean(row.documentDate || row.recordedDate);
  return `${row.municipality}|${caseNumber}|${title}|${date}`;
};

async function fetchJson(source, term) {
  const parsed = new URL(source.sourceUrl);
  const tenant = parsed.pathname.split("/").filter(Boolean).at(-1);
  const query = new URLSearchParams({ Query: term, IncludeCases: "true", IncludeSenderRecipient: "true", DateFrom: cutoff, DateTo: today });
  const { stdout } = await exec("curl", ["-L", "-sS", "--max-time", "30", "-H", `Tenant: ${tenant}`, "-H", "Accept: application/json", `${parsed.origin}/publikum/api/PredefinedQuery/CasesAndRegistryEntries?${query}`], { maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const projects = [];
const status = [];
for (const source of sources) {
  const rows = new Map();
  try {
    // Elements returns a broad, paginated public result for `bygg`. One request
    // per municipality keeps collection fast; the detailed NBR filter is applied
    // locally to the returned titles.
    const payload = await fetchJson(source, "bygg");
    for (const item of payload.Items || []) {
        const title = clean(item.SA_TITTEL || item.JP_INNHOLD_G || item.JP_TITTEL || item.Title);
        const date = String(item.SA_DATO || item.JP_DOKDATO || item.JP_JDATO || "").slice(0, 10);
        if (!title || excluded.test(title) || (date && date < cutoff) || !new RegExp(terms.join("|"), "i").test(title)) continue;
        const id = String(item.JP_ID || item.SA_ID || `${title}|${date}`);
        rows.set(id, {
          sourceStream: "municipal_elements_innsyn",
          sourceKey: `${source.name.replace(/ kommune$/, "").replace(/ herad$/, "").toLocaleLowerCase("nb-NO")}_elements_innsyn`,
          sourceDocumentId: id,
          municipality: source.name,
          caseTitle: title,
          documentTitle: title,
          shortFacts: title,
          caseNumber: item.SA_SAKSNR_XX || "",
          documentType: item.ND_BETEGN || "",
          documentDate: date,
          recordedDate: date,
          fromName: item.JP_AVSMOT_G || "",
          actorVisibility: "åpent i kilde",
          hasAnonymizedActor: /xxxx|anonym/i.test(title),
          caseUrl: source.sourceUrl,
          files: [],
          sourceQueries: terms.filter((candidate) => new RegExp(candidate, "i").test(title)),
          address: "",
          matrikkel: "",
          classification: { status: "lead", reason: "kommunal byggesak eller planinformasjon", stage: "saksbehandling pågår", projectTypes: [], excludedReasons: [], leadScore: 0, priority: "B" },
          locationEnrichment: { hasMapPoint: false, mapLabel: "Ikke bekreftet lokasjon", addressSource: "adresse/matrikkel må hentes fra sakens metadata" },
        });
      }
    projects.push(...rows.values());
    status.push({ municipality: source.name, adapter: source.adapter, status: rows.size ? "hentet" : "ingen treff/krever kontroll", count: rows.size, sourceUrl: source.sourceUrl });
    console.log(`${source.name}: ${rows.size} bygg-/plansaker`);
  } catch (error) {
    status.push({ municipality: source.name, adapter: source.adapter, status: "feil", count: 0, sourceUrl: source.sourceUrl, error: error.message });
    console.error(`${source.name}: ${error.message}`);
  }
}

const previous = JSON.parse(await fs.readFile(path.join(outputDir, "projects_location_enriched.json"), "utf8"));
const existing = previous.projects || [];
const unique = [...new Map([...existing, ...projects].map((row) => [canonicalKey(row), row])).values()];
const previousStatus = JSON.parse(await fs.readFile(path.join(outputDir, "region_status.json"), "utf8"));
const mergedStatus = [...new Map([...previousStatus.municipalities, ...status].map((row) => [row.municipality, row])).values()];
await fs.writeFile(path.join(outputDir, "projects_location_enriched.json"), JSON.stringify({ ...previous, generatedAt: new Date().toISOString(), projects: unique }, null, 2));
await fs.writeFile(path.join(outputDir, "projects_contact_enriched.json"), JSON.stringify({ ...(JSON.parse(await fs.readFile(path.join(outputDir, "projects_contact_enriched.json"), "utf8"))), generatedAt: new Date().toISOString(), projects: unique }, null, 2));
await fs.writeFile(path.join(outputDir, "region_status.json"), JSON.stringify({ ...previousStatus, generatedAt: new Date().toISOString(), municipalities: mergedStatus, projectCount: unique.length }, null, 2));
await import("./enrich-map-points.mjs");
await import("./enrich-all-project-contacts.mjs");
console.log(`Totalt etter Elements: ${unique.length} unike saker`);
