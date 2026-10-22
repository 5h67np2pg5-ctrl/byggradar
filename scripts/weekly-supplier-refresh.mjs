import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");
const reportPath = path.join(root, "data", "weekly-supplier-refresh-report.json");
const regionStructurePath = path.join(root, "config", "region-structure.json");

const normalize = (value) => String(value || "")
  .toLocaleLowerCase("nb-NO")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/æ/g, "ae")
  .replace(/ø/g, "o")
  .replace(/å/g, "a")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const identity = (row) => {
  const org = String(row?.orgNumber || row?.organizationNumber || "").replace(/\D/g, "");
  if (org) return `org:${org}`;
  const website = String(row?.website || "").trim().toLocaleLowerCase("nb-NO");
  if (website) return `website:${website}`;
  return `name:${normalize(row?.name)}|address:${normalize(row?.address)}`;
};
const preservedIn = (previous, current) => {
  const previousOrg = String(previous?.orgNumber || previous?.organizationNumber || "").replace(/\D/g, "");
  const currentOrg = String(current?.orgNumber || current?.organizationNumber || "").replace(/\D/g, "");
  if (previousOrg && currentOrg && previousOrg === currentOrg) return true;
  const previousWebsite = String(previous?.website || "").trim().toLocaleLowerCase("nb-NO");
  const currentWebsite = String(current?.website || "").trim().toLocaleLowerCase("nb-NO");
  if (previousWebsite && currentWebsite && previousWebsite === currentWebsite) return true;
  return normalize(previous?.name) === normalize(current?.name)
    && normalize(previous?.address) === normalize(current?.address);
};

async function run(command, args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [path.join(root, "scripts", command), ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: "ok", output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
  } catch (error) {
    return { status: "error", output: `${error.stdout || ""}${error.stderr || ""}${error.message || error}`.trim() };
  }
}

const before = JSON.parse(await fs.readFile(registerPath, "utf8").catch(() => "[]"));
const beforeFile = JSON.stringify(before, null, 2);
const report = {
  startedAt: new Date().toISOString(),
  schedule: "Mandag kl. 06.00 Europe/Oslo",
  before: { rows: before.length, unique: new Set(before.map(identity)).size },
  sources: [],
};

report.sources.push({ source: "HP", ...(await run("import-hp-suppliers.mjs", ["--all"])) });
report.sources.push({ source: "MA", ...(await run("import-ma-all-regions.mjs", [])) });

const regionPayload = JSON.parse(await fs.readFile(regionStructurePath, "utf8").catch(() => "{}"));
const regionIds = (regionPayload.regions || []).map((region) => region.id).filter(Boolean);
const dibSnapshot = process.env.DIB_SNAPSHOT || "/tmp/sgregister-enterprises.json";
try {
  await fs.access(dibSnapshot);
  for (const regionId of regionIds) {
    report.sources.push({ source: "DIB", regionId, ...(await run("import-dib-missing-suppliers.mjs", [], { NBR_IMPORT_REGION: regionId, DIB_SNAPSHOT: dibSnapshot })) });
  }
} catch {
  report.sources.push({ source: "DIB", status: "skipped", detail: "DIB_SNAPSHOT mangler" });
}

const maInputDirectory = process.env.NBR_MA_INPUT_DIR || path.join(root, "data", "ma-snapshots");
for (const regionId of regionIds) {
  const inputPath = path.join(maInputDirectory, `${regionId}.json`);
  try {
    await fs.access(inputPath);
    report.sources.push({ source: "MA", regionId, ...(await run("import-ma-region.mjs", [], { NBR_IMPORT_REGION: regionId, NBR_MA_INPUT: inputPath })) });
  } catch {
    report.sources.push({ source: "MA", regionId, status: "skipped", detail: "MA-kildedata mangler" });
  }
}

report.sources.push({ source: "orgnummer", ...(await run("enrich-supplier-org-numbers.mjs", [])) });
const after = JSON.parse(await fs.readFile(registerPath, "utf8").catch(() => "[]"));
const removed = before.filter((previous) => !after.some((current) => preservedIn(previous, current)));
if (removed.length) {
  await fs.writeFile(registerPath, `${beforeFile}\n`, "utf8");
  report.status = "aborted_existing_businesses_would_be_removed";
  report.removedCount = removed.length;
  report.removedExamples = removed.slice(0, 10).map((row) => row.name || row.orgNumber || row.website || "Ukjent virksomhet");
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  throw new Error(`Ukentlig innhenting avbrutt: ${removed.length} eksisterende virksomheter kunne ikke bevares.`);
}
report.finishedAt = new Date().toISOString();
report.after = {
  rows: after.length,
  unique: new Set(after.map(identity)).size,
  addedUnique: Math.max(0, new Set(after.map(identity)).size - report.before.unique),
  sourceCounts: Object.fromEntries([...new Set(after.flatMap((row) => row.sources || [row.source || "UKJENT"]))].map((source) => [source, after.filter((row) => (row.sources || [row.source]).includes(source)).length])),
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report.after, null, 2));
