import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registerPath = path.join(root, "data", "google_ads_suppliers.json");
const snapshotPath = process.env.DIB_SNAPSHOT || "/tmp/sgregister-enterprises.json";
const regionId = process.env.NBR_IMPORT_REGION || "bergensregionen";
const localityConfigPath = path.join(root, "config", "dib-region-localities.json");

const normalize = (value) => String(value || "").toLocaleLowerCase("nb-NO").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const cleanOrg = (value) => String(value || "").replace(/\D/g, "").slice(0, 9);
const addressText = (address = {}) => [address.line_1, address.line_2, address.line_3, address.line_4, address.postal_code, address.postal_town].filter(Boolean).join(", ");

const localityConfig = JSON.parse(await fs.readFile(localityConfigPath, "utf8"));
const municipalityByTown = localityConfig[regionId] || {};
const regionTowns = new Set(Object.keys(municipalityByTown).map(normalize));
const municipalityFor = (town) => municipalityByTown[normalize(town)] || "";

const tradeFor = (areas) => {
  const text = normalize((areas || []).map((area) => area.subject_area).join(" "));
  if (/elektr|elkraft|automatis|brannalarm|ledesystem/.test(text)) return "Elektriker";
  if (/ror|vannforsyn|avlop|sanit|sprinkler/.test(text)) return "Rørlegger";
  if (/ventil|klima/.test(text)) return "Ventilasjon";
  if (/murer|mur|betong|flis|skorstein/.test(text)) return "Murer";
  if (/maler|overflate/.test(text)) return "Maler";
  if (/tak|tømrer|trearbeid|bygning/.test(text)) return "Snekker";
  if (/grunn|geotekn|landskap|veg|uteareal|anlegg/.test(text)) return "Grunnarbeid";
  if (/arkitekt|prosjekter|brannkonsept|konstruksjon/.test(text)) return "Prosjektering";
  return "Annet";
};

const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
const dibEnterprises = snapshot.enterprises || [];
const suppliers = JSON.parse(await fs.readFile(registerPath, "utf8"));
const existingOrgNumbers = new Set(suppliers.map((supplier) => cleanOrg(supplier.orgNumber)).filter(Boolean));
const regionRows = dibEnterprises.filter((enterprise) => regionTowns.has(normalize(enterprise.businessaddress?.postal_town)));
const regionByOrg = new Map(regionRows.map((enterprise) => [cleanOrg(enterprise.organizational_number), enterprise]));
const missing = regionRows.filter((enterprise) => {
  const orgNumber = cleanOrg(enterprise.organizational_number);
  return orgNumber && !existingOrgNumbers.has(orgNumber);
});

const collectedAt = new Date().toISOString();
const dibMetadata = (enterprise) => {
  const orgNumber = cleanOrg(enterprise.organizational_number);
  const approvalAreas = enterprise.valid_approval_areas || [];
  return {
    dibk: {
      approved: enterprise.status?.approved === true,
      approvalPeriodTo: enterprise.status?.approval_period_to || "",
      approvalCertificate: enterprise.status?.approval_certificate || `https://sgregister.dibk.no/enterprises/${orgNumber}/approval_certificate`,
      approvalAreas,
      educationalEnterpriseApproved: enterprise.additional_terms?.educational_enterprise_approved === true,
      liabilityInsurance: enterprise.additional_terms?.liability_insurance === true,
      industrialInjuryInsurance: enterprise.additional_terms?.industrial_injury_insurance === true,
    },
    dibSourceUrl: `https://sgregister.dibk.no/enterprises/${orgNumber}`,
    dibCheckedAt: collectedAt,
  };
};

const updatedExisting = suppliers.map((supplier) => {
  const enterprise = regionByOrg.get(cleanOrg(supplier.orgNumber));
  if (!enterprise) return supplier;
  const sources = [...new Set([
    ...(Array.isArray(supplier.sources) ? supplier.sources : []),
    supplier.source,
    "DIB",
  ].filter(Boolean))];
  return { ...supplier, sources, ...dibMetadata(enterprise) };
});

const imported = missing.map((enterprise) => {
  const orgNumber = cleanOrg(enterprise.organizational_number);
  const approvalAreas = enterprise.valid_approval_areas || [];
  const town = enterprise.businessaddress?.postal_town || "";
  return {
    name: enterprise.name || `Virksomhet ${orgNumber}`,
    trade: tradeFor(approvalAreas),
    address: addressText(enterprise.businessaddress),
    phone: enterprise.phone || "",
    email: enterprise.email || "",
    website: enterprise.www ? (/^https?:\/\//i.test(enterprise.www) ? enterprise.www : `https://${enterprise.www}`) : "",
    source: "DIB",
    sourceLabel: "DIB",
    sources: ["DIB"],
    sourceUrl: `https://sgregister.dibk.no/enterprises/${orgNumber}`,
    regionId,
    municipality: municipalityFor(town),
    orgNumber,
    description: `DiBK sentral godkjenning: ${approvalAreas.map((area) => area.subject_area).filter(Boolean).join(", ") || "godkjent virksomhet"}`,
    ...dibMetadata(enterprise),
    collectedAt,
  };
});

const merged = [...updatedExisting, ...imported];
await fs.writeFile(registerPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(root, "data", `dib-${regionId}-import-report.json`), `${JSON.stringify({
  generatedAt: collectedAt,
  regionId,
  sourceCandidates: regionRows.length,
  alreadyInRegister: regionRows.length - missing.length,
  updatedExisting: updatedExisting.filter((supplier, index) => supplier !== suppliers[index]).length,
  imported: imported.length,
  skippedBecauseAlreadyRegistered: missing.length ? regionRows.length - missing.length : regionRows.length,
  importedOrganizationNumbers: imported.map((row) => row.orgNumber),
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ regionId, sourceCandidates: regionRows.length, imported: imported.length, totalSuppliers: merged.length }, null, 2));
