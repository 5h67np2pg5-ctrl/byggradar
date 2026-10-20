import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");
const seedSources = [
  ["bergensregionen", "Bergen kommune", "tomrer", "Snekker"],
  ["bergensregionen", "Bergen kommune", "elektriker", "Elektriker"],
  ["bergensregionen", "Bergen kommune", "rorlegger", "Rørlegger"],
  ["bergensregionen", "Bergen kommune", "ventilasjon", "Ventilasjon"],
  ["bergensregionen", "Bergen kommune", "murer", "Murer"],
  ["bergensregionen", "Bergen kommune", "grunnarbeid", "Grunnarbeid"],
  ["bergensregionen", "Bergen kommune", "tak", "Tak"],
  ["bergensregionen", "Bergen kommune", "maler", "Maler"],
  ["bergensregionen", "Bergen kommune", "taklegger", "Taklegger"],
  ["bergensregionen", "Bergen kommune", "gulvlegger", "Gulvlegger"],
  ["bergensregionen", "Bergen kommune", "varmepumpe", "Varmepumpemontør"],
  ["bergensregionen", "Bergen kommune", "byggmester", "Byggmester"],
  ["bergensregionen", "Askøy kommune", "tomrer", "Snekker"],
  ["bergensregionen", "Askøy kommune", "rorlegger", "Rørlegger"],
  ["bergensregionen", "Bjørnafjorden kommune", "rorlegger", "Rørlegger"],
  ["bergensregionen", "Øygarden kommune", "tomrer", "Snekker"],
];

const regionMunicipalities = {
  bergensregionen: ["Bergen kommune", "Askøy kommune", "Øygarden kommune", "Bjørnafjorden kommune", "Osterøy kommune", "Alver kommune", "Samnanger kommune", "Vaksdal kommune", "Austevoll kommune", "Kvam herad", "Voss herad", "Modalen kommune", "Masfjorden kommune", "Austrheim kommune", "Fedje kommune", "Gulen kommune", "Tysnes kommune"],
  stavangerregionen: ["Stavanger kommune", "Sandnes kommune", "Sola kommune", "Randaberg kommune", "Klepp kommune", "Time kommune", "Hå kommune", "Gjesdal kommune", "Strand kommune", "Kvitsøy kommune", "Hjelmeland kommune", "Bjerkreim kommune", "Eigersund kommune", "Suldal kommune", "Sirdal kommune", "Lund kommune", "Sokndal kommune"],
  haugalandsregionen: ["Kvinnherad kommune", "Stord kommune", "Fitjar kommune", "Bømlo kommune", "Sveio kommune", "Haugesund kommune", "Karmøy kommune", "Tysvær kommune", "Bokn kommune", "Utsira kommune", "Vindafjord kommune", "Etne kommune", "Sauda kommune"],
  grenlandsregionen: ["Skien kommune", "Porsgrunn kommune", "Bamble kommune", "Notodden kommune", "Midt-Telemark kommune", "Kragerø kommune", "Nome kommune", "Tinn kommune", "Drangedal kommune", "Vinje kommune", "Seljord kommune", "Kviteseid kommune", "Siljan kommune", "Tokke kommune", "Hjartdal kommune", "Nissedal kommune", "Fyresdal kommune"],
  sorlandsregionen: ["Kristiansand kommune", "Lindesnes kommune", "Vennesla kommune", "Lillesand kommune", "Lyngdal kommune", "Farsund kommune", "Flekkefjord kommune", "Kvinesdal kommune", "Birkenes kommune", "Sirdal kommune", "Hægebostad kommune", "Iveland kommune"],
  vestfoldkongsbergregionen: ["Drammen kommune", "Sandefjord kommune", "Tønsberg kommune", "Larvik kommune", "Horten kommune", "Holmestrand kommune", "Lier kommune", "Kongsberg kommune", "Færder kommune", "Øvre Eiker kommune"],
};
const supportedTrades = [
  ["tomrer", "Snekker"], ["elektriker", "Elektriker"], ["rorlegger", "Rørlegger"], ["ventilasjon", "Ventilasjon"],
  ["murer", "Murer"], ["grunnarbeid", "Grunnarbeid"], ["maler", "Maler"], ["taklegger", "Taklegger"],
  ["gulvlegger", "Gulvlegger"], ["varmepumpe", "Varmepumpemontør"], ["byggmester", "Byggmester"],
];
const slugMunicipality = (name) => name.replace(/ kommune| herad/gi, "").toLocaleLowerCase("nb-NO").replace(/å/g, "a").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/[^a-z0-9]/g, "");
const allSources = Object.entries(regionMunicipalities).flatMap(([regionId, municipalities]) => municipalities.flatMap((municipality) => supportedTrades.map(([slug, trade]) => [regionId, municipality, slug, trade])));
const regionFilter = String(process.env.NBR_IMPORT_REGION || "").trim().toLocaleLowerCase("nb-NO");
const sources = process.argv.includes("--all") ? allSources.filter(([regionId]) => !regionFilter || regionId === regionFilter) : seedSources;

const headers = { accept: "text/html,application/xhtml+xml", "user-agent": "NorskByggRadar/1.0 (organic supplier import)" };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const strip = (value) => String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const keyOf = (row) => String(row.orgNumber || row.website || row.name).toLocaleLowerCase("nb-NO").trim();

async function jsonLd(html) {
  const found = [];
  for (const match of String(html).matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { found.push(JSON.parse(match[1])); } catch { /* Ugyldig JSON-LD ignoreres. */ }
  }
  return found;
}

async function fetchText(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) return "";
  return response.text();
}

async function importSource([regionId, municipality, slug, trade]) {
  const listingUrl = `https://haandverkerportalen.no/${slug}/${slugMunicipality(municipality)}`;
  let html = "";
  try {
    html = await fetchText(listingUrl);
  } catch (error) {
    console.warn(`Hoppet over kilde ${listingUrl}: ${error.message || error}`);
  }
  if (!html) return { listingUrl, rows: [] };
  const lists = (await jsonLd(html)).find((item) => item?.["@type"] === "ItemList" && Array.isArray(item.itemListElement));
  const jsonEntries = lists?.itemListElement || [];
  const linkedEntries = [...html.matchAll(/href=["'](https:\/\/haandverkerportalen\.no\/bedrift\/[^"'#?]+)["']/gi)].map((match) => ({ url: match[1] }));
  const entries = [...new Map([...jsonEntries, ...linkedEntries].map((entry) => [String(entry.url || entry.item || ""), entry])).values()];
  const rows = [];
  for (let index = 0; index < entries.length; index += 8) {
    const batch = entries.slice(index, index + 8);
    const details = await Promise.all(batch.map(async (entry) => {
      try {
        const website = String(entry.url || entry.item || "");
        if (!/^https?:\/\//i.test(website)) return null;
        const detailHtml = await fetchText(website);
        const business = (await jsonLd(detailHtml)).find((item) => item?.["@type"] === "HomeAndConstructionBusiness") || {};
        const address = business.address || {};
        return {
          name: business.name || entry.name,
          trade,
          address: [address.streetAddress, address.postalCode, address.addressLocality].filter(Boolean).join(", "),
          phone: String(business.telephone || "").trim(),
          email: "",
          website,
          source: "HP",
          sourceLabel: "HP",
          sourceUrl: listingUrl,
          regionId,
          municipality,
          orgNumber: String(business.identifier || business.taxID || "").trim(),
          description: `Fagområde hentet fra Håndverkerportalen: ${trade}`,
          collectedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.warn(`Hoppet over virksomhet fra ${listingUrl}: ${error.message || error}`);
        return null;
      }
    }));
    rows.push(...details.filter((row) => row && row.name));
    await delay(150);
  }
  return { listingUrl, rows };
}

const existing = JSON.parse(await fs.readFile(registerPath, "utf8").catch(() => "[]"));
const merged = new Map(existing.map((row) => [keyOf(row), row]));
let imported = 0;
for (let index = 0; index < sources.length; index += 3) {
  const batch = sources.slice(index, index + 3);
  const results = await Promise.all(batch.map((source) => importSource(source)));
  results.forEach((result, resultIndex) => {
    const source = batch[resultIndex];
    result.rows.forEach((row) => { merged.set(keyOf(row), row); imported += 1; });
    console.log(`${source[1]} · ${source[3]}: ${result.rows.length} oppføringer (${result.listingUrl})`);
  });
  await fs.mkdir(path.dirname(registerPath), { recursive: true });
  await fs.writeFile(registerPath, `${JSON.stringify([...merged.values()], null, 2)}\n`, "utf8");
}
await fs.mkdir(path.dirname(registerPath), { recursive: true });
await fs.writeFile(registerPath, `${JSON.stringify([...merged.values()], null, 2)}\n`, "utf8");
console.log(`Importert: ${imported}. Unike i registeret: ${merged.size}.`);
