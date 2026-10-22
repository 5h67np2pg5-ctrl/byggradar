import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(root, "config/alver-api-preview.json"), "utf8"));
const reportDir = path.join(root, "reports");
const reportPath = path.join(reportDir, "alver-api-preview.json");
const userAgent = "NorskByggRadar/1.0 (separat kontrolladapter)";
const now = new Date();
const cutoffMs = now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000;
const include = new RegExp(config.include, "i");
const exclude = new RegExp(config.exclude, "i");
const clean = (value) => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const decode = (value) => clean(value).replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number(code)));
const isoDate = (value) => {
  const match = String(value || "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
};
const dateMs = (value) => Date.parse(value || "");
const request = (url) => fetch(url, {
  headers: { accept: "text/html", "user-agent": userAgent },
  signal: AbortSignal.timeout(30000),
});
const queryUrl = (term, startrow) => {
  const url = new URL(config.sourceUrl);
  url.search = new URLSearchParams({
    response: "arkivsak_sok_tomdefault",
    showresults: "true",
    startrow: String(startrow),
    tomtsok: "false",
    simple: "false",
    tittel: term,
    sok: "Søk",
  });
  return url;
};
const rowKey = (row) => `${row.caseUrl}|${row.caseNumber}|${row.documentDate}`.toLocaleLowerCase("nb-NO");

// Sing/WebSak is an HTML search surface. We only read rows linked to the
// municipality's own arkivsak-detail route; no intermediary aggregation is used.
const terms = ["bygg", "byggesak", "byggjesak", "søknad"];
const rows = [];
const termCounts = {};
let status = "ok";
let error = "";

try {
  for (const term of terms) {
    const termRows = [];
    for (let startrow = 0; startrow < 5000; startrow += config.pageSize) {
      const response = await request(queryUrl(term, startrow));
      if (!response.ok) throw new Error(`Alver WebSak svarte ${response.status}`);
      const html = await response.text();
      const trMatches = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
      const anchorMatches = html.match(/<a\b[^>]+href=["'][^"']*response=arkivsak_detaljer[^"']*["'][\s\S]*?<\/a>/gi) || [];
      const containers = trMatches.length ? trMatches : anchorMatches;
      const parsed = containers.map((rowHtml) => {
        const link = rowHtml.match(/href=["']([^"']*response=arkivsak_detaljer[^"']*)["']/i)?.[1] || "";
        if (!link) return null;
        const text = decode(rowHtml);
        const documentDate = isoDate(text);
        const caseNumber = text.match(/\b\d{4}\/\d+\b/)?.[0] || "";
        const title = text.replace(/\s+/g, " ").trim();
        return { caseUrl: new URL(link, config.sourceUrl).toString(), caseNumber, title, documentDate };
      }).filter(Boolean);
      termRows.push(...parsed);
      if (!parsed.length || parsed.length < config.pageSize) break;
    }
    termCounts[term] = termRows.length;
    rows.push(...termRows);
  }
} catch (caught) {
  status = "unavailable";
  error = caught.message;
}

const recent = rows.filter((row) => row.documentDate && dateMs(row.documentDate) >= cutoffMs);
const filtered = recent.filter((row) => include.test(row.title) && !exclude.test(row.title));
const unique = [...new Map(filtered.map((row) => [rowKey(row), row])).values()];
const report = {
  generatedAt: now.toISOString(),
  adapter: "alver-municipality-singsak-api-preview",
  municipality: config.municipality,
  municipalityNumber: config.municipalityNumber,
  source: config.sourceUrl,
  doesNotModifyNbrProjectFiles: true,
  status,
  error: error || undefined,
  cutoff: new Date(cutoffMs).toISOString(),
  counts: status === "ok" ? { rawRows: rows.length, recentByDate: recent.length, afterNbrPreviewFilter: filtered.length, uniqueAfterCaseDeduplication: unique.length } : null,
  termCounts,
  examples: unique.slice(0, 25),
  filter: { include: config.include, exclude: config.exclude },
};
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, status, counts: report.counts, error: error || null }, null, 2));
if (status !== "ok") process.exitCode = 2;
