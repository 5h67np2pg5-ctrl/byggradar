import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectAllNationalProcurements } from "./national-procurement-adapters.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "public", "data", "national_projects.json");

const result = await collectAllNationalProcurements();
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Nasjonalt anskaffelsesgrunnlag: ${result.total} poster`);
for (const source of result.sources) console.log(`${source.source}: ${source.status} (${source.detail})`);
