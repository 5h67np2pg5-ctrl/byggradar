import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(root, file), "utf8"));
const manifest = await readJson("config/region-structure.json");
const sourceFiles = ["src/main.js", "public/sales/sales.js", "scripts/import-hp-suppliers.mjs"];
const sourceText = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, await fs.readFile(path.join(root, file), "utf8")])));
const failures = [];
const normalized = (value) => String(value).toLocaleLowerCase("nb-NO").replace(/\s+/g, " ").trim();

for (const region of manifest.regions) {
  const regionPath = path.join(root, "public", "data", "regions", region.id);
  for (const file of manifest.requiredProjectFiles) {
    try { await fs.access(path.join(regionPath, file)); } catch { failures.push(`${region.id}: mangler ${file}`); }
  }
  if (!sourceText["src/main.js"].includes(`id: "${region.id}"`)) failures.push(`${region.id}: mangler i /user`);
  if (!sourceText["public/sales/sales.js"].includes(`id: "${region.id}"`)) failures.push(`${region.id}: mangler i /sales`);
  if (!sourceText["scripts/import-hp-suppliers.mjs"].includes(`${region.id}: [`)) failures.push(`${region.id}: mangler i leverandørimport`);
  const municipalityLists = sourceFiles.map((file) => {
    const text = sourceText[file];
    return region.municipalities.filter((municipality) => text.includes(municipality)).map(normalized).sort();
  });
  const expected = [...new Set(region.municipalities.map(normalized))].sort();
  for (const [index, list] of municipalityLists.entries()) {
    if (JSON.stringify(list) !== JSON.stringify(expected)) failures.push(`${region.id}: kommuneliste avviker i ${sourceFiles[index]}`);
  }
}

const allMunicipalities = manifest.regions.flatMap((region) => region.municipalities.map(normalized));
const duplicates = allMunicipalities.filter((municipality, index) => allMunicipalities.indexOf(municipality) !== index);
if (duplicates.length) failures.push(`kommuner med dobbelt regiontilhørighet: ${[...new Set(duplicates)].join(", ")}`);

if (failures.length) {
  console.error("Regionstruktur: FEIL");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Regionstruktur OK: ${manifest.regions.length} regioner, ${allMunicipalities.length} kommunetilhørigheter og felles datafiler kontrollert.`);
}
