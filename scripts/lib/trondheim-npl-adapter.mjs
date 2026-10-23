const userAgent = "NorskByggRadar/1.0 (kontrolladapter; kontakt Norsk ByggRadar)";
const source = "https://norske-postlister.no/";
const lookbackDays = 90;
const cacheTtlMs = 15 * 60 * 1000;
const include = /bygg|bygge|byggesak|byggjesak|byggesøknad|byggjesøknad|byggetillatelse|rammetillatelse|igangsetting|igangsetjing|tilbygg|påbygg|bruksendring|garasje|fasade|takarbeid|terreng|støttemur|oppføring|rivning|riving|fradeling|frådeling|seksjonering|dispensasjon|nabovarsel|eiendom/i;
const exclude = /adress(?:e)?endring|avslag|klage|ferdigmelding|ferdigattest|tilsyn|ulovlighet|innsyn|møteinnkalling|postmottak|arkiv|anmodning om dokument|bero|stanset|avsluttet|trukket|tilbakekalt|spørsmål|veiledning|gebyr|høring/i;
let cachedResult = null;
let pendingRequest = null;

const day = (date) => date.toISOString().slice(0, 10);
const textOf = (item) => [item.case_title, item.document_title, item.document_type, item.document_other_info?.case_description].filter(Boolean).join(" ");

async function fetchDay(date) {
  const params = new URLSearchParams({
    query: "bygg OR bygge OR byggje OR byggesak OR byggjesak OR byggesøknad OR byggjesøknad OR byggetillatelse OR byggjeløyve OR rammetillatelse OR rammeløyve OR igangsetting OR igangsetjing OR igangsettingstillatelse OR igangsettingsløyve OR igangsetjingsløyve OR tilbygg OR påbygg OR bruksendring OR garasje OR bolig OR bustad OR næring OR fasade OR tak OR terreng OR mur OR oppføring OR rivning OR riving OR fradeling OR frådeling OR seksjonering OR dispensasjon OR løyve",
    "must[entity_id]": "5001-trondheim-kommune",
    "must[document_recorded_date]": date,
    json: "",
  });
  const response = await fetch(`${source}?${params}`, {
    headers: { accept: "application/json", "user-agent": userAgent },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Norske postlister svarte HTTP ${response.status}`);
  return response.json();
}

async function fetchReport() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - lookbackDays + 1);
  const dates = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(day(cursor));
  const results = await Promise.all(dates.map(async (date) => {
    try { return { date, payload: await fetchDay(date) }; }
    catch (error) { return { date, error: error instanceof Error ? error.message : String(error) }; }
  }));
  const documents = results.flatMap(({ payload }) => Array.isArray(payload?.documents) ? payload.documents : [])
    .filter((item) => { const text = textOf(item); return include.test(text) && !exclude.test(text); });
  const uniqueDocuments = [...new Map(documents.map((item) => [item.document_id || `${item.case_serial_number}|${item.document_title}`, item])).values()];
  const uniqueCases = [...new Map(uniqueDocuments.map((item) => [item.case_serial_number || item.case_id || item.document_id, item])).values()];
  const failedDays = results.filter((result) => result.error).map((result) => ({ date: result.date, error: result.error }));
  return {
    generatedAt: new Date().toISOString(), adapter: "trondheim-norske-postlister-json", municipality: "Trondheim kommune", municipalityNumber: "5001", source, sourceType: "private-control-source", lookbackDays, doesNotModifyNbrProjectFiles: true, status: failedDays.length ? "partial" : "ok", error: failedDays.length ? `${failedDays.length} dagsøk feilet` : null,
    counts: { rawReturned: documents.length, uniqueDocumentsAfterCaseDeduplication: uniqueDocuments.length, uniqueCasesAfterCaseDeduplication: uniqueCases.length },
    failedDays,
    examples: uniqueDocuments.slice(0, 50).map((item) => ({ caseNumber: item.case_serial_number, title: item.case_title || item.document_title, documentTitle: item.document_title, date: item.document_recorded_date, type: item.document_type, caseType: item.document_other_info?.case_description, sourceUrl: item._links?.searchCaseAndDoc?.href ? new URL(item._links.searchCaseAndDoc.href, source).href : source })),
    filter: { include: include.source, exclude: exclude.source },
  };
}

export async function fetchTrondheimNplBuildingCases({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedResult && cachedResult.expiresAt > Date.now()) return cachedResult.report;
  if (pendingRequest) return pendingRequest;
  pendingRequest = fetchReport().then((report) => { cachedResult = { report, expiresAt: Date.now() + cacheTtlMs }; return report; }).catch((caught) => ({
    generatedAt: new Date().toISOString(), adapter: "trondheim-norske-postlister-json", municipality: "Trondheim kommune", municipalityNumber: "5001", source, sourceType: "private-control-source", lookbackDays, doesNotModifyNbrProjectFiles: true, status: "unavailable", error: caught instanceof Error ? caught.message : String(caught), counts: null, failedDays: [], examples: [], filter: { include: include.source, exclude: exclude.source },
  })).finally(() => { pendingRequest = null; });
  return pendingRequest;
}
