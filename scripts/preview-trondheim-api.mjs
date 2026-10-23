import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTrondheimBuildingCases } from "./lib/trondheim-adapter.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "reports/trondheim-api-preview.json");
const report = await fetchTrondheimBuildingCases({ forceRefresh: true });
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, status: report.status, counts: report.counts, error: report.error }, null, 2));
if (report.status !== "ok") process.exitCode = 2;
