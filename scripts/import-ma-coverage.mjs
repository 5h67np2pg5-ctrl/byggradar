import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSupplierRegistry } from "./lib/supplier-registry.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");
const reportDir = path.join(root, "data", "ma-coverage-reports");
const regionId = "bergensregionen";
const regionName = "Bergensregionen";
const coverageMunicipality = "Øygarden kommune";
const maMunicipalityId = "3113";
const maQuery = `query PublicBusinessSearchV2($input: BusinessSearchV2Input!) { businessSearchV2(input: $input) { businesses { edges { node { id name addresses { place street postCode } } } pageInfo { totalCount hasNextPage } } } }`;
const maHeaders = {
  accept: "application/json",
  "content-type": "application/json",
  "accept-language": "nb-NO",
  "user-agent": "NorskByggRadar/1.0",
  "x-platform": "web",
  "x-application": "public",
  "x-version": "12.0.3",
};

const normalize = (value) => String(value || "")
  .toLocaleLowerCase("nb-NO")
  .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(aksjeselskap|allmennaksjeselskap|as|asa|ans|da|sa|nuf)\b/g, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const digits = (value) => String(value || "").replace(/\D/g, "");
const addressText = (address = {}) => [address.street, address.postCode, address.place].filter(Boolean).join(", ");
const brregAddressText = (address = {}) => [address.adresse?.join?.(", ") || address.adresse, address.postnummer, address.poststed].filter(Boolean).join(", ");
const identity = (row) => {
  const org = digits(row?.organizationNumber || row?.orgNumber);
  if (org) return `org:${org}`;
  return `name:${normalize(row?.name)}|address:${normalize(row?.address)}`;
};

async function loadMaSuppliers() {
  const rows = [];
  let page = 1;
  while (page <= 100) {
    const response = await fetch("https://mittanbud.no/graphql", {
      method: "POST",
      headers: maHeaders,
      body: JSON.stringify({
        operationName: "PublicBusinessSearchV2",
        query: maQuery,
        variables: { input: { pageSelect: { page, size: 50 }, municipalities: [maMunicipalityId] } },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    const businesses = payload.data?.businessSearchV2?.businesses;
    if (!businesses) throw new Error(payload.errors?.[0]?.message || "MA-søket returnerte ingen virksomhetsliste.");
    rows.push(...businesses.edges.map((edge) => edge.node).filter((row) => row?.id && row?.name));
    if (!businesses.pageInfo?.hasNextPage) break;
    page += 1;
  }
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

async function lookupBrreg(name) {
  const response = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(name)}&size=20`, {
    headers: { accept: "application/json", "user-agent": "NorskByggRadar/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return [];
  const payload = await response.json();
  return payload?._embedded?.enheter || [];
}

function scoreBrreg(item, row) {
  const targetName = normalize(row.name);
  const itemName = normalize(item.navn);
  const maAddress = normalize(addressText(row.addresses?.[0] || {}));
  const brregAddress = normalize(brregAddressText(item.forretningsadresse || {}));
  let score = itemName === targetName ? 6 : (itemName.includes(targetName) || targetName.includes(itemName) ? 3 : 0);
  if (maAddress && brregAddress && maAddress.split(" ").some((part) => part.length > 3 && brregAddress.includes(part))) score += 1;
  if (digits(row.addresses?.[0]?.postCode) && digits(item.forretningsadresse?.postnummer) === digits(row.addresses?.[0]?.postCode)) score += 2;
  return score;
}

const nbr = JSON.parse(await fs.readFile(registerPath, "utf8"));
const nbrNames = new Set(nbr.map((row) => normalize(row.name)).filter(Boolean));
const nbrOrganizations = new Set(nbr.map((row) => digits(row.organizationNumber || row.orgNumber)).filter(Boolean));
const maRows = await loadMaSuppliers();
const nameCandidates = maRows.filter((row) => !nbrNames.has(normalize(row.name)));
const checked = [];
let cursor = 0;
const workers = Array.from({ length: 6 }, async () => {
  while (cursor < nameCandidates.length) {
    const row = nameCandidates[cursor++];
    const items = await lookupBrreg(row.name).catch(() => []);
    const best = items.map((item) => ({ item, score: scoreBrreg(item, row) })).sort((a, b) => b.score - a.score)[0];
    const org = best?.item?.organisasjonsnummer || "";
    checked.push({ row, item: best?.item || null, score: best?.score || 0, organizationNumber: org, alreadyInNbr: Boolean(org && nbrOrganizations.has(org)) });
  }
});
await Promise.all(workers);

const confirmedNew = checked.filter((entry) => entry.item && entry.score >= 6 && !entry.alreadyInNbr);
const review = checked.filter((entry) => !confirmedNew.includes(entry) && !entry.alreadyInNbr);
const existingByOrganization = checked.filter((entry) => entry.alreadyInNbr);
const merged = new Map(nbr.map((row) => [identity(row), row]));
for (const entry of confirmedNew) {
  const brreg = entry.item;
  const address = brregAddressText(brreg.forretningsadresse || {}) || addressText(entry.row.addresses?.[0] || {});
  const municipality = brreg.forretningsadresse?.kommune ? `${brreg.forretningsadresse.kommune} kommune` : "";
  const row = {
    name: brreg.navn || entry.row.name,
    address,
    organizationNumber: entry.organizationNumber,
    municipality,
    regionId,
    regionName,
    coverageMunicipalities: [coverageMunicipality],
    trade: "Fagområde ikke oppgitt",
    source: "MA",
    sourceLabel: "MA",
    sources: ["MA"],
    sourceUrl: `https://mittanbud.no/bedrift/${encodeURIComponent(entry.row.id)}`,
    website: `https://mittanbud.no/bedrift/${encodeURIComponent(entry.row.id)}`,
    collectedAt: new Date().toISOString(),
  };
  merged.set(identity(row), row);
}

await fs.mkdir(reportDir, { recursive: true });
await writeSupplierRegistry(registerPath, [...merged.values()]);
await fs.writeFile(path.join(reportDir, "oygarden-latest.json"), `${JSON.stringify({
  municipality: coverageMunicipality,
  municipalityId: maMunicipalityId,
  maUnique: maRows.length,
  nameCandidates: nameCandidates.length,
  imported: confirmedNew.length,
  existingByOrganization: existingByOrganization.length,
  review: review.length,
  reviewCandidates: review.map((entry) => ({
    name: entry.row.name,
    address: addressText(entry.row.addresses?.[0] || {}),
    brregName: entry.item?.navn || "",
    brregAddress: brregAddressText(entry.item?.forretningsadresse || {}),
    organizationNumber: entry.organizationNumber,
    score: entry.score,
  })),
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ municipality: coverageMunicipality, maUnique: maRows.length, nameCandidates: nameCandidates.length, imported: confirmedNew.length, existingByOrganization: existingByOrganization.length, review: review.length, registerTotal: merged.size, report: "data/ma-coverage-reports/oygarden-latest.json" }, null, 2));
