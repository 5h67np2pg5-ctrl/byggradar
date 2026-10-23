const userVersion = 442;
const dashboardVersion = 457;
const SALES_VERSION = userVersion + dashboardVersion;
const salesEntryIsApproved = (() => {
  try {
    return sessionStorage.getItem("nbr-entry-version") === String(SALES_VERSION)
      && sessionStorage.getItem("nbr-entry-mode") === "sales";
  }
  catch { return false; }
})();

const regions = [
  { id: "bergensregionen", name: "Bergensregionen", anchor: [60.393, 5.324], municipalities: ["Bergen kommune", "Askøy kommune", "Øygarden kommune", "Bjørnafjorden kommune", "Osterøy kommune", "Alver kommune", "Samnanger kommune", "Vaksdal kommune", "Austevoll kommune", "Kvam herad", "Voss herad", "Modalen kommune", "Masfjorden kommune", "Austrheim kommune", "Fedje kommune", "Gulen kommune", "Tysnes kommune"] },
  { id: "stavangerregionen", name: "Stavangerregionen", anchor: [58.970, 5.733], municipalities: ["Stavanger kommune", "Sandnes kommune", "Sola kommune", "Randaberg kommune", "Klepp kommune", "Time kommune", "Hå kommune", "Gjesdal kommune", "Strand kommune", "Kvitsøy kommune", "Hjelmeland kommune", "Bjerkreim kommune", "Eigersund kommune", "Suldal kommune", "Lund kommune", "Sokndal kommune"] },
  { id: "haugalandsregionen", name: "Haugalandsregionen", anchor: [59.505, 5.700], municipalities: ["Kvinnherad kommune", "Stord kommune", "Fitjar kommune", "Bømlo kommune", "Sveio kommune", "Haugesund kommune", "Karmøy kommune", "Tysvær kommune", "Bokn kommune", "Utsira kommune", "Vindafjord kommune", "Etne kommune", "Sauda kommune"] },
  { id: "grenlandsregionen", name: "Grenlandsregionen", anchor: [59.140, 9.610], municipalities: ["Skien kommune", "Porsgrunn kommune", "Bamble kommune", "Kragerø kommune", "Drangedal kommune", "Siljan kommune"] },
  { id: "sorlandsregionen", name: "Sørlandsregionen", anchor: [58.147, 7.996], municipalities: ["Kristiansand kommune", "Lindesnes kommune", "Vennesla kommune", "Lillesand kommune", "Lyngdal kommune", "Farsund kommune", "Flekkefjord kommune", "Kvinesdal kommune", "Birkenes kommune", "Sirdal kommune", "Hægebostad kommune", "Iveland kommune"] },
  { id: "vestfoldkongsbergregionen", name: "Vestfold- og Kongsbergregionen", anchor: [59.250, 10.200], municipalities: ["Drammen kommune", "Sandefjord kommune", "Tønsberg kommune", "Larvik kommune", "Horten kommune", "Holmestrand kommune", "Lier kommune", "Kongsberg kommune", "Færder kommune", "Øvre Eiker kommune"] },
  { id: "trondheim", name: "Trondheim kommune", anchor: [63.4305, 10.3951], municipalities: ["Trondheim kommune"] },
];
const allRegionMunicipalityNames = [...new Set(regions.flatMap((item) => item.municipalities))];

// Mittanbud bruker egne områdekoder, som ikke er de samme som SSBs kommunenummer.
const municipalityCodes = {
  bergen: "3096", askoy: "3114", oygarden: "3113", bjornafjorden: "3111", osteroy: "3117", alver: "3118", voss: "3108", kvam: "3109",
  samnanger: "3110", vaksdal: "3115", austevoll: "3112", modalen: "3116", masfjorden: "3121", austrheim: "3119", fedje: "3120", gulen: "3122", tysnes: "3103",
  stavanger: "2386", sandnes: "2941", sola: "2395", randaberg: "2396", klepp: "2392", time: "2393", ha: "2391", gjesdal: "2394", strand: "2398", kvitsoy: "2404", hjelmeland: "2399", bjerkreim: "2390", eigersund: "2384", suldal: "2400", sirdal: "3095", lund: "2389", sokndal: "2388",
  kvinnherad: "3104", stord: "3101", fitjar: "3102", bomlo: "3100", sveio: "3099", haugesund: "2387", karmoy: "2407", tysvaer: "2406", bokn: "2405", utsira: "2408", vindafjord: "2409", etne: "3098", sauda: "2401",
  skien: "3054", porsgrunn: "3053", bamble: "3058", notodden: "3055", midttelemark: "3062", kragero: "3059", nome: "3061", tinn: "3063", drangedal: "3060", vinje: "3070", seljord: "3065", kviteseid: "3066", siljan: "3057", tokke: "3069", hjartdal: "3064", nissedal: "3067", fyresdal: "3068",
  kristiansand: "3074", lindesnes: "3075", farsund: "3076", flekkefjord: "3077", lillesand: "3082", birkenes: "3083", iveland: "3085", vennesla: "3090", lyngdal: "3092", haegebostad: "3093", kvinesdal: "3094"
  , drammen: "3301", sandefjord: "3907", tonsberg: "3905", larvik: "3909", horten: "3901", holmestrand: "3903", lier: "3312", kongsberg: "3303", faerder: "3811", ovreeiker: "3314"
};
const officialMunicipalitySources = {
  alver: "https://innsyn.sing.no/alver/innsyn/wfinnsyn.ashx?response=arkivsak_sok_tomdefault&showresults=true",
  askoy: "https://innsynpluss.onacos.no/askoy/sok/",
  austevoll: "https://prod02.elementscloud.no/publikum/941139787_prod-941139787/",
  austrheim: "https://www.austrheim.kommune.no/nav/innsynpolitikk_og_hoyringar",
  bergen: "https://www.bergen.kommune.no/omkommunen/offentlig-innsyn/innsynplanogbyggesak/saksinnsyn",
  bjornafjorden: "https://www.bjornafjorden.kommune.no/sok-etter-sak/sok-etter-alle-saker/",
  fedje: "https://www.fedje.kommune.no/artikkel/postliste",
  gulen: "https://www.gulen.kommune.no/artikkel/offentleg-postjournal-og-innsyn-i-dokument",
  kvam: "https://www.kvam.no/innsyn/postliste/",
  masfjorden: "https://prod02.elementscloud.no/publikum/945627913_prod-945627913/",
  modalen: "https://prod02.elementscloud.no/publikum/964969302_prod-964969302/",
  osteroy: "https://www.osteroy.kommune.no/artikkel/innsyn-i-saker",
  samnanger: "https://www.samnanger.kommune.no/cfc88fe6-1070-4fb1-9c08-2ea15c88c9d3",
  tysnes: "https://prod01.elementscloud.no/publikum/959412340_PROD-959412340-IKTNH/",
  vaksdal: "https://www.vaksdal.kommune.no/f85858ea-00aa-4140-b0f5-e9b1d9c05e16",
  voss: "https://voss.herad.no/administrasjon/postliste-og-innsyn-i-arkiv/sok/",
  oygarden: "https://www.oygarden.kommune.no/tjenester/innsyn-og-naring/innsyn/postliste/",
  etne: "https://www.etne.kommune.no/om-kommunen/innsyn/sok/",
};
const approvedMunicipalityHosts = new Set(["alver.kommune.no", "austrheim.kommune.no", "bjornafjorden.kommune.no", "www.bjornafjorden.kommune.no", "fedje.kommune.no", "gulen.kommune.no", "innsyn.sing.no", "innsynpluss.onacos.no", "kvam.no", "masfjorden.kommune.no", "modalen.kommune.no", "osteroy.kommune.no", "prod01.elementscloud.no", "prod02.elementscloud.no", "samnanger.kommune.no", "tysnes.kommune.no", "vaksdal.kommune.no", "bergen.kommune.no", "voss.herad.no", "oygarden.kommune.no", "etne.kommune.no"]);
const state = { regionId: "bergensregionen", municipality: "", address: "", projects: [], geocode: null, map: null, addressTimer: null, supplierQuery: "", supplierTrade: "", supplierShowAll: false, supplierLoading: false, supplierError: "", suppliers: [], supplierSearched: false, supplierCalledNotice: null, googleAdsLoading: false, googleAdsResults: [], googleAdsError: "" };

const app = document.querySelector("#salesApp");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
const normalize = (value) => String(value || "").toLocaleLowerCase("nb-NO").replace(/\b(kommune|herad)\b/g, "").replace(/\s+/g, " ").trim();
const region = () => regions.find((item) => item.id === state.regionId) || regions[0];
const municipalityName = (value) => String(value || "").replace(/\s+/g, " ").trim();
const supplierTradeTerms = [
  ["bygg og tømrerarbeid", "snekker"], ["tømrer", "snekker"], ["snekker", "snekker"],
  ["elektriker", "elektriker"], ["rørlegger", "rorlegger"], ["rør", "rorlegger"],
  ["maler", "maler"], ["kjøkken", "kjokken"], ["bad", "bad"], ["fasade", "fasade"],
  ["kjeller", "kjeller"], ["grunnarbeid", "grunnarbeid"], ["tak", "tak"],
  ["borettslag", "borettslag"], ["sameie", "borettslag"], ["større prosjekter", "xl"],
];
const supplierTradeLabels = [...new Map(supplierTradeTerms.map(([, slug]) => [slug, {
  snekker: "Snekker", elektriker: "Elektriker", rorlegger: "Rørlegger", maler: "Maler",
  kjokken: "Kjøkken", bad: "Pusse opp bad", fasade: "Fasade", kjeller: "Kjeller",
  grunnarbeid: "Grunnarbeid", tak: "Tak", borettslag: "Borettslag/sameie", xl: "Større prosjekter",
}[slug] || slug])).values()];
const supplierWorkTypeIds = { snekker: "213", elektriker: "123", rorlegger: "207", bad: "153", tak: "229" };
const supplierCalledStorageKey = "nbr-supplier-called-v1";
const supplierPhoneStorageKey = "nbr-supplier-phone-v1";
const salesRegionContextKey = "nbr-sales-region-context";
const supplierCalledDays = 30;
let supplierCountRequest = 0;

function sortSuppliersAlphabetically(suppliers) {
  return [...suppliers].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "nb-NO", { sensitivity: "base" }));
}

function renderShell() {
  app.innerHTML = `
    <main class="sales-shell">
      <header class="sales-topbar">
        <a class="sales-brand" href="/" aria-label="Tilbake til Norsk ByggRadar"><img src="/assets/byggradar-radar.png" alt="" /><span>Norsk ByggRadar</span></a>
        <div class="sales-title"><span>Selgerflate</span><strong>Se prosjekter rundt kundens adresse</strong></div>
        <div class="sales-version">Versjon ${SALES_VERSION}</div>
      </header>
      <section class="sales-controls" aria-label="Salgsfiltre">
        <div class="control-group address-control"><label for="customerAddress">Kundens adresse</label><div class="address-row"><input id="customerAddress" type="search" list="customerAddressSuggestions" placeholder="Skriv inn gateadresse, poststed eller postnummer" autocomplete="street-address" /><datalist id="customerAddressSuggestions"></datalist><button id="addressSearch" type="button">Finn adresse</button></div><p>Adressesøk og forslag er begrenset til valgt region.</p></div>
        <div class="control-group"><label for="salesRegion">Område</label><select id="salesRegion">${regions.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select></div>
        <div class="control-group"><label for="salesMunicipality">Kommune</label><select id="salesMunicipality"><option value="">Alle kommuner i området</option></select></div>
      </section>
      <section class="sales-summary"><strong id="salesSummary">Velg område og skriv inn kundens adresse for å starte salgsvisningen.</strong><span id="salesAddressStatus">Ingen kundeadresse valgt</span></section>
      <section class="sales-map-section"><div class="section-heading"><h1>Områdekart for <span id="mapAreaName">Bergensregionen</span></h1><span id="mapCount">Klar for søk</span></div><div id="salesMap" class="sales-map" aria-label="Områdekart med prosjekter og kundens adresse"></div><p class="map-legend"><span class="legend-dot red"></span>Kundens adresse <span class="legend-dot blue"></span>Prosjekt</p></section>
      <section class="sales-suppliers" aria-labelledby="salesSuppliersTitle"><div class="section-heading"><div><h2 id="salesSuppliersTitle">Andre leverandører i Norge</h2><p id="salesSupplierCount" class="supplier-count">Beregner unike leverandører i alle regioner...</p><p>Vis alle leverandører i valgt område, eller filtrer listen etter fagområde.</p></div></div><div class="supplier-search-row"><button id="salesSupplierAll" type="button" class="supplier-all-button">Vis alle leverandører</button><select id="salesSupplierTrade" aria-label="Fagområde"><option value="">Alle virksomheter</option>${supplierTradeLabels.map((label) => { const slug = Object.entries({ snekker: "Snekker", elektriker: "Elektriker", rorlegger: "Rørlegger", maler: "Maler", kjokken: "Kjøkken", bad: "Pusse opp bad", fasade: "Fasade", kjeller: "Kjeller", grunnarbeid: "Grunnarbeid", tak: "Tak", borettslag: "Borettslag/sameie", xl: "Større prosjekter" }).find(([, value]) => value === label)?.[0] || ""; return `<option value="${slug}">${esc(label)}</option>`; }).join("")} </select><button id="salesSupplierSearch" type="button">Filtrer fagområde</button></div><div id="salesSupplierResults" class="supplier-results" aria-live="polite"></div><div id="salesSelectedProject" class="sales-selected-project" hidden></div></section>
    </main>`;
  bindEvents();
  rememberSalesRegionContext();
  updateMunicipalities();
  loadProjects();
  void loadGlobalSupplierCount();
}

function rememberSalesRegionContext() {
  try {
    sessionStorage.setItem(salesRegionContextKey, JSON.stringify({ id: state.regionId, name: region().name, municipalities: region().municipalities }));
  } catch { /* Regionkontekst er bare nødvendig i den aktive arbeidsøkten. */ }
}

async function loadSupplierCount(regionGroups, requestId) {
  const count = document.querySelector("#salesSupplierCount");
  try {
    const params = new URLSearchParams({ regions: JSON.stringify(regionGroups) });
    const response = await fetch(`/api/mittanbud-supplier-summary?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Kunne ikke hente leverandørantallet.");
    if (requestId === supplierCountRequest) count.textContent = `${payload.count} unike leverandører funnet i alle Norsk ByggRadars registrerte regioner`;
  } catch {
    if (requestId === supplierCountRequest) count.textContent = "Leverandørantallet kunne ikke hentes";
  }
}

function loadRegionSupplierCount() {
  return Promise.resolve();
}

function loadGlobalSupplierCount() {
  const requestId = ++supplierCountRequest;
  const count = document.querySelector("#salesSupplierCount");
  count.textContent = "Beregner unike leverandører i alle Norsk ByggRadars registrerte regioner...";
  void loadSupplierCount(regions.map((item) => ({ id: item.id, municipalities: item.municipalities })), requestId);
}

function bindEvents() {
  document.querySelector("#salesRegion").addEventListener("change", (event) => { state.regionId = event.target.value; state.municipality = ""; rememberSalesRegionContext(); clearSupplierResults(); updateMunicipalities(); loadProjects(); });
  document.querySelector("#salesMunicipality").addEventListener("change", (event) => { state.municipality = event.target.value; clearSupplierResults(); loadProjects(); });
  document.querySelector("#salesSupplierAll").addEventListener("click", () => searchExternalSuppliers({ showAll: true }));
  document.querySelector("#salesSupplierSearch").addEventListener("click", () => searchExternalSuppliers({ showAll: false }));
  document.querySelector("#salesSupplierTrade").addEventListener("change", (event) => { state.supplierTrade = event.target.value; });
  document.querySelector("#salesSupplierResults").addEventListener("click", (event) => {
    const star = event.target.closest("[data-supplier-called]");
    if (star) {
      event.preventDefault();
      markSupplierCalled(Number(star.dataset.supplierCalled));
      return;
    }
    const link = event.target.closest("[data-supplier-phone-search]");
    if (link) enrichSupplierPhone(state.suppliers[Number(link.dataset.supplierPhoneSearch)]);
    const dashboardLink = event.target.closest("[data-open-supplier-dashboard]");
    if (dashboardLink) openSupplierDashboard(Number(dashboardLink.dataset.openSupplierDashboard));
  });

  document.querySelector("#addressSearch").addEventListener("click", geocodeCustomerAddress);
  document.querySelector("#customerAddress").addEventListener("input", (event) => {
    const query = event.target.value.trim();
    window.clearTimeout(state.addressTimer);
    state.geocode = null;
    if (!query) {
      document.querySelector("#salesAddressStatus").textContent = "Ingen kundeadresse valgt";
      renderMap();
      return;
    }
    if (query.length < 3) { renderAddressSuggestions([]); return; }
    state.addressTimer = window.setTimeout(() => fetchAddressSuggestions(query), 280);
  });
  document.querySelector("#customerAddress").addEventListener("change", geocodeCustomerAddress);
  document.querySelector("#customerAddress").addEventListener("keydown", (event) => { if (event.key === "Enter") geocodeCustomerAddress(); });
}

function addressSearchParams(query, limit = 8) {
  return new URLSearchParams({ sok: query, treffPerSide: String(limit), utkoordsys: "4258", kommuner: region().municipalities.join(",") });
}

function renderAddressSuggestions(items) {
  const datalist = document.querySelector("#customerAddressSuggestions");
  if (!datalist) return;
  datalist.innerHTML = [...new Set(items.map((item) => item.adressetekst).filter(Boolean))].map((label) => `<option value="${esc(label)}"></option>`).join("");
}

async function fetchAddressSuggestions(query) {
  try {
    const response = await fetch(`/api/geocode?${addressSearchParams(query).toString()}`);
    const payload = await response.json();
    renderAddressSuggestions(payload?.adresser || []);
  } catch { renderAddressSuggestions([]); }
}

function clearSupplierResults() {
  state.suppliers = [];
  state.supplierSearched = false;
  state.supplierShowAll = false;
  state.supplierCalledNotice = null;
  const results = document.querySelector("#salesSupplierResults");
  if (results) results.innerHTML = "";
}

async function searchGoogleAds() {
  const input = document.querySelector("#googleAdsQuery");
  const query = input.value.trim() || document.querySelector("#salesSupplierTrade").selectedOptions[0]?.textContent?.trim() || "";
  const results = document.querySelector("#salesSupplierResults");
  if (!query) { results.innerHTML = `<div class="supplier-empty">Skriv inn virksomhet eller fagområde før søket.</div>`; return; }
  state.googleAdsLoading = true;
  state.googleAdsError = "";
  results.innerHTML = `<div class="supplier-empty">Søker etter aktive Google Ads-funn...</div>`;
  try {
    const params = new URLSearchParams({ q: query, regionId: state.regionId, regionName: region().name, municipality: state.municipality, trade: document.querySelector("#salesSupplierTrade").selectedOptions[0]?.textContent?.trim() || "" });
    const response = await fetch(`/api/google-ads-suppliers?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Google Ads-søket kunne ikke gjennomføres.");
    state.googleAdsResults = Array.isArray(payload.suppliers) ? payload.suppliers : [];
    state.suppliers = [...state.googleAdsResults, ...state.suppliers.filter((supplier) => supplier.source !== "GA")];
    renderSupplierResults(payload.message || "");
  } catch (error) {
    state.googleAdsError = error.message || "Google Ads-søket kunne ikke gjennomføres.";
    results.innerHTML = `<div class="supplier-empty"><strong>Google Ads-søk kunne ikke gjennomføres.</strong><p>${esc(state.googleAdsError)}</p></div>`;
  } finally { state.googleAdsLoading = false; }
}

function supplierSearchParams() {
  const query = state.municipality || region().name;
  const normalizedQuery = query.toLocaleLowerCase("nb-NO");
  const matchedTrade = state.supplierTrade
    ? [state.supplierTrade, state.supplierTrade]
    : supplierTradeTerms.find(([term]) => normalizedQuery.includes(term));
  const place = query
    .replace(matchedTrade?.[0] || "", "")
    .replace(/\s+\bi\b\s+/i, " ")
    .trim() || state.municipality || region().name;
  const codes = state.municipality
    ? [municipalityCodes[normalizeCode(state.municipality)] || "3096"]
    : region().municipalities.map((item) => municipalityCodes[normalizeCode(item)]).filter(Boolean);
  const trade = matchedTrade?.[1] || "";
  const municipalityNames = state.municipality ? [state.municipality] : region().municipalities;
  return new URLSearchParams({ municipalities: codes.join(","), municipalityNames: municipalityNames.join(","), regionId: state.regionId, regionName: region().name, workTypes: supplierWorkTypeIds[trade] || "", trade, place });
}

async function searchExternalSuppliers({ showAll = false } = {}) {
  const results = document.querySelector("#salesSupplierResults");
  state.supplierTrade = document.querySelector("#salesSupplierTrade").value;
  if (!showAll && !state.supplierTrade) { results.innerHTML = `<div class="supplier-empty">Velg fagområde før du filtrerer.</div>`; return; }
  state.supplierShowAll = showAll;
  state.supplierQuery = state.municipality || region().name;
  state.supplierLoading = true; state.supplierError = ""; state.suppliers = []; state.supplierSearched = true; state.supplierCalledNotice = null;
  results.innerHTML = `<div class="supplier-empty">Henter leverandører...</div>`;
  try {
    const params = supplierSearchParams();
    if (showAll) { params.set("all", "1"); params.delete("workTypes"); params.delete("trade"); }
    const response = await fetch(`/api/mittanbud-suppliers?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Leverandørlisten kunne ikke hentes.");
    state.suppliers = sortSuppliersAlphabetically(filterCalledSuppliers(Array.isArray(payload.suppliers) ? payload.suppliers : []).map(hydrateCachedSupplierPhone));
    if (!state.suppliers.length) throw new Error(payload.message || "Ingen leverandører ble funnet.");
    renderSupplierResults();
  } catch (error) {
    state.supplierError = error.message || "Leverandørlisten kunne ikke hentes.";
    results.innerHTML = `<div class="supplier-empty"><strong>Ingen leverandører ble hentet.</strong><p>${esc(state.supplierError)}</p></div>`;
  } finally { state.supplierLoading = false; }
}

function renderSupplierResults(extraMessage = "") {
  const results = document.querySelector("#salesSupplierResults");
  const called = readCalledSuppliers();
  const summary = `${extraMessage ? `<div class="supplier-result-summary">${esc(extraMessage)}</div>` : ""}${state.supplierShowAll ? `<div class="supplier-result-summary">Alle leverandører i ${esc(state.supplierQuery)}: ${state.suppliers.length}</div>` : ""}`;
  results.innerHTML = summary + state.suppliers.map((supplier, index) => {
    const calledAt = Number(called[supplierKey(supplier)]) || 0;
    const calledText = calledAt ? `<span class="supplier-called-notice" role="status">Oppringt ${formatCalledDate(calledAt)}</span>` : "";
    const phone = supplier.phone
      ? `<a href="tel:${esc(supplier.phone.replace(/\D/g, ""))}">Telefon: ${esc(supplier.phone)}</a>`
      : `<span>${supplier.aiLoading ? "Søker etter telefonnummer..." : "Telefon ikke oppgitt"}</span><span class="supplier-phone-search-label">Søk selv etter telefonnummer</span>`;
    const aiInfo = supplier.aiInfo && !supplier.phone ? `<span class="supplier-ai-info">${esc(supplier.aiInfo)}</span>` : "";
    const sourceCode = supplier.source === "Mittanbud" ? "MA" : String(supplier.source || supplier.sourceLabel || "MA").toUpperCase();
    const sourceBadge = sourceCode === "GA" ? `<span class="supplier-source-badge" title="Funnet via Google Ads">GA</span>` : sourceCode === "HP" ? `<span class="supplier-source-badge hp" title="Funnet via Håndverkerportalen">HP</span>` : sourceCode === "DIB" ? `<span class="supplier-source-badge dib" title="Funnet via DiBK SGregister">DIB</span>` : `<span class="supplier-source-badge mittanbud" title="Funnet via Mittanbud">MA</span>`;
    return `<article class="supplier-row"><div><strong>${sourceBadge}<button type="button" class="supplier-dashboard-link" data-open-supplier-dashboard="${index}">${esc(supplier.name || "Ukjent virksomhet")}</button></strong><span>Fagområde: ${esc(supplier.trade || "Fagområde ikke oppgitt")}</span><span>${esc(supplier.address || "Adresse ikke oppgitt")}</span>${supplier.description ? `<span>${esc(supplier.description)}</span>` : ""}</div><div>${phone}${aiInfo}${supplier.email ? `<a href="mailto:${esc(supplier.email)}">${esc(supplier.email)}</a>` : ""}${supplier.website ? `<a href="${esc(supplier.website)}" target="_blank" rel="noreferrer">Nettsted</a>` : ""}<button type="button" class="supplier-called-star ${calledAt ? "is-called" : ""}" data-supplier-called="${index}" aria-pressed="${calledAt ? "true" : "false"}" title="${calledAt ? "Oppringt " + formatCalledDate(calledAt) : "Marker som oppringt"}">★</button>${calledText}</div></article>`;
  }).join("");
}

function openSupplierDashboard(index) {
  const supplier = state.suppliers[index];
  if (!supplier) return;
  const dashboardSupplier = {
    ...supplier,
    salesRegionId: state.regionId,
    salesRegionName: region().name,
    salesMunicipalities: region().municipalities,
    salesMunicipality: state.municipality,
  };
  try {
    sessionStorage.setItem("nbr-sales-dashboard-handoff", JSON.stringify(dashboardSupplier));
    sessionStorage.setItem("nbr-dashboard-overview-snapshot", JSON.stringify({
      regionId: state.regionId,
      regionName: region().name,
      municipalities: region().municipalities,
      suppliers: state.suppliers,
    }));
  } catch { /* Dashboardet viser en fallback hvis økten ikke kan lagres. */ }
  window.location.href = "/dashboard?login=1&v=892";
}

function formatCalledDate(timestamp) {
  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("nb-NO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function supplierKey(supplier) {
  return `${String(supplier.name || "").trim().toLocaleLowerCase("nb-NO")}|${String(supplier.address || "").trim().toLocaleLowerCase("nb-NO")}`;
}

function readSupplierPhoneCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(supplierPhoneStorageKey) || "{}");
    return cached && typeof cached === "object" ? cached : {};
  } catch { return {}; }
}

function hydrateCachedSupplierPhone(supplier) {
  const cached = readSupplierPhoneCache()[supplierKey(supplier)];
  return cached?.phone || cached?.website ? { ...supplier, phone: cached.phone || supplier.phone, website: cached.website || supplier.website, aiInfo: cached.phone ? "Telefonnummer funnet via AI-søk." : "Nettsted funnet via AI-søk.", aiChecked: true, aiSearchUrl: cached.searchUrl || "" } : supplier;
}

function rememberSupplierPhone(supplier, payload) {
  if (!payload.phone && !payload.website) return;
  try {
    const cached = readSupplierPhoneCache();
    cached[supplierKey(supplier)] = { phone: payload.phone || "", website: payload.website || "", searchUrl: payload.searchUrl || "", savedAt: Date.now() };
    localStorage.setItem(supplierPhoneStorageKey, JSON.stringify(cached));
  } catch { /* Telefonresultatet er fortsatt tilgjengelig i den aktive visningen. */ }
}

function readCalledSuppliers() {
  try {
    const entries = JSON.parse(localStorage.getItem(supplierCalledStorageKey) || "{}");
    return entries && typeof entries === "object" ? entries : {};
  } catch { return {}; }
}

function filterCalledSuppliers(suppliers) {
  return suppliers;
}

function markSupplierCalled(index) {
  const supplier = state.suppliers[index];
  if (!supplier) return;
  const calledAt = Date.now();
  try {
    const called = readCalledSuppliers();
    called[supplierKey(supplier)] = calledAt;
    localStorage.setItem(supplierCalledStorageKey, JSON.stringify(called));
  } catch { /* Markeringen er bare lokal bekvemmelighet. */ }
  state.supplierCalledNotice = { name: supplier.name, at: calledAt };
  renderSupplierResults();
}

async function enrichSupplierPhone(supplier) {
  if (!supplier || supplier.aiLoading) return;
  if (supplier.aiChecked) return;
  supplier.aiLoading = true;
  supplier.aiChecked = true;
  supplier.aiInfo = "";
  renderSupplierResults();
  try {
    const response = await fetch(`/api/ai-phone-search?q=${encodeURIComponent(supplier.name)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "AI-søk feilet.");
    supplier.phone = payload.phone || "";
    supplier.website = payload.website || supplier.website || "";
    supplier.aiInfo = payload.phone ? "Telefonnummer funnet via AI-søk." : payload.info || "Telefonnummer ble ikke funnet i AI-søket.";
    supplier.aiSearchUrl = payload.searchUrl || "";
    rememberSupplierPhone(supplier, payload);
  } catch (error) {
    supplier.aiInfo = error.message || "AI-søket kunne ikke gjennomføres.";
  } finally {
    supplier.aiLoading = false;
    renderSupplierResults();
  }
}

function updateMunicipalities() {
  const select = document.querySelector("#salesMunicipality");
  select.innerHTML = `<option value="">Alle kommuner i området</option>${region().municipalities.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join("")}`;
  select.value = state.municipality;
  document.querySelector("#mapAreaName").textContent = state.municipality ? municipalityName(state.municipality) : region().name;
}

async function loadProjects() {
  const currentRegion = region();
  document.querySelector("#mapCount").textContent = "Laster prosjekter...";
  try {
    const [response, contactResponse] = await Promise.all([
      fetch(`/data/regions/${currentRegion.id}/projects_location_enriched.json?ts=${Date.now()}`),
      fetch(`/data/regions/${currentRegion.id}/projects_contact_enriched.json?ts=${Date.now()}`),
    ]);
    if (!response.ok) throw new Error(`Kunne ikke hente prosjektdata (${response.status})`);
    const [payload, contactPayload] = await Promise.all([
      response.json(),
      contactResponse.ok ? contactResponse.json() : Promise.resolve({ projects: [] }),
    ]);
    const contactMap = new Map((contactPayload.projects || []).map((project) => [project.projectId, project]));
    const projects = (payload.projects || []).filter((project) => !state.municipality || normalize(project.municipality) === normalize(state.municipality)).map((project) => ({ ...project, contactData: contactMap.get(project.sourceDocumentId), point: project.locationEnrichment || project }));
    state.projects = projects;
    const mappedCount = projects.filter((project) => Number.isFinite(Number(project.point.latitude)) && Number.isFinite(Number(project.point.longitude))).length;
    document.querySelector("#mapCount").textContent = `${projects.length} prosjekter · ${mappedCount} med kartpunkt`;
    document.querySelector("#salesSummary").textContent = `${projects.length} prosjekter i ${state.municipality ? municipalityName(state.municipality) : currentRegion.name}.`;
    renderMap();
  } catch (error) {
    state.projects = [];
    document.querySelector("#mapCount").textContent = "Prosjekter kunne ikke lastes";
    document.querySelector("#salesSummary").textContent = error.message;
    renderMap();
  }
}

function renderSelectedProject() {
  const panel = document.querySelector("#salesSelectedProject");
  const project = state.selectedProject;
  if (!panel) return;
  if (!project) { panel.hidden = true; panel.innerHTML = ""; return; }
  const title = project.title || project.shortFacts || project.caseTitle || "Uten prosjekttittel";
  const place = project.address || project.location || project.place || "Adresse ikke oppgitt";
  const municipality = project.municipality || "Kommune ikke oppgitt";
  const phase = project.classification?.phase || project.phase || project.status || "Fase ikke oppgitt";
  const date = project.documentDate || project.recordedDate || project.deadline || "Dato ikke oppgitt";
  const contactData = project.contactData || {};
  const sourceUrl = salesProjectSourceUrl(project, contactData);
  const location = project.locationEnrichment || {};
  const actors = [project.fromName, project.toName, project.fromOrg, project.toOrg, contactData.displayContact?.name].filter(Boolean);
  const contacts = [...(contactData.contacts || []), ...(project.contacts || [])].filter(Boolean);
  const contactRows = contacts.flatMap((contact) => [contact.name, contact.phone, contact.email].filter(Boolean));
  const fields = [
    ["Adresse", project.address || location.address || project.location],
    ["Kommune", project.municipality],
    ["Matrikkel", project.matrikkel],
    ["Fase/status", phase],
    ["Saksnummer", project.caseNumber],
    ["Dokumentdato", project.documentDate],
    ["Dokumenttype", project.documentType],
    ["Avsender", project.fromName || contactData.fromName],
    ["Mottaker", project.toName || contactData.toName],
    ["Virksomhet", project.fromOrg || project.toOrg || contactData.fromOrg || contactData.toOrg],
    ["Poststed", location.postPlace],
    ["Postnummer", location.postCode],
  ].filter(([, value]) => value);
  const fileLinks = (project.files || []).map((file) => {
    const href = safeHref(file.url || file.href);
    return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(file.title || file.name || "Åpne vedlegg")}</a>` : "";
  }).filter(Boolean);
  const contactMarkup = contactRows.length || actors.length
    ? `<section><h3>Kontakt og aktører</h3><p>${actors.map((actor) => esc(actor)).join(" · ")}</p>${contactRows.map((item) => `<p>${esc(item)}</p>`).join("")}</section>`
    : "";
  panel.hidden = false;
  panel.innerHTML = `<div class="selected-project-heading"><strong>Valgt prosjekt · utvidet informasjon</strong><button type="button" id="closeSelectedProject">Lukk</button></div><h2>${esc(title)}</h2><p>${esc(place)} · ${esc(municipality)}</p><dl>${fields.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>${project.description ? `<section><h3>Prosjektinformasjon</h3><p class="selected-project-description">${esc(project.description)}</p></section>` : ""}${contactMarkup}${fileLinks.length ? `<section><h3>Vedlegg</h3>${fileLinks.join("")}</section>` : ""}<section class="selected-project-links">${sourceUrl ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">Se full sak</a>` : ""}${project.sourceStream ? `<span>Kilde: ${esc(project.sourceStream)}</span>` : ""}</section>`;
  document.querySelector("#closeSelectedProject")?.addEventListener("click", () => { state.selectedProject = null; renderSelectedProject(); });
}

async function geocodeCustomerAddress() {
  const input = document.querySelector("#customerAddress");
  const status = document.querySelector("#salesAddressStatus");
  const query = input.value.trim();
  if (!query) { status.textContent = "Skriv inn kundens adresse først"; return; }
  status.textContent = "Søker etter adresse...";
  try {
    const response = await fetch(`/api/geocode?${addressSearchParams(query, 5).toString()}`);
    const payload = await response.json();
    const item = payload?.adresser?.[0];
    if (!item || !Number.isFinite(Number(item.representasjonspunkt?.lat))) throw new Error("Adressen ble ikke funnet.");
    state.geocode = { lat: Number(item.representasjonspunkt.lat), lon: Number(item.representasjonspunkt.lon), label: item.adressetekst || query };
    input.value = state.geocode.label;
    status.textContent = `Kundens adresse: ${state.geocode.label}`;
    renderMap();
  } catch (error) { state.geocode = null; status.textContent = error.message || "Adressen kunne ikke finnes."; renderMap(); }
}

function renderMap() {
  const element = document.querySelector("#salesMap");
  if (!element || !window.L) return;
  if (state.map) state.map.remove();
  const currentRegion = region();
  const origin = state.geocode ? [state.geocode.lat, state.geocode.lon] : currentRegion.anchor;
  state.map = L.map(element, { zoomControl: true, scrollWheelZoom: true, doubleClickZoom: true, dragging: true, touchZoom: true, zoomAnimation: true, zoomSnap: 0.5 }).setView(origin, state.geocode ? 11 : 9);
  enableGentlePinchZoom(state.map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(state.map);
  const bounds = L.latLngBounds([]);
  state.projects.forEach((project) => {
    const lat = Number(project.point.latitude); const lon = Number(project.point.longitude); if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const marker = L.circleMarker([lat, lon], { radius: 5, color: "#1a628f", weight: 2, fillColor: "#54a9d0", fillOpacity: 0.9 }).addTo(state.map);
    const title = project.title || project.shortFacts || project.address || "Prosjekt";
    marker.bindTooltip(`${title}`, { direction: "top", sticky: true }); bounds.extend([lat, lon]);
    marker.on("click", () => { state.selectedProject = project; renderSelectedProject(); });
  });
  if (state.geocode) { const marker = L.circleMarker(origin, { radius: 9, color: "#8d2525", weight: 3, fillColor: "#d94c4c", fillOpacity: 1 }).addTo(state.map); marker.bindTooltip(`Kundens adresse: ${esc(state.geocode.label)}`, { direction: "top" }); bounds.extend(origin); }
  if (state.geocode) {
    // Kundeadressen er utgangspunktet. Selgeren kan zoome ut manuelt
    // for å se flere prosjektmarkører i området.
    // Hold the customer address in the center while keeping nearby projects
    // visible. The seller can zoom in further when a tighter view is needed.
    state.map.setView(origin, 13, { animate: false });
  } else if (bounds.isValid()) {
    state.map.fitBounds(bounds.pad(0.15), { maxZoom: 11 });
  }
  setTimeout(() => state.map?.invalidateSize(), 100);
}

function enableGentlePinchZoom(map) {
  map.touchZoom.enable();
  const container = map.getContainer();
  container.style.touchAction = "none";
  const touchZoom = map.touchZoom;
  const originalMove = touchZoom._onTouchMove.bind(touchZoom);
  touchZoom._onTouchMove = (event) => {
    if (event.touches?.length === 2 && touchZoom._zooming && touchZoom._startDist) {
      const first = map.mouseEventToContainerPoint(event.touches[0]);
      const second = map.mouseEventToContainerPoint(event.touches[1]);
      const currentDistance = first.distanceTo(second);
      const rawRatio = currentDistance / touchZoom._startDist;
      const easedRatio = 1 + (rawRatio - 1) * 0.10;
      const originalStartDistance = touchZoom._startDist;
      touchZoom._startDist = currentDistance / easedRatio;
      try {
        originalMove(event);
      } finally {
        touchZoom._startDist = originalStartDistance;
      }
      return;
    }
    originalMove(event);
  };
}

function normalizeCode(value) {
  return String(value || "").toLocaleLowerCase("nb-NO").replace(/kommune|herad/g, "").replace(/[åá]/g, "a").replace(/[øö]/g, "o").replace(/[æä]/g, "ae").replace(/[^a-z0-9]/g, "").trim();
}

function officialMunicipalitySource(municipality) {
  const key = normalizeCode(municipality);
  return officialMunicipalitySources[key] || "";
}

function parseMatrikkel(value) {
  const match = String(value || "").match(/^(\d+)\s*\/\s*(\d+)(?:\s*\/\s*(\d+))?(?:\s*\/\s*(\d+))?/);
  return match ? { gnr: match[1], bnr: match[2] } : null;
}

function elementsSearchUrl(base, query) {
  const today = new Date().toISOString().slice(0, 10);
  return `${base}?Query=${encodeURIComponent(query)}&OrderBy=DATE&SortOrder=1&DateFrom=2023-10-15&DateTo=${today}`;
}

function salesProjectSourceUrl(project, contactData = {}) {
  const candidate = project.caseUrl || project.sourceUrl || contactData.sourceUrl || project.source || "";
  const municipality = normalizeCode(project.municipality);
  const query = project.caseNumber || project.address || project.matrikkel || project.title || "";
  if (municipality === "bergen") {
    return query ? `${officialMunicipalitySources.bergen}?q=${encodeURIComponent(query)}` : officialMunicipalitySources.bergen;
  }
  if (municipality === "austevoll") {
    return query ? elementsSearchUrl("https://prod02.elementscloud.no/publikum/941139787_prod-941139787/Search", query) : officialMunicipalitySources.austevoll;
  }
  if (municipality === "alver") {
    const params = new URLSearchParams({ response: "arkivsak_sok_tomdefault", showresults: "true", startrow: "0", tomtsok: "false", simple: "false" });
    const matrikkel = parseMatrikkel(project.matrikkel);
    if (project.caseNumber) params.set("sakid", project.caseNumber);
    else if (matrikkel) { params.set("gardsnr", matrikkel.gnr); params.set("bruksnr", matrikkel.bnr); }
    else if (query) params.set("tittel", query);
    return `https://innsyn.sing.no/alver/innsyn/wfinnsyn.ashx?${params}`;
  }
  if (municipality === "etne") return officialMunicipalitySources.etne;
  if (municipality === "kvam") return /norske-postlister\.no\/sak\//i.test(candidate) ? candidate : officialMunicipalitySources.kvam;
  const elementsBases = {
    tysnes: "https://prod01.elementscloud.no/publikum/959412340_PROD-959412340-IKTNH/Search",
    masfjorden: "https://prod02.elementscloud.no/publikum/945627913_prod-945627913/Search",
    modalen: "https://prod02.elementscloud.no/publikum/964969302_prod-964969302/Search",
  };
  const elementsBase = elementsBases[municipality];
  if (elementsBase) return query ? elementsSearchUrl(elementsBase, query) : officialMunicipalitySource(municipality);
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" && approvedMunicipalityHosts.has(url.hostname.toLocaleLowerCase("nb-NO")) && /#\/details\//i.test(candidate)) return candidate;
  } catch {}
  return officialMunicipalitySource(municipality);
}

function safeHref(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

if (salesEntryIsApproved) {
  renderShell();
} else {
  window.location.replace(`/?login=1&v=${SALES_VERSION}`);
}
