import fs from "node:fs/promises";
import { writeSupplierRegistry } from "./lib/supplier-registry.mjs";

const registerPath = "data/google_ads_suppliers.json";
const region = {
  id: "stavangerregionen",
  name: "Stavangerregionen",
  municipalities: ["Stavanger kommune", "Sandnes kommune", "Sola kommune", "Randaberg kommune", "Klepp kommune", "Time kommune", "Hå kommune", "Gjesdal kommune", "Strand kommune", "Kvitsøy kommune", "Hjelmeland kommune", "Bjerkreim kommune", "Eigersund kommune", "Suldal kommune", "Lund kommune", "Sokndal kommune"],
};
const headers = { accept: "application/json", "content-type": "application/json", "accept-language": "nb-NO", "user-agent": "NorskByggRadar/1.0", "x-platform": "web", "x-application": "public", "x-version": "12.0.3" };
const query = `query PublicBusinessSearchV2($input: BusinessSearchV2Input!) { businessSearchV2(input: $input) { businesses { edges { node { id name addresses { place street postCode } } } pageInfo { totalCount hasNextPage } } } }`;
const normalize = (value) => String(value || "").toLocaleLowerCase("nb-NO").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(kommune|herad|aksjeselskap|allmennaksjeselskap|as|asa|ans|da|sa|nuf)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const digits = (value) => String(value || "").replace(/\D/g, "");
const addressText = (row) => [row?.street, row?.postCode, row?.place].filter(Boolean).join(", ");
const brregAddress = (row) => [row?.adresse?.join?.(", ") || row?.adresse, row?.postnummer, row?.poststed].filter(Boolean).join(", ");

async function loadDirectory() {
  const html = await (await fetch("https://mittanbud.no/bedriftsok", { headers: { accept: "text/html", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) })).text();
  const values = new Map();
  const pattern = /id\\?":\\?"(\d+)\\?",\\?"name\\?":\\?"([^"\\]+)\\?",\\?"code\\?":(\d+)/g;
  let match;
  while ((match = pattern.exec(html))) values.set(normalize(match[2]), match[1]);
  console.error(`Mittanbud kommune-ID-er funnet: ${values.size}`);
  return values;
}

async function loadMunicipality(id) {
  const rows = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await fetch("https://mittanbud.no/graphql", { method: "POST", headers, body: JSON.stringify({ operationName: "PublicBusinessSearchV2", query, variables: { input: { pageSelect: { page, size: 50 }, municipalities: [id] } } }), signal: AbortSignal.timeout(20000) });
    const payload = await response.json();
    const businesses = payload.data?.businessSearchV2?.businesses;
    if (!businesses) throw new Error(payload.errors?.[0]?.message || "MA svarte uten virksomhetsliste");
    rows.push(...businesses.edges.map((edge) => edge.node).filter((row) => row?.id && row?.name));
    if (!businesses.pageInfo?.hasNextPage) break;
  }
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

const directory = await loadDirectory();
const municipalityIds = region.municipalities.map((name) => ({ name, id: directory.get(normalize(name)) })).filter((item) => item.id);
const missing = region.municipalities.filter((name) => !directory.has(normalize(name)));
const byId = new Map();
const perMunicipality = {};
for (const municipality of municipalityIds) {
  const rows = await loadMunicipality(municipality.id);
  perMunicipality[municipality.name] = rows.length;
  for (const row of rows) byId.set(row.id, row);
}

const nbr = JSON.parse(await fs.readFile(registerPath, "utf8"));
const nbrNames = new Set(nbr.map((row) => normalize(row.name)).filter(Boolean));
const nbrOrganizations = new Set(nbr.map((row) => digits(row.organizationNumber || row.orgNumber)).filter(Boolean));
const candidates = [...byId.values()].filter((row) => !nbrNames.has(normalize(row.name)));
const checked = [];
let cursor = 0;
async function lookup(name) {
  const response = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(name)}&size=20`, { headers: { accept: "application/json", "user-agent": "NorskByggRadar/1.0" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) return [];
  return (await response.json())?._embedded?.enheter || [];
}
const workers = Array.from({ length: 6 }, async () => {
  while (cursor < candidates.length) {
    const row = candidates[cursor++];
    const items = await lookup(row.name).catch(() => []);
    const target = normalize(row.name);
    const best = items.map((item) => ({ item, score: normalize(item.navn) === target ? 6 : 0 })).sort((a, b) => b.score - a.score)[0];
    const org = best?.item?.organisasjonsnummer || "";
    checked.push({ row, item: best?.item || null, score: best?.score || 0, org, alreadyInNbr: Boolean(org && nbrOrganizations.has(org)) });
  }
});
await Promise.all(workers);
const confirmedNew = checked.filter((entry) => entry.item && entry.score >= 6 && !entry.alreadyInNbr);
const review = checked.filter((entry) => !confirmedNew.includes(entry) && !entry.alreadyInNbr);
const hasAddressMatch = (entry) => {
  const ma = entry.row.addresses?.[0] || {};
  const br = entry.item?.forretningsadresse || {};
  const postcode = digits(ma.postCode) && digits(ma.postCode) === digits(br.postnummer);
  const street = normalize(ma.street) && normalize(br.adresse?.join?.(" ") || br.adresse).includes(normalize(ma.street));
  return postcode || street;
};
const addressMatchedNew = confirmedNew.filter(hasAddressMatch);
const addressMatches = addressMatchedNew.length;
const report = {
  region: region.name,
  municipalities: municipalityIds.length,
  missingMunicipalities: missing,
  perMunicipality,
  maUniqueAcrossRegion: byId.size,
  alreadyInNbrByName: byId.size - candidates.length,
  newConfirmedByBrreg: confirmedNew.length,
  newWithOrganizationNumber: confirmedNew.filter((entry) => Boolean(entry.org)).length,
  newWithBrregAddress: confirmedNew.filter((entry) => Boolean(brregAddress(entry.item?.forretningsadresse || {}))).length,
  newWithMatchingAddressOrPostcode: addressMatches,
  alreadyInNbrByOrganization: checked.filter((entry) => entry.alreadyInNbr).length,
  review: review.length,
  reviewCandidates: review.map((entry) => ({ name: entry.row.name, address: addressText(entry.row.addresses?.[0] || {}), brregName: entry.item?.navn || "", brregAddress: brregAddress(entry.item?.forretningsadresse || {}), organizationNumber: entry.org, score: entry.score })),
  confirmedNew: confirmedNew.map((entry) => ({ name: entry.row.name, maAddress: addressText(entry.row.addresses?.[0] || {}), brregName: entry.item.navn, brregAddress: brregAddress(entry.item.forretningsadresse || {}), organizationNumber: entry.org })),
  note: "Ingen virksomheter ble importert; dette er kun kontroll.",
};
if (process.env.IMPORT_SR === "1") {
  const registerPath = "data/google_ads_suppliers.json";
  const current = JSON.parse(await fs.readFile(registerPath, "utf8"));
  const identity = (row) => {
    const org = digits(row.organizationNumber || row.orgNumber);
    return org ? `org:${org}` : `name:${normalize(row.name)}`;
  };
  const merged = new Map(current.map((row) => [identity(row), row]));
  let imported = 0;
  for (const entry of addressMatchedNew) {
    const brreg = entry.item;
    const row = {
      name: brreg.navn || entry.row.name,
      address: brregAddress(brreg.forretningsadresse || {}) || addressText(entry.row.addresses?.[0] || {}),
      organizationNumber: entry.org,
      municipality: brreg.forretningsadresse?.kommune ? `${brreg.forretningsadresse.kommune} kommune` : "",
      regionId: region.id,
      regionName: region.name,
      coverageMunicipalities: region.municipalities,
      trade: "Fagområde ikke oppgitt",
      source: "MA",
      sourceLabel: "MA",
      sources: ["MA"],
      sourceUrl: `https://mittanbud.no/bedrift/${encodeURIComponent(entry.row.id)}`,
      website: `https://mittanbud.no/bedrift/${encodeURIComponent(entry.row.id)}`,
      collectedAt: new Date().toISOString(),
    };
    const key = identity(row);
    if (!merged.has(key)) { merged.set(key, row); imported += 1; }
  }
  await writeSupplierRegistry(registerPath, [...merged.values()]);
  report.imported = imported;
  report.note = "211 adresse-/postnummersamsvarende virksomheter ble importert; avvikskandidater ble ikke importert.";
}
await fs.writeFile("data/ma-coverage-reports/stavangerregionen-latest.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, confirmedNew: undefined }, null, 2));
