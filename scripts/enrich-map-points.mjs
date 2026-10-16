import fs from "node:fs/promises";

const regions = ["bergensregionen", "stavangerregionen", "haugalandsregionen"];
const municipalityNumbers = {
  bergen: "4601", tysnes: "4616", voss: "4621", kvam: "4622", samnanger: "4623",
  bjørnafjorden: "4624", austevoll: "4625", øygarden: "4626", askøy: "4627", vaksdal: "4628",
  modalen: "4629", osterøy: "4630", alver: "4631", austrheim: "4632", fedje: "4633",
  masfjorden: "4634", gulen: "4635", kvinnherad: "4617", stord: "4614", fitjar: "4615",
  bømlo: "4613", sveio: "4612", haugesund: "1106", karmøy: "1149", tysvær: "1146",
  bokn: "1145", utsira: "1151", vindafjord: "1160", etne: "4611", sauda: "1135",
  stavanger: "1103", sandnes: "1108", sola: "1124", randaberg: "1127", klepp: "1120",
  time: "1121", hå: "1119", gjesdal: "1122", strand: "1130", kvitsøy: "1144",
  hjelmeland: "1133", bjerkreim: "1114", eigersund: "1101", suldal: "1134", sirdal: "4228",
  lund: "1112", sokndal: "1111",
};

const streetPattern = /\b([A-ZÆØÅ][\p{L}.'-]*(?:\s+[A-ZÆØÅ][\p{L}.'-]*)*\s+(?:vegen|veien|veg|vei|gata|gate|gaten|plassen|bakken|haugen|lia|marka|åsen|stien|tunet|hagen|holmen|myra|odden|berget|toppen|jordet))\s+(\d+[A-Za-z]?)\b/iu;

function municipalityName(value) {
  return String(value || "")
    .toLocaleLowerCase("nb-NO")
    .replace(/\b(kommune|herad)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addressCandidate(project) {
  const explicit = [project.address, project.locationEnrichment?.address]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .find((value) => value && /\d/.test(value) && !/\b(gbnr|gnr|bnr|matrikkel|s\.?nr\.?|seksjonsnummer|tiltak på|godkjent|søknad om)\b/i.test(value));
  if (explicit) return explicit.split("|")[0].trim();
  for (const value of [project.caseTitle, project.shortFacts, project.documentTitle, project.title, project.description]) {
    const match = String(value || "").match(streetPattern);
    if (match) return match[0];
  }
  return "";
}

function matrikkel(project) {
  const value = project.matrikkel || [project.gnr, project.bnr, project.fnr, project.snr].filter(Boolean).join("/");
  const match = String(value || "").match(/^(\d+)\s*\/\s*(\d+)(?:\s*\/\s*(\d+))?(?:\s*\/\s*(\d+))?/);
  return match ? { gnr: match[1], bnr: match[2], fnr: match[3] && match[3] !== "0" ? match[3] : "", unr: match[4] && match[4] !== "0" ? match[4] : "" } : null;
}

function queries(project) {
  const kommunenummer = municipalityNumbers[municipalityName(project.municipality)] || "";
  const address = addressCandidate(project);
  const list = [];
  if (address) list.push({ sok: `${address} ${municipalityName(project.municipality)}`.trim(), kommunenummer });
  const property = matrikkel(project);
  if (property && kommunenummer) list.push({ kommunenummer, gardsnummer: property.gnr, bruksnummer: property.bnr, festenummer: property.fnr, undernummer: property.unr });
  return list;
}

async function lookup(query) {
  const params = new URLSearchParams({ ...query, treffPerSide: "1", utkoordsys: "4258", filtrer: "adresser.representasjonspunkt" });
  const response = await fetch(`https://api.kartverket.no/adresser/v1/sok?${params}`);
  if (!response.ok) return null;
  const payload = await response.json();
  const address = payload.adresser?.[0];
  const point = address?.representasjonspunkt;
  if (!point?.lat || !point?.lon) return null;
  return { latitude: Number(point.lat), longitude: Number(point.lon), mapLabel: "Kart", address: address.adressetekst || "", addressSource: "Kartverket Adresse-API", coordinateSystem: "EPSG:4258", lookupStatus: "adresse/matrikkel slått opp i Kartverket" };
}

async function enrich(project) {
  if (project.locationEnrichment?.hasMapPoint && Number.isFinite(Number(project.locationEnrichment.latitude)) && Number.isFinite(Number(project.locationEnrichment.longitude))) return false;
  for (const query of queries(project)) {
    try {
      const result = await lookup(query);
      if (result) {
        project.locationEnrichment = { ...(project.locationEnrichment || {}), hasMapPoint: true, ...result };
        if (!project.address && result.address) project.address = result.address;
        return true;
      }
    } catch (error) {
      console.warn("Kartverket-oppslag feilet", project.sourceDocumentId, error.message);
    }
  }
  return false;
}

async function run() {
  for (const region of regions) {
    const file = `public/data/regions/${region}/projects_location_enriched.json`;
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const projects = data.projects || [];
    let attempted = 0;
    let enriched = 0;
    for (let index = 0; index < projects.length; index += 12) {
      const batch = projects.slice(index, index + 12).filter((project) => !(project.locationEnrichment?.hasMapPoint));
      attempted += batch.length;
      const results = await Promise.all(batch.map(enrich));
      enriched += results.filter(Boolean).length;
    }
    await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
    const exact = projects.filter((project) => project.locationEnrichment?.hasMapPoint).length;
    console.log(`${region}: forsøkt ${attempted}, nye ${enriched}, eksakte ${exact}/${projects.length}, mangler ${projects.length - exact}`);
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
