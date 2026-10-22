import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputDir = path.join(root, "public/data/regions/vestfoldkongsbergregionen");
const sourceUrl = "https://innsyn2020.drammen.kommune.no/postjournal-v2/450d153d-62f7-4564-ab1b-60370477c471";
const searchUrl = `${sourceUrl}?params=${encodeURIComponent(JSON.stringify({ search: "bygg" }))}`;
const include = /byggesak|byggesøknad|byggetillatelse|rammetillatelse|igangsettingstillatelse|igangsetting|fasade|påbygg|tilbygg|rivning|fradeling|seksjonering|reguleringsplan|planinitiativ|dispensasjon|oppføring|garasje|bolig|næring|terreng|forstøtningsmur|bruksendring/i;
const exclude = /avslag|klage|ferdigmelding|ferdigattest|tilsyn|ulovlighetsoppfølging|innsyn|dokumenter fra tidligere|møteinnkalling|postmottak|oversendelse|arkiv|anmodning om dokument|bero|stanset|avsluttet|trukket|tilbakekalt|spørsmål|veiledning|gebyrregulativ|gebyr|høring|prioritering av byggesaker|saksbehandling pågår|^tilbud\b|ikke operativt|cv\b|stilling|ansettelse/i;
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const canonicalKey = (row) => `${row.municipality}|${clean(row.caseNumber)}|${clean(row.caseTitle).toLocaleLowerCase("nb-NO")}`;
const parseAddress = (title) => clean(title).split(",")[0] || "";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
  const caseFolders = page.getByText(/Saksmapper/).first();
  if (!await caseFolders.count()) throw new Error("Drammen: fant ikke fanen Saksmapper");
  await caseFolders.click();
  await page.waitForTimeout(700);
  let previousCount = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const count = await page.locator("table tbody tr").count();
    const more = page.locator("button").filter({ hasText: "Last flere" });
    if (!await more.count() || count === previousCount) break;
    previousCount = count;
    await more.click();
    await page.waitForTimeout(700);
  }
  const rows = await page.locator("table tbody tr").evaluateAll((elements) => elements.map((element) => {
    const cells = [...element.querySelectorAll("td")].map((cell) => cell.innerText.replace(/\s+/g, " ").trim());
    return { caseNumber: cells[0] || "", documentType: cells[1] || "", matrikkel: cells[2] || "", caseTitle: cells[3] || "" };
  }));
  const projects = rows
    .map((row) => ({ ...row, municipality: "Drammen kommune", documentDate: "", recordedDate: "" }))
    .filter((row) => row.caseNumber && row.caseTitle && include.test(row.caseTitle) && !exclude.test(row.caseTitle))
    .map((row) => ({
      sourceStream: "municipal_jupiter_innsyn",
      sourceKey: "drammen_jupiter_plan_og_bygg",
      sourceDocumentId: `${row.caseNumber}|${row.caseTitle}`,
      municipality: row.municipality,
      caseTitle: row.caseTitle,
      documentTitle: row.caseTitle,
      shortFacts: row.caseTitle,
      caseNumber: row.caseNumber,
      documentType: row.documentType,
      documentDate: row.documentDate,
      recordedDate: row.recordedDate,
      fromName: "",
      actorVisibility: "åpent i kilde",
      hasAnonymizedActor: /xxxx|anonym/i.test(row.caseTitle),
      caseUrl: sourceUrl,
      files: [],
      sourceQueries: ["bygg"],
      address: parseAddress(row.caseTitle),
      matrikkel: row.matrikkel,
      classification: { status: "lead", reason: "kommunal byggesak eller planinformasjon", stage: "saksbehandling pågår", projectTypes: [], excludedReasons: [], leadScore: 0, priority: "B" },
      locationEnrichment: { hasMapPoint: false, mapLabel: "Ikke bekreftet lokasjon", addressSource: "adresse/matrikkel må hentes fra sakens metadata" },
    }));
  const previous = JSON.parse(await fs.readFile(path.join(outputDir, "projects_location_enriched.json"), "utf8"));
  const existing = (previous.projects || []).filter((row) => row.municipality !== "Drammen kommune");
  const unique = [...new Map([...existing, ...projects].map((row) => [canonicalKey(row), row])).values()];
  const contactPath = path.join(outputDir, "projects_contact_enriched.json");
  const contact = JSON.parse(await fs.readFile(contactPath, "utf8"));
  const statusPath = path.join(outputDir, "region_status.json");
  const previousStatus = JSON.parse(await fs.readFile(statusPath, "utf8"));
  const municipalities = [...new Map([...previousStatus.municipalities, { municipality: "Drammen kommune", adapter: "drammen-postjournal", status: "hentet", count: projects.length, sourceUrl }].map((item) => [item.municipality, item])).values()];
  await fs.writeFile(path.join(outputDir, "projects_location_enriched.json"), JSON.stringify({ ...previous, generatedAt: new Date().toISOString(), projects: unique }, null, 2));
  await fs.writeFile(contactPath, JSON.stringify({ ...contact, generatedAt: new Date().toISOString(), projects: unique }, null, 2));
  await fs.writeFile(statusPath, JSON.stringify({ ...previousStatus, generatedAt: new Date().toISOString(), municipalities, projectCount: unique.length }, null, 2));
  await import("./enrich-map-points.mjs");
  await import("./enrich-all-project-contacts.mjs");
  console.log(`Drammen: ${projects.length} bygg-/plansaker etter filter (${rows.length} søketreff), totalt ${unique.length} unike saker`);
} finally {
  await browser.close();
}
