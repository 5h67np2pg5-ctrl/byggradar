const state = {
  projects: [],
  rawProjectCount: 0,
  filtered: [],
  selected: null,
  trade: "",
  area: "",
  showMap: false,
  visibleCount: 200,
  userLocation: null,
  activeRegion: null,
  map: null,
  mapMarkers: [],
  mapViewKey: "",
  miniMap: null,
  fullMap: null,
  fullMapMarker: null,
  suppressFullMapOpenUntil: 0,
  forceCloseFullMapUntil: 0,
  fullMapCloseToken: 0,
  mapGestureUntil: 0,
  mapGeocodeCache: new Map(),
  refreshTimer: null,
  weeklyRefreshTimer: null,
  markedProjectIds: new Set(),
  expandedPreviewIds: new Set(),
};

const tradePresets = [
  "elektro",
  "bygg",
  "rør",
  "ventilasjon",
  "grunnarbeid",
  "tak",
  "prosjektering",
  "rehabilitering",
  "nybygg",
  "garasje",
  "næring",
  "bolig",
];

const savedFiltersKey = "byggradar.filters.v1";
const markedProjectsKey = "byggradar.markedProjects.v1";
const authSessionKey = "byggradar.session.v1";
const rememberedSessionValue = "active-v2";
const standardProjectLimit = 200;
const loadMoreStep = 20;
const weeklyDeliveryCount = 50;

const locationRegions = [
  {
    id: "bergensregionen",
    name: "Bergensregionen",
    anchor: { lat: 60.39299, lon: 5.32415 },
    municipalities: [
      "Bergen kommune",
      "Askøy kommune",
      "Øygarden kommune",
      "Bjørnafjorden kommune",
      "Osterøy kommune",
      "Alver kommune",
      "Samnanger kommune",
      "Vaksdal kommune",
      "Austevoll kommune",
      "Kvam herad",
      "Voss herad",
      "Modalen kommune",
      "Masfjorden kommune",
      "Austrheim kommune",
      "Fedje kommune",
      "Gulen kommune",
      "Tysnes kommune",
    ],
  },
];

const municipalityMapAnchors = {
  "bergen": { lat: 60.39299, lon: 5.32415 },
  "askøy": { lat: 60.40962, lon: 5.22504 },
  "øygarden": { lat: 60.35712, lon: 5.12415 },
  "bjørnafjorden": { lat: 60.18385, lon: 5.46380 },
  "osterøy": { lat: 60.52476, lon: 5.49566 },
  "alver": { lat: 60.54890, lon: 5.28770 },
  "samnanger": { lat: 60.37735, lon: 5.75921 },
  "vaksdal": { lat: 60.47678, lon: 5.74072 },
  "austevoll": { lat: 60.09520, lon: 5.22720 },
  "kvam": { lat: 60.37002, lon: 6.14554 },
  "voss": { lat: 60.62967, lon: 6.41474 },
  "modalen": { lat: 60.81772, lon: 5.80693 },
  "masfjorden": { lat: 60.79936, lon: 5.30035 },
  "austrheim": { lat: 60.77709, lon: 4.93227 },
  "fedje": { lat: 60.77821, lon: 4.71495 },
  "gulen": { lat: 60.98112, lon: 5.07417 },
  "tysnes": { lat: 60.04076, lon: 5.53129 },
};

const municipalityNumbers = {
  "bergen": "4601",
  "tysnes": "4616",
  "voss": "4621",
  "kvam": "4622",
  "samnanger": "4623",
  "bjørnafjorden": "4624",
  "austevoll": "4625",
  "øygarden": "4626",
  "askøy": "4627",
  "vaksdal": "4628",
  "modalen": "4629",
  "osterøy": "4630",
  "alver": "4631",
  "austrheim": "4632",
  "fedje": "4633",
  "masfjorden": "4634",
  "gulen": "4635",
};

const sourceLabels = {
  postlister_allemannsdata: "Byggesak",
  bane_nor_procurement_plan: "Bane NOR",
};

// Offisielle innganger til postjournal/saksinnsyn for kommunene i regionen.
// Sider som videresender til riktig dokumentportal er med vilje beholdt som
// kommunal inngang når rådataene ikke inneholder en direkte dokumentlenke.
const officialMunicipalitySources = {
  "alver": "https://innsyn.sing.no/alver/innsyn/wfinnsyn.ashx?response=arkivsak_sok_tomdefault&showresults=true",
  "askøy": "https://innsynpluss.onacos.no/askoy/sok/",
  "austevoll": "https://prod02.elementscloud.no/publikum/941139787_prod-941139787/",
  "austrheim": "https://www.austrheim.kommune.no/nav/innsynpolitikk_og_hoyringar",
  "bergen": "https://www.bergen.kommune.no/omkommunen/offentlig-innsyn/innsynplanogbyggesak/saksinnsyn",
  "bjørnafjorden": "https://www.bjornafjorden.kommune.no/sok-etter-sak/sok-etter-alle-saker/",
  "fedje": "https://www.fedje.kommune.no/artikkel/postliste",
  "gulen": "https://www.gulen.kommune.no/artikkel/offentleg-postjournal-og-innsyn-i-dokument",
  "kvam": "https://www.kvam.no/innsyn/postliste/",
  "masfjorden": "https://prod02.elementscloud.no/publikum/945627913_prod-945627913/",
  "modalen": "https://prod02.elementscloud.no/publikum/964969302_prod-964969302/",
  "osterøy": "https://www.osteroy.kommune.no/artikkel/innsyn-i-saker",
  "samnanger": "https://www.samnanger.kommune.no/cfc88fe6-1070-4fb1-9c08-2ea15c88c9d3",
  "tysnes": "https://prod01.elementscloud.no/publikum/959412340_PROD-959412340-IKTNH/",
  "vaksdal": "https://www.vaksdal.kommune.no/f85858ea-00aa-4140-b0f5-e9b1d9c05e16",
  "voss": "https://voss.herad.no/administrasjon/postliste-og-innsyn-i-arkiv/sok/",
  "øygarden": "https://www.oygarden.kommune.no/tjenester/innsyn-og-naring/innsyn/postliste/",
};

const approvedMunicipalityHosts = new Set([
  "alver.kommune.no",
  "austrheim.kommune.no",
  "bjornafjorden.kommune.no",
  "fedje.kommune.no",
  "gulen.kommune.no",
  "innsyn.sing.no",
  "innsynpluss.onacos.no",
  "kvam.no",
  "masfjorden.kommune.no",
  "modalen.kommune.no",
  "osteroy.kommune.no",
  "prod01.elementscloud.no",
  "prod02.elementscloud.no",
  "samnanger.kommune.no",
  "tysnes.kommune.no",
  "vaksdal.kommune.no",
  "bergen.kommune.no",
  "voss.herad.no",
  "oygarden.kommune.no",
]);

const stageRank = {
  "igangsetting søkt": 1,
  "igangsettingstillatelse gitt": 2,
  "tillatelse gitt": 3,
  "rammetillatelse gitt": 4,
  "saksbehandling pågår": 5,
  "søknad mottatt": 6,
};

const app = document.querySelector("#app");
const forceLogin = new URLSearchParams(window.location.search).get("login") === "1";

init();

async function init() {
  if (forceLogin || readSavedValue(authSessionKey) !== rememberedSessionValue) {
    renderLogin();
    return;
  }

  await initApplication();
}

async function initApplication() {
  try {
    renderShell();
    restoreSavedFilters();
    restoreMarkedProjects();
    await loadProjects();
    state.filtered = filterProjects();
    state.selected = null;
    scheduleRefreshes();
    render();
  } catch (error) {
    app.innerHTML = `
      <main class="fatal">
        <h1>ByggRadar kunne ikke starte</h1>
        <p>${escapeHtml(error.message || String(error))}</p>
      </main>
    `;
    console.error(error);
  }
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-screen">
      <section class="login-panel" aria-labelledby="loginTitle">
        <div class="login-brand">
          <img src="/assets/byggradar-radar.png" alt="" class="login-logo" />
        </div>
        <div class="login-copy">
          <p class="login-eyebrow">Få informasjon om prosjekter før andre</p>
          <h1 id="loginTitle">Velkommen til ByggRadar</h1>
          <p>Få relevante byggeprosjekter, tiltak og anskaffelser i områdene du arbeider i.</p>
        </div>
        <label class="remember-choice">
          <input id="rememberSession" type="checkbox" autocomplete="off" />
          <span>Husk meg i denne nettleseren</span>
        </label>
        <button class="login-button" id="loginButton" type="button">Logg inn</button>
      </section>
    </main>
  `;

  document.querySelector("#rememberSession").checked = false;

  document.querySelector("#loginButton")?.addEventListener("click", () => {
    if (document.querySelector("#rememberSession")?.checked) {
      writeSavedValue(authSessionKey, rememberedSessionValue);
    }
    if (forceLogin) window.history.replaceState({}, "", window.location.pathname);
    initApplication();
  });
}

async function loadProjects() {
  const cacheBust = `t=${Date.now()}`;
  const [locationData, contactData] = await Promise.all([
    fetch(`/data/projects_location_enriched.json?${cacheBust}`).then((response) => {
      if (!response.ok) throw new Error(`Kunne ikke hente prosjektdata (${response.status})`);
      return response.json();
    }),
    fetch(`/data/projects_contact_enriched.json?${cacheBust}`).then((response) => {
      if (!response.ok) throw new Error(`Kunne ikke hente kontaktdata (${response.status})`);
      return response.json();
    }),
  ]);

  const contacts = new Map((contactData.projects || []).map((project) => [project.projectId, project]));
  const rawProjects = locationData.projects || [];
  const normalizedProjects = rawProjects.map((project, index) => normalizeProject(project, contacts.get(project.sourceDocumentId), index));
  state.rawProjectCount = normalizedProjects.length;
  state.projects = deduplicateProjects(normalizedProjects);
  // Utvidet prosjektinformasjon er nå tilgjengelig på alle prosjekter.
  // Feltene filtreres i renderExpandedPreviewFields slik at tomme etiketter aldri vises.
  state.expandedPreviewIds = new Set(state.projects.map((project) => project.id));
  state.projects.forEach((project) => {
    project.isExpandedPreview = true;
  });
}

function deduplicateProjects(projects) {
  const grouped = new Map();
  for (const project of projects) {
    const key = projectIdentityKey(project);
    const existing = grouped.get(key);
    grouped.set(key, existing ? mergeProjectRecords(existing, project) : project);
  }
  return [...grouped.values()];
}

function projectIdentityKey(project) {
  const municipality = normalizeMunicipalityName(project.municipality || project.marketArea);
  const caseNumber = normalize(project.documentNumber || project.caseNumber || "");
  if (caseNumber && (project.sourceStream === "postlister_allemannsdata" || project.sourceStream === "bane_nor_procurement_plan")) {
    return `case:${project.sourceStream}:${municipality}:${caseNumber}`;
  }
  if (caseNumber) return `case:${municipality}:${caseNumber}`;

  const matrikkel = normalize(project.matrikkel || "");
  if (matrikkel) return `property:${municipality}:${matrikkel}`;
  const address = normalize(project.address || project.place || "");
  if (address && address !== "ukjent sted") return `address:${municipality}:${address}`;
  return `id:${project.sourceStream}:${project.id}`;
}

function mergeProjectRecords(existing, incoming) {
  const primary = parsedDateMs(incoming.date) > parsedDateMs(existing.date) ? incoming : existing;
  const secondary = primary === existing ? incoming : existing;
  const mergedFiles = uniqueByKey([...(existing.files || []), ...(incoming.files || [])], (file) => normalize(file.url || file.title || file.name || ""));
  const mergedContacts = uniqueByKey([...(existing.contacts || []), ...(incoming.contacts || [])], (contact) => normalize(contact.email || contact.phone || contact.name || ""));
  const mergedActors = uniqueByKey([...(existing.actors || []), ...(incoming.actors || [])], (actor) => normalize(actor.name || ""));

  return {
    ...primary,
    id: existing.id,
    title: primary.title || secondary.title,
    description: [primary.description, secondary.description].sort((a, b) => String(b || "").length - String(a || "").length)[0] || "",
    files: mergedFiles,
    contacts: mergedContacts,
    actors: mergedActors,
    contact: primary.contact || secondary.contact,
    contactQuality: primary.contactQuality?.level === "complete" ? primary.contactQuality : secondary.contactQuality || primary.contactQuality,
    sourceQueries: [...new Set([...(existing.sourceQueries || []), ...(incoming.sourceQueries || [])])],
  };
}

function uniqueByKey(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeProject(project, contactProject, index) {
  const classification = project.classification || {};
  const location = project.locationEnrichment || {};
  const derivedMatrikkel = extractMatrikkelFromProject(project);
  const title = cleanTitle(project.title || project.shortFacts || project.caseTitle || "Ukjent prosjekt");
  const status = classification.stage || project.status || project.phase || "Ukjent status";
  const projectTypes = classification.projectTypes || [];
  const tradeRelevance = project.tradeRelevance || projectTypes.join("; ") || inferTrade(title, project.documentTitle, project.caseTitle);
  const marketRole = project.marketRole || (project.sourceStream === "bane_nor_procurement_plan" ? "external" : "external");
  const address = validAddressCandidate(location.address) || validAddressCandidate(project.address) || "";
  const place = address || project.location || project.municipality || project.marketArea || "Ukjent sted";
  const date = project.documentDate || project.deadline || project.recordedDate || "";
  const hasMapPoint = Boolean(location.hasMapPoint);
  const contact = contactProject?.displayContact || null;
  const actors = projectActors(project, contactProject);
  const contactQuality = assessContactQuality(contact, actors, project.hasAnonymizedActor);
  const lookupSubject = contactLookupSubject(project, place, actors, contact);
  const isPostlistEntry = project.sourceStream === "postlister_allemannsdata";

  return {
    id: project.sourceDocumentId || `project-${index}`,
    sourceStream: project.sourceStream,
    sourceLabel: sourceLabels[project.sourceStream] || "Kilde",
    title,
    rawTitle: project.title || project.shortFacts || "",
    dateLabel: shortDate(date),
    dateFullLabel: fullDateLabel(date),
    firstLine: projectSummaryLine(title, place, project.municipality, status),
    secondLine: `${shortTrade(tradeRelevance)} | ${contactLineSummary(contactQuality)}`,
    status,
    statusText: shortStatus(status),
    date,
    tradeRelevance,
    projectTypes,
    municipality: project.municipality || "",
    marketRole,
    marketArea: project.marketArea || marketRoleLabel(marketRole),
    place,
    address,
    matrikkel: derivedMatrikkel,
    lat: Number(location.latitude || project.latitude || project.lat || 0),
    lon: Number(location.longitude || project.longitude || project.lon || 0),
    hasMapPoint,
    mapLabel: location.mapLabel || "",
    sourceUrl: projectSourceUrl(project),
    sourceQueries: project.sourceQueries || [],
    description: project.description || project.shortFacts || project.caseTitle || "",
    caseNumber: isPostlistEntry ? "" : project.caseNumber || "",
    documentNumber: isPostlistEntry ? project.caseNumber || "" : "",
    documentType: project.documentType || "",
    recordedDate: project.recordedDate || "",
    fromName: project.fromName || "",
    toName: project.toName || "",
    fromOrg: project.fromOrg || "",
    toOrg: project.toOrg || "",
    actorVisibility: project.actorVisibility || "",
    addressLookupStatus: project.addressLookupStatus || location.lookupStatus || "",
    files: Array.isArray(project.files) ? project.files : [],
    buyer: project.buyer || "",
    owner: project.owner || "",
    procurementType: project.procurementType || "",
    procurementProjectType: project.projectType || "",
    estimatedValue: project.estimatedValue || "",
    procurementContactName: project.contactName || "",
    deadline: project.deadline || "",
    contact,
    contacts: contactProject?.contacts || [],
    actors,
    contactQuality,
    lookupSubject,
    contactLookupSources: contactLookupSources(lookupSubject),
    personContactPolicy: contactProject?.personContactPolicy || project.personLookupPolicy || "",
    score: classification.leadScore || 0,
    attractivenessScore: attractivenessScore({
      sourceStream: project.sourceStream,
      status,
      date,
      hasMapPoint,
      matrikkel: project.matrikkel,
      contact,
      classificationScore: classification.leadScore || 0,
      projectTypes,
    }),
    priority: classification.priority || "C",
    searchText: normalize([
      title,
      project.shortFacts,
      status,
      tradeRelevance,
      project.municipality,
      project.marketArea,
      place,
      project.fromOrg,
      project.toOrg,
      contactProject?.displayContact?.name,
      actors.map((actor) => actor.name).join(" "),
    ].filter(Boolean).join(" ")),
  };
}

function renderShell() {
  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand">ByggRadar</div>
          <div class="subtle" id="summaryText" tabindex="0">Laster prosjekter...</div>
        </div>
        <div class="top-actions">
          <button class="help-pill" id="helpPill" type="button" aria-label="Råd om bruk av ByggRadar">Råd</button>
        </div>
      </header>

      <section class="filters" aria-label="Filtre">
        <label class="search-field">
          <span>Fag/oppdragstype</span>
          <input id="tradeInput" type="search" placeholder="f.eks. elektro, tømrer, grunnarbeid" autocomplete="off" />
        </label>
        <div class="area-control">
          <label class="search-field">
            <span>Område</span>
            <input id="areaInput" type="search" placeholder="kommune, adresse, region" autocomplete="off" />
          </label>
          <button class="location-button" id="locationButton" type="button">Finn min region</button>
        </div>
        <div class="region-notice" id="regionNotice" aria-live="polite"></div>

        <div class="chip-row" id="tradePresets"></div>
      </section>

      <section class="workspace">
        <section class="project-list" id="projectList" aria-label="Prosjekter"></section>
      </section>

      <section class="map-dialog" id="mapDialog" hidden aria-label="Prosjektkart">
        <div class="map-dialog-panel">
          <div class="map-dialog-toolbar">
            <strong>Prosjektkart</strong>
            <button class="close-button map-dialog-close" id="mapDialogClose" type="button">Lukk</button>
          </div>
          <div id="fullMapCanvas" class="full-map-canvas"></div>
        </div>
      </section>
    </main>
  `;

  const helpText = "Forslag: Velg fag og område først, åpne de mest relevante prosjektene, og kontakt tiltakshaver eller ansvarlig aktør tidlig. Start kort: Hei, jeg ser at dere har et prosjekt på gang i [adresse]. Vi jobber med [fag], og kan raskt avklare om vi kan bidra i planlegging eller utførelse. Ønsker dere at jeg sender en kort presentasjon eller tar en rask prat?";
  const helpPill = document.querySelector("#helpPill");
  helpPill.dataset.tooltip = helpText;

  document.querySelector("#mapDialogClose").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeFullMap();
  });
  bindInput("tradeInput", "trade");
  bindInput("areaInput", "area");
  document.querySelector("#locationButton").addEventListener("click", useCurrentLocation);
}

function bindInput(id, key) {
  const input = document.querySelector(`#${id}`);
  input.addEventListener("input", () => {
    state[key] = input.value;
    if (key === "area") {
      state.userLocation = null;
      state.activeRegion = findRegionByText(input.value);
    }
    state.visibleCount = standardProjectLimit;
    saveFilters();
    render();
  });
}

function render() {
  state.filtered = filterProjects();
  if (!state.filtered.find((project) => project.id === state.selected?.id)) {
    state.selected = null;
  }

  state.visibleCount = Math.max(standardProjectLimit, state.visibleCount);
  const visibleProjects = visibleDeliveryProjects();
  const summaryText = document.querySelector("#summaryText");
  const totalProjectCount = state.rawProjectCount || state.filtered.length;
  summaryText.innerHTML = `
    <span>${visibleProjects.length} av ${totalProjectCount} aktive prosjekter vises</span>
    <span>hver måned, med ${weeklyDeliveryCount} nye hver uke</span>
  `;
  summaryText.dataset.tooltip = deliveryInfoText();
  document.body.dataset.map = "closed";
  renderRegionNotice();

  renderPresetChips("tradePresets", tradePresets, (value) => {
    state.trade = toggleTextValue(state.trade, value);
    document.querySelector("#tradeInput").value = state.trade;
    state.visibleCount = standardProjectLimit;
    saveFilters();
  });

  renderList();
}

function renderPresetChips(id, values, onClick) {
  const element = document.querySelector(`#${id}`);
  element.innerHTML = values.map((value) => `<button class="chip" type="button" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join("");
  element.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    onClick(button.dataset.value);
    render();
  }));
}

function renderRegionNotice() {
  const notice = document.querySelector("#regionNotice");
  if (!notice) return;
  const selectedRegion = findRegionByText(state.area) || state.activeRegion;
  if (!selectedRegion) {
    notice.textContent = "";
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  notice.textContent = `Valgt område: ${selectedRegion.name} (${selectedRegion.municipalities.length} kommuner)`;
}

function renderList() {
  const list = document.querySelector("#projectList");
  if (!state.filtered.length) {
    list.innerHTML = `<div class="empty">Ingen prosjekter matcher filtrene.</div>`;
    return;
  }
  const visibleProjects = visibleDeliveryProjects();
  list.innerHTML = `
    ${visibleProjects.map((project, index) => `
    <article class="project-row ${state.selected?.id === project.id ? "is-selected" : ""} ${isMarkedProject(project.id) ? "is-marked" : ""}" data-project-id="${escapeHtml(project.id)}">
      <button
        class="project-mark"
        type="button"
        data-id="${escapeHtml(project.id)}"
        aria-pressed="${isMarkedProject(project.id) ? "true" : "false"}"
        title="${isMarkedProject(project.id) ? "Fjern merking" : "Merk prosjekt"}"
      >
        ${isMarkedProject(project.id) ? "★" : "☆"}
      </button>
      <button class="project-summary" type="button" data-id="${escapeHtml(project.id)}">
        <span class="project-number">${index + 1}</span>
        <span class="project-meta">
          <span class="row-status">${escapeHtml(project.statusText)}</span>
          <span class="date-badge" title="${escapeHtml(project.dateFullLabel)}">${index >= standardProjectLimit ? `<span class="extra-star" title="Utenfor standard leveranse">★</span>` : ""}${escapeHtml(project.dateLabel)}</span>
        </span>
        <span class="row-copy">
          <span class="line-primary">${escapeHtml(project.firstLine)}</span>
          <span class="line-secondary">${escapeHtml(project.secondLine)}</span>
        </span>
      </button>
      ${state.selected?.id === project.id ? renderExpandedProject(project) : ""}
    </article>
    `).join("")}
    ${state.visibleCount < state.filtered.length ? `
      <button class="load-more" id="loadMoreButton" type="button">
        Vis 20 flere prosjekter
      </button>
    ` : ""}
  `;
  list.querySelectorAll(".project-summary").forEach((row) => {
    row.addEventListener("click", () => {
      state.selected = state.projects.find((project) => project.id === row.dataset.id);
      if (state.showMap) closeMapPane({ renderAfterClose: false });
      writeSavedValue("selectedProjectId", state.selected?.id || "");
      render();
    });
  });
  list.querySelectorAll(".project-mark").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMarkedProject(button.dataset.id);
      state.filtered = filterProjects();
      render();
    });
  });
  document.querySelector("#loadMoreButton")?.addEventListener("click", () => {
    state.visibleCount = Math.min(state.visibleCount + loadMoreStep, state.filtered.length);
    render();
  });
  document.querySelector(".close-project")?.addEventListener("click", () => {
    state.selected = null;
    writeSavedValue("selectedProjectId", "");
    render();
  });
  document.querySelector(".mini-map-card")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() < state.suppressFullMapOpenUntil) return;
    if (state.selected) openFullMap(state.selected);
  });
  renderMiniMap();
}

function renderExpandedProject(project) {
  const phone = project.contact?.phone ? normalizePhone(project.contact.phone) : "";
  const emailHref = project.contact?.email ? projectMailtoHref(project) : "";
  return `
    <div class="project-expanded">
      <div class="expanded-main">
        <div class="expanded-info">
          <button class="close-button close-project" type="button">Lukk</button>
          <dl class="facts compact">
            <div><dt>Adresse</dt><dd>${escapeHtml(project.place || "Ikke oppgitt")}</dd></div>
            <div><dt>Kommune</dt><dd>${escapeHtml(project.municipality || "Ikke oppgitt")}</dd></div>
            <div><dt>Fag/tema</dt><dd>${escapeHtml(project.tradeRelevance || "Ikke tolket")}</dd></div>
            <div><dt>Matrikkel</dt><dd>${escapeHtml(project.matrikkel || "Ikke oppgitt")}</dd></div>
          </dl>
          <div class="expanded-text">${escapeHtml(project.description || "Ingen ekstra prosjektinfo funnet.")}</div>
          ${project.isExpandedPreview ? renderExpandedPreviewFields(project) : ""}
          ${project.contact ? `
            <div class="contact-line">
              <strong>${escapeHtml(project.contact.name || "Virksomhet")}</strong>
              ${project.contact.phone ? `<a href="tel:${phone}">T: ${escapeHtml(project.contact.phone)}</a>` : `<span>Telefon ikke funnet</span>`}
              ${project.contact.email ? `<a class="generated-mail-link" href="${escapeHtml(emailHref)}" title="Vil du sende mail?" aria-label="Vil du sende mail? E-post til ${escapeHtml(project.contact.email)}">E: ${escapeHtml(project.contact.email)}</a>` : ""}
              ${project.contact.website ? `<a href="${escapeHtml(project.contact.website)}" target="_blank" rel="noreferrer">Nettside</a>` : ""}
            </div>
          ` : `<div class="contact-line muted">Ingen virksomhetskontakt funnet.</div>`}
          ${renderContactQuality(project)}
        </div>
        ${projectCanOpenMap(project) ? `
          <button class="mini-map-card" type="button" aria-label="Åpne kart for prosjektet">
            <span>Prosjektkart</span>
            <span id="miniMapCanvas" class="mini-map-canvas"></span>
          </button>
        ` : ""}
      </div>
    </div>
  `;
}

function renderExpandedPreviewFields(project) {
  const businessContact = project.contacts.find((contact) => contact.name && contact.name === project.contact?.name) || project.contacts[0] || {};
  const sender = [project.fromOrg || project.fromName, project.toOrg || project.toName].filter(Boolean).join(" → ");
  const files = project.files.filter((file) => file && (file.url || file.href)).slice(0, 5).map((file) => {
    const title = fileDisplayTitle(file.title || file.name || "Vedlegg");
    return `<li><a href="${escapeHtml(file.url || file.href)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></li>`;
  }).join("");
  const hasProcurementInfo = project.buyer || project.procurementContactName || project.procurementType || project.estimatedValue || project.deadline;
  const facts = [
    [project.documentNumber ? "Dokumentnummer" : "Saksnummer", project.documentNumber || project.caseNumber],
    ["Dokumentdato", project.date ? formatNorwegianDate(project.date) : ""],
    ["Dokumenttype", project.documentType],
    ["Avsender/mottaker", sender],
    ["Organisasjonsnummer", businessContact.orgNumber],
    ["Bransje", businessContact.industry],
    ["Forretningsadresse", businessContact.address],
    ["Anskaffelse", hasProcurementInfo ? [project.procurementType, project.procurementProjectType].filter(Boolean).join(" · ") || "Ekstern prosjektkilde" : ""],
    ["Kjøper", project.buyer],
    ["Kontaktperson", project.procurementContactName],
    ["Anslått verdi", project.estimatedValue],
    ["Frist", project.deadline],
  ].filter(([, value]) => value);

  if (!facts.length && !files && !project.sourceUrl) return "";

  return `
    <section class="expanded-preview-fields">
      <div class="preview-label">Utvidet prosjektinformasjon</div>
      ${facts.length ? `<dl class="facts compact">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
      ${files ? `<div class="preview-subsection"><strong>Vedlegg</strong><ul class="attachment-list">${files}</ul></div>` : ""}
      ${project.sourceUrl ? `<a class="full-case-link" href="${escapeHtml(project.sourceUrl)}" target="_blank" rel="noreferrer">Åpne kommunalt saksinnsyn</a>` : ""}
    </section>
  `;
}

function projectSourceUrl(project) {
  const candidate = project.caseUrl || project.sourceUrl || "";
  const municipality = normalize(project.municipality || "");

  if (project.sourceStream === "bane_nor_procurement_plan") return candidate;

  if (municipality.includes("bergen")) {
    // Postlistestrømmen gir ofte dokumentnummer, ikke kommunens BYGG-saksnummer.
    // Adresse/matrikkel gir derfor sikrere treff i Bergen kommunes saksinnsyn.
    const query = project.address || project.matrikkel || project.caseNumber || project.title || "";
    return query
      ? `https://www.bergen.kommune.no/omkommunen/offentlig-innsyn/innsynplanogbyggesak/saksinnsyn?q=${encodeURIComponent(query)}`
      : "https://www.bergen.kommune.no/omkommunen/offentlig-innsyn/innsynplanogbyggesak/saksinnsyn";
  }

  if (municipality.includes("austevoll")) {
    return austevollSearchUrl(project);
  }

  if (municipality.includes("alver")) {
    return alverSearchUrl(project);
  }

  // Kvam leverer direkte sakslenker i rådataene. Bruk denne når den finnes,
  // ellers havner brukeren på kommunens generelle postlisteside uten søk.
  if (municipality.includes("kvam")) {
    if (candidate && /norske-postlister\.no\/sak\//i.test(candidate)) return candidate;
    return officialMunicipalitySource(project.municipality);
  }

  // Tysnes, Masfjorden og Modalen bruker samme Elements-søk som Austevoll.
  // Rådataene kommer ofte via en mellomkilde, så vi bygger den offisielle
  // søkeadressen fra kommunens portal i stedet for å sende brukeren dit.
  if (["tysnes", "masfjorden", "modalen"].some((name) => municipality.includes(name))) {
    return elementsMunicipalitySearchUrl(project);
  }

  // Bevar direkte dokumentvisning fra kommuner som leverer en detalj-lenke.
  if (candidate && isApprovedMunicipalitySource(candidate) && /#\/details\//i.test(candidate)) return candidate;

  if (!candidate) return officialMunicipalitySource(project.municipality);

  return officialMunicipalitySource(project.municipality);
}

function austevollSearchUrl(project) {
  const base = "https://prod02.elementscloud.no/publikum/941139787_prod-941139787/Search";
  const query = project.caseNumber || project.address || project.matrikkel || project.title || "";
  if (!query) return officialMunicipalitySource("Austevoll kommune");

  return elementsSearchUrl(base, query);
}

function alverSearchUrl(project) {
  const base = "https://innsyn.sing.no/alver/innsyn/wfinnsyn.ashx";
  const params = new URLSearchParams({
    response: "arkivsak_sok_tomdefault",
    showresults: "true",
    startrow: "0",
    tomtsok: "false",
    simple: "false",
  });
  const caseNumber = String(project.caseNumber || "").trim();
  const matrikkel = parseMatrikkel(project.matrikkel);
  if (caseNumber) {
    params.set("sakid", caseNumber);
  } else if (matrikkel) {
    params.set("gardsnr", matrikkel.gnr);
    params.set("bruksnr", matrikkel.bnr);
  } else if (project.title || project.address) {
    params.set("tittel", project.address || project.title);
  }
  return `${base}?${params.toString()}`;
}

function elementsMunicipalitySearchUrl(project) {
  const municipality = normalize(project.municipality || "");
  const bases = {
    tysnes: "https://prod01.elementscloud.no/publikum/959412340_PROD-959412340-IKTNH/Search",
    masfjorden: "https://prod02.elementscloud.no/publikum/945627913_prod-945627913/Search",
    modalen: "https://prod02.elementscloud.no/publikum/964969302_prod-964969302/Search",
  };
  const entry = Object.entries(bases).find(([name]) => municipality.includes(name));
  if (!entry) return officialMunicipalitySource(project.municipality);
  const query = project.caseNumber || project.address || project.matrikkel || project.title || "";
  return query ? elementsSearchUrl(entry[1], query) : officialMunicipalitySource(project.municipality);
}

function elementsSearchUrl(base, query) {
  const today = new Date().toISOString().slice(0, 10);
  return `${base}?Query=${encodeURIComponent(query)}&OrderBy=DATE&SortOrder=1&DateFrom=2023-10-15&DateTo=${today}`;
}

function officialMunicipalitySource(municipalityValue) {
  const municipality = normalize(municipalityValue);
  const entry = Object.entries(officialMunicipalitySources).find(([name]) => {
    const key = normalize(name);
    return municipality === key || municipality.startsWith(`${key} `) || municipality.includes(`${key} kommune`) || municipality.includes(`${key} herad`);
  });
  return entry ? entry[1] : "";
}

function isApprovedMunicipalitySource(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && approvedMunicipalityHosts.has(url.hostname.toLocaleLowerCase("nb-NO"));
  } catch {
    return false;
  }
}

function renderContactQuality(project) {
  const sources = project.contactLookupSources || [];
  return `
    <div class="contact-quality ${project.contactQuality.level}">
      <div>
        <strong>${escapeHtml(project.contactQuality.label)}</strong>
        <span>${escapeHtml(project.contactQuality.message)}</span>
      </div>
      ${project.actors.length ? `
        <div class="actor-line">
          Aktør: ${project.actors.slice(0, 3).map((actor) => escapeHtml(actor.name)).join(", ")}
        </div>
      ` : ""}
      ${project.lookupSubject ? `
        <div class="actor-line">
          Søk etter: ${escapeHtml(project.lookupSubject)}
        </div>
      ` : ""}
      ${sources.length ? `
        <div class="lookup-line">
          ${sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>`).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderMap() {
  const pane = document.querySelector("#mapPane");
  if (!state.showMap) {
    if (state.map) {
      state.map.remove();
      state.map = null;
      state.mapMarkers = [];
      state.mapViewKey = "";
    }
    pane.innerHTML = "";
    return;
  }

  const points = mapPointProjects();
  if (!points.length) {
    if (state.map) {
      state.map.remove();
      state.map = null;
      state.mapMarkers = [];
      state.mapViewKey = "";
    }
    pane.innerHTML = `
      <div class="map-pane-toolbar">
        <strong>Kart</strong>
        <button class="map-pane-close" id="mapPaneClose" type="button">Lukk</button>
      </div>
      <div class="map-empty">Ingen kartpunkt i dette utvalget.</div>
    `;
    attachMapCloseButton(pane);
    return;
  }

  if (!window.L) {
    pane.innerHTML = `
      <div class="map-pane-toolbar">
        <strong>Kart</strong>
        <button class="map-pane-close" id="mapPaneClose" type="button">Lukk</button>
      </div>
      <div class="map-empty">Kartbiblioteket er ikke lastet. Sjekk nettverk og last siden på nytt.</div>
    `;
    attachMapCloseButton(pane);
    return;
  }

  if (!pane.querySelector("#mapCanvas")) {
    pane.innerHTML = `
      <div class="map-pane-toolbar">
        <strong>Kart</strong>
        <button class="map-pane-close" id="mapPaneClose" type="button">Lukk</button>
      </div>
      <div id="mapCanvas" class="map-canvas"></div>
    `;
    attachMapCloseButton(pane);
    state.map = null;
    state.mapMarkers = [];
    state.mapViewKey = "";
  }

  if (!state.map) {
    state.map = L.map("mapCanvas", {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
    });
    addBaseMap(state.map);
    state.map.whenReady(() => refreshMapSize(state.map));
  }

  const viewKey = mapViewKey(points);
  if (state.mapViewKey !== viewKey) {
    if (points.length === 1) {
      state.map.setView(L.latLng(points[0].lat, points[0].lon), 14);
    } else {
      const bounds = L.latLngBounds(points.map((project) => [project.lat, project.lon]));
      state.map.fitBounds(bounds.pad(0.16), { maxZoom: 12 });
    }
    state.mapViewKey = viewKey;
  }

  state.mapMarkers.forEach((marker) => marker.remove());
  state.mapMarkers = addProjectMarkers(state.map, points, state.selected, {
    onMarkerClick: openProjectFromMap,
  });

  // Kommunale postlister inneholder ofte matrikkel eller adresse før
  // koordinaten er beriket. Hent reell posisjon fra Kartverket i bakgrunnen,
  // og tegn kartet på nytt når treffene er klare.
  resolveMissingMapPoints(points).then((changed) => {
    if (!changed || !state.showMap) return;
    state.mapViewKey = "";
    renderMap();
  });

  refreshMapSize(state.map);
}

function attachMapCloseButton(pane) {
  const closeButton = pane.querySelector("#mapPaneClose");
  closeButton?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMapPane();
  });
  closeButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMapPane();
  });
}

function renderMiniMap() {
  const container = document.querySelector("#miniMapCanvas");
  if (state.miniMap) {
    state.miniMap.remove();
    state.miniMap = null;
  }
  if (container) container.innerHTML = "";
  if (state.showMap) return;
  const selectedPoint = projectMapPoint(state.selected);
  if (!container || !selectedPoint || !window.L) return;

  state.miniMap = L.map(container, {
    zoomControl: false,
    attributionControl: false,
    preferCanvas: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    dragging: false,
    touchZoom: false,
    tap: false,
  }).setView([selectedPoint.lat, selectedPoint.lon], selectedPoint.isMunicipalityFallbackPoint ? 12 : 15);
  addBaseMap(state.miniMap, { compact: true });
  addProjectMarkers(state.miniMap, mapPointProjects(), selectedPoint, {
    compact: true,
    onMarkerClick: openProjectFromMap,
  });
  refreshMapSize(state.miniMap);

  // Et utvidet kort kan åpnes før hovedkartet er vist. Kjør derfor samme
  // adresse- og matrikkeloppslag her, slik at Bjørnafjorden og andre
  // kommuner får eiendommens faktiske plassering også i småkartet.
  if (state.selected && !state.selected.hasMapPoint && hasMapLookupValue(state.selected)) {
    resolveMissingMapPoints([state.selected]).then((changed) => {
      if (!changed || !state.selected || !document.querySelector("#miniMapCanvas")) return;
      renderMiniMap();
    });
  }
}

function openFullMap(project) {
  const selectedPoint = projectMapPoint(project);
  if (!selectedPoint || !window.L) return;
  if (Date.now() < state.suppressFullMapOpenUntil) return;
  if (Date.now() < state.forceCloseFullMapUntil) return;
  const dialog = document.querySelector("#mapDialog");
  if (state.miniMap) {
    state.miniMap.remove();
    state.miniMap = null;
  }
  document.querySelector("#miniMapCanvas")?.replaceChildren();
  dialog.hidden = false;
  dialog.removeAttribute("hidden");
  dialog.removeAttribute("aria-hidden");
  dialog.style.removeProperty("display");
  dialog.classList.remove("is-force-hidden");
  document.body.classList.add("has-map-dialog");

  if (state.fullMap) {
    state.fullMap.remove();
    state.fullMap = null;
    state.fullMapMarker = null;
  }

  state.fullMap = L.map("fullMapCanvas", {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: false,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    boxZoom: true,
    keyboard: true,
    dragging: true,
    touchZoom: true,
    tap: true,
  }).setView([selectedPoint.lat, selectedPoint.lon], selectedPoint.isMunicipalityFallbackPoint ? 12 : 13);
  addBaseMap(state.fullMap);
  const points = mapPointProjects();
  addProjectMarkers(state.fullMap, points, selectedPoint, {
    onMarkerClick: openProjectFromMap,
  });
  bindFullMapTouchGuards();
  bindFullMapProjectSelection(points);
  refreshMapSize(state.fullMap);
}

function markMapGesture(duration = 1100) {
  state.mapGestureUntil = Math.max(state.mapGestureUntil || 0, Date.now() + duration);
}

function isMapGestureActive() {
  return Date.now() < (state.mapGestureUntil || 0);
}

function bindFullMapTouchGuards() {
  const canvas = document.querySelector("#fullMapCanvas");
  if (!canvas) return;
  let multiTouchStarted = false;
  canvas.addEventListener("touchstart", (event) => {
    multiTouchStarted = (event.touches?.length || 0) > 1;
    if (multiTouchStarted) markMapGesture(1400);
  }, { passive: true });
  canvas.addEventListener("touchmove", (event) => {
    if ((event.touches?.length || 0) > 1 || multiTouchStarted) markMapGesture(1400);
  }, { passive: true });
  canvas.addEventListener("touchend", () => {
    if (multiTouchStarted) markMapGesture(1400);
    multiTouchStarted = false;
  }, { passive: true });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" && event.isPrimary === false) markMapGesture(1400);
  }, { passive: true });
}

function mapPointProjects() {
  return activeMapProjects()
    .map((project) => projectMapPoint(project))
    .filter(Boolean);
}

function projectCanOpenMap(project) {
  return Boolean(projectMapPoint(project));
}

function activeMapProjects() {
  const projects = state.filtered.length ? state.filtered : state.projects;
  if (!state.selected) return projects;
  const hasSelected = projects.some((project) => project.id === state.selected.id);
  return hasSelected ? projects : [state.selected, ...projects];
}

function projectMapPoint(project) {
  if (!project) return null;
  if (project.hasMapPoint && project.lat && project.lon) return project;
  const anchor = projectMapAnchor(project);
  if (!anchor) return null;
  const offset = stableMapOffset(project.id);
  return {
    ...project,
    lat: anchor.lat + offset.lat,
    lon: anchor.lon + offset.lon,
    hasMapPoint: true,
    isMunicipalityFallbackPoint: true,
  };
}

function extractMatrikkelFromProject(project) {
  const sourceText = [project.caseTitle, project.shortFacts, project.documentTitle, project.address]
    .filter(Boolean)
    .join(" | ");
  const match = sourceText.match(/\bgnr\.?\s*(\d+)\s*(?:,\s*|\s+)bnr\.?\s*(\d+)/i);
  if (match) {
    return `${match[1]}/${match[2]}/0/0`;
  }
  return project.matrikkel || "";
}

async function resolveMissingMapPoints(projects) {
  const sourceProjects = projects.map((project) => state.projects.find((item) => item.id === project.id) || project);
  const candidates = sourceProjects.filter((project) => !project.hasMapPoint && hasMapLookupValue(project));
  if (!candidates.length) return false;

  const results = await Promise.all(candidates.map((project) => geocodeProject(project)));
  return results.some(Boolean);
}

function hasMapLookupValue(project) {
  return Boolean(validAddressCandidate(project.address) || parseMatrikkel(project.matrikkel));
}

async function geocodeProject(project) {
  const query = mapLookupQuery(project);
  if (!query) return false;
  const cacheKey = JSON.stringify(query);
  if (state.mapGeocodeCache.has(cacheKey)) {
    return applyGeocodeResult(project, state.mapGeocodeCache.get(cacheKey));
  }

  try {
    const url = `/api/geocode?${new URLSearchParams({
      ...query,
      treffPerSide: "1",
      utkoordsys: "4258",
      filtrer: "adresser.representasjonspunkt",
    })}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Kartverket ${response.status}`);
    const payload = await response.json();
    const address = payload.adresser?.[0];
    const point = address?.representasjonspunkt;
    const result = point?.lat && point?.lon ? {
      lat: Number(point.lat),
      lon: Number(point.lon),
      address: address.adressetekst || "",
      label: "Kartverket Adresse-API",
    } : null;
    state.mapGeocodeCache.set(cacheKey, result);
    return applyGeocodeResult(project, result);
  } catch (error) {
    state.mapGeocodeCache.set(cacheKey, null);
    console.warn("Kunne ikke plassere prosjektet i kartet", project.id, error);
    return false;
  }
}

function mapLookupQuery(project) {
  const municipalityName = normalizeMunicipalityName(project.municipality);
  const municipalityNumber = municipalityNumbers[municipalityName];
  const address = validAddressCandidate(project.address);
  if (address) {
    return {
      sok: `${address} ${municipalityName}`.trim(),
      kommunenummer: municipalityNumber || "",
    };
  }
  const matrikkel = parseMatrikkel(project.matrikkel);
  if (!matrikkel || !municipalityNumber) return null;
  return {
    kommunenummer: municipalityNumber,
    gardsnummer: matrikkel.gnr,
    bruksnummer: matrikkel.bnr,
    festenummer: matrikkel.fnr || "",
    undernummer: matrikkel.unr || "",
  };
}

function validAddressCandidate(value) {
  const text = String(value || "")
    .replace(/^[-–—\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /\b(gbnr|gnr|bnr|matrikkel|tiltak på|godkjent|søknad om|løyve|rammeløyve)\b/i.test(text)) return "";
  return /\d/.test(text) ? text.split("|")[0].trim() : "";
}

function parseMatrikkel(value) {
  const match = String(value || "").match(/^(\d+)\s*\/\s*(\d+)(?:\s*\/\s*(\d+))?(?:\s*\/\s*(\d+))?/);
  if (!match) return null;
  return {
    gnr: match[1],
    bnr: match[2],
    fnr: match[3] && match[3] !== "0" ? match[3] : "",
    unr: match[4] && match[4] !== "0" ? match[4] : "",
  };
}

function applyGeocodeResult(project, result) {
  if (!result?.lat || !result?.lon) return false;
  project.lat = result.lat;
  project.lon = result.lon;
  project.hasMapPoint = true;
  project.isMunicipalityFallbackPoint = false;
  project.mapLabel = result.label;
  if (result.address && (!project.address || !validAddressCandidate(project.address))) project.address = result.address;
  return true;
}

function projectMapAnchor(project) {
  const candidates = [
    project.municipality,
    project.place,
    project.address,
    project.marketArea,
    project.title,
    project.description,
  ];
  for (const candidate of candidates) {
    const anchor = municipalityMapAnchor(candidate);
    if (anchor) return anchor;
  }
  const region = findRegionByText(state.area) || state.activeRegion;
  if (region && projectMatchesRegion(project, region)) return region.anchor;
  if (region) return region.anchor;
  if (locationRegions[0]) return locationRegions[0].anchor;
  return null;
}

function municipalityMapAnchor(value) {
  const key = normalizeMunicipalityName(value);
  if (municipalityMapAnchors[key]) return municipalityMapAnchors[key];
  const text = normalizeMunicipalityName(value);
  const match = Object.entries(municipalityMapAnchors).find(([municipality]) => text.includes(municipality));
  return match?.[1] || null;
}

function stableMapOffset(value) {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  const ring = Math.abs(hash % 12);
  const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
  const radius = 0.002 + ring * 0.00055;
  return {
    lat: Math.sin(angle) * radius,
    lon: Math.cos(angle) * radius,
  };
}

function addProjectMarkers(map, projects, selectedProject, options = {}) {
  return projects.map((project) => {
    const isSelected = selectedProject?.id === project.id;
    const regularRadius = options.compact ? 3.5 : 5.8;
    const fallbackRadius = options.compact ? 4 : 6.4;
    const selectedRadius = options.compact ? 8 : 11;
    const marker = L.circleMarker([project.lat, project.lon], {
      radius: isSelected ? selectedRadius : project.isMunicipalityFallbackPoint ? fallbackRadius : regularRadius,
      weight: isSelected ? 4 : project.isMunicipalityFallbackPoint ? 2.4 : 2,
      color: isSelected ? "#102d4a" : project.isMunicipalityFallbackPoint ? "#164b6f" : "#ffffff",
      fillColor: isSelected ? "#ffbe3d" : project.isMunicipalityFallbackPoint ? "#7fc7ee" : "#1677ad",
      fillOpacity: isSelected ? 1 : project.isMunicipalityFallbackPoint ? 0.82 : 0.9,
      opacity: 1,
      className: [
        "project-map-marker",
        isSelected ? "is-selected" : "",
        project.isMunicipalityFallbackPoint ? "is-municipality-fallback" : "",
      ].filter(Boolean).join(" "),
    });
    if (options.onMarkerClick) {
      let handledMarkerSelect = false;
      const handleMarkerSelect = (event) => {
        if (handledMarkerSelect) return;
        if (isMapGestureActive()) {
          if (window.L?.DomEvent && event.originalEvent) L.DomEvent.stop(event.originalEvent);
          return;
        }
        handledMarkerSelect = true;
        if (window.L?.DomEvent && event.originalEvent) {
          L.DomEvent.stop(event.originalEvent);
          event.originalEvent.preventDefault?.();
          event.originalEvent.stopPropagation?.();
          event.originalEvent.stopImmediatePropagation?.();
        }
        options.onMarkerClick(project);
        setTimeout(() => {
          handledMarkerSelect = false;
        }, 250);
      };
      marker.on("click tap", handleMarkerSelect);
    }
    marker.on("mouseover", (event) => showMapHoverCard(map, project, event.latlng));
    marker.on("mousemove", (event) => showMapHoverCard(map, project, event.latlng));
    marker.on("mouseout", () => hideMapHoverCard(map));
    marker.addTo(map);
    const markerElement = marker.getElement?.();
    if (markerElement) {
      markerElement.dataset.projectId = project.id;
      markerElement.dataset.municipality = project.municipality || "";
      markerElement.setAttribute("role", "button");
      markerElement.setAttribute("aria-label", mapTooltipText(project));
    }
    if (isSelected) marker.bringToFront();
    return marker;
  });
}

function bindFullMapProjectSelection(projects) {
  const canvas = document.querySelector("#fullMapCanvas");
  if (!canvas || !state.fullMap) return;
  canvas.addEventListener("click", (event) => {
    if (isMapGestureActive()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      return;
    }
    if (event.target.closest(".leaflet-control")) return;
    const match = nearestProjectFromPointer(event, projects);
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    openProjectFromMap(match.project);
  }, true);
}

function nearestProjectFromPointer(event, projects) {
  if (!state.fullMap || !window.L) return null;
  const container = state.fullMap.getContainer();
  const rect = container.getBoundingClientRect();
  const clickPoint = L.point(event.clientX - rect.left, event.clientY - rect.top);
  let nearest = null;
  for (const project of projects) {
    const markerPoint = state.fullMap.latLngToContainerPoint([project.lat, project.lon]);
    const distance = clickPoint.distanceTo(markerPoint);
    const threshold = state.selected?.id === project.id ? 28 : 20;
    if (distance <= threshold && (!nearest || distance < nearest.distance)) {
      nearest = { project, distance };
    }
  }
  return nearest;
}

function openProjectFromMap(project) {
  const selectedProject = state.projects.find((candidate) => candidate.id === project.id) || project;
  state.selected = selectedProject;
  const closeToken = ++state.fullMapCloseToken;
  state.suppressFullMapOpenUntil = Date.now() + 3000;
  state.forceCloseFullMapUntil = Date.now() + 3000;
  closeFullMap({ force: true, lock: true });
  closeMapPane({ renderAfterClose: false });
  writeSavedValue("selectedProjectId", selectedProject.id);
  render();
  [0, 16, 60, 180, 500, 1000, 1800, 2600].forEach((delay) => {
    setTimeout(() => {
      if (closeToken === state.fullMapCloseToken) closeFullMap({ force: true, lock: true });
    }, delay);
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (closeToken === state.fullMapCloseToken) closeFullMap({ force: true, lock: true });
      scrollSelectedProjectIntoView(selectedProject.id);
    });
  });
}

function closeMapPane(options = {}) {
  state.showMap = false;
  if (state.map) {
    state.map.remove();
    state.map = null;
    state.mapMarkers = [];
    state.mapViewKey = "";
  }
  const pane = document.querySelector("#mapPane");
  if (pane) pane.innerHTML = "";
  document.body.dataset.map = "closed";
  const toggle = document.querySelector("#mapToggle");
  if (toggle) {
    toggle.textContent = "Vis kart";
    toggle.classList.remove("is-active");
  }
  if (options.renderAfterClose !== false) render();
}

function scrollSelectedProjectIntoView(projectId) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-project-id="${cssEscape(projectId)}"]`)
        || document.querySelector(`[data-id="${cssEscape(projectId)}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  });
}

function mapTooltipText(project) {
  const typeText = shortTrade(project.tradeRelevance || project.projectTypes?.join("; ") || project.status || "ukjent tiltak");
  const fallback = project.isMunicipalityFallbackPoint ? " | kommunepunkt" : "";
  return `${project.place || project.address || project.municipality || "Ukjent adresse"} | ${typeText}${fallback}`;
}

function ensureMapHoverCard(map) {
  const container = map.getContainer();
  let card = container.querySelector(".map-hover-card");
  if (!card) {
    card = document.createElement("div");
    card.className = "map-hover-card";
    card.hidden = true;
    container.appendChild(card);
  }
  return card;
}

function showMapHoverCard(map, project, latlng) {
  const card = ensureMapHoverCard(map);
  const size = map.getSize();
  const point = map.latLngToContainerPoint(latlng || [project.lat, project.lon]);
  const maxLeft = Math.max(8, size.x - 372);
  const maxTop = Math.max(8, size.y - 72);

  card.textContent = mapTooltipText(project);
  card.hidden = false;
  card.style.left = `${Math.min(Math.max(point.x + 12, 8), maxLeft)}px`;
  card.style.top = `${Math.min(Math.max(point.y - 42, 8), maxTop)}px`;
}

function hideMapHoverCard(map) {
  const card = map.getContainer().querySelector(".map-hover-card");
  if (card) card.hidden = true;
}

function addBaseMap(map, options = {}) {
  const tileOptions = {
    maxZoom: 19,
    updateWhenIdle: true,
    keepBuffer: options.compact ? 1 : 4,
    detectRetina: true,
    className: "byggradar-map-tiles",
  };
  const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    ...tileOptions,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

  let fallbackStarted = false;

  layer.on("tileerror", (event) => {
    event.tile.classList.add("tile-load-error");
    if (fallbackStarted) return;
    fallbackStarted = true;
    const fallbackLayer = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
      ...tileOptions,
      subdomains: "abc",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles courtesy of HOT',
    });
    layer.remove();
    fallbackLayer.addTo(map);
    refreshMapSize(map);
  });

  layer.addTo(map);
  return layer;
}

function refreshMapSize(map) {
  [0, 120, 350, 800].forEach((delay) => {
    setTimeout(() => {
      if (!map) return;
      map.invalidateSize({ pan: false });
    }, delay);
  });
}

function closeFullMap(options = {}) {
  const dialog = document.querySelector("#mapDialog");
  if (!dialog) return;
  if (dialog.hidden && !options.force) return;
  dialog.hidden = true;
  dialog.setAttribute("hidden", "");
  dialog.setAttribute("aria-hidden", "true");
  dialog.style.display = "none";
  if (options.lock) dialog.classList.add("is-force-hidden");
  document.body.classList.remove("has-map-dialog");
  if (state.fullMap) {
    state.fullMap.remove();
    state.fullMap = null;
    state.fullMapMarker = null;
  }
  const canvas = document.querySelector("#fullMapCanvas");
  if (canvas) canvas.innerHTML = "";
}

function mapViewKey(points) {
  return points
    .map((project) => `${project.id}:${project.lat.toFixed(5)},${project.lon.toFixed(5)}`)
    .sort()
    .join("|");
}

function renderDetails() {
  const details = document.querySelector("#details");
  const project = state.selected;
  if (!project) {
    details.innerHTML = `<div class="empty">Velg et prosjekt.</div>`;
    return;
  }

  const phone = project.contact?.phone ? normalizePhone(project.contact.phone) : "";
  const emailHref = project.contact?.email ? projectMailtoHref(project) : "";
  details.innerHTML = `
    <div class="detail-header">
      <div class="detail-kicker">${escapeHtml(project.statusText)} · ${escapeHtml(project.sourceLabel)}</div>
      <h1>${escapeHtml(project.title)}</h1>
      <p>${escapeHtml(project.place)}</p>
    </div>

    <div class="detail-actions">
      ${phone ? `<a class="primary-action" href="tel:${phone}">Ring</a>` : ""}
      ${project.contact?.email ? `<a class="primary-action generated-mail-link" href="${escapeHtml(emailHref)}" title="Vil du sende mail?" aria-label="Vil du sende mail? E-post til ${escapeHtml(project.contact.email)}">E-post</a>` : ""}
    </div>

    <dl class="facts">
      <div><dt>Fag/tema</dt><dd>${escapeHtml(project.tradeRelevance || "Ikke tolket")}</dd></div>
      <div><dt>Dato/tidspunkt</dt><dd>${escapeHtml(formatNorwegianDate(project.date) || "Ikke oppgitt")}</dd></div>
      <div><dt>Matrikkel</dt><dd>${escapeHtml(project.matrikkel || "Ikke oppgitt")}</dd></div>
      <div><dt>Markedsområde</dt><dd>${escapeHtml(project.marketArea)}</dd></div>
    </dl>

    ${project.contact ? `
      <section class="contact-box">
        <h2>Kontakt</h2>
        <strong>${escapeHtml(project.contact.name || "Virksomhet")}</strong>
        <div>${project.contact.phone ? `T: ${escapeHtml(project.contact.phone)}` : "Telefon ikke funnet"}</div>
        <div>${project.contact.email ? `E: <a class="generated-mail-link" href="${escapeHtml(emailHref)}" title="Vil du sende mail?" aria-label="Vil du sende mail? E-post til ${escapeHtml(project.contact.email)}">${escapeHtml(project.contact.email)}</a>` : ""}</div>
        <div>${project.contact.website ? `<a href="${escapeHtml(project.contact.website)}" target="_blank" rel="noreferrer">${escapeHtml(project.contact.website)}</a>` : ""}</div>
      </section>
    ` : `<section class="contact-box muted">Ingen virksomhetskontakt funnet.</section>`}

    <section class="description">
      <h2>Prosjektinfo</h2>
      <p>${escapeHtml(project.description)}</p>
    </section>
  `;
}

function filterProjects() {
  const trade = normalize(state.trade);
  const area = normalize(state.area);
  const textRegion = findRegionByText(state.area) || state.activeRegion;

  return state.projects
    .filter((project) => !trade || tradeMatches(project, trade))
    .filter((project) => !textRegion || projectMatchesRegion(project, textRegion))
    .filter((project) => textRegion || !area || normalize([project.place, project.municipality, project.marketArea, project.address].join(" ")).includes(area))
    .sort(deliverySort);
}

function standardDeliveryProjects() {
  return state.filtered.slice(0, standardProjectLimit);
}

function visibleDeliveryProjects() {
  return state.filtered
    .slice(0, Math.min(state.visibleCount, state.filtered.length))
    .sort(markedFirstSort);
}

function weeklyDeliveryBatch() {
  return standardDeliveryProjects().slice(0, weeklyDeliveryCount);
}

function retiringDeliveryBatch() {
  return standardDeliveryProjects().slice(-weeklyDeliveryCount);
}

function deliverySort(a, b) {
  // Utvalget skal alltid starte med de ferskeste prosjektene fra kilden.
  // Faglig attraktivitet og status brukes bare når datoen er lik eller mangler.
  return parsedDateMs(b.date) - parsedDateMs(a.date) ||
    b.attractivenessScore - a.attractivenessScore ||
    (stageRank[normalize(a.status)] || 20) - (stageRank[normalize(b.status)] || 20) ||
    b.score - a.score ||
    Number(b.hasMapPoint) - Number(a.hasMapPoint) ||
    String(b.date).localeCompare(String(a.date));
}

function markedFirstSort(a, b) {
  return Number(isMarkedProject(b.id)) - Number(isMarkedProject(a.id)) || deliverySort(a, b);
}

function isMarkedProject(projectId) {
  return state.markedProjectIds.has(String(projectId || ""));
}

function toggleMarkedProject(projectId) {
  const id = String(projectId || "");
  if (!id) return;
  if (state.markedProjectIds.has(id)) {
    state.markedProjectIds.delete(id);
  } else {
    state.markedProjectIds.add(id);
  }
  writeSavedValue(markedProjectsKey, JSON.stringify([...state.markedProjectIds]));
}

function restoreMarkedProjects() {
  try {
    const ids = JSON.parse(readSavedValue(markedProjectsKey) || "[]");
    state.markedProjectIds = new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    state.markedProjectIds = new Set();
  }
}

function attractivenessScore(project) {
  const status = normalize(project.status);
  let score = Number(project.classificationScore || 0);

  const statusWeights = {
    "igangsettingstillatelse gitt": 120,
    "igangsetting søkt": 105,
    "tillatelse gitt": 90,
    "rammetillatelse gitt": 78,
    "saksbehandling pågår": 62,
    "søknad mottatt": 50,
  };
  score += statusWeights[status] || 25;

  const dateScore = recencyScore(project.date);
  score += dateScore;

  if (project.sourceStream === "postlister_allemannsdata") score += 45;
  if (project.hasMapPoint) score += 20;
  if (project.matrikkel) score += 14;
  if (project.contact?.phone) score += 16;
  if (project.contact?.email) score += 10;
  if (!project.contact?.phone && !project.contact?.email) score -= 14;

  const types = (project.projectTypes || []).map(normalize).join(" ");
  if (/nybygg|naering|offentlig|teknisk installasjon|tilbygg|pabygg|ombygging|rehabilitering/.test(types)) score += 12;
  if (/ukjent/.test(types)) score -= 8;

  if (/^År\s+\d{4}$/i.test(String(project.date || ""))) score -= 80;
  if (/kvartal/i.test(String(project.date || ""))) score -= 35;

  return score;
}

function projectActors(project, contactProject) {
  const rawActors = [
    contactProject?.displayContact?.name,
    ...(contactProject?.contacts || []).map((contact) => contact.name || contact.queryName),
    project.toOrg,
    project.fromOrg,
    project.toName,
    project.fromName,
  ];

  return uniqueValues(rawActors)
    .map((name) => ({ name: cleanActorName(name), type: actorType(name) }))
    .filter((actor) => actor.name && actor.type !== "ignore")
    .slice(0, 6);
}

function assessContactQuality(contact, actors, hasAnonymizedActor) {
  if (contact?.phone && contact?.email) {
    return {
      level: "complete",
      label: "Kontakt komplett",
      message: "Telefon og e-post er funnet. Oppslag kan brukes til å kontrollere eller finne flere personer.",
      needsExternalLookup: false,
    };
  }
  if (contact?.phone || contact?.email) {
    return {
      level: "partial",
      label: "Kontakt delvis funnet",
      message: contact.phone ? "Telefon er funnet, e-post mangler." : "E-post er funnet, telefon mangler.",
      needsExternalLookup: true,
    };
  }
  if (actors.some((actor) => actor.type === "company")) {
    return {
      level: "missing",
      label: "Kontakt må finnes",
      message: "Virksomhet er identifisert, men telefon/e-post mangler. Søk i åpne kontaktkilder.",
      needsExternalLookup: true,
    };
  }
  if (hasAnonymizedActor) {
    return {
      level: "private",
      label: "Privat/anonymisert",
      message: "Navn mangler eller er skjult. Søk på adresse, matrikkel eller åpne aktørnavn.",
      needsExternalLookup: true,
    };
  }
  return {
    level: "unknown",
    label: "Kontakt uklar",
    message: "Ingen tydelig aktør funnet. Søk på adresse, matrikkel eller prosjekttekst.",
    needsExternalLookup: true,
  };
}

function contactLineSummary(contactQuality) {
  const labels = {
    complete: "kontakt komplett",
    partial: "kontakt delvis",
    missing: "kontakt må finnes",
    private: "privat/anonymisert",
    unknown: "kontakt uklar",
  };
  return labels[contactQuality.level] || "kontakt uklar";
}

function contactLookupSubject(project, place, actors, contact) {
  const actorName = actors.find((actor) => actor.type === "company")?.name || actors[0]?.name || contact?.name || "";
  if (actorName) return actorName;

  const address = String(project.locationEnrichment?.address || project.address || place || "").trim();
  if (address && !/^ukjent sted$/i.test(address)) return [address, project.municipality].filter(Boolean).join(", ");

  const matrikkel = String(project.matrikkel || "").trim();
  if (matrikkel) return [matrikkel, project.municipality].filter(Boolean).join(", ");

  return cleanTitle(project.title || project.shortFacts || project.caseTitle || "");
}

function contactLookupSources(subject) {
  const text = String(subject || "").trim();
  if (!text) return [];
  const query = encodeURIComponent(text);
  return [
    { label: "AI-søk", url: `https://www.google.com/search?udm=50&q=${query}+telefon+epost` },
    { label: "1881", url: `https://www.1881.no/?query=${query}` },
    { label: "Gule Sider", url: `https://www.gulesider.no/${query}/bedrifter` },
    { label: "Proff", url: `https://www.proff.no/s%C3%B8k?q=${query}` },
  ];
}

function actorType(value) {
  const name = normalize(value);
  if (!name || /xxxx|flere mottakere/.test(name)) return "ignore";
  if (/pbe byggesak|arbeidssted|kommune|statsforvalteren|departement|direktorat/.test(name)) return "ignore";
  if (/\b(as|asa|ans|da|sa|ba|nuf)\b|bygg|entrepren|arkitekt|prosjekt|konsulent|ror|elektro|anlegg|tak|ventilasjon|ingenior|raadgiv|consult|bolig|eiendom/.test(name)) return "company";
  return "person";
}

function cleanActorName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+\(.*?\)$/g, "")
    .trim();
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalize(cleanActorName(value));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recencyScore(value) {
  const dateMs = parsedDateMs(value);
  if (!dateMs) return 0;
  const now = new Date();
  const days = Math.round((dateMs - startOfDayMs(now)) / 86400000);
  if (days < -45) return 18;
  if (days <= 7) return 70;
  if (days <= 30) return 62;
  if (days <= 90) return 42;
  if (days <= 180) return 18;
  return -35;
}

function parsedDateMs(value) {
  const text = String(value || "").trim();
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])).getTime();
  const monthYear = text.match(/^([A-ZÆØÅa-zæøå]+)\s+(\d{4})$/);
  if (monthYear) {
    const month = norwegianMonthIndex(monthYear[1]);
    if (month >= 0) return new Date(Number(monthYear[2]), month, 1).getTime();
  }
  const quarter = text.match(/^(\d+)\.\s*kvartal\s+(\d{4})$/i);
  if (quarter) return new Date(Number(quarter[2]), (Number(quarter[1]) - 1) * 3, 1).getTime();
  const year = text.match(/^År\s+(\d{4})$/i);
  if (year) return new Date(Number(year[1]), 0, 1).getTime();
  return 0;
}

function startOfDayMs(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function norwegianMonthIndex(value) {
  const months = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
  return months.indexOf(normalize(value));
}

function tradeMatches(project, value) {
  const text = normalize([project.tradeRelevance, project.rawTitle, project.description, project.sourceQueries.join(" ")].join(" "));
  const expanded = expandTrade(value);
  return expanded.some((term) => text.includes(term));
}

function expandTrade(value) {
  const normalized = normalize(value);
  const expansions = {
    elektriker: ["elektro", "teknisk", "installasjon", "signal", "kontaktledning", "strøm", "kabel", "ladeanlegg", "energi"],
    elektro: ["elektro", "teknisk", "installasjon", "signal", "kontaktledning", "strøm", "kabel", "ladeanlegg", "energi"],
    rør: ["rør", "sanitær", "vann", "varme", "teknisk"],
    tømrer: ["tilbygg", "påbygg", "nybygg", "ombygging", "garasje", "bolig", "bygg/anlegg"],
    grunnarbeid: ["grunn", "underbygning", "utgraving", "anlegg", "vei", "veg", "miljøsanering"],
    ventilasjon: ["ventilasjon", "teknisk installasjon", "ombygging", "næring"],
    tak: ["tak", "takopplett", "takvind", "tekking"],
    prosjektering: ["prosjektering", "rådgivning", "arkitekt"],
    rehabilitering: ["rehabilitering", "ombygging", "fasadeendring"],
    nybygg: ["nybygg", "nytt bygg", "oppføring"],
    garasje: ["garasje", "carport", "bod"],
    næring: ["næring", "kontor", "lager", "butikk", "skole", "sykehjem"],
    bolig: ["bolig", "enebolig", "tomannsbolig", "leilighet", "rekkehus"],
  };
  return [normalized, ...(expansions[normalized] || [])].filter(Boolean).map(normalize);
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/^\d+\/\d+\/\d+\/\d+\s*/g, "")
    .split("|")[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 78);
}

function fileDisplayTitle(value) {
  return String(value || "Vedlegg")
    .replace(/<[^>]*>/g, "")
    .replace(/&aring;/g, "å")
    .replace(/&oslash;/g, "ø")
    .replace(/&aelig;/g, "æ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function inferTrade(...values) {
  const text = normalize(values.filter(Boolean).join(" "));
  const result = [];
  if (/elektro|teknisk|signal|kontaktledning|kabel|energi|transformator/.test(text)) result.push("elektro/teknisk");
  if (/nybygg|tilbygg|påbygg|ombygging|bruksendring|garasje|riving|entreprise/.test(text)) result.push("bygg/anlegg");
  if (/rådgiv|prosjektering|arkitekt/.test(text)) result.push("rådgivning/prosjektering");
  if (/bolig|enebolig|leilighet/.test(text)) result.push("bolig");
  return result.join("; ") || "mulig prosjekt";
}

function shortPlace(value) {
  return String(value || "Ukjent sted").replace(", Norge", "").slice(0, 34);
}

function shortPlaceWithMunicipality(place, municipality) {
  const cleanMunicipality = String(municipality || "").replace(/\s+/g, " ").trim();
  const cleanPlace = String(place || "Ukjent sted").replace(", Norge", "").replace(/\s+/g, " ").trim();
  if (!cleanMunicipality) return cleanPlace.slice(0, 34);

  const placeWithoutMunicipality = removeMunicipalityFromPlace(cleanPlace, cleanMunicipality).trim();
  const displayPlace = placeWithoutMunicipality || cleanMunicipality;
  if (normalizeMunicipalityName(displayPlace) === normalizeMunicipalityName(cleanMunicipality)) return cleanMunicipality;
  return `${displayPlace.slice(0, 34)}, ${cleanMunicipality}`;
}

function projectSummaryLine(title, place, municipality, status) {
  const displayPlace = shortPlaceWithMunicipality(place, municipality);
  const cleanSummaryTitle = removeRepeatedPlace(title, place, municipality);
  return [displayPlace, cleanSummaryTitle || shortStatus(status)].filter(Boolean).join(" | ");
}

function removeRepeatedPlace(title, place, municipality) {
  const clean = String(title || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const placeText = removeMunicipalityFromPlace(place, municipality);
  const titleKey = normalize(clean);
  const placeKey = normalize(placeText);
  if (placeKey && (titleKey === placeKey || titleKey.startsWith(`${placeKey} `) || titleKey.includes(` ${placeKey} `))) {
    return clean.replace(new RegExp(escapeRegExp(placeText), "i"), "").replace(/^[-–|,\s]+|[-–|,\s]+$/g, "").trim();
  }
  const street = streetBase(placeText);
  if (street && normalize(clean).startsWith(normalize(street))) {
    const afterFirstComma = clean.split(",").slice(1).join(",").trim();
    if (afterFirstComma) return afterFirstComma;
  }
  return clean;
}

function streetBase(value) {
  return String(value || "")
    .split(",")[0]
    .replace(/\b\d+[A-ZÆØÅa-zæøå]?\b/g, "")
    .replace(/\bog\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value || ""));
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function removeMunicipalityFromPlace(place, municipality) {
  const municipalityName = normalizeMunicipalityName(municipality);
  return String(place || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => normalizeMunicipalityName(part) !== municipalityName)
    .join(", ");
}

function municipalitySuffix(municipality, place) {
  const cleanMunicipality = String(municipality || "").replace(/\s+/g, " ").trim();
  if (!cleanMunicipality) return "";
  if (normalize(place).includes(normalizeMunicipalityName(cleanMunicipality))) return "";
  return `, ${cleanMunicipality}`;
}

function shortStatus(value) {
  const status = String(value || "Status ukjent");
  if (normalize(status) === "igangsettingstillatelse gitt" || normalize(status) === "ig gitt") return "Igangsettingstillatelse gitt";
  return status.replace("saksbehandling pågår", "Under behandling");
}

function shortTrade(value) {
  return String(value || "Fag ikke tolket").replaceAll(";", ",").slice(0, 34);
}

function shortDate(value) {
  if (!value) return "Tidspunkt ikke oppgitt";
  const text = String(value || "").trim();
  const quarter = text.match(/^(\d+)\.\s*kvartal\s+(\d{4})$/i);
  if (quarter) return `${quarter[1]}. kv. ${quarter[2]}`;
  return formatNorwegianDate(value);
}

function fullDateLabel(value) {
  if (!value) return "Tidspunkt ikke oppgitt";
  return formatNorwegianDate(value);
}

function formatNorwegianDate(value) {
  const text = String(value || "").trim();
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return `${isoDate[3]}.${isoDate[2]}.${isoDate[1]}`;
  const isoDateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]/);
  if (isoDateTime) return `${isoDateTime[3]}.${isoDateTime[2]}.${isoDateTime[1]}`;
  return text;
}

function formatNorwegianDateTime(value) {
  if (!(value instanceof Date)) return "";
  const weekdays = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
  const date = `${String(value.getDate()).padStart(2, "0")}.${String(value.getMonth() + 1).padStart(2, "0")}.${value.getFullYear()}`;
  const time = `${String(value.getHours()).padStart(2, "0")}.${String(value.getMinutes()).padStart(2, "0")}`;
  return `${weekdays[value.getDay()]} ${date} kl. ${time}`;
}

function formatShortNorwegianDateTime(value) {
  if (!(value instanceof Date)) return "";
  const date = `${String(value.getDate()).padStart(2, "0")}.${String(value.getMonth() + 1).padStart(2, "0")}.${value.getFullYear()}`;
  const time = `${String(value.getHours()).padStart(2, "0")}.${String(value.getMinutes()).padStart(2, "0")}`;
  return `${date} kl. ${time}`;
}

function marketRoleLabel(role) {
  return ({ core: "Bergen", border: "Nærområde", bergen_region: "Bergensregionen", external: "Ekstern kilde" })[role] || "Ukjent område";
}

function toggleTextValue(current, value) {
  const normalized = normalize(current);
  const candidate = normalize(value);
  return normalized.includes(candidate) ? "" : value;
}

function normalize(value) {
  return String(value || "").toLocaleLowerCase("nb-NO").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function projectMailtoHref(project) {
  const email = String(project.contact?.email || "").trim();
  if (!email) return "";
  const subject = `Forespørsel om prosjektinformasjon - ${projectMailPlace(project)}`;
  const body = projectMailBody(project);
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function projectMailBody(project) {
  const place = projectMailPlace(project);
  const municipality = project.municipality || project.marketArea || "";
  const projectType = compactText(project.tradeRelevance || project.statusText || project.title || "prosjektet");
  const title = compactText(project.title || project.description || "prosjektet");
  const status = compactText(project.statusText || project.status || "");
  const matrikkel = compactText(project.matrikkel || "");
  const date = formatNorwegianDate(project.date);

  const lines = [
    "Hei,",
    "",
    `Jeg tar kontakt fordi vi har fått med oss prosjektet ${title} på ${place}${municipality ? ` i ${municipality}` : ""}, og dette ser ut som et prosjekt som kan være relevant for oss.`,
    `Slik jeg forstår saken gjelder det ${projectType}${status ? `, med status ${status}` : ""}${date ? `, registrert ${date}` : ""}.`,
  ];

  if (matrikkel) lines.push(`Matrikkel: ${matrikkel}.`);

  lines.push(
    "",
    "Vi har kapasitet fremover og ønsker derfor gjerne litt mer informasjon om prosjektet, slik at vi kan vurdere om vi kan bidra på en god måte.",
    "Dersom det passer, tar jeg gjerne en kort prat eller avtaler en befaring for å se nærmere på behovet.",
    "",
    "På forhånd takk for tilbakemelding.",
    "",
    "Vennlig hilsen"
  );

  return lines.join("\n");
}

function projectMailPlace(project) {
  return compactText(project.place || project.address || project.municipality || "aktuelt prosjekt");
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function saveFilters() {
  writeSavedValue(savedFiltersKey, JSON.stringify({ trade: state.trade, area: state.area, regionId: state.activeRegion?.id || "" }));
}

function restoreSavedFilters() {
  try {
    const saved = JSON.parse(readSavedValue(savedFiltersKey) || "{}");
    state.trade = saved.trade || "";
    state.area = /^min posisjon|^region ved min posisjon/i.test(saved.area || "") ? "" : saved.area || "";
    state.activeRegion = locationRegions.find((region) => region.id === saved.regionId) || findRegionByText(state.area);
    document.querySelector("#tradeInput").value = state.trade;
    document.querySelector("#areaInput").value = state.area;
  } catch {
    state.trade = "";
    state.area = "";
    state.activeRegion = null;
  }
}

function readSavedValue(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSavedValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nettleseren kan ha blokkert lokal lagring. Appen fungerer likevel uten.
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((position) => {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    const region = nearestLocationRegion(lat, lon);
    state.userLocation = {
      lat,
      lon,
      regionId: region.id,
    };
    state.activeRegion = region;
    state.area = `${region.name} (${region.municipalities.length} kommuner)`;
    document.querySelector("#areaInput").value = state.area;
    state.visibleCount = standardProjectLimit;
    saveFilters();
    render();
  });
}

function nearestLocationRegion(lat, lon) {
  return locationRegions
    .map((region) => ({ region, distance: distanceKm(lat, lon, region.anchor.lat, region.anchor.lon) }))
    .sort((a, b) => a.distance - b.distance)[0]?.region || locationRegions[0];
}

function findRegionByText(value) {
  const text = normalize(value);
  if (!text) return null;

  // Et konkret kommunenavn skal gi et kommunefilter, ikke utvide søket til
  // hele Bergensregionen. Regionen velges bare når brukeren skriver selve
  // regionnavnet eller et annet eksplisitt regionsøk.
  for (const region of locationRegions) {
    const municipality = region.municipalities.find((candidate) => {
      const normalized = normalize(candidate);
      return normalized === text || normalizeMunicipalityName(candidate) === normalizeMunicipalityName(text);
    });
    if (municipality) {
      return {
        ...region,
        id: `municipality:${normalizeMunicipalityName(municipality)}`,
        name: municipality,
        municipalities: [municipality],
      };
    }
  }

  return locationRegions.find((region) => {
    if (normalize(region.name).includes(text) || text.includes(normalize(region.name))) return true;
    return false;
  }) || null;
}

function projectMatchesRegion(project, region) {
  if (project.municipality && municipalityInRegion(project.municipality, region)) return true;
  const text = normalize([project.place, project.address, project.marketArea].join(" "));
  if (region.municipalities.some((municipality) => text.includes(normalizeMunicipalityName(municipality)))) return true;
  return false;
}

function municipalityInRegion(value, region) {
  const normalized = normalizeMunicipalityName(value);
  return region.municipalities.some((municipality) => normalizeMunicipalityName(municipality) === normalized);
}

function normalizeMunicipalityName(value) {
  return normalize(value).replace(/\bkommune\b|\bherad\b/g, "").replace(/\s+/g, " ").trim();
}

function distanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
  const toRad = (value) => (value * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scheduleRefreshes() {
  scheduleWeeklyDeliveryRefresh();
}

function scheduleWeeklyDeliveryRefresh() {
  if (state.weeklyRefreshTimer) clearTimeout(state.weeklyRefreshTimer);
  const now = new Date();
  const next = nextMondayAtMidnight(now);
  state.weeklyRefreshTimer = setTimeout(async () => {
    await applyWeeklyDelivery();
    scheduleWeeklyDeliveryRefresh();
  }, next.getTime() - now.getTime());
}

async function applyWeeklyDelivery() {
  await loadProjects();
  state.visibleCount = standardProjectLimit;
  state.filtered = filterProjects();
  state.selected = null;
  render();
}

function nextMondayAtMidnight(fromDate) {
  const next = new Date(fromDate);
  const currentDay = next.getDay();
  const daysUntilMonday = (8 - currentDay) % 7;
  next.setDate(next.getDate() + daysUntilMonday);
  next.setHours(0, 0, 0, 0);
  if (next <= fromDate) {
    next.setDate(next.getDate() + 7);
  }
  return next;
}

function deliveryInfoText() {
  const nextDelivery = formatNorwegianDateTime(nextMondayAtMidnight(new Date()));
  return `Standardleveransen er alltid ${standardProjectLimit} prosjekter. Hver mandag kl. 00.00 legges ${weeklyDeliveryCount} nye prosjekter inn i standardlisten, og de ${weeklyDeliveryCount} eldste fjernes. Prosjekter som lastes manuelt utover dette merkes med stjerne. Neste planlagte leveranse: ${nextDelivery}.`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[char]);
}
