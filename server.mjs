import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const residentialBuildingTypes = [
  "111", "112", "113", "121", "122", "123", "124", "131", "133", "135", "136",
  "141", "142", "143", "144", "145", "146", "151", "152", "159",
];
const ssbMetadataCache = new Map();
const ssbYearCache = new Map();
const ssbTableCache = new Map();

const supplierSearchPatterns = {
  byggevarehus: "Biltema|Optimera|Monter|Montér|Byggmakker|XL-BYGG|Obs BYGG|Maxbo|Bygger'n|Bauhaus",
  elektrogrossist: "Ahlsell|Solar|Onninen|Rexel|Elektroimportøren|Elektroimportoren|Berggård Amundsen|Berggard Amundsen",
  "vvs-grossist": "Brødrene Dahl|Broedrene Dahl|Ahlsell|Heidenreich|VVS Eksperten|VVSeksperten",
  "verktøy-maskinutleie": "Würth|Wurth|Motek|Ramirent|Renta|Cramo|Tools|TOOLS",
  "betong-pukk-grus": "NorBetong|Unicon|Veidekke|Franzefoss|NCC|Skanska",
  "transport-kran-container": "Norsk Gjenvinning|Ragn-Sells|Renta|Cramo|Bring|Litra",
  "arbeidstoy-verneutstyr": "TOOLS|Ahlsell|Wenaas|Mascot|Proffklær|Proffklaer|Würth|Wurth",
};
const supplierSearchTerms = {
  byggevarehus: ["Biltema", "Optimera", "Montér", "Byggmakker", "XL-BYGG", "Obs BYGG", "Maxbo"],
  elektrogrossist: ["Ahlsell", "Solar", "Onninen", "Rexel", "Elektroimportøren"],
  "vvs-grossist": ["Brødrene Dahl", "Ahlsell", "Heidenreich", "VVS Eksperten"],
  "verktøy-maskinutleie": ["Würth", "Motek", "Ramirent", "Renta", "Cramo", "TOOLS"],
  "betong-pukk-grus": ["NorBetong", "Unicon", "Veidekke", "Franzefoss", "NCC"],
  "transport-kran-container": ["Norsk Gjenvinning", "Ragn-Sells", "Renta", "Cramo", "Bring", "Litra"],
  "arbeidstoy-verneutstyr": ["TOOLS", "Ahlsell", "Wenaas", "Mascot", "Proffklær", "Würth"],
};

function distanceBetweenCoordinates(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const latitudeDelta = (lat2 - lat1) * Math.PI / 180;
  const longitudeDelta = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hashString(value) {
  return [...String(value)].reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0);
}

function supplierResult(category, name, lat, lon, centerLat, centerLon, website = "") {
  return {
    id: `${category}-${name}-${lat.toFixed(5)}-${lon.toFixed(5)}`,
    company: name,
    category,
    lat,
    lon,
    distanceKm: distanceBetweenCoordinates(centerLat, centerLon, lat, lon),
    discountPercent: [15, 22, 30, 18, 26][Math.abs(hashString(name)) % 5],
    website,
  };
}

async function fallbackNominatimSuppliers(category, lat, lon) {
  const delta = 0.6;
  const viewbox = `${lon - delta},${lat + delta},${lon + delta},${lat - delta}`;
  const terms = supplierSearchTerms[category] || [];
  const results = [];
  for (const term of terms) {
    const query = new URLSearchParams({ q: term, format: "jsonv2", limit: "5", bounded: "1", viewbox, addressdetails: "1" });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
      headers: { accept: "application/json", "user-agent": "NorskByggRadar/1.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) continue;
    const places = await response.json();
    for (const place of places) {
      const placeLat = Number(place.lat);
      const placeLon = Number(place.lon);
      const name = String(place.name || place.display_name?.split(",")[0] || "").trim();
      if (!name || !Number.isFinite(placeLat) || !Number.isFinite(placeLon)) continue;
      results.push(supplierResult(category, name, placeLat, placeLon, lat, lon));
    }
  }
  return results;
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (url.pathname === "/api/geocode") {
      const allowedKeys = [
        "sok",
        "kommunenummer",
        "gardsnummer",
        "bruksnummer",
        "festenummer",
        "undernummer",
        "treffPerSide",
        "utkoordsys",
        "filtrer",
      ];
      const query = new URLSearchParams();
      allowedKeys.forEach((key) => {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      });
      const kartverket = await fetch(`https://api.kartverket.no/adresser/v1/sok?${query}`);
      const body = await kartverket.text();
      response.writeHead(kartverket.status, {
        "content-type": kartverket.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(body);
      return;
    }

    if (url.pathname === "/api/nearby-suppliers") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      const category = String(url.searchParams.get("category") || "");
      const searchPattern = supplierSearchPatterns[category];
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !searchPattern) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Ugyldig søkepunkt eller leverandørkategori" }));
        return;
      }
      try {
        const seen = new Map();
        let successfulSearch = false;
        const overpassEndpoints = [
          "https://overpass-api.de/api/interpreter",
          "https://overpass.kumi.systems/api/interpreter",
          "https://overpass.private.coffee/api/interpreter",
        ];
        // Søk trinnvis slik at nære treff alltid får prioritet foran treff
        // som bare finnes fordi søkeområdet ble satt til 50 km.
        for (const radius of [10000, 25000, 50000]) {
          const safeLat = lat.toFixed(6);
          const safeLon = lon.toFixed(6);
          const query = `[out:json][timeout:20];(nwr(around:${radius},${safeLat},${safeLon})["name"~"${searchPattern}",i];${category === "byggevarehus" ? `nwr(around:${radius},${safeLat},${safeLon})["shop"~"doityourself|hardware|trade",i];` : ""});out center tags;`;
          for (const endpoint of overpassEndpoints) {
            try {
              const overpass = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
                headers: { accept: "application/json", "user-agent": "NorskByggRadar/1.0" },
                signal: AbortSignal.timeout(9000),
              });
              if (!overpass.ok) continue;
              successfulSearch = true;
              const payload = await overpass.json();
              (payload.elements || []).forEach((element) => {
                const point = element.type === "node"
                  ? { lat: element.lat, lon: element.lon }
                  : { lat: element.center?.lat, lon: element.center?.lon };
                const name = String(element.tags?.name || "").trim();
                if (!name || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;
                const key = `${name.toLowerCase()}|${point.lat.toFixed(5)}|${point.lon.toFixed(5)}`;
                if (seen.has(key)) return;
                const distanceKm = distanceBetweenCoordinates(lat, lon, point.lat, point.lon);
                seen.set(key, {
                  id: `${category}-${element.type}-${element.id}`,
                  company: name,
                  category,
                  lat: point.lat,
                  lon: point.lon,
                  distanceKm,
                  discountPercent: [15, 22, 30, 18, 26][Math.abs(hashString(name)) % 5],
                  website: element.tags?.website || element.tags?.contact_website || "",
                });
              });
              if (seen.size >= 4) break;
            } catch {
              // Prøv neste Overpass-tjeneste før Nominatim-fallback.
            }
          }
          if (seen.size >= 4) break;
        }
        if (!successfulSearch) throw new Error("Stedsøket svarte uten gyldig resultat");
        const suppliers = [...seen.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 4);
        if (!suppliers.length) throw new Error("Stedsøket ga ingen leverandører");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ suppliers, source: "OpenStreetMap/Overpass", center: { lat, lon } }));
      } catch (error) {
        try {
          const fallbackResults = await fallbackNominatimSuppliers(category, lat, lon);
          const unique = new Map();
          fallbackResults.forEach((supplier) => {
            const key = `${supplier.company.toLowerCase()}|${supplier.lat.toFixed(5)}|${supplier.lon.toFixed(5)}`;
            if (!unique.has(key)) unique.set(key, supplier);
          });
          const suppliers = [...unique.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 4);
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end(JSON.stringify({ suppliers, source: "OpenStreetMap/Nominatim", center: { lat, lon } }));
        } catch (fallbackError) {
          response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Leverandørsøket kunne ikke hentes nå.", detail: fallbackError.message || error.message }));
        }
      }
      return;
    }

    if (url.pathname === "/api/ai-phone-search") {
      const subject = String(url.searchParams.get("q") || "").trim().slice(0, 180);
      if (!subject || /^(telefon(?:nummer)?\s+(?:ikke funnet|ble ikke funnet)|ukjent|aktør)$/i.test(subject)) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Mangler søkeord" }));
        return;
      }

      const query = `Finn telefonnummer til "${subject}"`;
      const searchUrls = [
        `https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`,
      ];
      let plainText = "";
      let firstPhone = "";
      let phones = [];
      for (const searchUrl of searchUrls) {
        let candidateText = "";
        try {
          const searchResponse = await fetch(searchUrl, {
            headers: {
              accept: "text/html,application/xhtml+xml",
              "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
            },
          });
          if (!searchResponse.ok) continue;
          candidateText = decodeHtmlEntities(stripHtml(await searchResponse.text())).replace(/\s+/g, " ").trim();
        } catch {
          continue;
        }
        if (/unusual traffic|not a robot|captcha|robots are known|solve the captcha|søket ble midlertidig stoppet/i.test(candidateText)) continue;
        const candidatePhones = extractNorwegianPhones(candidateText, subject);
        if (candidatePhones.length) {
          plainText = candidateText;
          phones = candidatePhones;
          firstPhone = candidatePhones[0];
          break;
        }
        if (!plainText) plainText = candidateText;
      }
      const phoneIndex = firstPhone ? plainText.indexOf(firstPhone) : -1;
      const context = phoneIndex >= 0
        ? plainText.slice(Math.max(0, phoneIndex - 180), Math.min(plainText.length, phoneIndex + 260)).trim()
        : "Telefonnummer ble ikke funnet i søkeresultatene.";

      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({
        query,
        phone: firstPhone,
        phones,
        info: firstPhone ? context : "",
        source: "AI-søk",
      }));
      return;
    }

    if (url.pathname === "/api/ssb-statistics") {
      const requestedMunicipalities = url.searchParams.get("kommunenumre") || url.searchParams.get("kommunenummer") || "";
      const municipalityNumbers = [...new Set(requestedMunicipalities.split(",").map((value) => value.replace(/\D/g, "").slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))];
      const municipalityNumber = municipalityNumbers[0] || "";
      if (!municipalityNumbers.length) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Mangler gyldig kommunenummer" }));
        return;
      }
      const requestedYear = Number(url.searchParams.get("år") || new Date().getFullYear());
      const currentYear = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= new Date().getFullYear() ? requestedYear : new Date().getFullYear();
      const [planYears, housingYears, feeAccountingYears, buildingAreaYears, holidayYears] = await Promise.all([
        latestSsbYears("12690", currentYear),
        latestSsbYears("05940", currentYear),
        latestSsbYears("13013", currentYear),
        latestSsbYears("05939", currentYear),
        latestSsbYears("06952", currentYear),
      ]);
      const [feeYears, buildingYears] = await Promise.all([
        latestSsbYears("12303", currentYear),
        latestSsbYears("13021", currentYear),
      ]);
      const [plan, housing, commercial, publicBuilding, holiday, fees, building, buildingProcessing, feeAccounting] = await Promise.all([
        fetchSsbTable("12690", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "ContentsCode", values: ["KOSantreghoring0000", "KOSinskomplanall0000", "KOStemaareal0000", "KOShoringsfrist0000", "KOSinnsigelseral0000", "KOSomfplanbehand0001", "KOSomfplanbehand0000", "KOSbehandlingsti0000", "KOSklagesakerved0000"] },
          { code: "Tid", values: planYears },
        ]),
        fetchSsbTable("05940", [
          { code: "Region", values: municipalityNumbers },
          { code: "Byggeareal", values: residentialBuildingTypes },
          { code: "ContentsCode", values: ["Igangsatte", "Fullforte", "BruksarealIgang", "BruksarealFullfort"] },
          { code: "Tid", values: housingYears },
        ]),
        fetchSsbTable("05939", [
          { code: "Region", values: municipalityNumbers },
          { code: "Byggeareal", values: ["611", "612", "613", "614", "615", "616", "619", "621", "623", "629", "641", "642", "643", "649", "651", "652", "653", "654", "655", "659", "661", "662", "663", "669", "671", "672", "673", "674", "675", "679", "719", "721", "722", "723", "729", "731", "732", "739"] },
          { code: "ContentsCode", values: ["Igangsatt", "Fullfort"] },
          { code: "Tid", values: buildingAreaYears },
        ]),
        fetchSsbTable("06952", [
          { code: "Region", values: municipalityNumbers },
          { code: "ContentsCode", values: ["IgangFrid2", "FullFritid2"] },
          { code: "Tid", values: holidayYears },
        ]),
        fetchSsbTable("05939", [
          { code: "Region", values: municipalityNumbers },
          { code: "Byggeareal", values: ["__ALL__"] },
          { code: "ContentsCode", values: ["Igangsatt", "Fullfort"] },
          { code: "Tid", values: buildingAreaYears },
        ]),
        fetchSsbTable("12303", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "ContentsCode", values: ["KOSgebrebebolig0000", "KOSgebrgrunneie0000", "KOSgebrprivrgpln0000"] },
          { code: "Tid", values: feeYears },
        ]),
        fetchSsbTable("13021", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "KOKckategori0000", values: ["aalle"] },
          { code: "KOKctype0000", values: ["abygsokialt"] },
          { code: "ContentsCode", values: ["KOSmottattesokna0000", "KOSmangelfulleso0000", "KOSbehandletsokn0000", "KOSoverlovpalagt0000", "KOSgjennomsnitts0000"] },
          { code: "Tid", values: buildingYears },
        ]),
        fetchSsbTable("13021", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "KOKckategori0000", values: ["__ALL__"] },
          { code: "KOKctype0000", values: ["__ALL__"] },
          { code: "ContentsCode", values: ["KOSgjennomsnitts0000"] },
          { code: "Tid", values: buildingYears },
        ]),
        fetchSsbTable("13013", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "KOKkommunalsekto0000", values: ["4_p", "5_b", "6_k", "7_e"] },
          { code: "ContentsCode", values: [
            "KOSbelopdirdrift0000", "KOSbelopindirdri0000", "KOSbelopkalkrent0000", "KOSbelopkalkavsk0000",
            "KOSbelopandreinn0000", "KOSbelopgebyrgrl0000", "KOSbelopgebyrinn0000", "KOSbelopaaretsfi0000",
            "KOSbelopavsetnfo0000", "KOSbelopbrukfond0000", "KOSbelopkontrsum0000", "KOSbelopsaldo110000",
            "KOSbelopaltkostn0000", "KOSbelopsaldo3110000", "KOSbelopfindekng0000", "KOSbelopselvkost0000",
          ] },
          { code: "Tid", values: feeAccountingYears },
        ]),
      ]);
      const planSeries = ssbMetricSeries(plan);
      const housingSeries = ssbMetricSeries(housing, "Byggeareal");
      const commercialSeries = ssbMetricSeries(commercial, "Byggeareal");
      const publicBuildingSeries = ssbMetricSeries(publicBuilding, "Byggeareal");
      const holidaySeries = ssbMetricSeries(holiday);
      const feeSeries = ssbMetricSeries(fees);
      const buildingSeries = ssbMetricSeries(building);
      const buildingProcessingSeries = ssbMetricSeries(buildingProcessing, ["KOKckategori0000", "KOKctype0000"], "average");
      const feeAccountingSeries = ssbMetricSeries(feeAccounting, "KOKkommunalsekto0000");
      const planValues = Object.fromEntries(Object.entries(planSeries).map(([key, series]) => [key, series.current]));
      const housingValues = Object.fromEntries(Object.entries(housingSeries).map(([key, series]) => [key, series.current]));
      const feeValues = Object.fromEntries(Object.entries(feeSeries).map(([key, series]) => [key, series.current]));
      const buildingValues = Object.fromEntries(Object.entries(buildingSeries).map(([key, series]) => [key, series.current]));
      const feeAccountingValues = Object.fromEntries(Object.entries(feeAccountingSeries).map(([key, series]) => [key, series.current]));
      const planTrends = Object.fromEntries(Object.entries(planSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const housingTrends = Object.fromEntries(Object.entries(housingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const commercialTrends = Object.fromEntries(Object.entries(commercialSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const publicBuildingTrends = Object.fromEntries(Object.entries(publicBuildingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const holidayTrends = Object.fromEntries(Object.entries(holidaySeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const feeTrends = Object.fromEntries(Object.entries(feeSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const buildingTrends = Object.fromEntries(Object.entries(buildingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const feeAccountingTrends = Object.fromEntries(Object.entries(feeAccountingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const values = {
        latestAvailableYear: Math.max(...[planYears, housingYears, feeYears, buildingYears, buildingAreaYears, holidayYears].map((years) => Number(years.at(-1)))),
        plansWithHearingDeadline: planValues.KOShoringsfrist0000,
        planObjections: planValues.KOSinnsigelseral0000,
        planArea: planValues.KOStemaareal0000,
        regulationsAdopted: planValues.KOSomfplanbehand0001,
        privateDetailedPlans: planValues.KOSomfplanbehand0000,
        planProcessingDays: planValues.KOSbehandlingsti0000,
        planComplaints: planValues.KOSklagesakerved0000,
        housingStarted: housingValues.Igangsatte,
        housingCompleted: housingValues.Fullforte,
        housingNetDifference: Number(housingValues.Igangsatte || 0) - Number(housingValues.Fullforte || 0),
        housingStartedArea: housingValues.BruksarealIgang,
        housingCompletedArea: housingValues.BruksarealFullfort,
        commercialStartedArea: commercialSeries.BruksarealIgang?.current,
        commercialCompletedArea: commercialSeries.BruksarealFullfort?.current,
        constructionAreaTotal: Number(housingValues.BruksarealIgang || 0) + Number(commercialSeries.BruksarealIgang?.current || 0),
        publicBuildingStartedArea: publicBuildingSeries.Igangsatt?.current,
        holidayHomeArea: holidaySeries.IgangFrid2?.current,
        feeBuildingHouse: feeValues.KOSgebrebebolig0000,
        feePropertyCreation: feeValues.KOSgebrgrunneie0000,
        feePrivateRegulation: feeValues.KOSgebrprivrgpln0000,
        buildingApplications: buildingValues.KOSmottattesokna0000,
        incompleteBuildingApplications: buildingValues.KOSmangelfulleso0000,
        processedBuildingApplications: buildingValues.KOSbehandletsokn0000,
        lateBuildingApplications: buildingValues.KOSoverlovpalagt0000,
        buildingProcessingDays: buildingProcessingSeries.KOSgjennomsnitts0000?.current,
        feeDirectOperatingExpenses: feeAccountingValues.KOSbelopdirdrift0000,
        feeIndirectOperatingExpenses: feeAccountingValues.KOSbelopindirdri0000,
        feeInterestCosts: feeAccountingValues.KOSbelopkalkrent0000,
        feeDepreciation: feeAccountingValues.KOSbelopkalkavsk0000,
        feeOtherIncome: feeAccountingValues.KOSbelopandreinn0000,
        feeBasisTotal: feeAccountingValues.KOSbelopgebyrgrl0000,
        feeRevenueTotal: feeAccountingValues.KOSbelopgebyrinn0000,
        feeFinancialResult: feeAccountingValues.KOSbelopaaretsfi0000,
        feeFundProvision: feeAccountingValues.KOSbelopavsetnfo0000,
        feeFundUse: feeAccountingValues.KOSbelopbrukfond0000,
        feeControlSumSubsidy: feeAccountingValues.KOSbelopkontrsum0000,
        feeFundBalanceStart: feeAccountingValues.KOSbelopsaldo110000,
        feeAlternativeCost: feeAccountingValues.KOSbelopaltkostn0000,
        feeFundBalanceEnd: feeAccountingValues.KOSbelopsaldo3110000,
        feeFinancialCoverage: feeAccountingValues.KOSbelopfindekng0000,
      };
      applyFeeCoverageCalculations(values);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      const previousValues = {
        plansWithHearingDeadline: planSeries.KOShoringsfrist0000?.previous,
        planObjections: planSeries.KOSinnsigelseral0000?.previous,
        planArea: planSeries.KOStemaareal0000?.previous,
        regulationsAdopted: planSeries.KOSomfplanbehand0001?.previous,
        privateDetailedPlans: planSeries.KOSomfplanbehand0000?.previous,
        planProcessingDays: planSeries.KOSbehandlingsti0000?.previous,
        planComplaints: planSeries.KOSklagesakerved0000?.previous,
        housingStarted: housingSeries.Igangsatte?.previous,
        housingCompleted: housingSeries.Fullforte?.previous,
        housingNetDifference: Number(housingSeries.Igangsatte?.previous || 0) - Number(housingSeries.Fullforte?.previous || 0),
        housingStartedArea: housingSeries.BruksarealIgang?.previous,
        housingCompletedArea: housingSeries.BruksarealFullfort?.previous,
        commercialStartedArea: commercialSeries.BruksarealIgang?.previous,
        commercialCompletedArea: commercialSeries.BruksarealFullfort?.previous,
        constructionAreaTotal: Number(housingSeries.BruksarealIgang?.previous || 0) + Number(commercialSeries.BruksarealIgang?.previous || 0),
        publicBuildingStartedArea: publicBuildingSeries.Igangsatt?.previous,
        holidayHomeArea: holidaySeries.IgangFrid2?.previous,
        feeBuildingHouse: feeSeries.KOSgebrebebolig0000?.previous,
        feePropertyCreation: feeSeries.KOSgebrgrunneie0000?.previous,
        feePrivateRegulation: feeSeries.KOSgebrprivrgpln0000?.previous,
        buildingApplications: buildingSeries.KOSmottattesokna0000?.previous,
        incompleteBuildingApplications: buildingSeries.KOSmangelfulleso0000?.previous,
        processedBuildingApplications: buildingSeries.KOSbehandletsokn0000?.previous,
        lateBuildingApplications: buildingSeries.KOSoverlovpalagt0000?.previous,
        buildingProcessingDays: buildingProcessingSeries.KOSgjennomsnitts0000?.previous,
        feeDirectOperatingExpenses: feeAccountingSeries.KOSbelopdirdrift0000?.previous,
        feeIndirectOperatingExpenses: feeAccountingSeries.KOSbelopindirdri0000?.previous,
        feeInterestCosts: feeAccountingSeries.KOSbelopkalkrent0000?.previous,
        feeDepreciation: feeAccountingSeries.KOSbelopkalkavsk0000?.previous,
        feeOtherIncome: feeAccountingSeries.KOSbelopandreinn0000?.previous,
        feeBasisTotal: feeAccountingSeries.KOSbelopgebyrgrl0000?.previous,
        feeRevenueTotal: feeAccountingSeries.KOSbelopgebyrinn0000?.previous,
        feeFinancialResult: feeAccountingSeries.KOSbelopaaretsfi0000?.previous,
        feeFundProvision: feeAccountingSeries.KOSbelopavsetnfo0000?.previous,
        feeFundUse: feeAccountingSeries.KOSbelopbrukfond0000?.previous,
        feeControlSumSubsidy: feeAccountingSeries.KOSbelopkontrsum0000?.previous,
        feeFundBalanceStart: feeAccountingSeries.KOSbelopsaldo110000?.previous,
        feeAlternativeCost: feeAccountingSeries.KOSbelopaltkostn0000?.previous,
        feeFundBalanceEnd: feeAccountingSeries.KOSbelopsaldo3110000?.previous,
        feeFinancialCoverage: feeAccountingSeries.KOSbelopfindekng0000?.previous,
      };
      applyFeeCoverageCalculations(previousValues);
      const outputMetricKeys = [
        "latestAvailableYear", "plansWithHearingDeadline", "planObjections", "planArea", "regulationsAdopted", "privateDetailedPlans", "planProcessingDays", "planComplaints",
        "housingStarted", "housingCompleted", "housingNetDifference", "housingStartedArea", "housingCompletedArea", "commercialStartedArea", "commercialCompletedArea", "constructionAreaTotal", "publicBuildingStartedArea", "holidayHomeArea",
        "feeBuildingHouse", "feePropertyCreation", "feePrivateRegulation", "buildingApplications", "incompleteBuildingApplications", "processedBuildingApplications", "lateBuildingApplications", "buildingProcessingDays",
        "feeDirectOperatingExpenses", "feeIndirectOperatingExpenses", "feeInterestCosts", "feeDepreciation", "feeOtherIncome", "feeBasisTotal", "feeRevenueTotal", "feeFinancialResult", "feeFundProvision", "feeFundUse", "feeControlSumSubsidy", "feeFundBalanceStart", "feeAlternativeCost", "feeFundBalanceEnd", "feeFinancialCoverage",
      ];
      outputMetricKeys.forEach((metric) => {
        if (values[metric] === undefined) values[metric] = null;
        if (previousValues[metric] === undefined) previousValues[metric] = null;
      });
      const metricYears = {
        plansWithHearingDeadline: ssbMetricYears(planYears), planObjections: ssbMetricYears(planYears), planArea: ssbMetricYears(planYears), planComplaints: ssbMetricYears(planYears),
        latestAvailableYear: ssbMetricYears(planYears), regulationsAdopted: ssbMetricYears(planYears), privateDetailedPlans: ssbMetricYears(planYears), planProcessingDays: ssbMetricYears(planYears),
        housingStarted: ssbMetricYears(housingYears), housingCompleted: ssbMetricYears(housingYears), housingNetDifference: ssbMetricYears(housingYears), housingStartedArea: ssbMetricYears(housingYears), housingCompletedArea: ssbMetricYears(housingYears),
        commercialStartedArea: ssbMetricYears(housingYears), commercialCompletedArea: ssbMetricYears(housingYears), constructionAreaTotal: ssbMetricYears(housingYears),
        publicBuildingStartedArea: ssbMetricYears(buildingAreaYears), holidayHomeArea: ssbMetricYears(holidayYears),
        feeBuildingHouse: ssbMetricYears(feeYears), feePropertyCreation: ssbMetricYears(feeYears), feePrivateRegulation: ssbMetricYears(feeYears),
        buildingApplications: ssbMetricYears(buildingYears), incompleteBuildingApplications: ssbMetricYears(buildingYears), processedBuildingApplications: ssbMetricYears(buildingYears), lateBuildingApplications: ssbMetricYears(buildingYears), buildingProcessingDays: ssbMetricYears(buildingYears),
        feeDirectOperatingExpenses: ssbMetricYears(feeAccountingYears), feeIndirectOperatingExpenses: ssbMetricYears(feeAccountingYears),
        feeInterestCosts: ssbMetricYears(feeAccountingYears), feeDepreciation: ssbMetricYears(feeAccountingYears), feeOtherIncome: ssbMetricYears(feeAccountingYears),
        feeBasisTotal: ssbMetricYears(feeAccountingYears), feeRevenueTotal: ssbMetricYears(feeAccountingYears), feeFinancialResult: ssbMetricYears(feeAccountingYears),
        feeFundProvision: ssbMetricYears(feeAccountingYears), feeFundUse: ssbMetricYears(feeAccountingYears), feeControlSumSubsidy: ssbMetricYears(feeAccountingYears),
        feeFundBalanceStart: ssbMetricYears(feeAccountingYears), feeAlternativeCost: ssbMetricYears(feeAccountingYears), feeFundBalanceEnd: ssbMetricYears(feeAccountingYears),
        feeFinancialCoverage: ssbMetricYears(feeAccountingYears),
      };
      const year = Math.max(...Object.values(metricYears).map((item) => Number(item.year)));
      const previousYear = year - 1;
      response.end(JSON.stringify({ source: "Statistisk sentralbyrå", year, previousYear, metricYears, municipalityNumber, municipalityNumbers, municipalityCount: municipalityNumbers.length, scope: municipalityNumbers.length > 1 ? "region" : "municipality", values, previousValues, trends: {
        plansWithHearingDeadline: planTrends.KOShoringsfrist0000,
        planObjections: planTrends.KOSinnsigelseral0000,
        planArea: planTrends.KOStemaareal0000,
        regulationsAdopted: planTrends.KOSomfplanbehand0001,
        privateDetailedPlans: planTrends.KOSomfplanbehand0000,
        planProcessingDays: planTrends.KOSbehandlingsti0000,
        planComplaints: planTrends.KOSklagesakerved0000,
        housingStarted: housingTrends.Igangsatte,
        housingCompleted: housingTrends.Fullforte,
        housingNetDifference: ssbTrend(values.housingNetDifference, previousValues.housingNetDifference),
        housingStartedArea: housingTrends.BruksarealIgang,
        housingCompletedArea: housingTrends.BruksarealFullfort,
        commercialStartedArea: commercialTrends.BruksarealIgang,
        commercialCompletedArea: commercialTrends.BruksarealFullfort,
        publicBuildingStartedArea: publicBuildingTrends.Igangsatt,
        holidayHomeArea: holidayTrends.IgangFrid2,
        constructionAreaTotal: ssbTrend(values.constructionAreaTotal, previousValues.constructionAreaTotal),
        feeBuildingHouse: feeTrends.KOSgebrebebolig0000,
        feePropertyCreation: feeTrends.KOSgebrgrunneie0000,
        feePrivateRegulation: feeTrends.KOSgebrprivrgpln0000,
        buildingApplications: buildingTrends.KOSmottattesokna0000,
        incompleteBuildingApplications: buildingTrends.KOSmangelfulleso0000,
        processedBuildingApplications: buildingTrends.KOSbehandletsokn0000,
        lateBuildingApplications: buildingTrends.KOSoverlovpalagt0000,
        buildingProcessingDays: ssbTrend(values.buildingProcessingDays, previousValues.buildingProcessingDays),
        feeDirectOperatingExpenses: feeAccountingTrends.KOSbelopdirdrift0000,
        feeIndirectOperatingExpenses: feeAccountingTrends.KOSbelopindirdri0000,
        feeInterestCosts: feeAccountingTrends.KOSbelopkalkrent0000,
        feeDepreciation: feeAccountingTrends.KOSbelopkalkavsk0000,
        feeOtherIncome: feeAccountingTrends.KOSbelopandreinn0000,
        feeBasisTotal: feeAccountingTrends.KOSbelopgebyrgrl0000,
        feeRevenueTotal: feeAccountingTrends.KOSbelopgebyrinn0000,
        feeFinancialResult: feeAccountingTrends.KOSbelopaaretsfi0000,
        feeFundProvision: feeAccountingTrends.KOSbelopavsetnfo0000,
        feeFundUse: feeAccountingTrends.KOSbelopbrukfond0000,
        feeControlSumSubsidy: feeAccountingTrends.KOSbelopkontrsum0000,
        feeFundBalanceStart: feeAccountingTrends.KOSbelopsaldo110000,
        feeAlternativeCost: feeAccountingTrends.KOSbelopaltkostn0000,
        feeFundBalanceEnd: feeAccountingTrends.KOSbelopsaldo3110000,
        feeFinancialCoverage: feeAccountingTrends.KOSbelopfindekng0000,
      } }));
      return;
    }

    const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let requested = safePath === "/" ? "/index.html" : safePath;
    if (requested === "/app.js") requested = "/src/main.js";
    if (requested === "/styles.css") requested = "/src/styles.css";
    if (requested.startsWith("/data/")) requested = `/public${requested}`;
    if (requested.startsWith("/assets/")) requested = `/public${requested}`;
    if (requested.startsWith("/vendor/")) requested = `/public${requested}`;
    const filePath = path.join(root, requested);
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": mime[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      pragma: "no-cache",
      expires: "0",
    });
    response.end(body);
  } catch (error) {
    const isApiRequest = (request.url || "").startsWith("/api/");
    response.writeHead(isApiRequest ? 502 : 404, { "content-type": isApiRequest ? "application/json; charset=utf-8" : "text/plain; charset=utf-8" });
    response.end(isApiRequest ? JSON.stringify({ error: error?.message || "Tjenesten kunne ikke hente data akkurat nå." }) : "Not found");
  }
});

function stripHtml(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractNorwegianPhones(value, subject = "") {
  // Hent hele tallsekvenser før validering. Ellers kan et ni-sifret
  // organisasjonsnummer bli feiltolket som de første åtte sifrene i et
  // telefonnummer.
  const text = String(value || "");
  const pattern = /(?<!\d)(?:\+47[\s.-]?)?[\d][\d\s.-]{6,20}\d(?!\d)/g;
  const matches = [];
  const subjectTerms = String(subject || "")
    .toLocaleLowerCase("nb-NO")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 2 && !/^(aksjeselskap|as|asa|ans|da|sa|ba|nuf)$/.test(term));
  let match;
  while ((match = pattern.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const after = text.slice(match.index + match[0].length, Math.min(text.length, match.index + match[0].length + 50));
    const context = `${before} ${match[0]} ${after}`;
    const subjectInContext = subjectTerms.length === 0 || subjectTerms.some((term) => context.toLocaleLowerCase("nb-NO").includes(term));
    const phoneLabelNearNumber = /telefon|tlf\.?|tel\.?|mobil|kontakttelefon|phone|ring/i.test(before.slice(-50))
      || /telefon|tlf\.?|tel\.?|mobil|kontakttelefon|phone|ring/i.test(after.slice(0, 35));
    const explicitNorwegianNumber = /^\s*\+47[\s.-]?/.test(match[0]);
    if (subjectInContext && (phoneLabelNearNumber || explicitNorwegianNumber)) {
      matches.push(match[0]);
    }
  }
  return [...new Set(matches.map((phone) => phone.trim()).filter((phone) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 8) return /^[2-9]\d{7}$/.test(digits);
    return digits.length === 10 && digits.startsWith("47") && /^[2-9]\d{7}$/.test(digits.slice(2));
  }))].slice(0, 5);
}

server.listen(port, host, () => {
  console.log(`Norsk ByggRadar local UI: http://${host}:${port}/`);
});

async function fetchSsbTable(table, dimensions) {
  const metadata = await fetchSsbMetadata(table);
  const query = dimensions.map((dimension) => ({
    code: dimension.code,
    selection: { filter: "item", values: dimension.values.includes("__ALL__") ? metadata.variables.find((variable) => variable.code === dimension.code)?.values || [] : dimension.values },
  }));
  const cacheKey = `${table}:${JSON.stringify(query)}`;
  if (ssbTableCache.has(cacheKey)) return ssbTableCache.get(cacheKey);
  const payload = await fetchSsbJson(`https://data.ssb.no/api/v0/no/table/${table}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, response: { format: "json-stat2" } }),
  }, `SSB-spørringen feilet for tabell ${table}`);
  const result = { ...payload, metadata };
  ssbTableCache.set(cacheKey, result);
  return result;
}

async function latestSsbYears(table, requestedYear) {
  const cacheKey = `${table}:${requestedYear}`;
  if (ssbYearCache.has(cacheKey)) return ssbYearCache.get(cacheKey);
  const metadata = await fetchSsbMetadata(table);
  const timeVariable = metadata.variables?.find((variable) => variable.code === "Tid");
  const available = (timeVariable?.values || [])
    .map(String)
    .filter((period) => ssbPeriodSortValue(period) <= ssbPeriodSortValue(String(requestedYear)))
    .sort((a, b) => ssbPeriodSortValue(a) - ssbPeriodSortValue(b));
  const latest = available.at(-1);
  if (!latest) throw new Error(`SSB-tabell ${table} har ingen tilgjengelige årstall`);
  const previous = available.filter((period) => ssbPeriodSortValue(period) < ssbPeriodSortValue(latest)).at(-1) || latest;
  const years = [String(previous), String(latest)];
  ssbYearCache.set(cacheKey, years);
  return years;
}

function ssbPeriodSortValue(period) {
  const value = String(period);
  const match = value.match(/^(\d{4})(?:M(\d{2})|K(\d))?$/i);
  if (!match) return Number.NEGATIVE_INFINITY;
  const year = Number(match[1]);
  if (match[2]) return year * 100 + Number(match[2]);
  if (match[3]) return year * 100 + Number(match[3]) * 3;
  return year * 100;
}

async function fetchSsbMetadata(table) {
  if (ssbMetadataCache.has(table)) return ssbMetadataCache.get(table);
  const metadata = await fetchSsbJson(`https://data.ssb.no/api/v0/no/table/${table}`, {}, `SSB-tabell ${table} er ikke tilgjengelig`);
  ssbMetadataCache.set(table, metadata);
  return metadata;
}

async function fetchSsbJson(url, options, errorPrefix) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, options);
    lastStatus = response.status;
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 3) break;
    const retryAfter = Number(response.headers.get("retry-after")) || 2;
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 5) * 1000));
  }
  throw new Error(`${errorPrefix} (${lastStatus})`);
}

function ssbMetricYears(years) {
  const current = String(years.at(-1));
  const previous = String(years.at(-2));
  return { year: Number(current.slice(0, 4)), previousYear: Number(previous.slice(0, 4)), period: current, previousPeriod: previous };
}

function ssbMetricSeries(dataset, aggregateDimension = "", aggregation = "sum") {
  const values = Array.isArray(dataset.value) ? dataset.value : [];
  const dimensions = dataset.id || Object.keys(dataset.dimension || {});
  const orderedValues = Object.fromEntries(dimensions.map((dimension) => [dimension, Object.entries(dataset.dimension?.[dimension]?.category?.index || {}).sort((a, b) => a[1] - b[1]).map(([code]) => code)]));
  const metrics = orderedValues.ContentsCode || [];
  const times = orderedValues.Tid || [];
  const aggregateDimensions = aggregateDimension ? (Array.isArray(aggregateDimension) ? aggregateDimension : [aggregateDimension]) : [];
  const varyingDimensions = dimensions.filter((dimension) => !["ContentsCode", "Tid"].includes(dimension));
  const combinations = [[]];
  varyingDimensions.forEach((dimension) => {
    const next = [];
    for (const combination of combinations) for (const code of orderedValues[dimension] || []) next.push([...combination, [dimension, code]]);
    combinations.splice(0, combinations.length, ...next);
  });
  const dimensionSizes = Object.fromEntries(dimensions.map((dimension) => [dimension, orderedValues[dimension]?.length || 1]));
  const flatIndex = (coordinates) => dimensions.reduce((index, dimension) => index * dimensionSizes[dimension] + (dataset.dimension?.[dimension]?.category?.index?.[coordinates[dimension]] ?? 0), 0);
  return Object.fromEntries(metrics.map((metric) => {
    const series = times.map((time) => {
      const selected = combinations.filter((combination) => aggregateDimensions.length === 0 || combination.some(([dimension]) => aggregateDimensions.includes(dimension)));
      const numbers = selected.map((combination) => {
        const coordinates = Object.fromEntries([...combination, ["ContentsCode", metric], ["Tid", time]]);
        const value = values[flatIndex(coordinates)];
        return Number.isFinite(Number(value)) ? Number(value) : null;
      }).filter((value) => value !== null);
      if (!numbers.length) return null;
      return aggregation === "average" ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : numbers.reduce((sum, value) => sum + value, 0);
    });
    return [metric, { current: series.at(-1), previous: series.at(-2) }];
  }));
}

function applyFeeCoverageCalculations(values) {
  const basis = Number(values.feeBasisTotal);
  const revenue = Number(values.feeRevenueTotal);
  if (!Number.isFinite(basis) || basis === 0 || !Number.isFinite(revenue)) {
    values.feeFinancialCoverage = null;
    return values;
  }
  values.feeFinancialCoverage = (revenue / basis) * 100;
  return values;
}

function ssbTrend(current, previous) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return null;
  const change = Number(previous) === 0 ? (Number(current) > 0 ? 1 : 0) : (Number(current) - Number(previous)) / Math.abs(Number(previous));
  if (change > 0.03) return { arrow: "↑", label: "Stigende", className: "up" };
  if (change < -0.03) return { arrow: "↓", label: "Fallende", className: "down" };
  return { arrow: "→", label: "Flat", className: "neutral" };
}
