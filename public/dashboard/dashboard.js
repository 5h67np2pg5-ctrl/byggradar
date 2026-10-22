const DASHBOARD_VERSION = 441;
const DASHBOARD_PASSWORD = "norskbyggradar3000";
const dashboardAuthKey = "nbr-dashboard-auth-v1";
const storageKey = "nbr-sales-dashboard-handoff";
const overviewSnapshotKey = "nbr-dashboard-overview-snapshot";
const supplierCalledStorageKey = "nbr-supplier-called-v1";
const supplierContactNoteStorageKey = "nbr-supplier-contact-note-v1";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
const getSupplier = () => {
  try {
    const rawSupplier = sessionStorage.getItem(storageKey);
    // Dashboardet skal bare åpnes med virksomhet når den nettopp er valgt
    // fra leverandøroversikten. Gamle valg skal ikke bli hengende igjen.
    sessionStorage.removeItem(storageKey);
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
let dashboardServerNotes = {};
let dashboardNoteSaveQueue = Promise.resolve();

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
  if (supplier?.salesRegionId) return { id: supplier.salesRegionId, name: supplier.salesRegionName || supplier.salesRegionId, municipalities: supplier.salesMunicipalities || [] };
  try {
    const context = JSON.parse(sessionStorage.getItem("nbr-sales-region-context") || "null");
    if (context?.id && Array.isArray(context.municipalities)) return context;
  } catch { /* Bruk standardregion dersom arbeidsøkten ikke har regionkontekst. */ }
  return defaultRegionContext;
}

function dashboardIsAuthenticated() {
  try { return sessionStorage.getItem(dashboardAuthKey) === "ok"; }
  catch { return false; }
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
          <label for="dashboardPassword">Tilgangskode</label>
          <input id="dashboardPassword" type="password" autocomplete="current-password" required />
          <button type="submit">Åpne dashboard</button>
          <div id="dashboardLoginError" class="dashboard-login-error" role="alert" hidden>Tilgangskoden er ikke riktig.</div>
        </form>
        <a class="dashboard-gate-back" href="/user">Tilbake til brukerplattformen</a>
      </section>
    </main>`;
  document.querySelector("#dashboardLoginForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#dashboardPassword");
    const error = document.querySelector("#dashboardLoginError");
    if (input.value === DASHBOARD_PASSWORD) {
      try { sessionStorage.setItem(dashboardAuthKey, "ok"); } catch { /* Tilgang gjelder bare for aktiv nettleserøkt. */ }
      void startDashboard();
      return;
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

function projectType(project) {
  const classification = project?.classification || {};
  return firstValue(
    Array.isArray(classification.projectTypes) ? classification.projectTypes.join(", ") : classification.projectTypes,
    project?.projectType,
    project?.measureType,
    project?.tiltakstype,
    project?.status,
    project?.documentType,
  );
}

function projectPhase(project) {
  const classification = project?.classification || {};
  const phaseCandidate = firstValue(classification.phase, classification.stage, project?.phase, project?.stage);
  if (/^fase\s*[12]$/i.test(String(phaseCandidate || "").trim())) {
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
  let notes = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(supplierContactNoteStorageKey) || "{}");
    notes = parsed && typeof parsed === "object" ? parsed : {};
  } catch { /* Serverregisteret leses uavhengig av nettleserlagring. */ }
  const stored = dashboardContactNoteKeys(value).map((key) => dashboardServerNotes?.[key] || notes?.[key]).find(Boolean);
  if (stored && typeof stored === "object") return { heading: String(stored.heading || "").slice(0, 40), text: String(stored.text || "").slice(0, 50) };
  try {
    const normalizedName = dashboardNormalizedName(value?.name);
    const legacyStored = Object.entries(notes).find(([key]) => {
      const candidate = String(key).replace(/^normalized-name:/, "").split("|")[0];
      return normalizedName && dashboardNormalizedName(candidate) === normalizedName;
    })?.[1];
    if (legacyStored && typeof legacyStored === "object") return { heading: String(legacyStored.heading || "").slice(0, 40), text: String(legacyStored.text || "").slice(0, 50) };
    const snapshot = JSON.parse(sessionStorage.getItem(overviewSnapshotKey) || "null");
    const snapshotItem = snapshot?.suppliers?.find((item) => dashboardContactNoteKeys(item).some((key) => dashboardContactNoteKeys(value).includes(key)));
    const snapshotNote = snapshotItem?.dashboardContactNote || snapshotItem?.contactNote;
    if (snapshotNote && typeof snapshotNote === "object") return { heading: String(snapshotNote.heading || "").slice(0, 40), text: String(snapshotNote.text || "").slice(0, 50) };
    return { heading: "", text: String(stored || "").slice(0, 50) };
  } catch { return { heading: "", text: "" }; }
}

function saveDashboardContactNote(value, heading, text) {
  const entry = { heading: String(heading || "").slice(0, 40), text: String(text || "").slice(0, 50) };
  if (value && typeof value === "object") value.dashboardContactNote = entry;
  try {
    const notes = JSON.parse(localStorage.getItem(supplierContactNoteStorageKey) || "{}");
    dashboardContactNoteKeys(value).forEach((key) => { notes[key] = entry; });
    dashboardContactNoteKeys(value).forEach((key) => { dashboardServerNotes[key] = entry; });
    localStorage.setItem(supplierContactNoteStorageKey, JSON.stringify(notes));
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
      </header>
      <div class="dashboard-context">
        <div><span class="eyebrow">Valgt virksomhet</span><h1>${esc(name)}</h1><p class="dashboard-company-meta">${esc(trade)} · ${esc(address)}</p><p class="dashboard-industry-line">Næringskode: ${esc(industryCode || "Ikke oppgitt")} · ${esc(industryMeaning)}</p></div>
        <button class="back-button dashboard-context-back" id="backToSales" type="button">Tilbake til oversikt</button>
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
          <div class="panel-kicker">06 · Aksept</div><h2>Opprett kundeforhold</h2><p class="panel-intro">Når kunden sier ja, samler du opplysningene i ett siste steg.</p>
          <div class="onboarding-summary"><strong>${esc(name)}</strong><span>${esc(trade)}</span><span>${esc(address)}</span></div>
          <button class="primary-action" type="button">Start kundeopprettelse</button>
          <p class="fine-print">Kundeopprettelse kobles senere til avtale, fakturagrunnlag og tilgangsstyring.</p>
        </article>
        </div>
      </section>
    </main>`;
  document.querySelector("#backToSales")?.addEventListener("click", () => {
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
  syncDashboardMapAddress(supplier);
  void enrichBusinessProfile();
  void initializeMapOverview();
}

async function initializeMapOverview() {
  if (mapOverviewStarted || !supplier) return;
  mapOverviewStarted = true;
  const regionId = supplier.salesRegionId || "bergensregionen";
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
  if (dashboardMap) dashboardMap.remove();
  dashboardMap = L.map(element, { zoomControl: true, scrollWheelZoom: true, dragging: true, doubleClickZoom: true, touchZoom: true, zoomSnap: 0.5 }).setView(dashboardCustomerPoint ? [dashboardCustomerPoint.lat, dashboardCustomerPoint.lon] : [60.39, 5.32], dashboardCustomerPoint ? 13 : 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(dashboardMap);
  const projectIcon = L.divIcon({ className: "dashboard-project-marker", html: "", iconSize: [12, 12], iconAnchor: [6, 6] });
  const customerIcon = L.divIcon({ className: "dashboard-customer-marker", html: "", iconSize: [22, 22], iconAnchor: [11, 11] });
  const bounds = L.latLngBounds([]);
  dashboardProjects.forEach((project) => {
    const { lat, lon } = project.coordinates;
    const marker = L.marker([lat, lon], { icon: projectIcon, keyboard: false }).addTo(dashboardMap);
    marker.bindTooltip(esc(projectLabel(project)), { direction: "top", sticky: true });
    marker.on("click", () => {
      dashboardMap.panTo([lat, lon], { animate: true, duration: 0.25 });
      renderDashboardProjectDetail(project);
    });
    bounds.extend([lat, lon]);
  });
  if (dashboardCustomerPoint) {
    L.marker([dashboardCustomerPoint.lat, dashboardCustomerPoint.lon], { icon: customerIcon, keyboard: false }).addTo(dashboardMap).bindTooltip(`Kundens adresse: ${esc(dashboardCustomerPoint.label)}`, { direction: "top" });
    bounds.extend([dashboardCustomerPoint.lat, dashboardCustomerPoint.lon]);
    dashboardMap.setView([dashboardCustomerPoint.lat, dashboardCustomerPoint.lon], 13, { animate: false });
  } else if (bounds.isValid()) {
    dashboardMap.fitBounds(bounds.pad(0.15), { maxZoom: 11 });
  }
  if (status) status.textContent = `${dashboardProjects.length} prosjekter med kartpunkt i ${esc(supplier.salesRegionName || "valgt region")}.`;
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
  const projectTypes = Array.isArray(classification.projectTypes) ? classification.projectTypes.join(", ") : firstValue(project.projectType, project.measureType);
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
  const selectedIds = new Set([...phaseOne, ...phaseTwo].map((project) => project.sourceDocumentId || project.id));
  const nearest = [...phaseOne, ...phaseTwo,
    ...ranked.filter((project) => !selectedIds.has(project.sourceDocumentId || project.id))]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
  if (!nearest.length) { list.innerHTML = "<p class=\"dashboard-map-status\">Ingen prosjekter med bekreftet kartpunkt.</p>"; return; }
  list.innerHTML = nearest.map((project, index) => {
    const addressText = projectAddress(project) || "Adresse ikke oppgitt";
    const municipality = firstValue(project.municipality, "Kommune ikke oppgitt");
    const date = projectDate(project);
    const distance = Number.isFinite(project.distance) ? `${project.distance.toFixed(1).replace(".", ",")} km` : "";
    return `<div class="nearest-project-row"><span class="nearest-project-number">${index + 1}</span><div><strong>${esc(addressText)}</strong><span>${esc(municipality)}${projectType(project) ? ` · ${esc(projectType(project))}` : ""}</span></div><div class="nearest-project-meta">${projectPhase(project) ? `<b>${esc(projectPhase(project))}</b>` : ""}${date ? `<time>${esc(formatProjectDate(date))}</time>` : ""}${distance ? `<small>${esc(distance)}</small>` : ""}</div></div>`;
  }).join("");
}

document.addEventListener("click", async (event) => {
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
  app.innerHTML = `
    <main class="dashboard-shell">
      <header class="dashboard-topbar">
        <a class="dashboard-brand" href="/user"><img src="/assets/byggradar-radar.png" alt="" /><span>Norsk ByggRadar</span></a>
        <div class="dashboard-heading"><span>Dashboard</span><strong>Velg virksomhet for å starte</strong><small id="dashboardNationalSupplierCount">Laster registrerte bedrifter...</small></div>
      </header>
      <section class="dashboard-context"><div><h1>Virksomheter i valgt region</h1><p>Velg region. Virksomhetene lastes automatisk når området er valgt.</p></div></section>
      <main class="dashboard-region-list"><div class="dashboard-region-picker"><label for="dashboardRegionSelect">Region</label><select id="dashboardRegionSelect">${dashboardRegions.map((item) => `<option value="${esc(item.id)}" ${item.id === context.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select><label for="dashboardTradeSelect">Fagområde</label><select id="dashboardTradeSelect"><option value="">Alle fagområder</option>${["Elektriker", "Snekker", "Rørlegger", "Ventilasjon", "Grunnarbeid", "Murer", "Maler", "Taklegger", "Gulvlegger", "Byggmester", "Varmepumpemontør", "Prosjektering"].map((trade) => `<option value="${esc(trade)}" ${trade === dashboardTradeFilter ? "selected" : ""}>${esc(trade)}</option>`).join("")}</select></div><div class="region-list-heading"><div><span class="panel-kicker">Regionregister</span><h2>Alle virksomheter i ${esc(context.name)}</h2><p>Velg region og fagområde for å avgrense virksomhetslisten.</p></div><strong id="dashboardRegionalSupplierCount" class="regional-supplier-count">Laster antall virksomheter...</strong></div><div id="regionalSupplierRows" class="regional-supplier-rows"><p class="dashboard-map-status">Henter virksomheter i regionen...</p></div></main>
    </main>`;
  document.querySelector("#dashboardRegionSelect")?.addEventListener("change", (event) => {
    const nextContext = dashboardRegions.find((item) => item.id === event.target.value) || defaultRegionContext;
    try { sessionStorage.setItem("nbr-sales-region-context", JSON.stringify(nextContext)); } catch { /* Regionvalget gjelder bare den aktive arbeidsøkten. */ }
    regionalSuppliers = [];
    dashboardTradeFilter = "";
    regionalSupplierRequestId += 1;
    regionalSuppliersLoading = false;
    renderRegionalSupplierOverview();
  });
  document.querySelector("#dashboardTradeSelect")?.addEventListener("change", (event) => {
    dashboardTradeFilter = String(event.target.value || "");
    renderRegionalSupplierRows(context);
  });
  void loadDashboardNationalSupplierCount();
  if (regionalSuppliers.length) renderRegionalSupplierRows(context);
  else void loadRegionalSuppliers(context);
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
    supplier = { ...selected, salesRegionId: context.id, salesRegionName: context.name, salesMunicipalities: context.municipalities };
    profileLookupStarted = false;
    mapOverviewStarted = false;
    render();
  }));
}

async function loadRegionalSuppliers(context) {
  if (regionalSuppliersLoading) return;
  const requestId = ++regionalSupplierRequestId;
  regionalSuppliersLoading = true;
  const rows = document.querySelector("#regionalSupplierRows");
  try {
    const params = new URLSearchParams({ all: "1", regionId: context.id, regionName: context.name, municipalityNames: context.municipalities.join(",") });
    const response = await fetch(`/api/mittanbud-suppliers?${params}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Virksomhetslisten kunne ikke hentes.");
    if (requestId !== regionalSupplierRequestId) return;
    regionalSuppliers = sortSuppliersAlphabetically(hydrateDashboardContactNotes(dedupeDashboardSuppliers(Array.isArray(payload.suppliers) ? payload.suppliers : [])));
    renderRegionalSupplierRows(context);
  } catch (error) {
    if (requestId !== regionalSupplierRequestId) return;
    if (rows) rows.innerHTML = `<p class="dashboard-map-status">${esc(error.message || "Virksomhetslisten kunne ikke hentes.")}</p>`;
  } finally {
    if (requestId === regionalSupplierRequestId) regionalSuppliersLoading = false;
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
