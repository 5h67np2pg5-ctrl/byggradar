import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "data", "weekly-project-refresh-report.json");

// Only collectors with an implemented adapter are scheduled. Unsupported
// municipal sources remain untouched and are listed in the report.
const collectors = [
  ["collect-region-building-cases.mjs", "Vestfold- og Kongsbergregionen: ACOS/Elements"],
  ["collect-elements-cases.mjs", "Vestfold- og Kongsbergregionen: Elements"],
  ["collect-drammen-postjournal.mjs", "Drammen: postjournal"],
  ["collect-larvik-onacos.mjs", "Larvik: ONACOS"],
  ["collect-national-procurements.mjs", "Nasjonale anskaffelser"],
];

const report = {
  startedAt: new Date().toISOString(),
  schedule: "Fredag kl. 15.00 Europe/Oslo",
  policy: "Eksisterende prosjekter skal beholdes. Feil i én kilde skal ikke stoppe øvrige kilder.",
  collectors: [],
};

for (const [script, label] of collectors) {
  try {
    const result = await execFileAsync(process.execPath, [path.join(root, "scripts", script)], {
      cwd: root,
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    });
    report.collectors.push({ script, label, status: "ok", output: `${result.stdout || ""}${result.stderr || ""}`.trim().slice(-4000) });
  } catch (error) {
    report.collectors.push({ script, label, status: "error", output: `${error.stdout || ""}${error.stderr || ""}${error.message || error}`.trim().slice(-4000) });
  }
}

report.finishedAt = new Date().toISOString();
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const failed = report.collectors.filter((item) => item.status !== "ok");
console.log(JSON.stringify({ schedule: report.schedule, completed: report.collectors.length - failed.length, failed: failed.length }, null, 2));
