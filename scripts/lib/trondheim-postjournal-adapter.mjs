import { chromium } from "playwright";

const sourceUrl = "https://trondheim.innsynsportal.no/postjournal-v2/fc010204-2c07-4f3c-a8ef-879ec218111c";
const municipality = "Trondheim kommune";
const municipalityNumber = "5001";
const lookbackDays = 100;
const sliceDays = 7;
const maxPages = 80;
const include = /bygg|bygge|byggje|byggesak|byggjesak|byggesøknad|byggjesøknad|byggetillatelse|byggjeløyve|rammetillatelse|rammeløyve|igangsetting|igangsetjing|igangsettingstillatelse|igangsettingsløyve|igangsetjingsløyve|tilbygg|påbygg|bruksendring|garasje|fasade|tak|terreng|mur|oppføring|rivning|riving|fradeling|frådeling|seksjonering|dispensasjon|nabovarsel|eigedom|eiendom|løyve/i;
const exclude = /adress(?:e)?endring|avslag|klage|ferdigmelding|ferdigattest|tilsyn|ulovlighet|ulovleg|ulovlig|innsyn|møteinnkalling|postmottak|arkiv|anmodning om dokument|bero|stanset|avsluttet|avslutta|trukket|trekt|tilbakekalt|tilbakekalla|spørsmål|veiledning|gebyr|høring|høyring/i;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isoDay = (value) => value.toISOString().slice(0, 10);
const dateText = (value) => {
  const match = clean(value).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
};
const canonicalKey = (row) => `${row.caseNumber}|${row.documentDate}|${row.title}`.toLocaleLowerCase("nb-NO");
const caseNumberFromDocumentId = (value) => clean(value).replace(/-\d+$/, "");
const detailValue = (details, label, nextLabels = []) => {
  details = clean(details);
  const stop = nextLabels.length ? `(?=\\s+(?:${nextLabels.join("|")}):|$)` : "$";
  return details.match(new RegExp(`${label}:\\s*(.*?)${stop}`, "i"))?.[1]?.trim() || "";
};

function rollingWindow() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - lookbackDays + 1);
  return { from: isoDay(from), to: isoDay(to) };
}

function resultUrl({ from, to }) {
  const params = encodeURIComponent(JSON.stringify({
    fromDate: `${from}T00:00:00.000Z`,
    toDate: `${to}T00:00:00.000Z`,
    selectToDate: true,
  }));
  return `${sourceUrl}?params=${params}`;
}

async function loadAllRows(page, { includeDetails = true } = {}) {
  let previousCount = -1;
  for (let attempt = 0; attempt < maxPages; attempt += 1) {
    const count = await page.locator("table tbody tr").count();
    const more = page.getByRole("button", { name: "Last flere", exact: true });
    if (!await more.count() || count === previousCount) break;
    previousCount = count;
    await more.click();
    await page.waitForTimeout(450);
  }
  const rows = page.locator("table tbody tr");
  const parsed = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const raw = await row.evaluate((element) => {
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const cells = [...element.querySelectorAll("td")].map((cell) => normalize(cell.innerText));
    const links = [...element.querySelectorAll("a")].map((link) => ({ text: normalize(link.innerText), href: link.href }));
    const buttons = [...element.querySelectorAll("button")].map((button) => normalize(button.innerText));
    return { cells, links, buttons };
    });
    const more = row.getByRole("button", { name: "Mer", exact: true });
    if (includeDetails && await more.count()) {
      await more.click();
      await page.waitForTimeout(40);
      raw.detailText = String(await row.locator('[role="menu"]').innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      await more.click().catch(() => {});
    }
    parsed.push(raw);
  }
  return parsed;
}

function parseRow(row) {
  const [caseNumber, documentDateText, recordedDateText, typeCode, title] = row.cells;
  const text = clean(title);
  return {
    sourceStream: "municipal_jupiter_postjournal_browser",
    sourceKey: "trondheim_jupiter_bygg_og_plan",
    sourceDocumentId: caseNumber,
    municipality,
    municipalityNumber,
    caseNumber: caseNumberFromDocumentId(caseNumber),
    documentNumber: clean(caseNumber),
    title: text,
    documentTitle: text,
    shortFacts: text,
    documentDate: dateText(documentDateText),
    recordedDate: dateText(recordedDateText),
    documentTypeCode: clean(typeCode),
    documentType: typeCode === "I" ? "Inngående dokument" : typeCode === "U" ? "Utgående dokument" : typeCode === "N" ? "Internt notat" : "Ikke oppgitt",
    documentUrl: row.links.find((link) => link.text === "Last ned")?.href || "",
    caseUrl: sourceUrl,
    attachmentsListed: row.cells.find((cell) => /Vedlegg \(/i.test(cell)) || "",
    detailText: row.detailText || "",
    status: detailValue(row.detailText, "Status", ["Enhet", "Saksart", "Type", "Mottaker", "Saksbehandler"]),
    unit: detailValue(row.detailText, "Enhet", ["Saksart", "Type", "Mottaker", "Saksbehandler"]),
    caseType: detailValue(row.detailText, "Saksart", ["Type", "Mottaker", "Saksbehandler"]),
    recipient: detailValue(row.detailText, "Mottaker", ["Saksbehandler"]),
    caseOfficer: detailValue(row.detailText, "Saksbehandler"),
    sourceQueries: ["portal: Bygg og Plan; fritekstfilter ikke brukt"],
    actorVisibility: "åpent i kilde",
    hasAnonymizedActor: /xxxx|sladdet|anonym/i.test(text),
    files: row.links.filter((link) => link.text !== "Last ned"),
  };
}

export async function fetchTrondheimPostjournalCases({ from, to, headless = true, includeDetails = true } = {}) {
  const window = { ...rollingWindow(), ...(from && { from }), ...(to && { to }) };
  const browser = await chromium.launch({ headless });
  try {
    const page = await browser.newPage();
    const start = new Date(`${window.from}T00:00:00Z`);
    const end = new Date(`${window.to}T00:00:00Z`);
    const rows = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + sliceDays)) {
      const sliceEnd = new Date(cursor);
      sliceEnd.setUTCDate(sliceEnd.getUTCDate() + sliceDays - 1);
      if (sliceEnd > end) sliceEnd.setTime(end.getTime());
      await page.goto(resultUrl({ from: isoDay(cursor), to: isoDay(sliceEnd) }), { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(700);
      rows.push(...await loadAllRows(page, { includeDetails }));
    }
    const candidates = rows.map(parseRow).filter((row) => include.test(row.title) && !exclude.test(row.title));
    const unique = [...new Map(candidates.map((row) => [canonicalKey(row), row])).values()];
    return {
      generatedAt: new Date().toISOString(),
      adapter: "trondheim-municipality-jupiter-postjournal-browser",
      municipality,
      municipalityNumber,
      source: sourceUrl,
      sourceType: "official-public-browser",
      lookbackDays,
      sliceDays,
      includeDetails,
      dateWindow: window,
      doesNotModifyNbrProjectFiles: true,
      status: "ok",
      counts: { rowsRead: rows.length, afterNbrFilter: candidates.length, uniqueDocuments: unique.length, uniqueCases: new Set(unique.map((row) => row.caseNumber)).size },
      filter: { include: include.source, exclude: exclude.source },
      projects: unique,
    };
  } finally {
    await browser.close();
  }
}
