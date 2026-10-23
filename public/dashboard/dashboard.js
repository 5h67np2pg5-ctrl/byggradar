const userVersion = 442;
const dashboardBuildVersion = 462;
const DASHBOARD_VERSION = userVersion + dashboardBuildVersion;
const DASHBOARD_PASSWORD = "norskbyggradar3000";
const dashboardAuthKey = "nbr-dashboard-auth-v1";
const dashboardSupplierHandoffKey = "nbr-dashboard-supplier-handoff";
const dashboardRegionContextKey = "nbr-dashboard-region-context";
const dashboardCustomerLoginKey = "nbr-dashboard-customer-login";
const overviewSnapshotKey = "nbr-dashboard-overview-snapshot";
const supplierCalledStorageKey = "nbr-supplier-called-v1";
const supplierContactNoteStorageKey = "nbr-supplier-contact-note-v1";
const manualSupplierStorageKey = "nbr-dashboard-manual-suppliers-v1";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
const getSupplier = () => {
  try {
    const rawSupplier = sessionStorage.getItem(dashboardSupplierHandoffKey);
    // Dashboardet skal bare åpnes med virksomhet når den nettopp er valgt
    // fra virksomhetsoversikten. Gamle valg skal ikke bli hengende igjen.
    sessionStorage.removeItem(dashboardSupplierHandoffKey);
    const supplier = JSON.parse(rawSupplier || "null");
    return supplier && typeof supplier === "object" ? supplier : null;
  } catch { return null; }
};

let supplier = getSupplier();
const app = document.querySelector("#dashboardApp");
let profileLookupStarted = false;
let mapOverviewStarted = false;
let dashboardMap = null;
let dashboardProjects = [];
let dashboardCustomerPoint = null;
let regionalSuppliers = [];
let dashboardTradeFilter = "";
let regionalSuppliersLoading = false;
let regionalSupplierRequestId = 0;
let regionalSupplierAbortController = null;
let dashboardServerNotes = {};
let dashboardNoteSaveQueue = Promise.resolve();
let dashboardContactNoteIndex = null;
let dashboardCustomerRecord = null;
let dashboardCustomerFormOpen = false;
let customerOverviewOpen = false;
let customerRecords = [];
let customerTradeFilter = "";
let regionalSupplierSearchResult = null;
let regionalSupplierSearchLoading = false;
let regionalSupplierSearchRequestId = 0;

function sortSuppliersAlphabetically(suppliers) {
  return [...suppliers].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "nb-NO", { sensitivity: "base" }));
}
function dedupeDashboardSuppliers(suppliers) {
  const seen = new Map();
  for (const supplier of suppliers) {
    const organizationNumber = String(supplier.organizationNumber || supplier.orgNumber || "").replace(/\D/g, "");
    const normalizedName = String(supplier.name || supplier.company || "").toLocaleLowerCase("nb-NO").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(aksjeselskap|allmennaksjeselskap|as|asa|ans|da|sa|nuf)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const address = String(supplier.address || supplier.businessAddress || supplier.registeredAddress || "").trim().toLocaleLowerCase("nb-NO");
    const key = normalizedName ? `name:${normalizedName}` : organizationNumber ? `org:${organizationNumber}` : address ? `address:${address}` : "";
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, supplier);
      continue;
    }
    const merged = { ...existing, ...supplier };
    if (!merged.organizationNumber && existing.organizationNumber) merged.organizationNumber = existing.organizationNumber;
    if (!merged.orgNumber && existing.orgNumber) merged.orgNumber = existing.orgNumber;
    if (existing.sources || supplier.sources) merged.sources = [...new Set([...(existing.sources || []), ...(supplier.sources || [])])];
    if (!merged.dashboardContactNote && existing.dashboardContactNote) merged.dashboardContactNote = existing.dashboardContactNote;
    if (!merged.phone && existing.phone) merged.phone = existing.phone;
    if (!merged.address && existing.address) merged.address = existing.address;
    seen.set(key, merged);
  }
  return [...seen.values()];
}
function hydrateDashboardContactNotes(suppliers) {
  return suppliers.map((supplier) => {
    const note = readDashboardContactNote(supplier);
    return note.heading || note.text ? { ...supplier, dashboardContactNote: note } : supplier;
  });
}
let defaultRegionContext = { id: "bergensregionen", name: "Bergensregionen", municipalities: ["Bergen kommune", "Askøy kommune", "Øygarden kommune", "Bjørnafjorden kommune", "Osterøy kommune", "Alver kommune", "Samnanger kommune", "Vaksdal kommune", "Austevoll kommune", "Kvam herad", "Voss herad", "Modalen kommune", "Masfjorden kommune", "Austrheim kommune", "Fedje kommune", "Gulen kommune", "Tysnes kommune"] };
let dashboardRegions = [defaultRegionContext];

async function loadDashboardRegions() {
  try {
    const response = await fetch(`/config/region-structure.json?dashboard=${DASHBOARD_VERSION}`);
    if (!response.ok) throw new Error(`Regionstrukturen kunne ikke lastes (${response.status}).`);
    const payload = await response.json();
    const regions = Array.isArray(payload.regions) ? payload.regions.filter((region) => region?.id && region?.name && Array.isArray(region.municipalities)) : [];
    if (!regions.length) throw new Error("Regionstrukturen er tom.");
    dashboardRegions = regions.map((region) => ({ id: String(region.id), name: String(region.name), municipalities: region.municipalities.map(String) }));
    defaultRegionContext = dashboardRegions.find((region) => region.id === "bergensregionen") || dashboardRegions[0];
  } catch { /* En Bergen-fallback holder dashboardet tilgjengelig ved midlertidig konfigurasjonsfeil. */ }
}

async function startDashboard() {
  await loadDashboardRegions();
  await loadDashboardContactNotes();
  await loadDashboardCustomerRecord();
  if (!supplier) {
    const loggedInCustomer = readDashboardCustomerLogin();
    const matchedRegion = resolveCustomerRegion(loggedInCustomer?.municipality)
      || dashboardRegions.find((region) => region.id === loggedInCustomer?.regionId);
    try {
      if (matchedRegion) sessionStorage.setItem(dashboardRegionContextKey, JSON.stringify(matchedRegion));
      else sessionStorage.removeItem(dashboardRegionContextKey);
    } catch { /* Oppstart skal være uten tidligere regionvalg når kunden ikke er identifisert. */ }
    regionalSupplierAbortController?.abort();
    regionalSupplierAbortController = null;
    regionalSuppliers = [];
  }
  render();
}

async function loadDashboardContactNotes() {
  let serverNotes = {};
  try {
    const response = await fetch(`/api/dashboard-supplier-notes?t=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    serverNotes = payload?.notes && typeof payload.notes === "object" ? payload.notes : {};
  } catch { /* Lokal lagring brukes fortsatt som reserve. */ }
  let local = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(supplierContactNoteStorageKey) || "{}");
    local = parsed && typeof parsed === "object" ? parsed : {};
  } catch { /* Serverregisteret skal fortsatt brukes når nettleseren blokkerer lokal lagring. */ }
  dashboardServerNotes = { ...serverNotes, ...local };
  dashboardContactNoteIndex = null;
  if (Object.keys(local).length) persistDashboardNotes(dashboardServerNotes);
}

function persistDashboardNotes(notes) {
  const snapshot = notes && typeof notes === "object" ? structuredClone(notes) : {};
  dashboardNoteSaveQueue = dashboardNoteSaveQueue
    .catch(() => {})
    .then(async () => {
      const response = await fetch("/api/dashboard-supplier-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: snapshot }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`Kommentarer kunne ikke lagres (${response.status}).`);
    });
  return dashboardNoteSaveQueue;
}

function getRegionContext() {
  const supplierRegionId = supplier?.dashboardRegionId;
  if (supplierRegionId) {
    return {
      id: supplierRegionId,
      name: supplier.dashboardRegionName || supplierRegionId,
      municipalities: supplier.dashboardMunicipalities || [],
    };
  }
  try {
    const context = JSON.parse(
      sessionStorage.getItem(dashboardRegionContextKey)
      || "null",
    );
    if (context?.id && Array.isArray(context.municipalities)) return context;
  } catch { /* Bruk standardregion dersom arbeidsøkten ikke har regionkontekst. */ }
  return null;
}

function dashboardIsAuthenticated() {
  try { return sessionStorage.getItem(dashboardAuthKey) === "ok"; }
  catch { return false; }
}

function readDashboardCustomerLogin() {
  try { return JSON.parse(sessionStorage.getItem(dashboardCustomerLoginKey) || "null"); }
  catch { return null; }
}

function renderAccessGate() {
  app.innerHTML = `
    <main class="dashboard-gate">
      <a class="dashboard-gate-brand" href="/user" aria-label="Norsk ByggRadar dashboard"><img src="/assets/byggradar-radar.png" alt="" /><span>Norsk ByggRadar</span></a>
      <section class="dashboard-gate-panel">
        <span class="eyebrow">Beskyttet selgerflate</span>
        <h1>Logg inn til Dashboard</h1>
        <p>Skriv inn tilgangskoden for å åpne virksomhetsdashboardet.</p>
        <form id="dashboardLoginForm">
          <label for="dashboardUsername">Kundebrukernavn (valgfritt)</label>
          <input id="dashboardUsername" type="text" autocomplete="username" />
          <label for="dashboardPassword">Tilgangskode eller kundepassord</label>
          <input id="dashboardPassword" type="password" autocomplete="current-password" required />
          <button type="submit">Åpne dashboard</button>
          <div id="dashboardLoginError" class="dashboard-login-error" role="alert" hidden>Tilgangskoden er ikke riktig.</div>
        </form>
        <a class="dashboard-gate-back" href="/user">Tilbake til brukerplattformen</a>
      </section>
    </main>`;
  document.querySelector("#dashboardLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector("#dashboardPassword");
    const usernameInput = document.querySelector("#dashboardUsername");
    const error = document.querySelector("#dashboardLoginError");
    if (input.value === DASHBOARD_PASSWORD) {
      try { sessionStorage.setItem(dashboardAuthKey, "ok"); sessionStorage.removeItem(dashboardCustomerLoginKey); } catch { /* Tilgang gjelder bare for aktiv nettleserøkt. */ }
      void startDashboard();
      return;
    }
    if (usernameInput?.value.trim()) {
      try {
        const response = await fetch("/api/customer-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: usernameInput.value, password: input.value }) });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.customer) {
          sessionStorage.setItem(dashboardAuthKey, "ok");
          sessionStorage.setItem(dashboardCustomerLoginKey, JSON.stringify(payload.customer));
          void startDashboard();
          return;
        }
      } catch { /* Feil vises som ordinær innloggingsfeil. */ }
    }
    error.hidden = false;
    input.select();
  });
}

function valueOrFallback(value, fallback = "Ikke oppgitt") {
  return String(value || "").trim() || fallback;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function projectCoordinates(project) {
  const location = project?.locationEnrichment || project?.location || {};
  const coordinates = project?.coordinates || project?.geometry?.coordinates;
  const latitude = Number(firstValue(location.latitude, project?.latitude, project?.lat, Array.isArray(coordinates) ? coordinates[1] : coordinates?.lat));
  const longitude = Number(firstValue(location.longitude, project?.longitude, project?.lon, project?.lng, Array.isArray(coordinates) ? coordinates[0] : coordinates?.lon));
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= 57 && latitude <= 72 && longitude >= 3 && longitude <= 32
    ? { lat: latitude, lon: longitude }
    : null;
}

function projectAddress(project) {
  return firstValue(project?.address, project?.locationEnrichment?.address, project?.location, project?.place);
}

function inferDashboardProjectTypes(project) {
  const text = String([
    project?.caseTitle,
    project?.documentTitle,
    project?.title,
    project?.shortFacts,
    project?.description,
    project?.measureType,
    project?.projectType,
  ].filter(Boolean).join(" ")).toLocaleLowerCase("nb-NO");
  const matches = [
    ["Tilbygg/påbygg", /tilbygg|tilbygging|påbygg|pabygg|utvidelse|utviding/],
    ["Fasadeendring", /fasadeendring|fasade/],
    ["Ombygging/rehabilitering", /ombygg|rehabiliter|oppgradering|modernisering/],
    ["Bruksendring", /bruksendring|endring av bruk/],
    ["Nybygg", /nybygg|oppføring|oppforing|ny bolig|ny bustad/],
    ["Garasje/bod", /garasje|carport|bod|uthus/],
    ["Terrengarbeid", /terreng|planering|fylling|støttemur|stottemur/],
    ["Riving", /riving|rive|rivning/],
    ["Seksjonering", /seksjonering|reseksjonering/],
    ["Næring/offentlig", /næring|naering|kontor|lager|butikk|offentlig|skole|barnehage/],
  ];
  return matches.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function projectType(project) {
  const classification = project?.classification || {};
  const explicit = (Array.isArray(classification.projectTypes)
    ? classification.projectTypes
    : [classification.projectTypes, project?.projectType, project?.measureType, project?.tiltakstype]
  ).filter((value) => value && !/^(ukjent|ukjent tiltak|ikke oppgitt|ikke tolket)$/i.test(String(value).trim()));
  const inferred = inferDashboardProjectTypes(project);
  const types = [...explicit, ...inferred].filter((value, index, values) => (
    values.findIndex((candidate) => String(candidate).toLocaleLowerCase("nb-NO") === String(value).toLocaleLowerCase("nb-NO")) === index
  ));
  return types.join(", ") || firstValue(project?.status, project?.documentType);
}

function projectPhase(project) {
  const classification = project?.classification || {};
  const phaseCandidate = firstValue(classification.phase, classification.stage, project?.phase, project?.stage);
  if (/^fase\s*[1-5]$/i.test(String(phaseCandidate || "").trim())) {
    return String(phaseCandidate).replace(/\s+/g, " ").replace(/^fase\s*/i, "Fase ");
  }
  const status = String(firstValue(classification.stage, project?.status, project?.stage, project?.documentType) || "").toLocaleLowerCase("nb-NO");
  return /igangsetting|tillatelse|rammetillatelse|anbud|kontrakt/.test(status) ? "Fase 2" : "Fase 1";
}

function projectDate(project) {
  return firstValue(project?.documentDate, project?.recordedDate, project?.registeredDate, project?.date);
}

function formatProjectDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("nb-NO");
}

function projectLabel(project) {
  return [projectAddress(project), projectType(project)].filter(Boolean).join(" · ") || firstValue(project?.caseTitle, project?.shortFacts, "Prosjekt");
}

function projectCollection(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.projects) ? payload.projects : [];
}

function tradeFromIndustryCode(value) {
  const code = String(value || "").trim().replace(/\s/g, "");
  if (!code) return "";
  const mappings = [
    [/^43\.21/, "Elektro"],
    [/^43\.22/, "Rørlegger"],
    [/^43\.29/, "Tekniske installasjoner"],
    [/^43\.31/, "Murer"],
    [/^43\.32/, "Tømrer"],
    [/^43\.33/, "Gulv- og veggarbeid"],
    [/^43\.34/, "Maler"],
    [/^43\.39/, "Bygg og ferdigstilling"],
    [/^43\.91/, "Tak"],
    [/^43\.99/, "Entreprenør"],
    [/^43\./, "Bygg og anlegg"],
    [/^41\./, "Bygg og eiendom"],
    [/^42\./, "Anlegg og infrastruktur"],
    [/^71\.11/, "Arkitekt"],
    [/^71\.12/, "Rådgivende ingeniør"],
    [/^71\./, "Prosjektering og rådgivning"],
    [/^68\./, "Eiendom"],
  ];
  return mappings.find(([pattern]) => pattern.test(code))?.[1] || "";
}

function distanceKm(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function formatRevenue(value) {
  if (typeof value === "number") return `${new Intl.NumberFormat("nb-NO").format(value)} kr`;
  return String(value || "").trim();
}

function formatFact(value, suffix = "") {
  const text = String(value || "").trim();
  return text ? `${text}${suffix}` : "";
}

function formatCheckedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `Kontrollert ${date.toLocaleDateString("nb-NO")}`;
}

function normalizeWebsite(value) {
  const text = String(value || "").trim();
  if (!text || text.includes("mittanbud.no/bedrift/")) return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function factMarkup(label, value, meta = "") {
  if (!String(value || "").trim()) return "";
  return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${meta ? `<small>${esc(meta)}</small>` : ""}</div>`;
}

function metricMarkup(label, value, meta = "") {
  return `<div><dt>${esc(label)}</dt><dd>${esc(valueOrFallback(value))}</dd>${meta ? `<small>${esc(meta)}</small>` : ""}</div>`;
}

function supplierAddress(value) {
  return firstValue(
    value?.address,
    value?.businessAddress,
    value?.companyAddress,
    value?.registeredAddress,
    value?.forretningsadresse,
    value?.contactAddress,
    value?.location?.address,
  );
}

function syncDashboardMapAddress(value) {
  const input = document.querySelector("#dashboardCustomerAddress");
  const address = String(supplierAddress(value) || "").trim();
  if (input && address && address !== "Ikke oppgitt") input.value = address;
}

function dashboardContactNoteKeys(value) {
  const identities = [value?.organizationNumber, value?.orgNumber, value?.name]
    .map((item) => String(item || "").trim().toLocaleLowerCase("nb-NO"))
    .filter(Boolean);
  const normalizedName = dashboardNormalizedName(value?.name);
  if (normalizedName) identities.push(`normalized-name:${normalizedName}`);
  const address = String(supplierAddress(value) || "").trim().toLocaleLowerCase("nb-NO");
  return [...new Set([...identities, ...identities.map((identity) => address ? `${identity}|${address}` : "").filter(Boolean)])];
}

function dashboardNormalizedName(value) {
  return String(value || "").toLocaleLowerCase("nb-NO")
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(aksjeselskap|allmennaksjeselskap|as|asa|ans|da|sa|nuf)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function readDashboardContactNote(value) {
  const inline = value?.dashboardContactNote || value?.contactNote;
  if (inline && typeof inline === "object") {
    return { heading: String(inline.heading || "").slice(0, 40), text: String(inline.text || "").slice(0, 50) };
  }
  const stored = dashboardContactNoteKeys(value).map((key) => getDashboardContactNoteIndex().get(key)).find(Boolean);
  return stored && typeof stored === "object"
    ? { heading: String(stored.heading || "").slice(0, 40), text: String(stored.text || "").slice(0, 50) }
    : { heading: "", text: "" };
}

function getDashboardContactNoteIndex() {
  if (dashboardContactNoteIndex) return dashboardContactNoteIndex;
  const index = new Map();
  const addSupplierNote = (value, note) => {
    if (!note || typeof note !== "object") return;
    dashboardContactNoteKeys(value).forEach((key) => index.set(key, note));
  };
  const addStoredEntry = (key, note) => {
    if (!note || typeof note !== "object") return;
    index.set(String(key), note);
    const candidate = String(key).replace(/^normalized-name:/, "").split("|")[0];
    const normalized = dashboardNormalizedName(candidate);
    if (normalized) index.set(`normalized-name:${normalized}`, note);
  };
  Object.entries(dashboardServerNotes || {}).forEach(([key, note]) => addStoredEntry(key, note));
  try {
    const parsed = JSON.parse(localStorage.getItem(supplierContactNoteStorageKey) || "{}");
    if (parsed && typeof parsed === "object") Object.entries(parsed).forEach(([key, note]) => addStoredEntry(key, note));
  } catch { /* Serverregisteret brukes når lokal lagring ikke er tilgjengelig. */ }
  try {
    const snapshot = JSON.parse(sessionStorage.getItem(overviewSnapshotKey) || "null");
    if (Array.isArray(snapshot?.suppliers)) snapshot.suppliers.forEach((item) => addSupplierNote(item, item.dashboardContactNote || item.contactNote));
  } catch { /* Notater skal ikke stoppe virksomhetslisten. */ }
  dashboardContactNoteIndex = index;
  return index;
}

function saveDashboardContactNote(value, heading, text) {
  const entry = { heading: String(heading || "").slice(0, 40), text: String(text || "").slice(0, 50) };
  if (value && typeof value === "object") value.dashboardContactNote = entry;
  try {
    const notes = JSON.parse(localStorage.getItem(supplierContactNoteStorageKey) || "{}");
    dashboardContactNoteKeys(value).forEach((key) => { notes[key] = entry; });
    dashboardContactNoteKeys(value).forEach((key) => { dashboardServerNotes[key] = entry; });
    localStorage.setItem(supplierContactNoteStorageKey, JSON.stringify(notes));
    dashboardContactNoteIndex = null;
    persistDashboardNotes(dashboardServerNotes);
  } catch { /* Notatet gjelder bare når nettleseren tillater lokal lagring. */ }
}

function saveEnrichedSupplierToOverview(value) {
  try {
    const snapshot = JSON.parse(sessionStorage.getItem(overviewSnapshotKey) || "null");
    if (!snapshot || !Array.isArray(snapshot.suppliers)) return;
    const keys = dashboardContactNoteKeys(value);
    snapshot.suppliers = snapshot.suppliers.map((item) => (
      dashboardContactNoteKeys(item).some((key) => keys.includes(key))
        ? { ...item, ...value }
        : item
    ));
    sessionStorage.setItem(overviewSnapshotKey, JSON.stringify(snapshot));
  } catch { /* Oversikten beholder eksisterende data ved blokkert øktlagring. */ }
}

async function loadDashboardCustomerRecord() {
  const organizationNumber = String(supplier?.organizationNumber || supplier?.orgNumber || "").replace(/\D/g, "");
  const companyName = String(supplier?.name || supplier?.company || "").trim();
  if (!organizationNumber && !companyName) return;
  try {
    const query = organizationNumber
      ? `organizationNumber=${encodeURIComponent(organizationNumber)}`
      : `companyName=${encodeURIComponent(companyName)}`;
    const response = await fetch(`/api/customer-records?${query}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.record) dashboardCustomerRecord = payload.record;
  } catch { /* Kundeopprettelsen kan startes uten at et tidligere utkast finnes. */ }
}

async function loadDashboardCustomerRecords() {
  try {
    const response = await fetch("/api/customer-records", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    customerRecords = response.ok && Array.isArray(payload.records) ? payload.records : [];
  } catch {
    customerRecords = [];
  }
}

function customerRecordValue(record, ...keys) {
  return keys.map((key) => record?.[key]).find((value) => String(value || "").trim()) || "Ikke oppgitt";
}

function renderCustomerRecordRows() {
  const rows = document.querySelector("#customerOverviewRows");
  const count = document.querySelector("#customerOverviewCount");
  const visible = customerTradeFilter
    ? customerRecords.filter((record) => String(record.trade || "").toLocaleLowerCase("nb-NO") === customerTradeFilter.toLocaleLowerCase("nb-NO"))
    : customerRecords;
  const ordered = [...visible].sort((left, right) => String(left.companyName || "").localeCompare(String(right.companyName || ""), "nb-NO", { sensitivity: "base" }));
  if (count) count.textContent = `${ordered.length.toLocaleString("nb-NO")} kunder`;
  if (!ordered.length) {
    if (rows) rows.innerHTML = `<p class="dashboard-map-status">Ingen registrerte kunder${customerTradeFilter ? ` i bransjen ${esc(customerTradeFilter)}` : ""}.</p>`;
    return;
  }
  if (rows) rows.innerHTML = ordered.map((record) => {
    const organizationNumber = customerRecordValue(record, "organizationNumber");
    const contact = customerRecordValue(record, "contactPerson");
    const phone = customerRecordValue(record, "phone");
    const email = customerRecordValue(record, "email", "invoiceEmail");
    const region = customerRecordValue(record, "regionName");
    const model = customerRecordValue(record, "model");
    const interval = customerRecordValue(record, "billingInterval");
    const annualCost = customerRecordValue(record, "annualCost");
    return `<article class="customer-overview-row"><div class="customer-overview-main"><strong>${esc(customerRecordValue(record, "companyName"))}</strong><span>${esc(customerRecordValue(record, "trade"))}</span></div><div><b>Organisasjonsnummer</b><span>${esc(organizationNumber)}</span></div><div><b>Kontakt</b><span>${esc(contact)} · ${esc(phone)}</span><span>${esc(email)}</span></div><div><b>Område</b><span>${esc(region)}</span></div><div><b>Avtale</b><span>${esc(model)} · ${esc(interval)}</span><span>År: ${esc(annualCost)}</span></div></article>`;
  }).join("");
}

function renderCustomerOverview() {
  app.innerHTML = `
    <main class="dashboard-shell">
      <header class="dashboard-topbar">
        <a class="dashboard-brand" href="/user"><img src="/assets/byggradar-radar.png" alt="" /><span>Norsk ByggRadar</span></a>
        <div class="dashboard-heading"><span>Dashboard</span><strong>Kundeoversikt</strong><small>Registrerte kunder og avtalegrunnlag</small></div>
        <button class="dashboard-customer-overview-button" id="backToSupplierOverview" type="button">Tilbake til virksomhetsoversikt</button>
      </header>
      <section class="dashboard-context"><div><span class="eyebrow">Kunder</span><h1>Alle registrerte kunder</h1><p>Filtrer kunderegisteret på bransje. Kundeopplysninger ligger separat fra prosjekt- og virksomhetsregisteret.</p></div><strong id="customerOverviewCount" class="regional-supplier-count">Laster kunder...</strong></section>
      <main class="dashboard-region-list customer-overview-list"><div class="customer-overview-toolbar"><label for="customerTradeFilter">Bransje</label><select id="customerTradeFilter"><option value="">Alle bransjer</option>${[...new Set(customerRecords.map((record) => String(record.trade || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nb-NO")).map((trade) => `<option value="${esc(trade)}" ${trade === customerTradeFilter ? "selected" : ""}>${esc(trade)}</option>`).join("")}</select></div><div id="customerOverviewRows" class="customer-overview-rows"><p class="dashboard-map-status">Laster kunder...</p></div></main>
    </main>`;
  document.querySelector("#customerTradeFilter")?.addEventListener("change", (event) => {
    customerTradeFilter = String(event.target.value || "");
    renderCustomerRecordRows();
  });
  document.querySelector("#backToSupplierOverview")?.addEventListener("click", () => {
    customerOverviewOpen = false;
    supplier = null;
    renderRegionalSupplierOverview();
  });
  renderCustomerRecordRows();
}

async function openCustomerOverview() {
  customerOverviewOpen = true;
  await loadDashboardCustomerRecords();
  renderCustomerOverview();
}

function bindCustomerOverviewButton() {
  document.querySelector("#openCustomerOverview")?.addEventListener("click", () => { void openCustomerOverview(); });
}

function customerFieldValue(name, fallback = "") {
  return dashboardCustomerRecord?.[name] ?? fallback;
}

function normalizeCustomerMunicipality(value) {
  return String(value || "")
    .toLocaleLowerCase("nb-NO")
    .replace(/[–—-]/g, " ")
    .replace(/\b(kommune|herad|kommuna)\b/g, "")
    .replace(/[^a-z0-9æøå]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCustomerRegion(municipality) {
  const normalized = normalizeCustomerMunicipality(municipality);
  if (!normalized) return null;
  return dashboardRegions.find((region) => region.municipalities.some((item) => normalizeCustomerMunicipality(item) === normalized)) || null;
}

function customerLoginSuggestion(companyName, organizationNumber) {
  const normalizedName = String(companyName || "kunde")
    .toLocaleLowerCase("nb-NO")
    .replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 18) || "kunde";
  const digits = String(organizationNumber || "").replace(/\D/g, "");
  const suffix = digits.slice(-4) || "2026";
  return { username: `${normalizedName}.${suffix}`, password: `NBR-${normalizedName.slice(0, 6).toUpperCase()}-${suffix}!` };
}

function parseCustomerCost(value) {
  const normalized = String(value || "").trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatCustomerCost(value) {
  return Number(value.toFixed(2)).toLocaleString("nb-NO", { useGrouping: false, maximumFractionDigits: 2 });
}

function bindCustomerCostCalculation() {
  const form = document.querySelector("#customerRecordForm");
  if (!form) return;
  const fields = {
    monthlyCost: form.elements.namedItem("monthlyCost"),
    quarterlyCost: form.elements.namedItem("quarterlyCost"),
    halfYearCost: form.elements.namedItem("halfYearCost"),
    annualCost: form.elements.namedItem("annualCost"),
  };
  const discountField = form.elements.namedItem("discount");
  const multipliers = { monthlyCost: 1, quarterlyCost: 3, halfYearCost: 6, annualCost: 12 };
  const parseDiscount = () => Math.min(100, Math.max(0, parseCustomerCost(discountField?.value) || 0));
  let monthlyBasis = null;
  const initialMonthly = parseCustomerCost(fields.monthlyCost?.value);
  if (initialMonthly !== null) monthlyBasis = initialMonthly / (1 - parseDiscount() / 100);

  const applyCustomerCosts = () => {
    if (monthlyBasis === null) return;
    const netMultiplier = 1 - parseDiscount() / 100;
    Object.entries(fields).forEach(([fieldName, field]) => {
      if (field) field.value = formatCustomerCost(monthlyBasis * multipliers[fieldName] * netMultiplier);
    });
  };

  Object.entries(fields).forEach(([sourceName, sourceField]) => {
    sourceField?.addEventListener("input", () => {
      const sourceValue = parseCustomerCost(sourceField.value);
      if (sourceValue === null) return;
      monthlyBasis = sourceValue / multipliers[sourceName];
      applyCustomerCosts();
    });
  });
  discountField?.addEventListener("input", applyCustomerCosts);
}

async function saveDashboardCustomerRecord(form) {
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  const organizationNumber = String(supplier?.organizationNumber || supplier?.orgNumber || payload.organizationNumber || "").replace(/\D/g, "");
  const matchedRegion = resolveCustomerRegion(payload.municipality);
  const loginSuggestion = customerLoginSuggestion(payload.companyName || supplier?.name, organizationNumber);
  const record = {
    ...payload,
    companyName: String(payload.companyName || supplier?.name || "").trim(),
    organizationNumber,
    regionId: matchedRegion?.id || getRegionContext()?.id || supplier?.dashboardRegionId || "",
    regionName: matchedRegion?.name || getRegionContext()?.name || supplier?.dashboardRegionName || "",
    loginUsername: String(payload.loginUsername || loginSuggestion.username).trim(),
    loginPassword: String(payload.loginPassword || loginSuggestion.password).trim(),
  };
  const status = document.querySelector("#customerRecordStatus");
  if (status) status.textContent = "Lagrer kundeopplysninger...";
  try {
    const response = await fetch("/api/customer-records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Kundeopplysningene kunne ikke lagres.");
    dashboardCustomerRecord = result.record || record;
    if (status) status.textContent = "Kundeopplysningene er lagret lokalt og klare for senere fakturaeksport.";
  } catch (error) {
    if (status) status.textContent = error.message || "Kundeopplysningene kunne ikke lagres.";
  }
}

async function enrichBusinessProfile() {
  if (profileLookupStarted || !supplier) return;
  profileLookupStarted = true;
  const selectedSupplier = supplier;
  const params = new URLSearchParams({
    name: String(selectedSupplier.name || ""),
    orgNumber: String(selectedSupplier.organizationNumber || selectedSupplier.orgNumber || ""),
    address: String(supplierAddress(selectedSupplier) || ""),
  });
  try {
    const response = await fetch(`/api/business-profile?${params}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.profile) return;
    if (supplier !== selectedSupplier) return;
    Object.assign(selectedSupplier, payload.profile);
    saveEnrichedSupplierToOverview(selectedSupplier);
    selectedSupplier.profileSource = payload.source || selectedSupplier.profileSource;
    // Vis hovedprofilen med en gang. Eventuelt AI-oppslag skal aldri blokkere
    // telefon, nettsted eller resten av dashboardet.
    if (dashboardMap) {
      dashboardMap.remove();
      dashboardMap = null;
    }
    mapOverviewStarted = false;
    render();
    syncDashboardMapAddress(selectedSupplier);
    if (!selectedSupplier.phone || !firstValue(selectedSupplier.businessWebsite, selectedSupplier.companyWebsite)) {
      void (async () => {
        try {
          const searchResponse = await fetch(`/api/ai-phone-search?q=${encodeURIComponent(selectedSupplier.name || "")}`, { signal: AbortSignal.timeout(4500) });
          const searchPayload = await searchResponse.json().catch(() => ({}));
          if (supplier !== selectedSupplier || !searchResponse.ok) return;
          if (!selectedSupplier.phone && searchPayload.phone) selectedSupplier.phone = searchPayload.phone;
          if (!firstValue(selectedSupplier.businessWebsite, selectedSupplier.companyWebsite) && searchPayload.website) selectedSupplier.businessWebsite = searchPayload.website;
          selectedSupplier.aiSearchSource = searchPayload.source || "AI-søk";
          if (dashboardMap) {
            dashboardMap.remove();
            dashboardMap = null;
          }
          mapOverviewStarted = false;
          render();
        } catch { /* Profilen vises med opplysningene som allerede svarte. */ }
      })();
    }
  } catch { /* Profilen vises med opplysningene som allerede fulgte leverandørlisten. */ }
}

function render() {
  if (!dashboardIsAuthenticated()) {
    renderAccessGate();
    return;
  }
  if (customerOverviewOpen) {
    renderCustomerOverview();
    return;
  }
  if (!supplier) {
    renderRegionalSupplierOverview();
    return;
  }

  const name = valueOrFallback(supplier.name, "Ukjent virksomhet");
  const address = valueOrFallback(supplierAddress(supplier));
  const suppliedTrade = String(supplier.trade || "").trim();
  const usableTrade = suppliedTrade && !/^(fagområde|fagomrade) ikke oppgitt$/i.test(suppliedTrade) ? suppliedTrade : "";
  const industryCode = firstValue(supplier.industryCode, supplier.naceCode, supplier.naeringskode, supplier.næringskode, supplier.nace);
  const industryMeaning = valueOrFallback(firstValue(supplier.industry, tradeFromIndustryCode(industryCode)), "Betydning ikke oppgitt");
  const trade = valueOrFallback(firstValue(usableTrade, supplier.industry, tradeFromIndustryCode(industryCode)), "Fagområde ikke oppgitt");
  const organizationNumber = firstValue(supplier.organizationNumber, supplier.orgNumber);
  const supplierMunicipality = firstValue(supplier.municipality, supplier.municipalityName, supplier.kommune, supplier.kommuneName, supplier.registeredMunicipality, supplier.addressMunicipality);
  const customerMunicipality = customerFieldValue("municipality", supplierMunicipality);
  const customerRegion = resolveCustomerRegion(customerMunicipality) || getRegionContext() || {};
  const loginSuggestion = customerLoginSuggestion(customerFieldValue("companyName", name), customerFieldValue("organizationNumber", organizationNumber));
  const contactNote = readDashboardContactNote(supplier);
  const phone = supplier.phone ? `<a href="tel:${esc(String(supplier.phone).replace(/\D/g, ""))}">${esc(supplier.phone)}</a>` : `<span class="profile-missing">Ikke oppgitt</span>`;
  const companyWebsite = normalizeWebsite(firstValue(supplier.businessWebsite, supplier.companyWebsite));
  const sourceProfileUrl = /^https:\/\/www\.proff\.no\/selskap\//i.test(String(supplier.proffProfileUrl || ""))
    ? supplier.proffProfileUrl
    : "";
  const website = companyWebsite
    ? `<a href="${esc(companyWebsite)}" target="_blank" rel="noreferrer">${esc(companyWebsite.replace(/^https?:\/\//i, "").replace(/\/$/, ""))}</a>`
    : sourceProfileUrl
      ? `<span class="profile-missing">Egen hjemmeside ikke registrert</span> <a href="${esc(sourceProfileUrl)}" target="_blank" rel="noreferrer">Åpne virksomhetsprofil</a>`
      : "Ikke oppgitt";
  const sourceProfile = sourceProfileUrl ? `<a href="${esc(sourceProfileUrl)}" target="_blank" rel="noreferrer">Åpne kildeprofil</a>` : "Ikke oppgitt";
  const organizationForm = firstValue(supplier.organizationForm);
  const legalStatus = firstValue(supplier.status);
  const employeeValue = firstValue(supplier.employees, supplier.numberOfEmployees, supplier.employeeCount, supplier.employeeRange);
  const revenueValue = formatRevenue(firstValue(supplier.revenue, supplier.annualRevenue, supplier.turnover));
  const employeeYear = firstValue(supplier.employeesYear, supplier.employeeYear, supplier.financialYear);
  const revenueYear = firstValue(supplier.revenueYear, supplier.annualRevenueYear, supplier.financialYear);
  const employeeSource = firstValue(supplier.employeesSource, supplier.sourceLabel, supplier.source);
  const revenueSource = firstValue(supplier.revenueSource, supplier.sourceLabel, supplier.source);
  const employeeMeta = [employeeYear && `År ${employeeYear}`, supplier.employeesCheckedAt && formatCheckedDate(supplier.employeesCheckedAt), employeeSource && `Kilde: ${employeeSource}`].filter(Boolean).join(" · ");
  const revenueMeta = [revenueYear && `År ${revenueYear}`, revenueSource && `Kilde: ${revenueSource}`].filter(Boolean).join(" · ");
  const financialMeta = revenueYear ? `År ${revenueYear} · Kilde: ${revenueSource || "Regnskapsregisteret"}` : "Kilde: Regnskapsregisteret";
  const registerFlags = supplier.registerFlags || {};
  const registerText = [registerFlags.foretak && "Foretaksregisteret", registerFlags.mva && "Merverdiavgiftsregisteret", registerFlags.frivillig && "Frivillighetsregisteret"].filter(Boolean).join(" · ");
  const rolesText = Array.isArray(supplier.roles) ? supplier.roles.map((role) => `${role.type}: ${role.name}`).join("; ") : "";
  const employeeNote = !employeeValue && supplier.employeesRegistered ? "Antall registrert hos Brønnøysundregistrene, men selve tallet mangler i åpne data" : "";

  app.innerHTML = `
    <main class="dashboard-shell">
      <header class="dashboard-topbar">
        <a class="dashboard-brand" href="/user"><img src="/assets/byggradar-radar.png" alt="" /><span>Norsk ByggRadar</span></a>
        <div class="dashboard-heading"><span>Dashboard</span><strong>Arbeidsflate for salgspersonell</strong></div>
        <button class="dashboard-customer-overview-button" id="openCustomerOverview" type="button">Kundeoversikt</button>
      </header>
      <div class="dashboard-context">
        <div><span class="eyebrow">Valgt virksomhet</span><h1>${esc(name)}</h1><p class="dashboard-company-meta">${esc(trade)} · ${esc(address)}</p><p class="dashboard-industry-line">Næringskode: ${esc(industryCode || "Ikke oppgitt")} · ${esc(industryMeaning)}</p></div>
        <button class="back-button dashboard-context-back" id="backToOverview" type="button">Tilbake til virksomhetsoversikt</button>
      </div>
      <section class="dashboard-grid" aria-label="Dashboard">
        <div class="dashboard-column dashboard-column-primary">
        <article class="dashboard-panel panel-company">
          <div class="panel-kicker">01 · Forberedelse</div><h2>Virksomhetsprofil</h2><p class="panel-intro">Ha de viktigste faktaene foran deg før samtalen begynner.</p>
          <div class="profile-section-label">Offisiell foretaksinformasjon</div>
          <div class="profile-metrics">${metricMarkup("Omsetning", revenueValue, revenueMeta || "Kilde kontrolleres i åpne foretaksdata")}${metricMarkup("Driftsresultat", formatRevenue(supplier.operatingResult), financialMeta)}${metricMarkup("Ansatte", formatFact(employeeValue, employeeValue && !String(employeeValue).toLowerCase().includes("ansatt") ? " ansatte" : ""), employeeMeta || employeeNote || "Brreg og Proff kontrolleres når tallet mangler")}</div>
          <dl class="fact-grid">${factMarkup("Virksomhet", name)}${factMarkup("Fagområde", trade)}${factMarkup("Organisasjonsnummer", organizationNumber)}${factMarkup("Organisasjonsform", organizationForm)}${factMarkup("Adresse", address)}${factMarkup("Næringskode", industryCode)}${factMarkup("Registreringsstatus", legalStatus)}${factMarkup("Resultat før skatt", formatRevenue(supplier.profitBeforeTax), financialMeta)}${factMarkup("Årsresultat", formatRevenue(supplier.annualResult), financialMeta)}</dl>
          <div class="profile-details">${factMarkup("Juridisk navn", supplier.legalName || name)}${factMarkup("Virksomhetens aktivitet", supplier.activity)}${factMarkup("Vedtektsfestet formål", supplier.purpose)}${factMarkup("Registrerte roller", rolesText)}${factMarkup("Registertilknytning", registerText)}${factMarkup("Registreringsdato", supplier.registeredDate)}${factMarkup("Stiftelsesdato", supplier.foundedDate)}${factMarkup("Siste innsendte årsregnskap", supplier.lastAnnualAccounts)}${factMarkup("Aksjekapital", supplier.capital)}${factMarkup("Sum eiendeler", formatRevenue(supplier.totalAssets), financialMeta)}${factMarkup("Sum egenkapital", formatRevenue(supplier.totalEquity), financialMeta)}${factMarkup("Ansattinformasjon", employeeNote)}</div>
          <p class="profile-source-note">Profilen er beriket med tilgjengelige opplysninger fra åpne og lisensierte kilder. Omsetning og eksakt antall ansatte vises når kilden leverer disse tallene. Manglende opplysninger markeres, ikke gjettes.</p>
          <div class="contact-line"><span>Telefon</span>${phone}<span>Nettsted</span>${website}<span>Kildeprofil</span>${sourceProfile}</div>
          <div class="profile-note-field"><strong>Kundekommentar</strong><label for="dashboardContactNoteHeading">Overskrift</label><input id="dashboardContactNoteHeading" type="text" maxlength="40" value="${esc(contactNote.heading)}" placeholder="Skriv overskrift" /><label for="dashboardContactNote">Tekst</label><input id="dashboardContactNote" type="text" maxlength="50" value="${esc(contactNote.text)}" placeholder="Skriv inntil 50 tegn" /></div>
        </article>
        <article class="dashboard-panel panel-conversation">
          <div class="panel-kicker">Samtalehjelp</div><h2>Spørsmål til samtalen</h2><p class="panel-intro">Bruk spørsmålene som støtte for å avklare virksomhetens behov og vise hvordan NBR kan gi bedre oversikt over mulige oppdrag.</p>
          <div class="seller-question-help"><h3>Spørsmål til samtalen</h3><div class="choice-list" tabindex="0" aria-label="Spørsmål til samtalen">
            <h4 class="choice-group-heading">Konkurranse om oppdragene</h4>
            <ul class="choice-theme-note">
              <li>På Mittanbud, Anbudstorget og lignende plattformer kan dere motta forespørsler om pristilbud sammen med mange andre bedrifter i samme bransje.</li>
              <li>Konkurransen om oppdragene er ofte svært hard.</li>
              <li>Stadig flere virksomheter er, eller har vært, brukere av ulike plattformer.</li>
              <li>Det viser at virksomhetene ser verdi i å arbeide mer aktivt med å finne nye oppdrag.</li>
            </ul>
            <h4 class="choice-group-heading">Prioriteringer og ønskede oppdrag</h4>
            <div class="choice-item"><label><input type="checkbox" /> 1. Har dere kapasitet til flere oppdrag i tiden som kommer?</label><p class="choice-answer">NBR kan gjøre flere mulige oppdrag synlige, slik at dere selv kan vurdere hva dere ønsker å følge opp.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 2. Hvis dere kunne velge fra øverste hylle, hvilke typer prosjekter ville dere hatt mer av?</label><p class="choice-answer">NBR kan hjelpe dere med å lete etter prosjekter som ligner den typen arbeid dere ønsker mer av.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 3. Hvilke typer oppdrag passer virksomheten deres best når det gjelder lønnsomhet og gjennomføring?</label><p class="choice-answer">NBR kan gi et bedre grunnlag for å prioritere prosjekter som ser ut til å passe virksomhetens profil.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 4. Hvilken størrelse eller varighet på prosjekter passer kapasiteten deres best?</label><p class="choice-answer">NBR kan gjøre det enklere å vurdere prosjekter ut fra tilgjengelig informasjon om tiltaket og prosjektfasen.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 5. I hvilken fase ønsker dere helst å komme inn i et prosjekt?</label><p class="choice-answer">NBR kan synliggjøre prosjekter på ulike stadier, slik at dere selv kan vurdere når det er riktig å ta kontakt.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 6. Jobber dere i flere kommuner eller geografiske områder i regionen?</label><p class="choice-answer">NBR kan gi oversikt over muligheter i flere kommuner og gjøre det enklere å oppdage prosjekter utenfor nærområdet.</p></div>
            <h4 class="choice-group-heading">Dagens arbeidsmåte</h4>
            <div class="choice-item"><label><input type="checkbox" /> 7. Hvordan finner dere vanligvis nye oppdrag i dag?</label><p class="choice-answer">NBR kan supplere dagens metoder med informasjon fra byggesaker, postlister, tillatelser og andre åpne kilder.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 8. Hvilke plattformer eller kanaler bruker dere mest for å finne nye oppdrag?</label><p class="choice-answer">NBR kan samle prosjektinformasjon fra flere kilder i én arbeidsflate, slik at dere kan oppdage muligheter dere ellers ikke ville sett.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 9. Hvem hos dere har hovedansvaret for å finne og følge opp nye oppdrag?</label><p class="choice-answer">NBR kan gi den ansvarlige en mer strukturert oversikt over prosjekter som bør vurderes for kontakt.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 10. Hvordan prioriterer dere hvilke prosjekter dere skal følge opp først?</label><p class="choice-answer">NBR kan gjøre det enklere å prioritere etter prosjektfase, aktualitet, fagområde og geografisk nærhet.</p></div>
            <h4 class="choice-group-heading">Behov og utfordringer</h4>
            <div class="choice-item"><label><input type="checkbox" /> 11. Hva er den største utfordringen med å finne relevante oppdrag i dag?</label><p class="choice-answer">NBR kan redusere tiden dere bruker på manuelle søk og gjøre flere mulige prosjektmuligheter synlige.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 12. Hva skjer vanligvis når dere får vite om et interessant prosjekt for sent?</label><p class="choice-answer">NBR kan gi tidligere informasjon, slik at dere får bedre tid til å vurdere prosjektet og eventuelt ta kontakt.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 13. Hvor viktig er det for dere å oppdage prosjekter mens de fortsatt er i planleggingsfasen?</label><p class="choice-answer">NBR kan synliggjøre tidlige registreringer som gir dere mulighet til å følge prosjektet før senere aktører eventuelt kommer på banen.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 14. Ville det vært nyttig å få prosjekter sortert etter fagområde, geografi og prosjektfase?</label><p class="choice-answer">NBR kan gjøre det enklere å finne prosjekter som kan være relevante, uten at dere må gjennomgå alle registreringene manuelt.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 15. Ville en samlet oversikt gjort det enklere å følge både små og store oppdrag?</label><p class="choice-answer">NBR kan samle ulike typer prosjekter, slik at dere selv kan velge hvilke muligheter dere ønsker å undersøke nærmere.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 16. Ville kart, adresse og kontaktinformasjon gjort det enklere å planlegge salgsarbeidet?</label><p class="choice-answer">NBR kan gi bedre grunnlag for å vurdere avstand, aktører og hvem det kan være aktuelt å kontakte.</p></div>
            <h4 class="choice-group-heading">Verdi og beslutning</h4>
            <div class="choice-item"><label><input type="checkbox" /> 17. Hvilke opplysninger må dere ha før dere vurderer et prosjekt som interessant?</label><p class="choice-answer">NBR kan samle adresse, tiltakstype, fase, matrikkel, aktører og tilgjengelige kildelenker på ett sted.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 18. Hva legger dere mest vekt på når dere avgjør om et prosjekt er verdt å følge opp?</label><p class="choice-answer">NBR kan gi et samlet vurderingsgrunnlag, men virksomheten avgjør selv hvilke prosjekter som er interessante.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 19. Hvordan ville en ideell oversikt over nye oppdrag sett ut for dere?</label><p class="choice-answer">NBR kan tilpasses med relevante fagområder, kommuner, prosjektfaser og geografiske prioriteringer.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 20. Hva måtte Norsk ByggRadar vise for at tjenesten skulle bli nyttig i det daglige salgsarbeidet?</label><p class="choice-answer">NBR skal gjøre det enklere å oppdage, vurdere og prioritere mulige oppdrag som virksomheten selv kan følge opp.</p></div>
            <div class="choice-item"><label><input type="checkbox" /> 21. Skal vi se på hvilken løsning som passer best for virksomheten deres?</label><p class="choice-answer">Selgeren kan knytte behovene i samtalen til riktig modell og vise hvordan NBR kan brukes til å finne flere relevante muligheter.</p></div>
          </div></div>
        </article>
        <article class="dashboard-panel panel-needs">
          <div class="panel-kicker">03 · Bonusprogram</div><h2>Bonusprogram</h2><p class="panel-intro">Få én måned kostnadsfri bruk når dere tipser om en relevant virksomhet som senere blir kunde.</p>
          <div class="bonus-copy"><h3>Stikkord for selgeren</h3><p class="bonus-script">«Du kan faktisk bruke Norsk ByggRadar uten kostnad. Vi har så stor tro på verdien av Norsk ByggRadar for dere at dere får én måned kostnadsfri bruk dersom dere tipser om en annen virksomhet som blir kunde.</p><p class="bonus-script">Hvis dere kjenner bedrifter som kunne hatt nytte av tidligere informasjon om relevante prosjekter, kan dere få tjenesten kostnadsfritt.»</p><p>På brukersiden ligger det en tipsfunksjon som har blitt svært populær. Vi har allerede flere virksomheter som har gjort dette til en aktiv del av bruken, og som derfor har fått betydelig redusert kostnad.</p><h3>Det fungerer slik</h3><ul class="bonus-list"><li>Dere tipser om en relevant virksomhet.</li><li>Vi tar kontakt med virksomheten.</li><li>Dersom virksomheten blir kunde, registreres bonusen automatisk.</li><li>Én måned kostnadsfri bruk og eventuell rabatt legges automatisk inn på deres kundeforhold.</li><li>Flere tips på én måned gir akkumulert fri bruk. Tre tips i mars gir for eksempel fri bruk i april, mai og juni.</li></ul></div>
        </article>
        <article class="dashboard-panel panel-plans">
          <div class="panel-kicker">05 · Avtale</div><h2>Velg riktig modell</h2><p class="panel-intro">Presenter alternativene enkelt og anbefal én modell.</p>
          <div class="plan-list"><button type="button"><strong>Mini</strong><span>For mindre virksomheter og ett tydelig arbeidsområde</span></button><button type="button" class="recommended"><strong>Standard</strong><span>For virksomheter som vil arbeide bredere i regionen</span><b>Anbefalt</b></button><button type="button"><strong>Pro</strong><span>For virksomheter som vil ha full oversikt</span></button></div>
        </article>
        </div>
        <div class="dashboard-column dashboard-column-secondary">
        <article class="dashboard-panel panel-map">
          <div class="panel-kicker">02 · Kartoversikt</div><h2>Kartoversikt</h2><p class="panel-intro">Bruk prosjekter i nærheten som en konkret inngang til samtalen.</p>
          <div class="dashboard-address-controls">
            <label for="dashboardCustomerAddress">Kundens adresse</label>
            <div class="dashboard-address-row"><input id="dashboardCustomerAddress" type="text" value="${esc(address === "Ikke oppgitt" ? "" : address)}" placeholder="Skriv inn eller endre adresse" autocomplete="street-address" /><button type="button" id="dashboardFindAddress">Oppdater kart</button><button type="button" id="dashboardClearAddress" class="secondary-action">Tøm</button></div>
            <div id="dashboardAddressStatus" class="dashboard-address-status" role="status">${esc(address === "Ikke oppgitt" ? "Skriv inn en adresse for å finne prosjekter i nærheten." : `Kundens adresse: ${address}`)}</div>
          </div>
          <div id="dashboardMap" class="dashboard-map" aria-label="Kart over prosjekter i regionen"></div>
          <p id="dashboardMapStatus" class="dashboard-map-status">Laster prosjekter i regionen...</p>
          <div id="dashboardProjectDetail" class="dashboard-project-detail" hidden></div>
          <section class="nearest-projects" aria-labelledby="nearestProjectsHeading"><h3 id="nearestProjectsHeading">20 nærmeste prosjekter</h3><div id="dashboardNearestProjects" class="nearest-project-list"><p class="dashboard-map-status">Finner prosjekter nær kundens adresse...</p></div></section>
        </article>
        <article class="dashboard-panel panel-onboarding">
          <div class="panel-kicker">06 · Opprett kunde</div><h2>Opprett kunde</h2><p class="panel-intro">Samle kunde- og avtaleopplysninger i ett strukturert grunnlag for senere fakturaeksport.</p>
          <div class="onboarding-summary"><strong>${esc(customerFieldValue("companyName", name))}</strong><span>${esc(customerFieldValue("trade", trade))}</span><span>${esc(customerFieldValue("address", address))}</span></div>
          <button class="primary-action" id="openCustomerRecord" type="button" aria-expanded="${dashboardCustomerFormOpen ? "true" : "false"}">${dashboardCustomerFormOpen ? "Lukk kundeopplysninger" : "Opprett kunde"}</button>
          <div id="customerRecordExpanded" class="customer-record-expanded" ${dashboardCustomerFormOpen ? "" : "hidden"}>
            <form id="customerRecordForm" class="customer-record-form">
              <fieldset><legend>Kundeinformasjon</legend><div class="customer-form-grid"><label>Bedriftsnavn<input name="companyName" value="${esc(customerFieldValue("companyName", name))}" required /></label><label>Organisasjonsnummer<input name="organizationNumber" value="${esc(customerFieldValue("organizationNumber", organizationNumber))}" inputmode="numeric" /></label><label>Bransje<input name="trade" value="${esc(customerFieldValue("trade", trade))}" required /></label><label>Kontaktperson<input name="contactPerson" value="${esc(customerFieldValue("contactPerson"))}" /></label><label>Telefon<input name="phone" value="${esc(customerFieldValue("phone", supplier.phone || ""))}" type="tel" /></label><label>E-post<input name="email" value="${esc(customerFieldValue("email"))}" type="email" /></label><label>Nettsted<input name="website" value="${esc(customerFieldValue("website", companyWebsite))}" type="url" /></label><label class="customer-form-wide">Fakturaadresse<input name="invoiceAddress" value="${esc(customerFieldValue("invoiceAddress", address))}" /></label><label>Kommune<input id="customerMunicipalityInput" name="municipality" value="${esc(customerMunicipality)}" /></label><label>Region<input id="customerRegionName" name="regionName" value="${esc(customerFieldValue("regionName", customerRegion.name || ""))}" readonly /><input id="customerRegionId" name="regionId" type="hidden" value="${esc(customerFieldValue("regionId", customerRegion.id || ""))}" /></label></div><p id="customerRegionMatch" class="customer-region-match">${customerMunicipality && customerRegion.name ? `Kommunen er koblet til ${esc(customerRegion.name)}.` : "Skriv inn kundens kommune for å koble riktig region."}</p></fieldset>
              <fieldset><legend>Innloggingsopplysninger</legend><p class="customer-login-help">Forslagene kan brukes når kunden skal få sin egen tilgang. De lagres sammen med kundeoppføringen.</p><div class="customer-form-grid"><label>Brukernavn<input name="loginUsername" value="${esc(customerFieldValue("loginUsername", loginSuggestion.username))}" required /></label><label>Passord<input name="loginPassword" value="${esc(customerFieldValue("loginPassword", loginSuggestion.password))}" required /></label></div></fieldset>
              <fieldset><legend>Avtale og kostnader</legend><div class="customer-form-grid"><label>Modell<select name="model"><option ${customerFieldValue("model") === "Mini" ? "selected" : ""}>Mini</option><option ${customerFieldValue("model") === "Standard" ? "selected" : ""}>Standard</option><option ${customerFieldValue("model") === "Pro" ? "selected" : ""}>Pro</option></select></label><label>Startdato<input name="startDate" type="date" value="${esc(customerFieldValue("startDate"))}" /></label><label>Månedskostnad<input name="monthlyCost" inputmode="decimal" value="${esc(customerFieldValue("monthlyCost"))}" /></label><label>Kvartalskostnad<input name="quarterlyCost" inputmode="decimal" value="${esc(customerFieldValue("quarterlyCost"))}" /></label><label>Halvårskostnad<input name="halfYearCost" inputmode="decimal" value="${esc(customerFieldValue("halfYearCost"))}" /></label><label>Årskostnad<input name="annualCost" inputmode="decimal" value="${esc(customerFieldValue("annualCost"))}" /></label><label>Etableringskostnad<input name="setupCost" inputmode="decimal" value="${esc(customerFieldValue("setupCost"))}" /></label><label>Rabatt (%)<input name="discount" inputmode="decimal" value="${esc(customerFieldValue("discount"))}" /></label><label>MVA (%)<input name="vat" inputmode="decimal" value="${esc(customerFieldValue("vat", "25"))}" /></label><label>Fakturaintervall<select name="billingInterval"><option ${customerFieldValue("billingInterval") === "Månedlig" ? "selected" : ""}>Månedlig</option><option ${customerFieldValue("billingInterval") === "Kvartalsvis" ? "selected" : ""}>Kvartalsvis</option><option ${customerFieldValue("billingInterval") === "Halvårlig" ? "selected" : ""}>Halvårlig</option><option ${customerFieldValue("billingInterval") === "Årlig" ? "selected" : ""}>Årlig</option></select></label><label>Neste fakturadato<input name="nextInvoiceDate" type="date" value="${esc(customerFieldValue("nextInvoiceDate"))}" /></label></div></fieldset>
              <fieldset><legend>Fakturagrunnlag</legend><div class="customer-form-grid"><label>Fakturamottaker<input name="invoiceRecipient" value="${esc(customerFieldValue("invoiceRecipient"))}" /></label><label>EHF-organisasjonsnummer<input name="ehfOrganizationNumber" inputmode="numeric" value="${esc(customerFieldValue("ehfOrganizationNumber", organizationNumber))}" /></label><label>Faktura-e-post<input name="invoiceEmail" type="email" value="${esc(customerFieldValue("invoiceEmail"))}" /></label><label>Avtalenummer<input name="agreementNumber" value="${esc(customerFieldValue("agreementNumber"))}" /></label><label class="customer-form-wide">Notat til fakturering<textarea name="invoiceNote" rows="3">${esc(customerFieldValue("invoiceNote"))}</textarea></label></div></fieldset>
              <div class="customer-record-actions"><button class="primary-action" type="submit">Lagre kundeopplysninger</button><button class="secondary-action" id="closeCustomerRecord" type="button">Lukk</button></div><p id="customerRecordStatus" class="customer-record-status" role="status"></p>
            </form>
          </div>
          <p class="fine-print">Kundeopplysninger lagres separat fra prosjekter og leverandører.</p>
        </article>
        </div>
      </section>
    </main>`;
  document.querySelector("#backToOverview")?.addEventListener("click", () => {
    if (dashboardMap) {
      dashboardMap.remove();
      dashboardMap = null;
    }
    supplier = null;
    profileLookupStarted = false;
    mapOverviewStarted = false;
    dashboardCustomerPoint = null;
    dashboardProjects = [];
    renderRegionalSupplierOverview();
  });
  const updateContactNote = () => {
    const headingInput = document.querySelector("#dashboardContactNoteHeading");
    const textInput = document.querySelector("#dashboardContactNote");
    const heading = String(headingInput?.value || "").slice(0, 40);
    const text = String(textInput?.value || "").slice(0, 50);
    if (headingInput) headingInput.value = heading;
    if (textInput) textInput.value = text;
    saveDashboardContactNote(supplier, heading, text);
    const selectedKeys = new Set(dashboardContactNoteKeys(supplier));
    regionalSuppliers = regionalSuppliers.map((item) => {
      const itemKeys = dashboardContactNoteKeys(item);
      return itemKeys.some((key) => selectedKeys.has(key)) ? { ...item, dashboardContactNote: { heading, text } } : item;
    });
    regionalSuppliers = [...regionalSuppliers].sort((left, right) => {
      const leftHasNote = Boolean(readDashboardContactNote(left).heading || readDashboardContactNote(left).text);
      const rightHasNote = Boolean(readDashboardContactNote(right).heading || readDashboardContactNote(right).text);
      return Number(rightHasNote) - Number(leftHasNote);
    });
    try {
      const snapshot = JSON.parse(sessionStorage.getItem(overviewSnapshotKey) || "null");
      if (snapshot && Array.isArray(snapshot.suppliers)) {
        snapshot.suppliers = snapshot.suppliers.map((item) => {
          const itemKeys = dashboardContactNoteKeys(item);
          return itemKeys.some((key) => selectedKeys.has(key)) ? { ...item, dashboardContactNote: { heading, text } } : item;
        });
        snapshot.suppliers.sort((left, right) => Number(Boolean(right.dashboardContactNote?.heading || right.dashboardContactNote?.text)) - Number(Boolean(left.dashboardContactNote?.heading || left.dashboardContactNote?.text)));
        sessionStorage.setItem(overviewSnapshotKey, JSON.stringify(snapshot));
      }
    } catch { /* Oversikten kan fortsatt hente notatet fra lokal lagring. */ }
  };
  document.querySelector("#dashboardContactNoteHeading")?.addEventListener("input", updateContactNote);
  document.querySelector("#dashboardContactNote")?.addEventListener("input", updateContactNote);
  document.querySelector("#openCustomerRecord")?.addEventListener("click", () => {
    dashboardCustomerFormOpen = !dashboardCustomerFormOpen;
    const expanded = document.querySelector("#customerRecordExpanded");
    const button = document.querySelector("#openCustomerRecord");
    if (expanded) expanded.hidden = !dashboardCustomerFormOpen;
    if (button) { button.textContent = dashboardCustomerFormOpen ? "Lukk kundeopplysninger" : "Opprett kunde"; button.setAttribute("aria-expanded", String(dashboardCustomerFormOpen)); }
  });
  document.querySelector("#closeCustomerRecord")?.addEventListener("click", () => {
    dashboardCustomerFormOpen = false;
    document.querySelector("#customerRecordExpanded")?.setAttribute("hidden", "");
    const button = document.querySelector("#openCustomerRecord");
    if (button) { button.textContent = "Opprett kunde"; button.setAttribute("aria-expanded", "false"); }
  });
  document.querySelector("#customerRecordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveDashboardCustomerRecord(event.currentTarget);
  });
  bindCustomerCostCalculation();
  document.querySelector("#customerMunicipalityInput")?.addEventListener("input", (event) => {
    const matchedRegion = resolveCustomerRegion(event.target.value);
    const regionInput = document.querySelector("#customerRegionName");
    const regionIdInput = document.querySelector("#customerRegionId");
    const match = document.querySelector("#customerRegionMatch");
    if (regionInput) regionInput.value = matchedRegion?.name || "Ingen region funnet";
    if (regionIdInput) regionIdInput.value = matchedRegion?.id || "";
    if (match) match.textContent = matchedRegion ? `Kommunen er koblet til ${matchedRegion.name}.` : "Skriv inn kommunen slik den står i regionregisteret.";
  });
  bindCustomerOverviewButton();
  syncDashboardMapAddress(supplier);
  void enrichBusinessProfile();
  void initializeMapOverview();
}

async function initializeMapOverview() {
  if (mapOverviewStarted || !supplier) return;
  mapOverviewStarted = true;
  const regionContext = getRegionContext();
  const regionId = regionContext.id || "bergensregionen";
  const mapStatus = document.querySelector("#dashboardMapStatus");
  try {
    if (!window.L) throw new Error("Kartbiblioteket kunne ikke lastes.");
    const [response, contactResponse] = await Promise.all([
      fetch(`/data/regions/${encodeURIComponent(regionId)}/projects_location_enriched.json?dashboard=${DASHBOARD_VERSION}`),
      fetch(`/data/regions/${encodeURIComponent(regionId)}/projects_contact_enriched.json?dashboard=${DASHBOARD_VERSION}`),
    ]);
    if (!response.ok) throw new Error(`Prosjektdata kunne ikke lastes (${response.status}).`);
    const locationPayload = await response.json();
    const contactPayload = contactResponse.ok ? await contactResponse.json() : { projects: [] };
    const contactMap = new Map(projectCollection(contactPayload).map((project) => [project.projectId || project.sourceDocumentId, project]));
    dashboardProjects = projectCollection(locationPayload).map((project) => ({ ...project, contactData: contactMap.get(project.sourceDocumentId), coordinates: projectCoordinates(project) })).filter((project) => project.coordinates);
    await geocodeDashboardAddress(false);
    renderDashboardMap();
    renderNearestProjects();
  } catch (error) {
    if (mapStatus) mapStatus.textContent = error.message || "Prosjektene kunne ikke lastes.";
    renderNearestProjects(error.message || "Prosjektene kunne ikke lastes.");
  }
}

async function geocodeDashboardAddress(showStatus = true) {
  const input = document.querySelector("#dashboardCustomerAddress");
  const status = document.querySelector("#dashboardAddressStatus");
  const query = input?.value.trim();
  if (!query) {
    dashboardCustomerPoint = null;
    if (showStatus && status) status.textContent = "Skriv inn en adresse for å finne prosjekter i nærheten.";
    return;
  }
  if (showStatus && status) status.textContent = "Søker etter adresse...";
  try {
    const parts = query.split(",").map((part) => part.trim()).filter(Boolean);
    const withoutPostalCode = query.replace(/\b\d{4}\b/g, "").replace(/\s*,\s*/g, ", ").replace(/,{2,}/g, ",").replace(/\s{2,}/g, " ").replace(/^,\s*|\s*,$/g, "").trim();
    const streetAndPlace = parts.length > 1 ? `${parts[0]}, ${parts[parts.length - 1]}` : query;
    const candidates = [...new Set([query, withoutPostalCode, streetAndPlace, query.replace(/,/g, " ")].filter(Boolean))];
    let item;
    for (const candidate of candidates) {
      const response = await fetch(`/api/geocode?sok=${encodeURIComponent(candidate)}&treffPerSide=1&utkoordsys=4258&filtrer=adresser.representasjonspunkt`);
      const payload = await response.json().catch(() => ({}));
      const candidateItem = payload?.adresser?.[0];
      const lat = Number(candidateItem?.representasjonspunkt?.lat);
      const lon = Number(candidateItem?.representasjonspunkt?.lon);
      if (candidateItem && Number.isFinite(lat) && Number.isFinite(lon)) {
        item = candidateItem;
        break;
      }
    }
    const lat = Number(item?.representasjonspunkt?.lat);
    const lon = Number(item?.representasjonspunkt?.lon);
    if (!item || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Adressen ble ikke funnet.");
    dashboardCustomerPoint = { lat, lon, label: item.adressetekst || query };
    if (input) input.value = dashboardCustomerPoint.label;
    if (status) status.textContent = `Kundens adresse: ${dashboardCustomerPoint.label}`;
  } catch (error) {
    dashboardCustomerPoint = null;
    if (status) status.textContent = error.message || "Adressen kunne ikke finnes.";
  }
}

function renderDashboardMap() {
  const element = document.querySelector("#dashboardMap");
  const status = document.querySelector("#dashboardMapStatus");
  if (!element || !window.L) return;
  const regionContext = getRegionContext() || {};
  if (dashboardMap) dashboardMap.remove();
  dashboardMap = L.map(element, { zoomControl: true, scrollWheelZoom: true, dragging: true, doubleClickZoom: true, touchZoom: true, zoomSnap: 0.5, preferCanvas: true }).setView(dashboardCustomerPoint ? [dashboardCustomerPoint.lat, dashboardCustomerPoint.lon] : [60.39, 5.32], dashboardCustomerPoint ? 13 : 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(dashboardMap);
  const customerIcon = L.divIcon({ className: "dashboard-customer-marker", html: "", iconSize: [22, 22], iconAnchor: [11, 11] });
  const projectRenderer = L.canvas({ padding: 0.5 });
  const bounds = L.latLngBounds([]);
  dashboardProjects.forEach((project) => {
    const { lat, lon } = project.coordinates;
    const marker = L.circleMarker([lat, lon], { radius: 5, color: "#fff", weight: 1, fillColor: "#287fa8", fillOpacity: 1, renderer: projectRenderer, keyboard: false }).addTo(dashboardMap);
    marker.bindTooltip(esc(projectLabel(project)), { direction: "top", sticky: true });
    marker.on("click", () => {
      dashboardMap.panTo([lat, lon], { animate: true, duration: 0.25 });
      renderDashboardProjectDetail(project);
    });
    bounds.extend([lat, lon]);
  });
  if (dashboardCustomerPoint) {
    const customerPhone = firstValue(supplier?.phone, "Telefon ikke oppgitt");
    L.marker([dashboardCustomerPoint.lat, dashboardCustomerPoint.lon], { icon: customerIcon, keyboard: false }).addTo(dashboardMap).bindTooltip(`<strong>${esc(supplier?.name || "Kunde")}</strong><br>${esc(customerPhone)}`, { direction: "top" });
    bounds.extend([dashboardCustomerPoint.lat, dashboardCustomerPoint.lon]);
    dashboardMap.setView([dashboardCustomerPoint.lat, dashboardCustomerPoint.lon], 13, { animate: false });
  } else if (bounds.isValid()) {
    dashboardMap.fitBounds(bounds.pad(0.15), { maxZoom: 11 });
  }
  if (status) status.textContent = `${dashboardProjects.length} prosjekter med kartpunkt i ${esc(regionContext.name || "valgt region")}.`;
  setTimeout(() => dashboardMap?.invalidateSize(), 100);
}

function projectDetailValue(label, value) {
  return value ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : "";
}

function projectDetailHref(value) {
  try {
    const url = new URL(String(value || ""));
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function cleanDocumentTitle(value) {
  return String(value || "Vedlegg")
    .replace(/^\s*\[([\s\S]*)\]\([^)]*\)\s*$/, "$1")
    .replace(/\\(?=<\/?i\b)/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\[\]]/g, "")
    .replace(/&aring;/g, "å")
    .replace(/&oslash;/g, "ø")
    .replace(/&aelig;/g, "æ")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\\/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dashboardSupplierKey(supplier) {
  return `${String(supplier?.name || "").trim().toLocaleLowerCase("nb-NO")}|${String(supplier?.address || "").trim().toLocaleLowerCase("nb-NO")}`;
}

function supplierSourceCodes(supplier) {
  const rawSources = [
    ...(Array.isArray(supplier?.sources) ? supplier.sources : []),
    supplier?.source,
    supplier?.sourceLabel,
  ].map((value) => String(value || "").trim().toUpperCase());
  const codes = rawSources.map((value) => {
    if (value === "MITTANBUD") return "MA";
    if (value === "HÅNDVERKERPORTALEN" || value === "HANDVERKERPORTALEN") return "HP";
    if (value === "GOOGLE ADS") return "GA";
    return value;
  }).filter((value) => ["MA", "HP", "G", "GA", "DIB"].includes(value));
  return [...new Set(codes)];
}

function supplierSourceMarkup(supplier) {
  const codes = supplierSourceCodes(supplier);
  return codes.length ? `<span class="dashboard-source-summary" title="Kilder: ${esc(codes.join(", "))}">${esc(codes.join(", "))}</span>` : "";
}

function readDashboardCalledSuppliers() {
  try {
    const entries = JSON.parse(localStorage.getItem(supplierCalledStorageKey) || "{}");
    return entries && typeof entries === "object" ? entries : {};
  } catch { return {}; }
}

function readManualSuppliers(regionId) {
  try {
    const entries = JSON.parse(localStorage.getItem(manualSupplierStorageKey) || "{}");
    return Array.isArray(entries?.[regionId]) ? entries[regionId] : [];
  } catch { return []; }
}

function saveManualSupplier(region, supplierValue) {
  if (!region?.id || !supplierValue) return;
  try {
    const entries = JSON.parse(localStorage.getItem(manualSupplierStorageKey) || "{}");
    const current = Array.isArray(entries?.[region.id]) ? entries[region.id] : [];
    entries[region.id] = dedupeDashboardSuppliers([...current, supplierValue]);
    localStorage.setItem(manualSupplierStorageKey, JSON.stringify(entries));
  } catch { /* Den lokale oversikten fungerer fortsatt i aktiv økt. */ }
}

function markDashboardSupplierCalled(selected, context) {
  if (!selected) return;
  try {
    const called = readDashboardCalledSuppliers();
    called[dashboardSupplierKey(selected)] = Date.now();
    localStorage.setItem(supplierCalledStorageKey, JSON.stringify(called));
  } catch { /* Markeringen beholdes i aktiv visning dersom lagring ikke er tilgjengelig. */ }
  renderRegionalSupplierRows(context);
}

function renderDashboardProjectDetail(project) {
  const panel = document.querySelector("#dashboardProjectDetail");
  if (!panel) return;
  const location = project.locationEnrichment || {};
  const classification = project.classification || {};
  const contact = project.contactData || {};
  const actor = firstValue(project.fromOrg, project.toOrg, contact.displayContact?.name, project.fromName, project.toName);
  const phone = firstValue(contact.displayContact?.phone, contact.phone, project.contactPhone);
  const email = firstValue(contact.displayContact?.email, contact.email, project.contactEmail);
  const projectTitle = firstValue(project.caseTitle, project.documentTitle, project.shortFacts, project.title, "Prosjekt");
  const projectTypes = projectType(project);
  const caseUrl = projectDetailHref(project.caseUrl || project.sourceUrl);
  const files = (project.files || []).map((file) => {
    const href = projectDetailHref(file.url || file.href);
    return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(cleanDocumentTitle(file.title || file.name || "Åpne vedlegg"))}</a>` : "";
  }).filter(Boolean);
  panel.hidden = false;
  panel.innerHTML = `<div class="dashboard-project-detail-heading"><div><span class="panel-kicker">Utvidet prosjektinformasjon</span><h3>${esc(projectTitle)}</h3></div><button type="button" id="closeDashboardProjectDetail" aria-label="Lukk prosjektinformasjon">Lukk</button></div><dl class="dashboard-project-facts">${projectDetailValue("Adresse", firstValue(project.address, location.address))}${projectDetailValue("Kommune", project.municipality)}${projectDetailValue("Fag/tema", projectTypes)}${projectDetailValue("Matrikkel", project.matrikkel)}${projectDetailValue("Saksnummer", project.caseNumber)}${projectDetailValue("Dokumentdato", project.documentDate)}${projectDetailValue("Dokumenttype", project.documentType)}${projectDetailValue("Fase/status", firstValue(classification.phase, classification.stage, project.phase, project.status))}${projectDetailValue("Avsender/mottaker", [project.fromName, project.toName].filter(Boolean).join(" → "))}</dl>${actor || phone || email ? `<section class="dashboard-project-contact"><h4>Aktør og kontakt</h4>${actor ? `<p><strong>${esc(actor)}</strong></p>` : ""}${phone ? `<a href="tel:${esc(phone.replace(/\D/g, ""))}">${esc(phone)}</a>` : ""}${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : ""}</section>` : ""}${project.description || project.shortFacts ? `<p class="dashboard-project-description">${esc(project.description || project.shortFacts)}</p>` : ""}${files.length || caseUrl ? `<div class="dashboard-project-links">${caseUrl ? `<a href="${esc(caseUrl)}" target="_blank" rel="noopener noreferrer">Åpne innsyn</a>` : ""}${files.join("")}</div>` : ""}`;
  document.querySelector("#closeDashboardProjectDetail")?.addEventListener("click", () => { panel.hidden = true; panel.innerHTML = ""; });
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function dashboardProjectKey(project) {
  return String(project?.sourceDocumentId || project?.id || "");
}

function renderNearestProjects(message = "") {
  const list = document.querySelector("#dashboardNearestProjects");
  if (!list) return;
  if (message) { list.innerHTML = `<p class="dashboard-map-status">${esc(message)}</p>`; return; }
  const origin = dashboardCustomerPoint;
  const ranked = dashboardProjects
    .map((project) => ({ ...project, distance: origin ? distanceKm(origin, project.coordinates) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.distance - b.distance);
  // Kartoversikten skal alltid prioritere 60 % Fase 1 og 40 % Fase 2,
  // men fylle opp med tilgjengelige prosjekter dersom en fase mangler.
  const phaseOne = ranked.filter((project) => projectPhase(project) === "Fase 1").slice(0, 12);
  const phaseTwo = ranked.filter((project) => projectPhase(project) === "Fase 2").slice(0, 8);
  const selectedIds = new Set([...phaseOne, ...phaseTwo].map(dashboardProjectKey));
  const nearest = [...phaseOne, ...phaseTwo,
    ...ranked.filter((project) => !selectedIds.has(dashboardProjectKey(project)))]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
  if (!nearest.length) { list.innerHTML = "<p class=\"dashboard-map-status\">Ingen prosjekter med bekreftet kartpunkt.</p>"; return; }
  list.innerHTML = nearest.map((project, index) => {
    const addressText = projectAddress(project) || "Adresse ikke oppgitt";
    const municipality = firstValue(project.municipality, "Kommune ikke oppgitt");
    const date = projectDate(project);
    const distance = Number.isFinite(project.distance) ? `${project.distance.toFixed(1).replace(".", ",")} km` : "";
    return `<button type="button" class="nearest-project-row" data-dashboard-project-id="${esc(dashboardProjectKey(project))}" aria-label="Åpne prosjekt ${esc(addressText)}"><span class="nearest-project-number">${index + 1}</span><span><strong>${esc(addressText)}</strong><span>${esc(municipality)}${projectType(project) ? ` · ${esc(projectType(project))}` : ""}</span></span><span class="nearest-project-meta">${projectPhase(project) ? `<b>${esc(projectPhase(project))}</b>` : ""}${date ? `<time>${esc(formatProjectDate(date))}</time>` : ""}${distance ? `<small>${esc(distance)}</small>` : ""}</span></button>`;
  }).join("");
}

document.addEventListener("click", async (event) => {
  const projectRow = event.target.closest("[data-dashboard-project-id]");
  if (projectRow) {
    const project = dashboardProjects.find((candidate) => dashboardProjectKey(candidate) === projectRow.dataset.dashboardProjectId);
    if (project) {
      const coordinates = project.coordinates;
      if (dashboardMap && coordinates) dashboardMap.panTo([coordinates.lat, coordinates.lon], { animate: true, duration: 0.25 });
      renderDashboardProjectDetail(project);
    }
    return;
  }
  if (event.target.closest("#dashboardFindAddress")) {
    await geocodeDashboardAddress(true);
    renderDashboardMap();
    renderNearestProjects();
  }
  if (event.target.closest("#dashboardClearAddress")) {
    const input = document.querySelector("#dashboardCustomerAddress");
    if (input) input.value = "";
    dashboardCustomerPoint = null;
    const status = document.querySelector("#dashboardAddressStatus");
    if (status) status.textContent = "Skriv inn en adresse for å finne prosjekter i nærheten.";
    renderDashboardMap();
    renderNearestProjects();
  }
});

void startDashboard();

function renderRegionalSupplierOverview() {
  const context = getRegionContext();
  const selectedRegionId = context?.id || "";
  app.innerHTML = `
    <main class="dashboard-shell">
      <header class="dashboard-topbar">
        <a class="dashboard-brand" href="/user"><img src="/assets/byggradar-radar.png" alt="" /><span>Norsk ByggRadar</span></a>
        <div class="dashboard-heading"><span>Dashboard</span><strong>Velg virksomhet for å starte</strong><small id="dashboardNationalSupplierCount">Laster registrerte bedrifter...</small></div>
        <button class="dashboard-customer-overview-button" id="openCustomerOverview" type="button">Kundeoversikt</button>
      </header>
      <section class="dashboard-context"><div><h1>Virksomheter i valgt region</h1><p>Velg region. Virksomhetene lastes automatisk når området er valgt.</p></div></section>
      <main class="dashboard-region-list"><div class="dashboard-region-picker"><label for="dashboardRegionSelect">Region</label><select id="dashboardRegionSelect"><option value="" ${selectedRegionId ? "" : "selected"}>Velg region</option>${dashboardRegions.map((item) => `<option value="${esc(item.id)}" ${item.id === selectedRegionId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select><label for="dashboardTradeSelect">Fagområde</label><select id="dashboardTradeSelect"><option value="">Alle fagområder</option>${["Elektriker", "Snekker", "Rørlegger", "Ventilasjon", "Grunnarbeid", "Murer", "Maler", "Taklegger", "Gulvlegger", "Byggmester", "Varmepumpemontør", "Prosjektering"].map((trade) => `<option value="${esc(trade)}" ${trade === dashboardTradeFilter ? "selected" : ""}>${esc(trade)}</option>`).join("")}</select></div><div class="region-list-heading"><div><span class="panel-kicker">Regionregister</span><h2>${context ? `Alle virksomheter i ${esc(context.name)}` : "Velg region"}</h2><p>Velg region. Virksomheter lastes først etter at et område er valgt.</p></div><strong id="dashboardRegionalSupplierCount" class="regional-supplier-count">${context ? "Laster antall virksomheter..." : "Velg region for å laste virksomheter"}</strong></div><div id="regionalSupplierRows" class="regional-supplier-rows"><p class="dashboard-map-status">${context ? "Henter virksomheter i regionen..." : "Velg region for å hente virksomheter."}</p></div></main>
    </main>`;
  bindCustomerOverviewButton();
  document.querySelector("#dashboardRegionSelect")?.addEventListener("change", (event) => {
    const nextContext = dashboardRegions.find((item) => item.id === event.target.value);
    if (!nextContext) return;
    try { sessionStorage.setItem(dashboardRegionContextKey, JSON.stringify(nextContext)); } catch { /* Regionvalget gjelder bare den aktive arbeidsøkten. */ }
    regionalSupplierAbortController?.abort();
    regionalSupplierAbortController = null;
    regionalSuppliers = [];
    regionalSupplierSearchResult = null;
    regionalSupplierSearchLoading = false;
    regionalSupplierSearchRequestId += 1;
    dashboardTradeFilter = "";
    regionalSupplierRequestId += 1;
    regionalSuppliersLoading = false;
    renderRegionalSupplierOverview();
  });
  document.querySelector("#dashboardTradeSelect")?.addEventListener("change", (event) => {
    dashboardTradeFilter = String(event.target.value || "");
    renderRegionalSupplierRows(context);
  });
  if (context) mountRegionalSupplierSearch(context);
  void loadDashboardNationalSupplierCount();
  if (context && regionalSuppliers.length) renderRegionalSupplierRows(context);
  else if (context) void loadRegionalSuppliers(context);
}

function mountRegionalSupplierSearch(context) {
  const rows = document.querySelector("#regionalSupplierRows");
  if (!rows) return;
  rows.insertAdjacentHTML("beforebegin", `<section class="regional-supplier-search" aria-labelledby="regionalSupplierSearchHeading"><h3 id="regionalSupplierSearchHeading">Søk etter ikke-listet virksomhet</h3><p>Legg inn virksomhetsnavn eller organisasjonsnummer. Treffet hentes fra samme virksomhetskilder som de listede virksomhetene.</p><form id="regionalSupplierSearchForm"><label for="regionalSupplierSearchInput">Virksomhet</label><div class="regional-supplier-search-row"><input id="regionalSupplierSearchInput" name="query" type="search" placeholder="Søk etter virksomhetsnavn eller organisasjonsnummer" autocomplete="organization" /><button type="submit">Søk virksomhet</button></div><p id="regionalSupplierSearchStatus" class="regional-supplier-search-status" role="status"></p></form><div id="regionalSupplierSearchResult"></div></section>`);
  document.querySelector("#regionalSupplierSearchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") || "").trim();
    void searchRegionalSupplier(query, context);
  });
  renderRegionalSupplierSearchResult(context);
}

function renderRegionalSupplierSearchResult(context) {
  const resultContainer = document.querySelector("#regionalSupplierSearchResult");
  const status = document.querySelector("#regionalSupplierSearchStatus");
  if (!resultContainer || !context) return;
  if (status && regionalSupplierSearchLoading) status.textContent = "Henter virksomhetsinformasjon...";
  if (!regionalSupplierSearchResult) {
    resultContainer.innerHTML = "";
    return;
  }
  const profile = regionalSupplierSearchResult;
  const name = profile.legalName || profile.name || "Ukjent virksomhet";
  const address = supplierAddress(profile) || "Adresse ikke oppgitt";
  const trade = profile.industry || tradeFromIndustryCode(profile.industryCode) || "Fagområde ikke oppgitt";
  const phone = profile.phone || profile.telephone || "Telefon ikke oppgitt";
  const website = normalizeWebsite(firstValue(profile.businessWebsite, profile.companyWebsite, profile.website));
  const websiteMarkup = website ? `<a href="${esc(website)}" target="_blank" rel="noreferrer">${esc(website.replace(/^https?:\/\//i, "").replace(/\/$/, ""))}</a>` : "Nettsted ikke oppgitt";
  const employees = firstValue(profile.employees, profile.employeeCount, profile.employeeRange) || "Ansatte ikke oppgitt";
  const revenue = formatRevenue(firstValue(profile.revenue, profile.annualRevenue, profile.turnover)) || "Omsetning ikke oppgitt";
  resultContainer.innerHTML = `<article class="regional-supplier-search-result"><div><span class="panel-kicker">Søkeresultat · lagt til i regionoversikten</span><h4>${esc(name)}</h4><p>${esc(trade)} · ${esc(address)}</p></div><dl><div><dt>Organisasjonsnummer</dt><dd>${esc(profile.organizationNumber || profile.orgNumber || "Ikke oppgitt")}</dd></div><div><dt>Telefon</dt><dd>${esc(phone)}</dd></div><div><dt>Nettsted</dt><dd>${websiteMarkup}</dd></div><div><dt>Ansatte</dt><dd>${esc(String(employees))}</dd></div><div><dt>Omsetning</dt><dd>${esc(String(revenue))}</dd></div></dl><button type="button" class="regional-supplier-search-open" id="openRegionalSupplierSearchResult">Åpne virksomhetsprofil</button></article>`;
  document.querySelector("#openRegionalSupplierSearchResult")?.addEventListener("click", () => {
    supplier = { ...profile, name, trade, dashboardRegionId: context.id, dashboardRegionName: context.name, dashboardMunicipalities: context.municipalities };
    profileLookupStarted = true;
    mapOverviewStarted = false;
    render();
  });
}

async function searchRegionalSupplier(query, context) {
  const status = document.querySelector("#regionalSupplierSearchStatus");
  if (!query) {
    if (status) status.textContent = "Skriv inn virksomhetsnavn eller organisasjonsnummer.";
    return;
  }
  const requestId = ++regionalSupplierSearchRequestId;
  regionalSupplierSearchLoading = true;
  regionalSupplierSearchResult = null;
  if (status) status.textContent = "Henter virksomhetsinformasjon...";
  renderRegionalSupplierSearchResult(context);
  try {
    const params = new URLSearchParams({ name: query });
    if (/^\d{9}$/.test(query.replace(/\s/g, ""))) params.set("orgNumber", query.replace(/\s/g, ""));
    const response = await fetch(`/api/business-profile?${params}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const payload = await response.json().catch(() => ({}));
    if (requestId !== regionalSupplierSearchRequestId) return;
    if (!response.ok || !payload.profile) throw new Error("Ingen virksomhet ble funnet.");
    const searchedSupplier = {
      ...payload.profile,
      profileSource: payload.source || payload.profile.profileSource,
      name: payload.profile.legalName || query,
      dashboardRegionId: context.id,
      dashboardRegionName: context.name,
      dashboardMunicipalities: context.municipalities,
      source: "Søk i virksomhetsregister",
    };
    regionalSupplierSearchResult = searchedSupplier;
    regionalSuppliers = sortSuppliersAlphabetically(hydrateDashboardContactNotes(dedupeDashboardSuppliers([...regionalSuppliers, searchedSupplier])));
    saveManualSupplier(context, searchedSupplier);
    markDashboardSupplierCalled(searchedSupplier, context);
    if (status) status.textContent = "Virksomheten er funnet og ligger over regionlisten.";
  } catch (error) {
    if (requestId !== regionalSupplierSearchRequestId) return;
    if (status) status.textContent = error?.name === "TimeoutError" ? "Oppslaget tok for lang tid. Prøv igjen." : (error.message || "Virksomheten kunne ikke hentes.");
  } finally {
    if (requestId === regionalSupplierSearchRequestId) {
      regionalSupplierSearchLoading = false;
      renderRegionalSupplierSearchResult(context);
    }
  }
}

function renderRegionalSupplierRows(context) {
  const rows = document.querySelector("#regionalSupplierRows");
  const regionCount = document.querySelector("#dashboardRegionalSupplierCount");
  const called = readDashboardCalledSuppliers();
  const visibleSuppliers = dashboardTradeFilter
    ? regionalSuppliers.filter((item) => String(item.trade || "").toLocaleLowerCase("nb-NO") === dashboardTradeFilter.toLocaleLowerCase("nb-NO"))
    : regionalSuppliers;
  const orderedSuppliers = [...visibleSuppliers].sort((left, right) => {
    const leftNote = readDashboardContactNote(left);
    const rightNote = readDashboardContactNote(right);
    const leftHasNote = Boolean(leftNote.heading || leftNote.text);
    const rightHasNote = Boolean(rightNote.heading || rightNote.text);
    return Number(rightHasNote) - Number(leftHasNote);
  });
  if (regionCount) regionCount.textContent = `${regionalSuppliers.length.toLocaleString("nb-NO")} virksomheter i regionen`;
  if (!orderedSuppliers.length) {
    if (rows) rows.innerHTML = `<p class="dashboard-map-status">Ingen virksomheter ble funnet i ${esc(context.name)}.</p>`;
    return;
  }
  if (rows) rows.innerHTML = orderedSuppliers.map((item, index) => {
    const calledAt = Number(called[dashboardSupplierKey(item)]) || 0;
    const address = supplierAddress(item);
    const contactNote = readDashboardContactNote(item);
    const contactNoteMarkup = contactNote.heading || contactNote.text
      ? `<span class="dashboard-contact-note">${contactNote.heading ? `<strong>${esc(contactNote.heading)}</strong>` : ""}${contactNote.text ? `<span>${esc(contactNote.text)}</span>` : ""}</span>`
      : "";
    return `<button class="regional-supplier-row" type="button" data-regional-supplier="${index}"><span><strong><span class="dashboard-called-star ${calledAt ? "is-called" : ""}" data-dashboard-called="${index}" role="button" tabindex="0" aria-label="${calledAt ? "Oppringt " + formatCheckedDate(calledAt) : "Marker som oppringt"}" title="${calledAt ? "Oppringt " + formatCheckedDate(calledAt) : "Marker som oppringt"}">★</span>${supplierSourceMarkup(item)}${esc(item.name || "Ukjent virksomhet")}</strong><small>${esc(item.trade || "Fagområde ikke oppgitt")}</small></span><span>${esc(address || "Adresse ikke oppgitt")}</span>${contactNoteMarkup}</button>`;
  }).join("");
  rows?.querySelectorAll("[data-dashboard-called]").forEach((star) => star.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const selected = orderedSuppliers[Number(star.dataset.dashboardCalled)];
    markDashboardSupplierCalled(selected, context);
  }));
  rows?.querySelectorAll("[data-regional-supplier]").forEach((button) => button.addEventListener("click", () => {
    const selected = orderedSuppliers[Number(button.dataset.regionalSupplier)];
    if (!selected) return;
    try {
      sessionStorage.setItem(overviewSnapshotKey, JSON.stringify({
        regionId: context.id,
        regionName: context.name,
        municipalities: context.municipalities,
        suppliers: regionalSuppliers,
      }));
    } catch { /* Oversikten beholdes i minnet dersom øktlagring ikke er tilgjengelig. */ }
    supplier = { ...selected, dashboardRegionId: context.id, dashboardRegionName: context.name, dashboardMunicipalities: context.municipalities };
    profileLookupStarted = false;
    mapOverviewStarted = false;
    render();
  }));
}

async function loadRegionalSuppliers(context) {
  if (regionalSuppliersLoading) return;
  const requestId = ++regionalSupplierRequestId;
  regionalSupplierAbortController?.abort();
  const abortController = new AbortController();
  regionalSupplierAbortController = abortController;
  regionalSuppliersLoading = true;
  const rows = document.querySelector("#regionalSupplierRows");
  try {
    const params = new URLSearchParams({ all: "1", regionId: context.id, regionName: context.name, municipalityNames: context.municipalities.join(",") });
    const response = await fetch(`/api/registered-suppliers?${params}`, { signal: abortController.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Virksomhetslisten kunne ikke hentes.");
    if (requestId !== regionalSupplierRequestId) return;
    regionalSuppliers = sortSuppliersAlphabetically(hydrateDashboardContactNotes(dedupeDashboardSuppliers([
      ...(Array.isArray(payload.suppliers) ? payload.suppliers : []),
      ...readManualSuppliers(context.id),
    ])));
    renderRegionalSupplierRows(context);
  } catch (error) {
    if (requestId !== regionalSupplierRequestId) return;
    if (error?.name === "AbortError") return;
    if (rows) rows.innerHTML = `<p class="dashboard-map-status">${esc(error.message || "Virksomhetslisten kunne ikke hentes.")}</p>`;
  } finally {
    if (requestId === regionalSupplierRequestId) {
      regionalSuppliersLoading = false;
      if (regionalSupplierAbortController === abortController) regionalSupplierAbortController = null;
    }
  }
}

async function loadDashboardNationalSupplierCount() {
  const count = document.querySelector("#dashboardNationalSupplierCount");
  if (!count) return;
  try {
    const response = await fetch(`/api/national-supplier-count?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Virksomhetstallet kunne ikke hentes.");
    const payload = await response.json();
    const total = Number(payload.count);
    if (!Number.isFinite(total)) throw new Error("Ugyldig virksomhetstall.");
    count.textContent = `Norsk ByggRadar har i dag ${total.toLocaleString("nb-NO")} registrerte bedrifter`;
  } catch { count.textContent = "Registrerte bedrifter kunne ikke hentes akkurat nå."; }
}
