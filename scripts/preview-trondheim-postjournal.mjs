import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTrondheimPostjournalCases } from "./lib/trondheim-postjournal-adapter.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "reports/trondheim-postjournal-preview.json");
const report = await fetchTrondheimPostjournalCases();
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, status: report.status, dateWindow: report.dateWindow, counts: report.counts, examples: report.projects.slice(0, 5) }, null, 2));
