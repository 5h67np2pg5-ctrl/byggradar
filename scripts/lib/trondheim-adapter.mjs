import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const config = JSON.parse(await fs.readFile(path.join(root, "config/trondheim-api-preview.json"), "utf8"));
const userAgent = "NorskByggRadar/1.0 (kommunal kontrolladapter)";
const include = new RegExp(config.include.join("|"), "i");
const exclude = new RegExp(config.exclude.join("|"), "i");
const cacheTtlMs = 15 * 60 * 1000;
let cachedResult = null;
let pendingRequest = null;

const query = `query TrondheimProceedings($limit: Int!, $offset: Int!, $where: ProceedingsWhere!, $orderBy: ProceedingsOrderBy, $includeCount: Boolean) {
  proceedings(limit: $limit, offset: $offset, includeCount: $includeCount, where: $where, orderBy: $orderBy) {
    totalCount
    nodes {
      id
      archiveId
      sequenceNumber
      title
      date
      type { id name }
      subArchive { id name }
      propertyIdentifications { id useNr propertyNr }
    }
  }
}`;

const clean = (value) => Array.isArray(value)
  ? value.map(clean).filter(Boolean).join(" ")
  : String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const caseKey = (item) => clean(item.sequenceNumber || item.archiveId || item.id || item.title).toLocaleLowerCase("nb-NO");
const haystackFor = (item) => [item.title, item.type?.name, item.subArchive?.name, item.sequenceNumber].map(clean).join(" ");
const readCookies = (response) => response.headers.getSetCookie?.().map((cookie) => cookie.split(";", 1)[0]).join("; ") || "";

async function fetchReport() {
  let portalCookies = "";
  const raw = [];
  let remoteTotal = null;
  const portalResponse = await fetch(`${config.portalUrl}?reloadTime=${Date.now()}`, {
    headers: { accept: "text/html", "user-agent": userAgent }, signal: AbortSignal.timeout(30000),
  });
  if (!portalResponse.ok) throw new Error(`Trondheim innsynsside svarte HTTP ${portalResponse.status}`);
  portalCookies = readCookies(portalResponse);
  for (let page = 0; page < config.maxPages; page += 1) {
    const where = { sequenceNumber: "", typeIdIn: [], year: null, propertyNr: null, useNr: null, listId: config.listId, search: config.query, fromDate: null, toDate: null, archiveSystemId: null, subArchiveId: "", departmentIdIn: null, includeUnpublished: false };
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "Apollo-Require-Preflight": "true", origin: new URL(config.portalUrl).origin, referer: config.portalUrl, "user-agent": userAgent, ...(portalCookies ? { cookie: portalCookies } : {}) },
      body: JSON.stringify({ operationName: "TrondheimProceedings", query, variables: { limit: config.pageSize, offset: page * config.pageSize, where, orderBy: "date_DESC", includeCount: true } }),
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Trondheim GraphQL svarte HTTP ${response.status}`);
    if (Array.isArray(payload.errors) && payload.errors.length) throw new Error(payload.errors.map((error) => error.message).join("; "));
    if (!payload.data?.proceedings) throw new Error("Trondheim-svaret mangler proceedings");
    const result = payload.data.proceedings;
    remoteTotal ??= Number.isFinite(result.totalCount) ? result.totalCount : null;
    const items = Array.isArray(result.nodes) ? result.nodes : [];
    raw.push(...items);
    if (!items.length || items.length < config.pageSize || (remoteTotal !== null && raw.length >= remoteTotal)) break;
  }
  const buildingCandidates = raw.filter((item) => { const haystack = haystackFor(item); return include.test(haystack) && !exclude.test(haystack); });
  const unique = [...new Map(buildingCandidates.map((item) => [caseKey(item), item])).values()];
  return {
    generatedAt: new Date().toISOString(), adapter: "trondheim-municipality-jupiter-graphql", municipality: config.municipality, municipalityNumber: config.municipalityNumber, source: config.sourceUrl, portal: config.portalUrl, endpoint: config.endpoint, query: config.query, lookbackDays: null, doesNotModifyNbrProjectFiles: true, status: "ok", error: null,
    counts: { remoteProceedingTotal: remoteTotal, rawFetched: raw.length, afterNbrPreviewFilter: buildingCandidates.length, uniqueAfterCaseDeduplication: unique.length },
    filter: { include: config.include, exclude: config.exclude },
    examples: unique.slice(0, 20).map((item) => ({ id: item.id, caseNumber: clean(item.sequenceNumber), title: clean(item.title), date: clean(item.date), type: clean(item.type?.name), propertyIdentifications: item.propertyIdentifications || [] })),
  };
}

export async function fetchTrondheimBuildingCases({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedResult && cachedResult.expiresAt > Date.now()) return cachedResult.report;
  if (pendingRequest) return pendingRequest;
  pendingRequest = fetchReport().then((report) => { cachedResult = { report, expiresAt: Date.now() + cacheTtlMs }; return report; }).catch((caught) => ({
    generatedAt: new Date().toISOString(), adapter: "trondheim-municipality-jupiter-graphql", municipality: config.municipality, municipalityNumber: config.municipalityNumber, source: config.sourceUrl, portal: config.portalUrl, endpoint: config.endpoint, query: config.query, lookbackDays: null, doesNotModifyNbrProjectFiles: true, status: "unavailable", error: caught instanceof Error ? caught.message : String(caught), counts: null, filter: { include: config.include, exclude: config.exclude }, examples: [],
  })).finally(() => { pendingRequest = null; });
  return pendingRequest;
}
