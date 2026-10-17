import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

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
      const municipalityNumber = String(url.searchParams.get("kommunenummer") || "").replace(/\D/g, "").slice(0, 4);
      if (!/^\d{4}$/.test(municipalityNumber)) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Mangler gyldig kommunenummer" }));
        return;
      }
      const requestedYear = Number(url.searchParams.get("år") || new Date().getFullYear());
      const currentYear = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= new Date().getFullYear() ? requestedYear : new Date().getFullYear();
      const [planYears, housingYears] = await Promise.all([
        latestSsbYears("12690", currentYear),
        latestSsbYears("05940", currentYear),
      ]);
      const [plan, housing] = await Promise.all([
        fetchSsbTable("12690", [
          { code: "KOKkommuneregion0000", values: [municipalityNumber] },
          { code: "ContentsCode", values: ["KOSomfplanbehand0001", "KOSomfplanbehand0000", "KOSbehandlingsti0000"] },
          { code: "Tid", values: planYears },
        ]),
        fetchSsbTable("05940", [
          { code: "Region", values: [municipalityNumber] },
          { code: "Byggeareal", values: ["__ALL__"] },
          { code: "ContentsCode", values: ["Igangsatte", "Fullforte", "BruksarealIgang", "BruksarealFullfort"] },
          { code: "Tid", values: housingYears },
        ]),
      ]);
      const planSeries = ssbMetricSeries(plan);
      const housingSeries = ssbMetricSeries(housing, "Byggeareal");
      const planValues = Object.fromEntries(Object.entries(planSeries).map(([key, series]) => [key, series.current]));
      const housingValues = Object.fromEntries(Object.entries(housingSeries).map(([key, series]) => [key, series.current]));
      const planTrends = Object.fromEntries(Object.entries(planSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const housingTrends = Object.fromEntries(Object.entries(housingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const values = {
        regulationsAdopted: planValues.KOSomfplanbehand0001,
        privateDetailedPlans: planValues.KOSomfplanbehand0000,
        planProcessingDays: planValues.KOSbehandlingsti0000,
        housingStarted: housingValues.Igangsatte,
        housingCompleted: housingValues.Fullforte,
        housingStartedArea: housingValues.BruksarealIgang,
        housingCompletedArea: housingValues.BruksarealFullfort,
      };
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      const previousValues = {
        regulationsAdopted: planSeries.KOSomfplanbehand0001?.previous,
        privateDetailedPlans: planSeries.KOSomfplanbehand0000?.previous,
        planProcessingDays: planSeries.KOSbehandlingsti0000?.previous,
        housingStarted: housingSeries.Igangsatte?.previous,
        housingCompleted: housingSeries.Fullforte?.previous,
        housingStartedArea: housingSeries.BruksarealIgang?.previous,
        housingCompletedArea: housingSeries.BruksarealFullfort?.previous,
      };
      const year = Math.min(Number(planYears.at(-1)), Number(housingYears.at(-1)));
      const previousYear = year - 1;
      response.end(JSON.stringify({ source: "Statistisk sentralbyrå", year, previousYear, municipalityNumber, values, previousValues, trends: {
        regulationsAdopted: planTrends.KOSomfplanbehand0001,
        privateDetailedPlans: planTrends.KOSomfplanbehand0000,
        planProcessingDays: planTrends.KOSbehandlingsti0000,
        housingStarted: housingTrends.Igangsatte,
        housingCompleted: housingTrends.Fullforte,
        housingStartedArea: housingTrends.BruksarealIgang,
        housingCompletedArea: housingTrends.BruksarealFullfort,
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
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
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
  const metadataResponse = await fetch(`https://data.ssb.no/api/v0/no/table/${table}`);
  if (!metadataResponse.ok) throw new Error(`SSB-tabell ${table} er ikke tilgjengelig (${metadataResponse.status})`);
  const metadata = await metadataResponse.json();
  const query = dimensions.map((dimension) => ({
    code: dimension.code,
    selection: { filter: "item", values: dimension.values.includes("__ALL__") ? metadata.variables.find((variable) => variable.code === dimension.code)?.values || [] : dimension.values },
  }));
  const response = await fetch(`https://data.ssb.no/api/v0/no/table/${table}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, response: { format: "json-stat2" } }),
  });
  if (!response.ok) throw new Error(`SSB-spørringen feilet for tabell ${table} (${response.status})`);
  return { ...(await response.json()), metadata };
}

async function latestSsbYears(table, requestedYear) {
  const response = await fetch(`https://data.ssb.no/api/v0/no/table/${table}`);
  if (!response.ok) throw new Error(`SSB-tabell ${table} er ikke tilgjengelig (${response.status})`);
  const metadata = await response.json();
  const timeVariable = metadata.variables?.find((variable) => variable.code === "Tid");
  const available = (timeVariable?.values || []).map(Number).filter((year) => Number.isInteger(year) && year <= requestedYear).sort((a, b) => a - b);
  const latest = available.at(-1);
  if (!latest) throw new Error(`SSB-tabell ${table} har ingen tilgjengelige årstall`);
  const previous = available.filter((year) => year < latest).at(-1) || latest - 1;
  return [String(previous), String(latest)];
}

function ssbMetricSeries(dataset, aggregateDimension = "") {
  const labels = dataset.dimension?.ContentsCode?.category?.index || {};
  const values = Array.isArray(dataset.value) ? dataset.value : [];
  const orderedMetrics = Object.entries(labels).sort((a, b) => a[1] - b[1]).map(([code]) => code);
  const timeIndex = dataset.dimension?.Tid?.category?.index || {};
  const orderedTimes = Object.entries(timeIndex).sort((a, b) => a[1] - b[1]).map(([code]) => code);
  const timeSize = orderedTimes.length || 1;
  if (!aggregateDimension) return Object.fromEntries(orderedMetrics.map((code, metricIndex) => {
    const series = orderedTimes.map((_, timePosition) => values[metricIndex * timeSize + timePosition] ?? null);
    return [code, { current: series.at(-1), previous: series.at(-2) }];
  }));
  const aggregateSize = dataset.dimension?.[aggregateDimension]?.category?.index ? Object.keys(dataset.dimension[aggregateDimension].category.index).length : 1;
  return Object.fromEntries(orderedMetrics.map((code, metricIndex) => {
    const series = orderedTimes.map((_, timePosition) => Array.from({ length: aggregateSize }, (_, groupIndex) => values[(groupIndex * orderedMetrics.length * timeSize) + (metricIndex * timeSize) + timePosition] ?? 0).reduce((total, value) => total + Number(value || 0), 0));
    return [code, { current: series.at(-1), previous: series.at(-2) }];
  }));
}

function ssbTrend(current, previous) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return null;
  const change = Number(previous) === 0 ? (Number(current) > 0 ? 1 : 0) : (Number(current) - Number(previous)) / Math.abs(Number(previous));
  if (change > 0.03) return { arrow: "↑", label: "Stigende", className: "up" };
  if (change < -0.03) return { arrow: "↓", label: "Fallende", className: "down" };
  return { arrow: "→", label: "Flat", className: "neutral" };
}
