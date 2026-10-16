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
  console.log(`ByggRadar local UI: http://${host}:${port}/`);
});
