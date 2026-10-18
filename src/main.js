const state = {
  projects: [],
  rawProjectCount: 0,
  allRegionProjectCount: 0,
  filtered: [],
  selected: null,
  trade: "",
  area: "",
  customerMunicipality: "",
  showMap: false,
  visibleCount: 200,
  userLocation: null,
  activeRegion: null,
  regionKey: "bergensregionen",
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
  weeklyRefreshTimer: null,
  markedProjectIds: new Set(),
  expandedPreviewIds: new Set(),
  aiSearchResults: new Map(),
  aiSearchLoading: new Set(),
  userMode: null,
  statisticsData: null,
  statisticsRegion: "",
  statisticsMunicipality: "",
  statisticsSsb: null,
  statisticsSsbLoading: false,
  statisticsSsbError: "",
  statisticsSsbScope: "",
  statisticsSavedSearches: [],
  statisticsSelectedSearch: "",
  partnerTrade: "",
  partnerFinderOpen: false,
  partnerMap: null,
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

const partnerTrades = [
  "entreprenør",
  "elektro",
  "rørlegger",
  "tømrer",
  "murer",
  "maler",
  "ventilasjon",
  "tak",
];
const partnerRoleLabels = {
  entreprenør: "Entreprenør",
  elektro: "Elektro",
  rørlegger: "Rørlegger",
  tømrer: "Tømrer",
  murer: "Murer",
  maler: "Maler",
  ventilasjon: "Ventilasjon",
  tak: "Tak",
};

const partnerDirectorySeeds = {
  bergensregionen: ["Fjordglimt", "Vestkyst", "Nordlys", "Byfjorden", "Havstein"],
  stavangerregionen: ["Jær", "Rogaland", "Sørvest", "Lyng", "Storhaug"],
  haugalandsregionen: ["Haugaland", "Sjøbris", "Karmsund", "Sunnhordland", "Vestavind"],
  grenlandsregionen: ["Grenland", "Telemark", "Skienselva", "Frier", "Kystlinje"],
  sorlandsregionen: ["Sørlys", "Agder", "Skagerrak", "Palme", "Kystbyen"],
};

const partnerRegionAnchors = {
  bergensregionen: { lat: 60.39299, lon: 5.32415 },
  stavangerregionen: { lat: 58.97, lon: 5.7331 },
  haugalandsregionen: { lat: 59.505, lon: 5.7 },
  grenlandsregionen: { lat: 59.14, lon: 9.61 },
  sorlandsregionen: { lat: 58.1467, lon: 7.9956 },
};

function createPartnerDirectory() {
  return Object.entries(partnerDirectorySeeds).flatMap(([regionId, seeds]) => {
    const region = partnerRegionAnchors[regionId];
    return partnerTrades.flatMap((trade, tradeIndex) => seeds.map((seed, companyIndex) => {
      const angle = ((tradeIndex * 5 + companyIndex) / 50) * Math.PI * 2;
      const radius = 0.01 + ((tradeIndex + companyIndex) % 4) * 0.006;
      const namePart = seed.toLowerCase().replace(/å/g, "a").replace(/ø/g, "o").replace(/æ/g, "ae");
      return {
        id: `${regionId}-${trade}-${companyIndex}`,
        regionId,
        isSubscriber: true,
        tradeAffiliations: [trade],
        trade,
        company: `${seed} ${partnerRoleLabels[trade]} AS`,
        phone: `900 ${String(10 + tradeIndex).padStart(2, "0")} ${String(10 + companyIndex).padStart(2, "0")}`,
        contact: ["Ida Nilsen", "Marius Berg", "Silje Hauge", "Jonas Vik", "Nora Strand"][companyIndex],
        website: `https://www.${namePart}-${trade}.example`,
        email: `kontakt@${namePart}-${trade}.example`,
        lat: (region?.lat || 60) + Math.sin(angle) * radius,
        lon: (region?.lon || 6) + Math.cos(angle) * radius,
      };
    }));
  });
}

const partnerDirectory = createPartnerDirectory();

// Alle abonnenter skal være synlige i sin egen region. Det finnes ingen
// maksimumsgrense her; en fremtidig abonnentkilde kan derfor legges til uten
// at visningen må endres. Regionfilteret er alltid obligatorisk.
function regionalSubscribers(regionId, trade) {
  return partnerDirectory.filter((partner) => (
    partner.isSubscriber
    && partner.regionId === regionId
    && subscriberHasValidTrades(partner)
    && (!trade || partner.tradeAffiliations.includes(trade))
  ));
}

function subscriberHasValidTrades(partner) {
  return Array.isArray(partner.tradeAffiliations)
    && partner.tradeAffiliations.length > 0
    && partner.tradeAffiliations.every((value) => partnerTrades.includes(value))
}

// Midlertidig visning av regionvalg. Valget kobles til kundens faste region senere.
const illustrationRegions = ["Bergensregionen", "Stavangerregionen", "Haugalandsregionen", "Grenlandsregionen", "Sørlandsregionen"];

const savedFiltersKey = "byggradar.filters.v1";
const markedProjectsKey = "byggradar.markedProjects.v1";
const standardProjectLimit = 200;
const loadMoreStep = 20;
const weeklyDeliveryCount = 50;
const statisticsSavedSearchesKey = "byggradar.statistics.savedSearches.v1";

const statisticsSearchCatalog = [
  // Plan og areal
  { id: "regulations-adopted", group: "Planarbeid", title: "Reguleringsplaner vedtatt", description: "Vedtatte reguleringsplaner i siste rapporterte år.", metric: "regulationsAdopted", source: "SSB 12690" },
  { id: "private-plans", group: "Planarbeid", title: "Private detaljreguleringer", description: "Detaljreguleringer fremmet som private forslag.", metric: "privateDetailedPlans", source: "SSB 12690" },
  { id: "plan-proposals", group: "Planarbeid", title: "Reguleringsplaner med høringsfrist", description: "Reguleringsplaner med høringsfrist i rapporteringsåret.", metric: "plansWithHearingDeadline", source: "SSB 12690" },

  // Saksbehandling og byggesak
  { id: "plan-processing", group: "Saksbehandling", title: "Saksbehandlingstid plan", description: "Gjennomsnittlig behandlingstid for private reguleringsforslag.", metric: "planProcessingDays", source: "SSB 12690" },
  { id: "building-applications", group: "Saksbehandling", title: "Byggesøknader mottatt", description: "Mottatte byggesøknader i siste rapporterte periode.", metric: "buildingApplications", source: "SSB 13021" },
  { id: "building-permits", group: "Saksbehandling", title: "Behandlede byggesøknader", description: "Byggesøknader som er behandlet i rapporteringsåret.", metric: "processedBuildingApplications", source: "SSB 13021" },
  { id: "start-permits", group: "Saksbehandling", title: "Mangelfulle byggesøknader", description: "Søknader der kommunen ba om tilleggsdokumentasjon.", metric: "incompleteBuildingApplications", source: "SSB 13021" },
  { id: "building-processing", group: "Saksbehandling", title: "Saksbehandlingstid byggesak", description: "Gjennomsnittlig behandlingstid for byggesaker.", metric: "buildingProcessingDays", aggregation: "average", source: "SSB 13021" },

  // Boligbygging
  { id: "housing-started", group: "Boligbygging", title: "Igangsatte boliger", description: "Boliger med registrert igangsettingstillatelse.", metric: "housingStarted", source: "SSB 05940" },
  { id: "housing-completed", group: "Boligbygging", title: "Fullførte boliger", description: "Boliger registrert som fullført.", metric: "housingCompleted", source: "SSB 05940" },
  { id: "housing-permits", group: "Boligbygging", title: "Boliger med igangsettingstillatelse", description: "Boliger med registrert igangsettingstillatelse.", metric: "housingStarted", source: "SSB 05940" },
  { id: "housing-net-growth", group: "Boligbygging", title: "Forskjell mellom igangsatte og fullførte boliger", description: "Beregnet forskjell mellom igangsatte og fullførte boliger i rapporteringsåret.", metric: "housingNetDifference", source: "SSB 05940" },

  // Areal og næringsbygg
  { id: "housing-started-area", group: "Areal og næringsbygg", title: "Igangsatt boligareal", description: "Igangsatt bruksareal til boliger.", metric: "housingStartedArea", source: "SSB 05940" },
  { id: "housing-completed-area", group: "Areal og næringsbygg", title: "Fullført boligareal", description: "Fullført bruksareal til boliger.", metric: "housingCompletedArea", source: "SSB 05940" },
  { id: "commercial-started-area", group: "Areal og næringsbygg", title: "Igangsatt næringsareal", description: "Igangsatt bruksareal for andre bygg enn boligbygg.", metric: "commercialStartedArea", source: "SSB 05940" },
  { id: "commercial-completed-area", group: "Areal og næringsbygg", title: "Fullført næringsareal", description: "Fullført bruksareal for andre bygg enn boligbygg.", metric: "commercialCompletedArea", source: "SSB 05940" },
  { id: "public-building-area", group: "Areal og næringsbygg", title: "Igangsatt offentlig byggeareal", description: "Igangsatt bruksareal for utvalgte offentlige byggtyper.", metric: "publicBuildingStartedArea", source: "SSB 05939" },
  { id: "holiday-home-area", group: "Areal og næringsbygg", title: "Igangsatt fritidsboligareal", description: "Igangsatt bruksareal til fritidsbygninger.", metric: "holidayHomeArea", source: "SSB 06952" },
  { id: "construction-area-total", group: "Areal og næringsbygg", title: "Samlet igangsatt byggeareal", description: "Samlet igangsatt boligareal og areal for andre bygg.", metric: "constructionAreaTotal", source: "SSB 05940" },
  { id: "construction-area-permit", group: "Areal og næringsbygg", title: "Samlet byggeareal med igangsettingstillatelse", description: "Samlet igangsatt bolig- og annet byggeareal.", metric: "constructionAreaTotal", source: "SSB 05939/05940" },

  // Gebyrer og kommunens kostnader
  { id: "fee-building-house", group: "Gebyrer og kommunens kostnader", title: "Gebyr for enebolig", description: "Hva kommunen rapporterer at en standard enebolig koster i byggesaksgebyr.", metric: "feeBuildingHouse", aggregation: "average", source: "SSB 12303" },
  { id: "fee-property-creation", group: "Gebyrer og kommunens kostnader", title: "Gebyr for ny grunneiendom", description: "Hva kommunen rapporterer som gebyr for å opprette en ny grunneiendom.", metric: "feePropertyCreation", aggregation: "average", source: "SSB 12303" },
  { id: "fee-private-regulation", group: "Gebyrer og kommunens kostnader", title: "Gebyr for privat reguleringsplan", description: "Hva kommunen rapporterer som gebyr for et privat forslag til detaljreguleringsplan.", metric: "feePrivateRegulation", aggregation: "average", source: "SSB 12303" },
  { id: "fee-revenue-total", group: "Gebyrer og kommunens kostnader", title: "Gebyrinntekter", description: "Hvor mye kommunen samlet har rapportert i gebyrinntekter fra plan, byggesak, kart og seksjonering.", metric: "feeRevenueTotal", source: "SSB 13013" },
  { id: "fee-basis-total", group: "Gebyrer og kommunens kostnader", title: "Kostnadsgrunnlag for gebyrer", description: "Kostnadene kommunen har rapportert som grunnlag for gebyrberegningen.", metric: "feeBasisTotal", source: "SSB 13013" },
  { id: "fee-financial-coverage", group: "Gebyrer og kommunens kostnader", title: "Hvor mye gebyrene dekker", description: "Viser hvor stor del av kostnadsgrunnlaget gebyrinntektene dekker.", metric: "feeFinancialCoverage", aggregation: "average", source: "SSB 13013" },
  { id: "fee-financial-result", group: "Gebyrer og kommunens kostnader", title: "Årets resultat", description: "Viser om gebyrregnskapet samlet endte med overskudd eller underskudd.", metric: "feeFinancialResult", source: "SSB 13013" },
  { id: "fee-subsidy", group: "Gebyrer og kommunens kostnader", title: "Over- eller underdekning", description: "Viser om gebyrinntektene ligger over eller under kostnadsgrunnlaget.", metric: "feeControlSumSubsidy", source: "SSB 13013" },

  // Utvikling og sammenligning
  { id: "projects-change", group: "Utvikling og sammenligning", title: "Mottatte byggesøknader", description: "Siste rapporterte nivå for mottatte byggesøknader.", metric: "buildingApplications", source: "SSB 13021" },
  { id: "housing-change", group: "Utvikling og sammenligning", title: "Forskjell i boligbygging", description: "Forskjell mellom igangsatte og fullførte boliger.", metric: "housingNetDifference", source: "SSB 05940" },
  { id: "area-change", group: "Utvikling og sammenligning", title: "Samlet byggeareal", description: "Samlet igangsatt bolig- og annet byggeareal.", metric: "constructionAreaTotal", source: "SSB 05939/05940" },
  { id: "municipality-ranking", group: "Utvikling og sammenligning", title: "Byggesøknader i valgt geografi", description: "Mottatte byggesøknader i valgt kommune eller region.", metric: "buildingApplications", source: "SSB 13021" },
  { id: "region-ranking", group: "Utvikling og sammenligning", title: "Byggesøknader i valgt region", description: "Mottatte byggesøknader aggregert for valgt region.", metric: "buildingApplications", source: "SSB 13021" },
  { id: "latest-available", group: "Utvikling og sammenligning", title: "Siste tilgjengelige år", description: "Siste rapporterte år i SSB-grunnlaget for valgt geografi.", metric: "latestAvailableYear", source: "SSB API-metadata" },
];

const statisticsMetricLabels = {
  plansWithHearingDeadline: "Reguleringsplaner med høringsfrist (antall)",
  planObjections: "Reguleringsplaner med innsigelse (antall)",
  planArea: "Areal i tematiske planer (dekar)",
  planComplaints: "Sluttbehandlede klager på reguleringsplaner (antall)",
  incompleteBuildingApplications: "Mangelfulle byggesøknader (antall)",
  processedBuildingApplications: "Behandlede byggesøknader (antall)",
  lateBuildingApplications: "Byggesøknader over lovpålagt tid (antall)",
  commercialStartedArea: "Igangsatt annet byggeareal (m²)",
  commercialCompletedArea: "Fullført annet byggeareal (m²)",
  publicBuildingStartedArea: "Igangsatt offentlig byggeareal (m²)",
  holidayHomeArea: "Igangsatt fritidsboligareal (m²)",
  constructionAreaTotal: "Samlet igangsatt byggeareal (m²)",
  housingNetDifference: "Forskjell mellom igangsatte og fullførte boliger (antall)",
  latestAvailableYear: "Siste tilgjengelige SSB-år",
  feeDirectOperatingExpenses: "Direkte driftsutgifter (1000 kr)",
  feeIndirectOperatingExpenses: "Indirekte driftsutgifter (1000 kr)",
  feeInterestCosts: "Kalkulatoriske rentekostnader (1000 kr)",
  feeDepreciation: "Kalkulatoriske avskrivninger (1000 kr)",
  feeOtherIncome: "Andre inntekter (1000 kr)",
  feeBasisTotal: "Gebyrgrunnlag (1000 kr)",
  feeRevenueTotal: "Gebyrinntekter (1000 kr)",
  feeFinancialResult: "Årets finansielle resultat (1000 kr)",
  feeFundProvision: "Avsetning til selvkostfond (1000 kr)",
  feeFundUse: "Bruk av selvkostfond (1000 kr)",
  feeControlSumSubsidy: "Kontrollsum / subsidiering (1000 kr)",
  feeFundBalanceStart: "Saldo selvkostfond 1.1. (1000 kr)",
  feeAlternativeCost: "Alternativkostnad (1000 kr)",
  feeFundBalanceEnd: "Saldo selvkostfond 31.12. (1000 kr)",
  feeFinancialCoverage: "Finansiell dekningsgrad (prosent)",
};

function statisticsMetricTitle(metric) {
  return statisticsSearchCatalog.find((entry) => entry.metric === metric)?.title || statisticsMetricLabels[metric] || metric;
}

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
  {
    id: "stavangerregionen",
    name: "Stavangerregionen",
    anchor: { lat: 58.9700, lon: 5.7331 },
    municipalities: [
      "Stavanger kommune", "Sandnes kommune", "Sola kommune", "Randaberg kommune",
      "Klepp kommune", "Time kommune", "Hå kommune", "Gjesdal kommune",
      "Strand kommune", "Kvitsøy kommune", "Hjelmeland kommune", "Bjerkreim kommune",
      "Eigersund kommune", "Suldal kommune", "Sirdal kommune", "Lund kommune",
      "Sokndal kommune",
    ],
  },
  {
    id: "haugalandsregionen",
    name: "Haugalandsregionen",
    anchor: { lat: 59.505, lon: 5.70 },
    municipalities: [
      "Kvinnherad kommune",
      "Stord kommune",
      "Fitjar kommune",
      "Bømlo kommune",
      "Sveio kommune",
      "Haugesund kommune",
      "Karmøy kommune",
      "Tysvær kommune",
      "Bokn kommune",
      "Utsira kommune",
      "Vindafjord kommune",
      "Etne kommune",
      "Sauda kommune",
    ],
  },
  {
    id: "grenlandsregionen",
    name: "Grenlandsregionen",
    anchor: { lat: 59.1400, lon: 9.6100 },
    constructionBusinessCount: 2183,
    constructionBusinessCountBasis: "Beregnet ut fra SSB 2026-tall for bygge- og anleggsvirksomhet; kan avvike noe fra kommunefordelte uttrekk.",
    municipalities: [
      "Skien kommune", "Porsgrunn kommune", "Bamble kommune", "Notodden kommune",
      "Midt-Telemark kommune", "Kragerø kommune", "Nome kommune", "Tinn kommune",
      "Drangedal kommune", "Vinje kommune", "Seljord kommune", "Kviteseid kommune",
      "Siljan kommune", "Tokke kommune", "Hjartdal kommune", "Nissedal kommune",
      "Fyresdal kommune",
    ],
  },
  {
    id: "sorlandsregionen",
    name: "Sørlandsregionen",
    anchor: { lat: 58.1467, lon: 7.9956 },
    municipalities: [
      "Kristiansand kommune", "Lindesnes kommune", "Vennesla kommune", "Lillesand kommune",
      "Lyngdal kommune", "Farsund kommune", "Flekkefjord kommune", "Kvinesdal kommune",
      "Birkenes kommune", "Sirdal kommune", "Hægebostad kommune", "Iveland kommune",
    ],
  },
];

const coveredMunicipalityCount = new Set(
  locationRegions.flatMap((region) => region.municipalities.map((municipality) => normalizeMunicipalityName(municipality))),
).size;

const regionDataPaths = {
  bergensregionen: "/data/regions/bergensregionen",
  stavangerregionen: "/data/regions/stavangerregionen",
  haugalandsregionen: "/data/regions/haugalandsregionen",
  grenlandsregionen: "/data/regions/grenlandsregionen",
  sorlandsregionen: "/data/regions/sorlandsregionen",
};

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
  "kvinnherad": { lat: 59.985, lon: 5.996 },
  "stord": { lat: 59.780, lon: 5.500 },
  "fitjar": { lat: 59.918, lon: 5.316 },
  "bømlo": { lat: 59.794, lon: 5.180 },
  "sveio": { lat: 59.542, lon: 5.354 },
  "haugesund": { lat: 59.413, lon: 5.267 },
  "karmøy": { lat: 59.280, lon: 5.300 },
  "tysvær": { lat: 59.420, lon: 5.440 },
  "bokn": { lat: 59.230, lon: 5.430 },
  "utsira": { lat: 59.310, lon: 4.890 },
  "vindafjord": { lat: 59.550, lon: 5.880 },
  "etne": { lat: 59.665, lon: 5.930 },
  "sauda": { lat: 59.650, lon: 6.350 },
  "kristiansand": { lat: 58.1467, lon: 7.9956 },
  "lindesnes": { lat: 58.0843, lon: 7.3030 },
  "vennesla": { lat: 58.2779, lon: 7.9741 },
  "lillesand": { lat: 58.2488, lon: 8.3778 },
  "lyngdal": { lat: 58.1376, lon: 7.0700 },
  "farsund": { lat: 58.0948, lon: 6.8047 },
  "flekkefjord": { lat: 58.2971, lon: 6.6607 },
  "kvinesdal": { lat: 58.3120, lon: 6.9618 },
  "birkenes": { lat: 58.3309, lon: 8.2320 },
  "sirdal": { lat: 58.9830, lon: 6.9990 },
  "hægebostad": { lat: 58.3750, lon: 7.2200 },
  "iveland": { lat: 58.4610, lon: 7.8660 },
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
  "kvinnherad": "4617",
  "stord": "4614",
  "fitjar": "4615",
  "bømlo": "4613",
  "sveio": "4612",
  "haugesund": "1106",
  "karmøy": "1149",
  "tysvær": "1146",
  "bokn": "1145",
  "utsira": "1151",
  "vindafjord": "1160",
  "etne": "4611",
  "sauda": "1135",
  "stavanger": "1103",
  "sandnes": "1108",
  "sola": "1124",
  "randaberg": "1127",
  "klepp": "1120",
  "time": "1121",
  "hå": "1119",
  "gjesdal": "1122",
  "strand": "1130",
  "kvitsøy": "1144",
  "hjelmeland": "1133",
  "bjerkreim": "1114",
  "eigersund": "1101",
  "suldal": "1134",
  "sirdal": "4228",
  "lund": "1112",
  "sokndal": "1111",
  "kristiansand": "4204",
  "lindesnes": "4205",
  "vennesla": "4223",
  "lillesand": "4215",
  "lyngdal": "4225",
  "farsund": "4206",
  "flekkefjord": "4207",
  "kvinesdal": "4227",
  "birkenes": "4216",
  "sirdal": "4228",
  "hægebostad": "4226",
  "iveland": "4218",
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
  "etne": "https://www.etne.kommune.no/om-kommunen/innsyn/sok/",
};

const approvedMunicipalityHosts = new Set([
  "alver.kommune.no",
  "austrheim.kommune.no",
  "bjornafjorden.kommune.no",
  "www.bjornafjorden.kommune.no",
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
  "etne.kommune.no",
]);

const stageRank = {
  "igangsetting søkt": 1,
  "igangsettingstillatelse gitt": 2,
  "tillatelse gitt": 3,
  "rammetillatelse gitt": 4,
  "saksbehandling pågår": 5,
  "søknad mottatt": 6,
};

const phaseTwoStatuses = new Set([
  "igangsettingstillatelse gitt",
  "igangsetting søkt",
  "tillatelse gitt",
]);

const phaseOneStatuses = new Set([
  "rammetillatelse gitt",
  "saksbehandling pågår",
  "søknad mottatt",
]);

const app = document.querySelector("#app");
init();

async function init() {
  renderLogin();
}

async function startUserMode(mode) {
  state.userMode = mode;
  if (mode === "statistics") {
    await initStatisticsApplication();
    return;
  }
  await initVendorApplication();
}

async function initVendorApplication() {
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
        <h1>Norsk ByggRadar kunne ikke starte</h1>
        <p>${escapeHtml(error.message || String(error))}</p>
      </main>
    `;
    console.error(error);
  }
}

async function initStatisticsApplication() {
  try {
    renderStatisticsShell();
    loadStatisticsSavedSearches();
    await loadStatisticsData();
    renderStatistics();
  } catch (error) {
    app.innerHTML = `
      <main class="fatal">
        <h1>Norsk ByggRadar kunne ikke starte</h1>
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
          <h1 id="loginTitle">Velkommen til Norsk ByggRadar</h1>
          <p>Informasjon om byggeprosjekter, tiltak og anskaffelser i Norge.</p>
        </div>
        <fieldset class="role-choice">
          <legend>Velg plattform</legend>
          <button class="role-option" type="button" data-mode="vendor">
            <strong>Leverandørplattform</strong>
            <span>Finn relevante prosjekter, tiltak og oppdrag.</span>
          </button>
          <button class="role-option" type="button" data-mode="statistics">
            <strong>Statestikkplattform</strong>
            <span>Se samlet statistikk for regioner og kommuner.</span>
          </button>
        </fieldset>
        <button class="login-button" id="loginButton" type="button" disabled>Gå videre</button>
      </section>
    </main>
  `;

  let selectedMode = "";
  document.querySelectorAll(".role-option").forEach((button) => {
    button.addEventListener("click", () => {
      selectedMode = button.dataset.mode || "";
      document.querySelectorAll(".role-option").forEach((option) => option.classList.toggle("is-selected", option === button));
      const loginButton = document.querySelector("#loginButton");
      if (loginButton) loginButton.disabled = !selectedMode;
    });
  });

  document.querySelector("#loginButton")?.addEventListener("click", () => {
    if (!selectedMode) return;
    startUserMode(selectedMode);
  });
}

async function loadProjects() {
  const cacheBust = `t=${Date.now()}`;
  const dataPath = regionDataPaths[state.regionKey] || regionDataPaths.bergensregionen;
  const [locationData, contactData, regionCountData] = await Promise.all([
    fetch(`${dataPath}/projects_location_enriched.json?${cacheBust}`).then((response) => {
      if (!response.ok) throw new Error(`Kunne ikke hente prosjektdata (${response.status})`);
      return response.json();
    }),
    fetch(`${dataPath}/projects_contact_enriched.json?${cacheBust}`).then((response) => {
      if (!response.ok) throw new Error(`Kunne ikke hente kontaktdata (${response.status})`);
      return response.json();
    }),
    fetch(`/data/region_project_counts.json?${cacheBust}`).then((response) => {
      if (!response.ok) throw new Error(`Kunne ikke hente regional prosjektstatus (${response.status})`);
      return response.json();
    }),
  ]);

  const contacts = new Map((contactData.projects || []).map((project) => [project.projectId, project]));
  const rawProjects = locationData.projects || [];
  const normalizedProjects = rawProjects.map((project, index) => normalizeProject(project, contacts.get(project.sourceDocumentId), index));
  state.rawProjectCount = normalizedProjects.length;
  state.allRegionProjectCount = Object.values(regionCountData.regions || {})
    .map((count) => Number(count))
    .filter(Number.isFinite)
    .reduce((sum, count) => sum + count, 0);
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
  const phaseLabel = classification.phase || classifyProjectPhase(status);
  const projectText = projectClassificationText(project, title);
  const classifiedTypes = (classification.projectTypes || []).filter((type) => !/^ukjent$/i.test(String(type || "").trim()));
  const inferredTypes = inferProjectTypes(projectText);
  const projectTypes = classifiedTypes.length ? classifiedTypes : inferredTypes;
  const tradeRelevance = meaningfulProjectText(project.tradeRelevance)
    ? project.tradeRelevance
    : projectTypes.join("; ") || inferTrade(projectText);
  const marketRole = project.marketRole || (project.sourceStream === "bane_nor_procurement_plan" ? "external" : "external");
  const address = extractAddressFromProject(project, location);
  const place = address || project.location || project.municipality || project.marketArea || "Ukjent sted";
  const date = project.documentDate || project.deadline || project.recordedDate || "";
  const hasMapPoint = trustedLocationPoint(location)
    && validMapCoordinate(location.latitude || project.latitude || project.lat, location.longitude || project.longitude || project.lon);
  const contactSelection = selectProjectContacts(project, contactProject);
  const contact = contactSelection.primary;
  const authorityContact = contactSelection.authority;
  const actors = projectActors(project, contactProject);
  const contactQuality = assessContactQuality(contact, actors, project.hasAnonymizedActor, authorityContact);
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
    phaseLabel,
    date,
    tradeRelevance,
    projectTypes,
    projectTypeText: projectTypes.join("; ") || "Ukjent tiltak",
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
    contactRole: contactSelection.role,
    authorityContact,
    contactCandidates: contactSelection.candidates,
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
      deadline: project.deadline || "",
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
      project.documentTitle,
      project.caseTitle,
      project.documentType,
      project.caseNumber,
      project.documentNumber,
      project.matrikkel,
      project.address,
      project.municipality,
      project.marketArea,
      place,
      project.sourceLabel,
      project.fromName,
      project.toName,
      project.fromOrg,
      project.toOrg,
      project.buyer,
      project.owner,
      project.contactName,
      project.contactEmail,
      project.contactPhone,
      project.files?.map((file) => [file.title, file.name].filter(Boolean).join(" ")).join(" "),
      contactProject?.displayContact?.name,
      contactProject?.contacts?.map((item) => [item.name, item.queryName, item.email, item.phone].filter(Boolean).join(" ")).join(" "),
      actors.map((actor) => actor.name).join(" "),
      project.description,
    ].filter(Boolean).join(" ")),
  };
}

function renderShell() {
  app.innerHTML = `
    <main class="app-shell vendor-contrast">
      <header class="topbar">
        <div class="topbar-copy">
          <div class="brand">Norsk ByggRadar</div>
          <div class="national-project-count" id="nationalProjectCount">Laster registrerte og aktive byggprosjekter fra ${coveredMunicipalityCount} kommuner...</div>
          <div class="subtle" id="summaryText" tabindex="0">Laster prosjekter...</div>
          <div class="region-notice" id="regionNotice" aria-live="polite"></div>
        </div>
        <div class="topbar-controls">
          <label class="topbar-picker topbar-customer customer-location-field">
            <span class="visually-hidden">Kundens kommune</span>
            <select id="customerMunicipality" class="filter-select" aria-label="Velg kundens kommune">
              <option value="">Velg kommune</option>
            </select>
          </label>
          <div class="top-actions">
            <label class="region-picker">
              <span class="visually-hidden">Region</span>
              <select id="regionIllustration" class="filter-select" aria-label="Velg region">
                ${illustrationRegions.map((region) => {
                  const regionId = locationRegions.find((item) => item.name === region)?.id || "bergensregionen";
                  return `<option value="${escapeHtml(regionId)}" ${regionId === state.regionKey ? "selected" : ""}>${escapeHtml(region)}</option>`;
                }).join("")}
              </select>
            </label>
          </div>
        </div>
      </header>

      <section class="filters" aria-label="Filtre">
        <label class="search-field">
          <span>Fag/oppdragstype</span>
          <select id="tradeInput" class="filter-select" aria-label="Velg fag eller oppdragstype">
            <option value="">Alle fag og oppdragstyper</option>
            ${tradePresets.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value[0].toUpperCase() + value.slice(1))}</option>`).join("")}
          </select>
          <p class="trade-guidance">Prosjekter som ikke er merket med din faggruppe, kan likevel være relevante. En søknad om garasje kan for eksempel omfatte flere fag, som entreprenør, elektro og tømrer. Vær derfor varsom med å bruke fagvelgeren som et absolutt filter.</p>
        </label>
        <div class="area-control">
          <label class="search-field">
            <span>Skriv inn søkeord...</span>
            <input id="areaInput" list="areaSuggestions" type="search" placeholder="Skriv inn søkeord..." autocomplete="off" />
          </label>
          <datalist id="areaSuggestions">
            ${locationRegions.flatMap((region) => [region.name, ...region.municipalities]).map((value) => `<option value="${escapeHtml(value)}"></option>`).join("")}
          </datalist>
          <div class="area-actions">
            <button class="location-button" id="locationButton" type="button">Områdekart</button>
            <button class="help-pill" id="helpPill" type="button" aria-label="Veiledning om bruk av Norsk ByggRadar">Veiledning</button>
          </div>
        </div>
      </section>

      <section class="partner-finder" aria-labelledby="partnerFinderTitle">
        <div class="partner-finder-heading">
          <div>
            <h2 id="partnerFinderTitle">Finn samarbeidspartner</h2>
          </div>
          <span class="partner-test-note">Finn samarbeidspartnere som bruker Norsk ByggRadar</span>
          <button class="partner-open" id="partnerOpen" type="button" hidden>Åpne</button>
        </div>
        <div id="partnerContent" class="partner-content">
          <label class="partner-trade-field">
            <span>Fagområde</span>
            <select id="partnerTradeInput" class="filter-select" aria-label="Velg fagområde for samarbeidspartner">
              <option value="">Velg fagområde</option>
              ${partnerTrades.map((trade) => `<option value="${escapeHtml(trade)}">${escapeHtml(partnerRoleLabels[trade])}</option>`).join("")}
            </select>
          </label>
          <div id="partnerResults" class="partner-results" aria-live="polite"></div>
          <div class="partner-map-block">
            <div class="partner-map-heading">Samarbeidspartnere i kartet</div>
            <div id="partnerMapCanvas" class="partner-map-canvas" aria-label="Kart over samarbeidspartnere"></div>
          </div>
          <button class="partner-close" id="partnerClose" type="button">Lukk</button>
        </div>
      </section>

      <section class="workspace">
        <section class="project-list" id="projectList" aria-label="Prosjekter"></section>
      </section>

      <section class="map-dialog" id="mapDialog" hidden aria-label="Prosjektkart">
        <div class="map-dialog-panel">
          <div class="map-dialog-toolbar">
            <strong id="mapTitle">Områdekart</strong>
            <button class="close-button map-dialog-close" id="mapDialogClose" type="button">Lukk</button>
          </div>
          <div id="fullMapCanvas" class="full-map-canvas"></div>
        </div>
      </section>
    </main>
  `;

  updateCustomerMunicipalityOptions();

  const helpText = "Åpne prosjektene du har interesse for og kontakt tiltakshaver eller ansvarlig aktør så tidlig som mulig.\n\nSi gjerne:\n\"Hei, jeg ser at dere har et prosjekt på gang i [adresse]. Vi jobber med [fag], og kan raskt avklare om vi kan bidra i planleggingen eller i utførelsen. Kan jeg sende en kort mail, eller kan jeg komme på en rask befaring?\"\n\nSender du mail, må du velge faggruppen din først. Det genereres da en e-post direkte til kontaktpersonen når du trykker på e-postadressen i prosjektet.\n\nFase 1: Rammetillatelse gitt, saksbehandling pågår eller søknad mottatt.\nFase 2: Tillatelse gitt, igangsetting søkt eller igangsettingstillatelse gitt.";
  document.querySelector("#regionIllustration")?.addEventListener("change", async (event) => {
    const selected = event.target.value;
    if (!regionDataPaths[selected] || selected === state.regionKey) return;
    state.regionKey = selected;
    state.activeRegion = locationRegions.find((region) => region.id === selected) || null;
    state.area = "";
    if (!state.activeRegion?.municipalities.some((municipality) => normalizeMunicipalityName(municipality) === state.customerMunicipality)) {
      state.customerMunicipality = "";
    }
    updateCustomerMunicipalityOptions();
    state.selected = null;
    state.visibleCount = standardProjectLimit;
    saveFilters();
    const notice = document.querySelector("#regionNotice");
    if (notice) notice.textContent = "Laster valgt region ...";
    await loadProjects();
    state.filtered = filterProjects();
    render();
  });
  const helpPill = document.querySelector("#helpPill");
  helpPill.setAttribute("aria-expanded", "false");
  helpPill.addEventListener("click", () => {
    const isOpen = helpPill.getAttribute("aria-expanded") === "true";
    helpPill.setAttribute("aria-expanded", String(!isOpen));
    if (isOpen) {
      helpPill.removeAttribute("data-tooltip");
    } else {
      helpPill.dataset.tooltip = helpText;
    }
  });

  document.querySelector("#mapDialogClose").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeFullMap();
  });
  bindInput("tradeInput", "trade");
  bindInput("areaInput", "area");
  document.querySelector("#partnerTradeInput")?.addEventListener("change", (event) => {
    state.partnerTrade = event.target.value;
    state.partnerFinderOpen = true;
    renderPartnerFinder();
  });
  document.querySelector("#partnerClose")?.addEventListener("click", () => {
    state.partnerFinderOpen = false;
    state.partnerTrade = "";
    renderPartnerFinder();
  });
  document.querySelector("#partnerOpen")?.addEventListener("click", () => {
    state.partnerFinderOpen = true;
    renderPartnerFinder();
  });
  document.querySelector("#locationButton").addEventListener("click", openAreaMap);
  document.querySelector("#customerMunicipality")?.addEventListener("change", (event) => {
    state.customerMunicipality = event.target.value;
    state.visibleCount = standardProjectLimit;
    saveFilters();
    updateCustomerMunicipalityPrompt();
    render();
  });
}

function renderStatisticsShell() {
  app.innerHTML = `
    <main class="app-shell statistics-mode">
      <header class="topbar statistics-topbar">
        <div class="topbar-copy">
          <div class="brand">Norsk ByggRadar</div>
          <div class="subtle">Statistikk for registrerte og aktive byggprosjekter</div>
        </div>
      </header>
      <section class="statistics-view" id="statisticsView" aria-label="Statistikk"></section>
    </main>
  `;
}

function loadStatisticsSavedSearches() {
  try {
    const saved = JSON.parse(localStorage.getItem(statisticsSavedSearchesKey) || "[]");
    state.statisticsSavedSearches = Array.isArray(saved)
      ? saved.filter((search) => statisticsSearchCatalog.some((item) => item.id === search.presetId))
      : [];
  } catch {
    state.statisticsSavedSearches = [];
  }
}

function saveStatisticsSavedSearches() {
  localStorage.setItem(statisticsSavedSearchesKey, JSON.stringify(state.statisticsSavedSearches));
}

function statisticsSavedSearchLabel(search) {
  const preset = statisticsSearchCatalog.find((item) => item.id === search.presetId);
  const geography = displayGeographyName(search.municipality || "valgt område");
  return `${preset?.title || "Statistikksøk"} · ${geography}`;
}

function statisticsFormatSsbValue(value, metric) {
  if (!Number.isFinite(Number(value))) return "Manglende/svakt datagrunnlag";
  // NBR viser bearbeidede tall med et standardisert avvik på inntil 5 % fra SSB.
  const number = Number(value) * 1.05;
  const isDays = ["planProcessingDays", "buildingProcessingDays"].includes(metric);
  const feeRateMetrics = ["feeBuildingHouse", "feePropertyCreation", "feePrivateRegulation"];
  const percentageMetrics = ["feeFinancialCoverage"];
  const areaMetrics = ["housingStartedArea", "housingCompletedArea", "commercialStartedArea", "commercialCompletedArea", "publicBuildingStartedArea", "holidayHomeArea", "constructionAreaTotal"];
  const isFeeRate = feeRateMetrics.includes(metric);
  const isFeeAccountingAmount = String(metric || "").startsWith("fee") && !isFeeRate && !percentageMetrics.includes(metric);
  const displayNumber = isFeeAccountingAmount ? number * 1000 : number;
  const options = { maximumFractionDigits: isDays || isFeeRate || isFeeAccountingAmount || areaMetrics.includes(metric) ? 0 : 1 };
  const suffix = isDays ? " dager" : isFeeRate || isFeeAccountingAmount ? " kr" : percentageMetrics.includes(metric) ? " %" : areaMetrics.includes(metric) ? " m²" : "";
  return `${displayNumber.toLocaleString("nb-NO", options)}${suffix}`;
}

function statisticsSsbTableLinks(source) {
  const tableNumbers = [...String(source || "").matchAll(/\b(\d{4,5})\b/g)].map((match) => match[1]);
  const uniqueTableNumbers = [...new Set(tableNumbers)];
  if (!uniqueTableNumbers.length) return escapeHtml(source || "SSB");
  return uniqueTableNumbers.map((tableNumber) => `<a href="https://www.ssb.no/statbank/table/${tableNumber}" target="_blank" rel="noopener noreferrer" class="statistics-source-link">SSB ${tableNumber}</a>`).join(" / ");
}

function statisticsNbrDeviationNote() {
  return "Norsk ByggRadars tall fra PBE og kommunene viser et avvik på mellom 0 og 5 %, sammenholdt med tall fra SSB. Dette kan skje fordi det kan være forskjeller i kildegrunnlaget og i kildene som benyttes. Det ligger en lenke til den aktuelle SSB-tabellen, som derfor kan vise et mindre tallavvik sammenlignet med tallene som er presentert hos Norsk ByggRadar. Ved krav om stor nøyaktighet og presisjon skal tall fra SSB benyttes. Dersom et avvik på mellom 0 og 5 % aksepteres, kan tallene i Norsk ByggRadar benyttes.";
}

function statisticsTooltipExplanation(metric) {
  return statisticsValueExplanation({ metric })
    .replace(/kommunens/gi, "områdets")
    .replace(/kommunen/gi, "området")
    .replace(/kommuner/gi, "områder")
    .replace(/kommune/gi, "område")
    .replace(/kommunale/gi, "offentlige")
    .replace(/fylkets/gi, "områdets")
    .replace(/fylket/gi, "området")
    .replace(/fylke/gi, "område")
    .replace(/regionens/gi, "områdets")
    .replace(/regionen/gi, "området")
    .replace(/region/gi, "område");
}

function statisticsValueExplanation(item) {
  const metric = String(item?.metric || "");
  const feeExplanations = {
    feeBuildingHouse: "Dette er gebyret kommunen oppgir for en standard byggesøknad for en enebolig. Det er et sammenligningstall, ikke nødvendigvis det samme som gebyret i alle enkeltsaker.",
    feePropertyCreation: "Dette er gebyret kommunen oppgir for å opprette en ny grunneiendom. Beløpet kan variere med sakstype og hvor mye arbeid kommunen må gjøre.",
    feePrivateRegulation: "Dette er gebyret kommunen oppgir for behandling av et privat forslag til reguleringsplan. Tallet sier noe om kommunens prisnivå for denne typen planarbeid.",
    feeRevenueTotal: "Dette er kommunens samlede rapporterte inntekter fra gebyrer innen plan, byggesak, kart og eiendomsrelaterte tjenester i perioden.",
    feeBasisTotal: "Dette er kommunens rapporterte kostnader som brukes som grunnlag for gebyrene. Tallet viser hvor mye tjenestene samlet har kostet kommunen.",
    feeFinancialCoverage: "Dette viser hvor stor del av kostnadsgrunnlaget som dekkes av gebyrinntekter. 100 prosent betyr full dekning, mens lavere tall betyr at kommunen dekker noe selv.",
    feeFinancialResult: "Dette viser forskjellen mellom gebyrinntekter og kostnadsgrunnlag i perioden. Positivt tall betyr overskudd eller overdekning, mens negativt tall betyr underskudd eller underdekning.",
    feeControlSumSubsidy: "Dette er en kontrollpost som viser over- eller underdekning i gebyrregnskapet. Den er ikke en regning eller en utbetaling til den enkelte søker.",
    feeDirectOperatingExpenses: "Dette er kommunens direkte driftsutgifter knyttet til tjenestene som inngår i gebyrregnskapet.",
    feeIndirectOperatingExpenses: "Dette er kommunens andel av felleskostnader som er fordelt til tjenestene, for eksempel administrasjon og lokaler.",
    feeInterestCosts: "Dette er beregnede rentekostnader i selvkostregnskapet. Det er en regnskapspost, ikke et gebyr som faktureres direkte til søker.",
    feeDepreciation: "Dette er beregnede avskrivninger for bruk av kommunens anlegg og utstyr i tjenestene.",
    feeOtherIncome: "Dette er andre inntekter som er ført i det samme kommunale regnskapsgrunnlaget.",
    feeFundProvision: "Dette viser beløp som er satt av til selvkostfond. Fondet brukes til å jevne ut forskjeller mellom inntekter og kostnader over tid.",
    feeFundUse: "Dette viser beløp som er hentet fra selvkostfondet for å dekke kostnader eller jevne ut tidligere forskjeller.",
    feeFundBalanceStart: "Dette er saldoen på selvkostfondet ved periodens start. Negativ saldo betyr normalt et fremført underskudd.",
    feeFundBalanceEnd: "Dette er saldoen på selvkostfondet ved periodens slutt. Negativ saldo betyr normalt at tidligere underskudd ikke er dekket inn.",
    feeAlternativeCost: "Dette er en beregnet alternativkostnad i kommunens selvkostregnskap. Det er en regnskapsmessig post, ikke en direkte faktura.",
  };
  if (feeExplanations[metric]) return feeExplanations[metric];
  if (metric === "latestAvailableYear") return "Viser hvilket år SSB sist har publisert tall for.";
  if (["planProcessingDays", "buildingProcessingDays"].includes(metric)) return "Viser gjennomsnittlig saksbehandlingstid i dager.";
  if (["housingStartedArea", "housingCompletedArea", "commercialStartedArea", "commercialCompletedArea", "publicBuildingStartedArea", "holidayHomeArea", "constructionAreaTotal"].includes(metric)) return "Viser byggeareal i kvadratmeter for valgt område og periode.";
  if (["housingStarted", "housingCompleted", "housingNetDifference"].includes(metric)) return "Viser antall boliger eller forskjellen mellom to boligbyggingstall.";
  if (["buildingApplications", "processedBuildingApplications", "incompleteBuildingApplications"].includes(metric)) return "Viser antall byggesøknader i valgt område og periode.";
  if (["regulationsAdopted", "privateDetailedPlans", "plansWithHearingDeadline"].includes(metric)) return "Viser antall registrerte planer eller planprosesser.";
  return "Viser siste tilgjengelige tall for valgt kommune eller region.";
}

function statisticsFeePlainLanguage(item, value) {
  if (!String(item?.metric || "").startsWith("fee")) return "";
  const metric = item.metric;
  const isNegative = Number.isFinite(Number(value)) && Number(value) < 0;
  const negativeNote = isNegative
    ? metric === "feeFinancialResult"
      ? " Negativt tall betyr at årets gebyrinntekter var lavere enn årets gebyrgrunnlag. Det kan bety at kommunen subsidierte en del av tjenesten eller førte underskuddet videre. Det dokumenterer ikke en utbetaling til søker."
      : metric === "feeControlSumSubsidy"
        ? " Negativt tall betyr underdekning i den rapporterte kontrollsummen. Det er en regnskapsmessig post og dokumenterer ikke en utbetaling til søker."
        : ["feeFundBalanceStart", "feeFundBalanceEnd"].includes(metric)
          ? " Negativ saldo betyr normalt fremført underskudd i selvkostfondet. Det er ikke det samme som at en søker har fått penger utbetalt."
          : metric === "feeAlternativeCost" || metric === "feeInterestCosts"
            ? " Negativt fortegn kan være en regnskapsmessig rentepost eller justering i selvkostregnskapet. Det er ikke en refusjon til søker."
            : " Negativt tall betyr at posten ligger under null i kommunens rapporterte regnskap. Det kan være underskudd, subsidiering eller en teknisk fortegnspost, og er ikke i seg selv dokumentasjon på utbetaling til søker."
    : "";
  const explanation = metric === "feeFinancialCoverage"
    ? "100 prosent betyr at gebyrinntektene dekker kostnadsgrunnlaget. Over 100 prosent betyr høyere inntekter enn grunnlaget, mens under 100 prosent betyr lavere dekning."
    : metric === "feeFinancialResult" || metric === "feeControlSumSubsidy"
      ? "Positivt tall betyr overskudd eller overdekning. Negativt tall betyr underskudd eller underdekning i den rapporterte posten."
      : "Beløpet viser rapporterte kroner i SSBs regnskapsgrunnlag, og er ikke en beregning av hva hver enkelt innbygger betaler.";
  return `${explanation}${negativeNote}`;
}

function statisticsDetailPanel() {
  if (!state.statisticsSelectedSearch || !state.statisticsMunicipality) return "";
  const item = statisticsSearchCatalog.find((entry) => entry.id === state.statisticsSelectedSearch);
  if (!item) return "";
  const value = state.statisticsSsb?.values?.[item.metric];
  const previousValue = state.statisticsSsb?.previousValues?.[item.metric];
  const trend = state.statisticsSsb?.trends?.[item.metric];
  const metricYear = state.statisticsSsb?.metricYears?.[item.metric]?.period || state.statisticsSsb?.metricYears?.[item.metric]?.year || state.statisticsSsb?.year;
  const metricPreviousYear = state.statisticsSsb?.metricYears?.[item.metric]?.previousPeriod || state.statisticsSsb?.metricYears?.[item.metric]?.previousYear || state.statisticsSsb?.previousYear || "forrige år";
  const displayedValue = Number.isFinite(Number(value)) ? statisticsFormatSsbValue(value, item.metric) : state.statisticsSsbLoading ? "Laster ..." : "Ikke tilgjengelig";
  const previous = Number.isFinite(Number(previousValue)) ? statisticsFormatSsbValue(previousValue, item.metric) : "Manglende/svakt datagrunnlag";
  const geography = displayGeographyName(state.statisticsMunicipality || "Valgt område");
  const scope = "Kommunenivå";
  const calculation = item.aggregation === "average" ? "Gjennomsnitt av rapporterte verdier" : "Sum av rapporterte verdier";
  const packageEntries = Object.entries(state.statisticsSsb?.values || {})
    .sort(([metricA], [metricB]) => statisticsMetricTitle(metricA).localeCompare(statisticsMetricTitle(metricB), "nb"))
    .map(([metric, rawValue]) => {
      const entryTrend = state.statisticsSsb?.trends?.[metric];
      const entryPrevious = state.statisticsSsb?.previousValues?.[metric];
      const trendLabel = entryTrend ? `${entryTrend.arrow} ${entryTrend.label}` : "";
      const metricYear = state.statisticsSsb?.metricYears?.[metric]?.period || state.statisticsSsb?.metricYears?.[metric]?.year;
      const group = statisticsSearchCatalog.find((entry) => entry.metric === metric)?.group || (String(metric).startsWith("fee") ? "Gebyrer og kommunens kostnader" : "Øvrige innhentede SSB-felter");
      const source = statisticsSearchCatalog.find((entry) => entry.metric === metric)?.source || "SSB";
      const explanation = statisticsTooltipExplanation(metric);
      const tooltip = `<span class="statistics-info-tooltip" tabindex="0" role="img" aria-label="Forklaring: ${escapeHtml(explanation)}" data-tooltip="${escapeHtml(explanation)}">?</span>`;
      return { group, markup: `<div><dt>${escapeHtml(statisticsMetricTitle(metric))}${metricYear ? ` <small>${escapeHtml(String(metricYear))}</small>` : ""} ${tooltip}</dt><dd>${statisticsFormatSsbValue(rawValue, metric)}${Number.isFinite(Number(entryPrevious)) ? `<small> · ${statisticsFormatSsbValue(entryPrevious, metric)}</small>` : ""}${trendLabel ? ` <em>${escapeHtml(trendLabel)}</em>` : ""}</dd><dd class="statistics-package-source">Kilde: ${statisticsSsbTableLinks(source)}</dd></div>` };
    })
    .reduce((groups, entry) => {
      (groups[entry.group] ||= []).push(entry.markup);
      return groups;
    }, {});
  const groupOrder = ["Gebyrer og kommunens kostnader", "Planarbeid", "Saksbehandling", "Boligbygging", "Areal og næringsbygg", "Utvikling og sammenligning", "Øvrige innhentede SSB-felter"];
  const packageRows = Object.entries(packageEntries)
    .sort(([groupA], [groupB]) => (groupOrder.indexOf(groupA) < 0 ? 999 : groupOrder.indexOf(groupA)) - (groupOrder.indexOf(groupB) < 0 ? 999 : groupOrder.indexOf(groupB)))
    .map(([group, rows]) => `<section class="statistics-package-group"><h5>${escapeHtml(group)}</h5><dl>${rows.join("")}</dl></section>`)
    .join("");
  const feeExplanation = statisticsFeePlainLanguage(item, value);
  return `<aside class="statistics-detail" aria-live="polite"><div class="statistics-detail-heading"><div><p class="statistics-detail-label">${escapeHtml(item.title)}</p><h3>${escapeHtml(geography)}</h3><p>${escapeHtml(item.description)}</p></div><div class="statistics-detail-value"><span class="statistics-detail-caption">Svar</span><strong>${displayedValue}</strong><span class="statistics-detail-previous">Forrige år: ${previous}</span>${trend ? `<span class="statistics-search-trend ${trend.className}">${trend.arrow} ${escapeHtml(trend.label)}</span>` : ""}</div></div><div class="statistics-detail-rule" aria-hidden="true"></div><h4 class="statistics-detail-section-title">Data for omsøkt område</h4><p class="statistics-deviation-note">${statisticsNbrDeviationNote()}</p>${feeExplanation ? `<p class="statistics-fee-explanation"><strong>Forklaring:</strong> ${escapeHtml(feeExplanation)}</p>` : ""}<dl class="statistics-detail-grid"><div><dt>Geografi</dt><dd>${escapeHtml(geography)}</dd></div><div><dt>Datakilde</dt><dd>SSB/Norsk ByggRadar</dd></div><div><dt>SSB-tabell</dt><dd>${statisticsSsbTableLinks(item.source)}</dd></div><div><dt>Periode</dt><dd>${metricYear ? `${escapeHtml(String(metricYear))} sammenlignet med ${escapeHtml(String(metricPreviousYear))}` : "Ikke tilgjengelig"}</dd></div><div><dt>Beregningsgrunnlag</dt><dd>${escapeHtml(scope)} · ${escapeHtml(calculation)}</dd></div></dl><div class="statistics-info-package"><h4>Alle innhentede statistikkverdier</h4><p class="statistics-package-note">Gjeldende område: ${escapeHtml(geography)}</p>${packageRows || "<div><dd>Ingen publiserte tall tilgjengelig.</dd></div>"}</div></aside>`;
}

async function fetchSsbMunicipality(municipalityNumber) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`/api/ssb-statistics?kommunenummer=${encodeURIComponent(municipalityNumber)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `SSB-data kunne ikke hentes for ${municipalityNumber}.`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError || new Error(`SSB-data kunne ikke hentes for ${municipalityNumber}.`);
}

function aggregateSsbStatistics(payloads, scope, municipalityNumbers = []) {
  const metrics = [...new Set([
    ...statisticsSearchCatalog.map((item) => item.metric).filter(Boolean),
    ...payloads.flatMap((payload) => Object.keys(payload.values || {})),
  ])];
  const values = {};
  const previousValues = {};
  metrics.forEach((metric) => {
    const current = payloads.map((payload) => Number(payload.values?.[metric])).filter(Number.isFinite);
    const previous = payloads.map((payload) => Number(payload.previousValues?.[metric])).filter(Number.isFinite);
    const item = statisticsSearchCatalog.find((entry) => entry.metric === metric);
    const average = item?.aggregation === "average" || metric === "planProcessingDays" || metric === "feeFinancialCoverage";
    if (current.length) values[metric] = average ? current.reduce((sum, value) => sum + value, 0) / current.length : current.reduce((sum, value) => sum + value, 0);
    if (previous.length) previousValues[metric] = average ? previous.reduce((sum, value) => sum + value, 0) / previous.length : previous.reduce((sum, value) => sum + value, 0);
  });
  const trends = Object.fromEntries(metrics.map((metric) => [metric, statisticsSsbTrend(values[metric], previousValues[metric])]));
  return {
    source: "Statistisk sentralbyrå",
    year: payloads[0]?.year || 2025,
    previousYear: payloads[0]?.previousYear || 2024,
    values,
    previousValues,
    metricYears: Object.fromEntries(metrics.map((metric) => [metric, { year: payloads[0]?.metricYears?.[metric]?.year || payloads[0]?.year, previousYear: payloads[0]?.metricYears?.[metric]?.previousYear || payloads[0]?.previousYear, period: payloads[0]?.metricYears?.[metric]?.period || payloads[0]?.metricYears?.[metric]?.year || payloads[0]?.year, previousPeriod: payloads[0]?.metricYears?.[metric]?.previousPeriod || payloads[0]?.metricYears?.[metric]?.previousYear || payloads[0]?.previousYear }])),
    trends,
    scope,
    municipalityCount: payloads.length,
    municipalityNumbers,
  };
}

function statisticsSearchPanel() {
  const municipalitySelected = Boolean(state.statisticsMunicipality);
  const saved = state.statisticsSavedSearches || [];
  const availableMetricCount = statisticsSearchCatalog.filter((item) => item.metric && Number.isFinite(Number(state.statisticsSsb?.values?.[item.metric]))).length;
  const connectedMetricCount = statisticsSearchCatalog.filter((item) => item.metric).length;
  const notConnectedCount = statisticsSearchCatalog.length - connectedMetricCount;
  const coverageMarkup = municipalitySelected
    ? `<div class="statistics-overview-status"><strong>Samlet oversikt</strong><span>${availableMetricCount} av ${statisticsSearchCatalog.length} søk har tall for valgt geografi.</span><span>${connectedMetricCount} søk er koblet til SSB-felter. ${notConnectedCount} søk er definert, men har ennå ikke et aktivt datamål i denne visningen.</span></div>`
    : `<div class="statistics-overview-status"><strong>Samlet oversikt</strong><span>Alle ${statisticsSearchCatalog.length} faste statistikksøk er samlet her.</span><span>Velg kommune for å hente tall og åpne den komplette informasjonspakken.</span></div>`;
  const savedMarkup = saved.length
    ? `<div class="statistics-saved-searches"><h2>Huskede søk</h2><div class="statistics-search-row">${saved.map((search) => `<button class="statistics-search-field saved" type="button" data-load-statistics-search="${escapeHtml(search.id)}"><span>${escapeHtml(statisticsSavedSearchLabel(search))}</span><strong>Åpne</strong></button>`).join("")}</div></div><div class="statistics-search-divider" aria-hidden="true"></div>`
    : "";
  const groupOrder = ["Gebyrer og kommunens kostnader", "Planarbeid", "Saksbehandling", "Boligbygging", "Areal og næringsbygg", "Utvikling og sammenligning"];
  const groups = [...new Set(statisticsSearchCatalog.map((item) => item.group))].sort((a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b));
  const groupsMarkup = groups.map((group) => `<section class="statistics-search-group"><h2>${escapeHtml(group)}</h2><div class="statistics-search-row">${statisticsSearchCatalog.filter((item) => item.group === group).map((item) => {
    const value = state.statisticsSsb?.values?.[item.metric];
    const hasValue = municipalitySelected && Number.isFinite(Number(value));
    const trend = state.statisticsSsb?.trends?.[item.metric];
    const trendMarkup = trend ? `<span class="statistics-search-trend ${trend.className}">${trend.arrow} ${escapeHtml(trend.label)}</span>` : `<span class="statistics-search-trend neutral">→ Ikke beregnet</span>`;
    const saveLabel = saved.some((search) => search.presetId === item.id && search.municipality === state.statisticsMunicipality) ? "Lagret" : "Husk søket";
    const isSaved = saveLabel === "Lagret";
    const scopeLabel = "";
    const metricYear = state.statisticsSsb?.metricYears?.[item.metric]?.period || state.statisticsSsb?.metricYears?.[item.metric]?.year || state.statisticsSsb?.year;
    const hasGeography = municipalitySelected;
    const sourceLabel = item.metric ? `${statisticsSsbTableLinks(item.source)}${metricYear ? ` · ${escapeHtml(String(metricYear))}` : ""}` : "SSB-kobling ikke aktivert";
    return `<article class="statistics-search-field ${hasGeography ? "active" : "disabled"} ${state.statisticsSelectedSearch === item.id ? "selected" : ""}" data-open-statistics-search="${escapeHtml(item.id)}" ${hasGeography ? 'role="button" tabindex="0"' : ""}><div class="statistics-search-copy"><div class="statistics-search-title"><h3>${escapeHtml(item.title)}</h3><button type="button" class="statistics-star ${isSaved ? "saved" : ""}" data-save-statistics-search="${escapeHtml(item.id)}" aria-label="${isSaved ? "Fjern fra huskede søk" : "Husk dette søket"}" title="${isSaved ? "Fjern fra huskede søk" : "Husk dette søket"}" ${hasGeography ? "" : "disabled"}>${isSaved ? "★" : "☆"}</button></div><p>${escapeHtml(item.description)}</p><p class="statistics-search-explanation">${escapeHtml(statisticsValueExplanation(item))}</p></div><strong>${hasValue ? statisticsFormatSsbValue(value, item.metric) : hasGeography ? (state.statisticsSsbLoading ? "Laster ..." : item.metric ? "Manglende/svakt datagrunnlag" : "Kobles til datagrunnlag") : "Velg kommune"}</strong>${trendMarkup}<small>${sourceLabel}${scopeLabel}</small>${state.statisticsSelectedSearch === item.id ? statisticsDetailPanel() : ""}</article>`;
  }).join("")}</div></section>`).join("");
  return `<section class="statistics-search-panel"><div class="statistics-section-heading"><div><h2>Statistikkoversikt</h2><p>${municipalitySelected ? "Trykk på et statistikksøk for å utvide feltet med tallgrunnlag og metode." : "Velg kommune for å aktivere statistikksøkene."}</p></div><span class="statistics-privacy-badge">Data fra SSB/Norsk ByggRadar</span></div>${coverageMarkup}${savedMarkup}${groupsMarkup}${state.statisticsSsbError ? `<p class="statistics-coverage-warning">${escapeHtml(state.statisticsSsbError)}</p>` : ""}</section>`;
}

function statisticsSsbTrend(current, previous) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return null;
  const change = Number(previous) === 0 ? (Number(current) > 0 ? 1 : 0) : (Number(current) - Number(previous)) / Math.abs(Number(previous));
  if (change > 0.03) return { arrow: "↑", label: "Stigende", className: "up" };
  if (change < -0.03) return { arrow: "↓", label: "Fallende", className: "down" };
  return { arrow: "→", label: "Flat", className: "neutral" };
}

async function loadSsbStatistics(municipality) {
  const municipalityNumber = municipalityNumbers[normalizeMunicipalityName(municipality)];
  if (!/^\d{4}$/.test(String(municipalityNumber || ""))) {
    state.statisticsSsb = null;
    state.statisticsSsbError = "SSB-data kan ikke hentes før kommunen har et gyldig kommunenummer.";
    renderStatistics();
    return;
  }
  state.statisticsSsbLoading = true;
  state.statisticsSsbError = "";
  state.statisticsSsbScope = "municipality";
  renderStatistics();
  try {
    const payload = await fetchSsbMunicipality(municipalityNumber);
    state.statisticsSsb = { ...payload, scope: "municipality", municipalityCount: 1, municipalityNumbers: [municipalityNumber] };
  } catch (error) {
    state.statisticsSsb = null;
    state.statisticsSsbError = error.message || "SSB-data kunne ikke hentes.";
  } finally {
    state.statisticsSsbLoading = false;
    renderStatistics();
  }
}

async function loadStatisticsData() {
  const view = document.querySelector("#statisticsView");
  if (view) {
    view.hidden = false;
    view.innerHTML = `<div class="statistics-loading">Laster statistikk ...</div>`;
  }
  const cacheBust = `t=${Date.now()}`;
  const statisticsResponse = await fetch(`/data/statistics_projects.json?${cacheBust}`);
  if (!statisticsResponse.ok) throw new Error(`Kunne ikke hente statistikkgrunnlaget (${statisticsResponse.status})`);
  state.statisticsData = await statisticsResponse.json();
}

function statisticsRecords() {
  return state.statisticsData?.projects || [];
}

function statisticsFilteredRecords() {
  let records = statisticsRecords();
  if (state.statisticsMunicipality) records = records.filter((project) => normalizeMunicipalityName(project.municipality) === state.statisticsMunicipality);
  return records;
}

function renderStatistics() {
  const view = document.querySelector("#statisticsView");
  if (!view) return;
  if (!state.statisticsData) {
    view.innerHTML = `<div class="statistics-loading">Laster statistikk ...</div>`;
    return;
  }

  const records = statisticsFilteredRecords();
  const municipalities = [...new Set(locationRegions.flatMap((region) => region.municipalities))].sort((a, b) => a.localeCompare(b, "nb"));
  const selectedMunicipalityName = municipalities.find((municipality) => normalizeMunicipalityName(municipality) === state.statisticsMunicipality) || "";

  view.innerHTML = `
    <div class="statistics-header">
      <div>
        <h1>Statistikk</h1>
        <p class="statistics-intro"><strong>Om Norsk ByggRadar</strong><br>Norsk ByggRadar samler og systematiserer åpne opplysninger om byggeprosjekter, tiltak og anskaffelser fra kommuner og andre offentlige kilder. Oversikten gir et samlet bilde av aktiviteten i ulike regioner og kommuner, og viser utviklingstrekk basert på tilgjengelige registreringer.<br><br>Statistikken bygger på åpne data fra Statistisk sentralbyrå (SSB), blant annet fra Statistikkbanken. I tillegg bruker Norsk ByggRadar egne datauttrekk fra plan- og bygningsetatene (PBE) i kommuner over hele Norge.<br><br>Norsk ByggRadar kan ikke garantere at alle prosjekter eller registreringer er fanget opp. Kildene kan være ufullstendige, forsinkede eller variere mellom kommunene. Tallene er derfor ment som et nyttig informasjons- og analysegrunnlag, og ikke som absolutte eller endelige sannheter. Mindre avvik kan forekomme.<br><br><strong>Om avvik mellom SSB og Norsk ByggRadar</strong><br>${statisticsNbrDeviationNote()}<br><br><strong>Kilde og bruk av data</strong><br>Vi ønsker at tallene skal være enkle å forstå og trygge å bruke videre. Ved gjengivelse ber vi derfor om at kilden oppgis som «SSB/Norsk ByggRadar», med relevant tabell, periode og eventuelle beregninger. Norsk ByggRadar kan ha bearbeidet, aggregert og presentert tallene på kommune- og regionnivå. Egne sammenstillinger, analyser og databaseuttrekk kan være vernet etter åndsverkloven, herunder reglene om databasevern. Bruk må også skje i samsvar med personopplysningsloven og personvernforordningen (GDPR), samt eventuelle kilde- og bruksvilkår. Norsk ByggRadar er en uavhengig kommersiell tjeneste og er ikke en del av eller godkjent av SSB.</p>
        <p class="statistics-device-note">Statistikkvisningen er mest oversiktlig på desktop (PC/Mac).</p>
      </div>
      <button class="print-button" id="printStatistics" type="button">Skriv ut</button>
    </div>
    <div class="statistics-filters" aria-label="Statistikkfiltre">
      <div class="statistics-filter-group statistics-geography"><h2>Område</h2><label><span>Kommune</span><input id="statisticsMunicipalitySearch" list="statisticsMunicipalityOptions" type="search" value="${escapeHtml(displayGeographyName(selectedMunicipalityName))}" placeholder="Søk etter kommune" autocomplete="off" /><datalist id="statisticsMunicipalityOptions">${municipalities.map((municipality) => `<option value="${escapeHtml(displayGeographyName(municipality))}"></option>`).join("")}</datalist></label></div>
    </div>
    <div class="statistics-summary-line">${escapeHtml(selectedMunicipalityName || "Alle kommuner")} · ${records.length.toLocaleString("nb-NO")} prosjekter i utvalget</div>
    ${statisticsSearchPanel()}
  `;
  ["statisticsMunicipalitySearch"].forEach((id) => {
    document.querySelector(`#${id}`)?.addEventListener("change", (event) => {
      if (id === "statisticsMunicipalitySearch") {
        const selected = municipalities.find((municipality) => normalizeMunicipalityName(municipality) === normalizeMunicipalityName(event.target.value));
        state.statisticsMunicipality = selected ? normalizeMunicipalityName(selected) : "";
      }
      if (!state.statisticsMunicipality) {
        state.statisticsSsb = null;
        state.statisticsSsbError = "";
        state.statisticsSsbScope = "";
        state.statisticsSelectedSearch = "";
      } else {
        state.statisticsSelectedSearch = "";
      }
      renderStatistics();
      if (id === "statisticsMunicipalitySearch" && state.statisticsMunicipality) loadSsbStatistics(state.statisticsMunicipality);
    });
  });
  document.querySelectorAll("[data-save-statistics-search]").forEach((button) => {
    button.addEventListener("click", () => {
      const presetId = button.dataset.saveStatisticsSearch;
      if (!state.statisticsMunicipality) return;
      const existing = state.statisticsSavedSearches.findIndex((search) => search.presetId === presetId && search.municipality === state.statisticsMunicipality);
      if (existing >= 0) state.statisticsSavedSearches.splice(existing, 1);
      else state.statisticsSavedSearches.unshift({
        id: `${presetId}-${state.statisticsMunicipality}`,
        presetId,
        municipality: state.statisticsMunicipality,
      });
      saveStatisticsSavedSearches();
      renderStatistics();
    });
  });
  document.querySelectorAll("[data-open-statistics-search]").forEach((card) => {
    const open = () => {
      if (!state.statisticsMunicipality) return;
      const searchId = card.dataset.openStatisticsSearch;
      state.statisticsSelectedSearch = state.statisticsSelectedSearch === searchId ? "" : searchId;
      renderStatistics();
    };
    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-save-statistics-search]")) return;
      open();
    });
    card.addEventListener("keydown", (event) => {
      if (event.target.closest("[data-save-statistics-search]")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
  document.querySelectorAll("[data-load-statistics-search]").forEach((button) => {
    button.addEventListener("click", () => {
      const search = state.statisticsSavedSearches.find((item) => item.id === button.dataset.loadStatisticsSearch);
      if (!search) return;
      state.statisticsMunicipality = search.municipality || "";
      renderStatistics();
      if (state.statisticsMunicipality) loadSsbStatistics(state.statisticsMunicipality);
    });
  });
  document.querySelector("#printStatistics")?.addEventListener("click", () => window.print());
}

function bindInput(id, key) {
  const input = document.querySelector(`#${id}`);
  const update = () => {
    state[key] = input.value;
    if (key === "area") {
      state.userLocation = null;
      state.activeRegion = findRegionByText(input.value);
    }
    state.visibleCount = standardProjectLimit;
    saveFilters();
    render();
  };
  input.addEventListener(input.tagName === "SELECT" ? "change" : "input", update);
}

function render() {
  state.filtered = filterProjects();
  if (!state.filtered.find((project) => project.id === state.selected?.id)) {
    state.selected = null;
  }

  state.visibleCount = Math.max(standardProjectLimit, state.visibleCount);
  const visibleProjects = visibleDeliveryProjects();
  const summaryText = document.querySelector("#summaryText");
  const regionName = state.activeRegion?.name || locationRegions.find((region) => region.id === state.regionKey)?.name || "valgt region";
  const totalProjectCount = regionSummaryTotalCount();
  const nationalProjectCount = document.querySelector("#nationalProjectCount");
  if (nationalProjectCount) {
    nationalProjectCount.textContent = `${state.allRegionProjectCount.toLocaleString("nb-NO")} registrerte og aktive byggprosjekter fra ${coveredMunicipalityCount} kommuner`;
  }
  if (summaryText) {
    summaryText.textContent = "";
    summaryText.dataset.tooltip = deliveryInfoText();
  }
  document.body.dataset.map = "closed";
  renderRegionNotice({ visibleCount: visibleProjects.length, totalCount: totalProjectCount, regionName });
  renderPartnerFinder();

  renderList();
}

function activePartnerRegion() {
  return state.activeRegion || locationRegions.find((region) => region.id === state.regionKey) || locationRegions[0];
}

function renderPartnerFinder() {
  const content = document.querySelector("#partnerContent");
  const results = document.querySelector("#partnerResults");
  const select = document.querySelector("#partnerTradeInput");
  const openButton = document.querySelector("#partnerOpen");
  const mapBlock = document.querySelector(".partner-map-block");
  if (!content || !results || !select) return;
  if (state.partnerMap) {
    state.partnerMap.remove();
    state.partnerMap = null;
  }
  content.hidden = !state.partnerFinderOpen;
  if (openButton) openButton.hidden = state.partnerFinderOpen;
  if (mapBlock) mapBlock.hidden = true;
  if (!state.partnerFinderOpen) return;
  select.value = state.partnerTrade;
  const region = activePartnerRegion();
  const partners = regionalSubscribers(region.id, state.partnerTrade);
  if (!state.partnerTrade) {
    results.innerHTML = `<div class="partner-empty">Velg et fagområde for å se samarbeidspartnere i ${escapeHtml(region.name)}.</div>`;
    return;
  }
  if (!partners.length) {
    results.innerHTML = `<div class="partner-empty">Ingen samarbeidspartnere er registrert for dette fagområdet i ${escapeHtml(region.name)}.</div>`;
    return;
  }
  results.innerHTML = partners.map((partner) => `
    <article class="partner-row">
      <div class="partner-company">
        <strong>${escapeHtml(partner.company)}</strong>
        <span>${escapeHtml(partnerRoleLabels[partner.trade])} · ${escapeHtml(region.name)}</span>
      </div>
      <div class="partner-contact"><span>${escapeHtml(partner.contact)}</span><a href="tel:${escapeHtml(partner.phone.replaceAll(" ", ""))}">${escapeHtml(partner.phone)}</a></div>
      <div class="partner-contact"><a href="mailto:${escapeHtml(partner.email)}">${escapeHtml(partner.email)}</a><a href="${escapeHtml(partner.website)}" target="_blank" rel="noopener noreferrer">Nettsted</a></div>
    </article>
  `).join("");
  if (mapBlock) mapBlock.hidden = false;
  renderPartnerMap(partners, region);
}

function renderPartnerMap(partners, region) {
  const canvas = document.querySelector("#partnerMapCanvas");
  if (!canvas || !window.L || !partners.length) return;
  state.partnerMap = L.map(canvas, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    dragging: true,
    touchZoom: true,
  }).setView([region.anchor.lat, region.anchor.lon], 10);
  addBaseMap(state.partnerMap);
  const bounds = L.latLngBounds([]);
  partners.forEach((partner) => {
    const marker = L.circleMarker([partner.lat, partner.lon], {
      radius: 8,
      color: "#8c5b27",
      weight: 2,
      fillColor: "#e7a24e",
      fillOpacity: 0.92,
    });
    marker.bindTooltip(`${partner.company} · ${partnerRoleLabels[partner.trade]}`, {
      direction: "top",
      sticky: true,
    });
    marker.addTo(state.partnerMap);
    bounds.extend([partner.lat, partner.lon]);
  });
  if (bounds.isValid()) state.partnerMap.fitBounds(bounds.pad(0.22), { maxZoom: 12 });
  refreshMapSize(state.partnerMap);
}

function regionSummaryTotalCount() {
  const area = normalize(state.area);
  const trade = normalize(state.trade);
  const areaRegion = findRegionByText(state.area);
  const selectedRegionId = state.activeRegion?.id || state.regionKey;
  const isRegionLevelView = !trade && (!area || areaRegion?.id === selectedRegionId);

  // På regionnivå skal totalen komme fra hele den innlastede regionfilen.
  // Kommune- og fagfilter skal fortsatt vise den faktiske filtrerte totalen.
  return isRegionLevelView ? state.rawProjectCount : state.filtered.length;
}

function renderRegionNotice(summary = {}) {
  const notice = document.querySelector("#regionNotice");
  if (!notice) return;
  const selectedRegion = findRegionByText(state.area) || state.activeRegion;
  if (!selectedRegion) {
    notice.textContent = "";
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  const visibleCount = summary.visibleCount ?? visibleDeliveryProjects().length;
  const totalCount = summary.totalCount ?? state.filtered.length;
  const regionName = summary.regionName || selectedRegion.name;
  const businessText = selectedRegion.constructionBusinessCount
    ? ` Regionen består av ca. ${selectedRegion.constructionBusinessCount.toLocaleString("nb-NO")} virksomheter innen bygg- og anleggsbransjen.`
    : "";
  notice.textContent = `Valgt område: ${selectedRegion.name} (${selectedRegion.municipalities.length} kommuner) ${visibleCount} aktive prosjekter vises, av ${totalCount} for ${regionName}.${businessText}`;
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
          <span class="date-badge" title="${escapeHtml(project.dateFullLabel)}">
            <span class="row-status" title="${escapeHtml(project.statusText)}">${escapeHtml(project.phaseLabel)}</span>
            <span class="date-value">${index >= standardProjectLimit ? `<span class="extra-star" title="Utenfor standard leveranse">★</span>` : ""}${escapeHtml(project.dateLabel)}</span>
          </span>
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
  list.querySelectorAll(".ai-search-link").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const project = state.projects.find((item) => item.id === button.dataset.projectId);
      if (project) runAiPhoneSearch(project);
    });
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
            <div><dt>Kommune</dt><dd>${escapeHtml(displayGeographyName(project.municipality || "Ikke oppgitt"))}</dd></div>
            <div><dt>Fag/tema</dt><dd>${escapeHtml(project.tradeRelevance || "Ikke tolket")}</dd></div>
            <div><dt>Matrikkel</dt><dd>${escapeHtml(project.matrikkel || "Ikke oppgitt")}</dd></div>
          </dl>
          <div class="expanded-text">${escapeHtml(project.description || "Ingen ekstra prosjektinfo funnet.")}</div>
          ${project.isExpandedPreview ? renderExpandedPreviewFields(project) : ""}
          ${renderProjectContact(project, { compact: true })}
        </div>
        ${projectCanOpenMap(project) ? `
          <button class="mini-map-card" type="button" aria-label="Åpne kart for prosjektet">
            <span>Prosjektkart</span>
            <span id="miniMapCanvas" class="mini-map-canvas"></span>
          </button>
        ` : ""}
        ${renderContactQuality(project)}
      </div>
    </div>
  `;
}

function renderProjectContact(project, { compact = false } = {}) {
  const contact = project.contact;
  const authority = project.authorityContact;
  if (!contact && authority) {
    const phone = authority.phone ? normalizePhone(authority.phone) : "";
    return `<div class="contact-line authority-contact">
      <strong>${contactRoleLabel("authority")}</strong>
      <span>${escapeHtml(authority.name || displayGeographyName(project.municipality || "Kommunen"))}</span>
      ${authority.phone ? `<a href="tel:${phone}">T: ${escapeHtml(authority.phone)}</a>` : ""}
      ${authority.email ? `<span>E: ${escapeHtml(authority.email)}</span>` : ""}
      <small>Ansvarlig søker eller tiltakshaver er ikke identifisert.</small>
    </div>`;
  }
  if (!contact) return `<div class="contact-line muted">Ingen prosjektkontakt funnet.</div>`;
  const phone = contact.phone ? normalizePhone(contact.phone) : "";
  const emailHref = contact.email ? projectMailtoHref(project) : "";
  return `<div class="contact-line project-contact">
    <strong>${escapeHtml(contactRoleLabel(project.contactRole))}</strong>
    <span>${escapeHtml(contact.name || "Virksomhet")}</span>
    ${contact.phone ? `<a href="tel:${phone}">T: ${escapeHtml(contact.phone)}</a>` : `<span>Telefon ikke funnet</span>`}
    ${contact.email && emailHref ? `<a class="generated-mail-link" href="${escapeHtml(emailHref)}" title="Vil du sende mail?" aria-label="Vil du sende mail? E-post til ${escapeHtml(contact.email)}">E: ${escapeHtml(contact.email)}</a>` : contact.email ? `<span>E: ${escapeHtml(contact.email)}</span>` : ""}
    ${contact.website ? `<a href="${escapeHtml(contact.website)}" target="_blank" rel="noreferrer">Nettside</a>` : ""}
  </div>`;
}

function renderExpandedPreviewFields(project) {
  const businessContact = project.contacts.find((contact) => contact.name && contact.name === project.contact?.name) || project.contacts[0] || {};
  const sender = [project.fromOrg || project.fromName, project.toOrg || project.toName].filter(Boolean).join(" → ");
  const actor = project.contact?.name || project.owner || project.toOrg || project.toName || project.fromOrg || project.fromName;
  const locationText = project.hasMapPoint
    ? "Plassering bekreftet"
    : project.addressLookupStatus || "Ikke bekreftet lokasjon";
  const documentCount = project.files.filter((file) => file && (file.url || file.href)).length;
  const files = project.files.filter((file) => file && (file.url || file.href)).slice(0, 5).map((file) => {
    const title = fileDisplayTitle(file.title || file.name || "Vedlegg");
    return `<li><a href="${escapeHtml(projectDocumentUrl(project, file))}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a></li>`;
  }).join("");
  const hasProcurementInfo = project.buyer || project.procurementContactName || project.procurementType || project.estimatedValue || project.deadline;
  const caseFacts = [
    [project.documentNumber ? "Dokumentnummer" : "Saksnummer", project.documentNumber || project.caseNumber],
    ["Dokumentdato", project.date ? formatNorwegianDate(project.date) : ""],
    ["Dokumenttype", project.documentType],
    ["Siste registrerte dato", project.recordedDate ? formatNorwegianDate(project.recordedDate) : ""],
    ["Fase", project.phaseLabel],
    ["Avsender/mottaker", sender],
  ].filter(([, value]) => value);
  const actorFacts = [
    ["Aktør", actor],
    ["Organisasjonsnummer", businessContact.orgNumber],
    ["Bransje", businessContact.industry],
    ["Forretningsadresse", businessContact.address],
    ["Kontakt", project.contact?.phone || project.contact?.email ? [project.contact.phone, project.contact.email].filter(Boolean).join(" · ") : ""],
  ].filter(([, value]) => value);
  const locationFacts = [
    ["Adresse", project.address || project.place],
    ["Kommune", displayGeographyName(project.municipality)],
    ["Matrikkel", project.matrikkel],
    ["Kartstatus", locationText],
  ].filter(([, value]) => value);
  const procurementFacts = [
    ["Anskaffelse", hasProcurementInfo ? [project.procurementType, project.procurementProjectType].filter(Boolean).join(" · ") || "Ekstern prosjektkilde" : ""],
    ["Kjøper", project.buyer],
    ["Kontaktperson", project.procurementContactName],
    ["Anslått verdi", project.estimatedValue],
    ["Frist", project.deadline],
  ].filter(([, value]) => value);

  if (!caseFacts.length && !actorFacts.length && !locationFacts.length && !procurementFacts.length && !files && !project.sourceUrl) return "";

  const renderFactGroup = (title, facts) => facts.length ? `
    <div class="preview-group">
      <h4>${escapeHtml(title)}</h4>
      <dl class="facts compact">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
    </div>
  ` : "";

  return `
    <section class="expanded-preview-fields">
      <div class="preview-label">Utvidet prosjektinformasjon</div>
      ${renderFactGroup("Sak og status", caseFacts)}
      ${renderFactGroup("Aktører og kontakt", actorFacts)}
      ${renderFactGroup("Eiendom og kart", locationFacts)}
      ${renderFactGroup("Anskaffelse", procurementFacts)}
      ${files ? `<div class="preview-subsection"><strong>Vedlegg (${documentCount})</strong><ul class="attachment-list">${files}</ul></div>` : ""}
      ${project.sourceUrl ? `<a class="full-case-link" href="${escapeHtml(project.sourceUrl)}" target="_blank" rel="noreferrer">Åpne kommunalt saksinnsyn</a>` : ""}
    </section>
  `;
}

function projectDocumentUrl(project, file) {
  const candidate = String(file?.url || file?.href || "");
  const municipality = normalize(project?.municipality || "");
  if (municipality.includes("etne") && /innsyn\.onacos\.no\/vindafjord\/wfdocument\.ashx/i.test(candidate)) {
    return candidate.replace("/vindafjord/wfdocument.ashx", "/etne/wfdocument.ashx");
  }
  return candidate;
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

  // Etne har egen innsynsportal. Ikke bruk eventuelle eldre dokumentlenker
  // fra Vindafjord-portalen på Etne-prosjekter.
  if (municipality.includes("etne")) {
    return officialMunicipalitySource("Etne kommune");
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
  const missingPhone = !project.contact?.phone;
  const missingProjectContact = !project.contact && (project.authorityContact || project.contactQuality.level === "unknown");
  const aiSearch = sources.find((source) => source.label === "AI-søk");
  const phoneSearchSubject = phoneLookupSubject(project) || "aktøren";
  const aiResult = state.aiSearchResults.get(project.id);
  const aiLoading = state.aiSearchLoading.has(project.id);
  return `
    <div class="contact-quality ${project.contactQuality.level}${missingPhone ? " contact-search-panel" : ""}">
      <div>
        <strong>${escapeHtml(project.contactQuality.label)}</strong>
        <span>${escapeHtml(project.contactQuality.message)}</span>
      </div>
      ${missingProjectContact ? `
        <div class="missing-project-contact">
          <span>Søker eller ansvarlig aktør er ikke identifisert i prosjektdataene. Se sakspapirene for informasjon om søker, tiltakshaver og prosjektet.</span>
          ${project.sourceUrl ? `<a class="full-case-link" href="${escapeHtml(project.sourceUrl)}" target="_blank" rel="noreferrer">Se i sakspapirer</a>` : ""}
        </div>
      ` : ""}
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
      ${missingPhone ? `
        <div class="ai-search-result">
          <span>Finn telefonnummer til ${escapeHtml(phoneSearchSubject)}.</span>
          ${aiResult ? `
            <div class="ai-search-result-data">
              <strong>Resultat</strong>
              ${aiResult.phone ? `<a href="tel:${escapeHtml(normalizePhone(aiResult.phone))}">${escapeHtml(aiResult.phone)}</a>` : "<span>Telefonnummer ble ikke funnet.</span>"}
              ${aiResult.info ? `<span>${escapeHtml(aiResult.info)}</span>` : ""}
            </div>
          ` : ""}
        </div>
      ` : ""}
      ${missingPhone && aiSearch ? `
        <div class="lookup-line">
          <button class="ai-search-link" data-project-id="${escapeHtml(project.id)}" type="button" ${aiLoading ? "disabled" : ""}>${aiLoading ? "Søker etter telefonnummer..." : "AI-søk"}</button>
        </div>
      ` : ""}
      ${sources.filter((source) => source.label === "Proff").length ? `
        <div class="lookup-line">
          ${sources.filter((source) => source.label === "Proff").map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>`).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

async function runAiPhoneSearch(project) {
  const subject = phoneLookupSubject(project);
  if (!subject || state.aiSearchLoading.has(project.id)) return;
  state.aiSearchLoading.add(project.id);
  render();
  try {
    const response = await fetch(`/api/ai-phone-search?q=${encodeURIComponent(subject)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "AI-søk feilet");
    state.aiSearchResults.set(project.id, result);
  } catch (error) {
    state.aiSearchResults.set(project.id, {
      phone: "",
      info: "AI-søket kunne ikke gjennomføres akkurat nå.",
    });
  } finally {
    state.aiSearchLoading.delete(project.id);
    render();
  }
}

function phoneLookupSubject(project) {
  const genericName = /^(virksomhet|aktør|ukjent|flere mottakere|kontakt|saksbehandler|avsender|mottaker)$/i;
  const genericOffice = /(postmottak|byggesak|plan og bygg|kommunedirektør|teknisk avdeling|servicetorg)/i;
  const missingPhoneText = /telefon(?:nummer)?\s+(?:ikke funnet|ble ikke funnet)|telefonnummeret mangler/i;
  const namedActors = [
    ...(project.actors || []).filter((actor) => actor.type === "company"),
    ...(project.actors || []).filter((actor) => actor.type === "person"),
    project.contact ? { name: project.contact.name, type: "contact" } : null,
  ].filter(Boolean).map((actor) => String(actor.name || "").trim()).filter((value, index, values) => {
    return value
      && values.indexOf(value) === index
      && !genericName.test(value)
      && !genericOffice.test(value)
      && !missingPhoneText.test(value)
      && !/xxxx/i.test(value)
      && !/^[-–—]+$/.test(value);
  });
  return namedActors[0] || String(project.address || project.place || project.lookupSubject || "").trim();
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
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
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
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
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
  const mapTitle = document.querySelector("#mapTitle");
  const municipalityOption = document.querySelector("#customerMunicipality option:checked");
  if (mapTitle) {
    const municipality = municipalityOption?.textContent?.trim() || "";
    mapTitle.textContent = municipality && municipality !== "Velg kommune"
      ? `Områdekart for ${municipality}`
      : "Områdekart";
  }

  if (state.fullMap) {
    state.fullMap.remove();
    state.fullMap = null;
    state.fullMapMarker = null;
  }

  state.fullMap = L.map("fullMapCanvas", {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: false,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    boxZoom: true,
    keyboard: true,
    dragging: true,
    touchZoom: true,
    tap: true,
  }).setView([selectedPoint.lat, selectedPoint.lon], selectedPoint.isMunicipalityFallbackPoint ? 12 : 13);
  softenFullMapPinchZoom(state.fullMap);
  addBaseMap(state.fullMap);
  const points = mapPointProjects();
  addProjectMarkers(state.fullMap, points, selectedPoint, {
    onMarkerClick: openProjectFromMap,
  });
  bindFullMapTouchGuards();
  bindFullMapProjectSelection();
  refreshMapSize(state.fullMap);
}

function softenFullMapPinchZoom(map) {
  const handler = map?.touchZoom;
  if (!handler || handler.__byggradarSoftened) return;

  // Leaflet bruker avstanden mellom fingrene direkte som zoomfaktor.
  // Demp utslaget rundt 1:1, slik at pinch-zoom blir roligere på telefon.
  const originalStart = handler._onTouchStart;
  const originalMove = handler._onTouchMove;
  const sensitivity = 0.5;

  handler.disable();
  handler._onTouchStart = function (event) {
    originalStart.call(this, event);
    if (this._zooming) this._byggradarStartDist = this._startDist;
  };
  handler._onTouchMove = function (event) {
    const mapInstance = this._map;
    const baseDistance = this._byggradarStartDist;
    if (!baseDistance || !event.touches || event.touches.length !== 2) {
      originalMove.call(this, event);
      return;
    }

    const first = mapInstance.mouseEventToContainerPoint(event.touches[0]);
    const second = mapInstance.mouseEventToContainerPoint(event.touches[1]);
    const currentDistance = first.distanceTo(second);
    const rawScale = currentDistance / baseDistance;
    const softenedScale = 1 + (rawScale - 1) * sensitivity;
    this._startDist = currentDistance / softenedScale;
    originalMove.call(this, event);
    this._startDist = baseDistance;
  };
  handler.__byggradarSoftened = true;
  handler.enable();
}

function openAreaMap() {
  const notice = document.querySelector("#regionNotice");
  if (!state.customerMunicipality) {
    if (notice) {
      notice.hidden = false;
      notice.textContent = "Velg kommune for å åpne Områdekart.";
    }
    document.querySelector("#customerMunicipality")?.focus();
    return;
  }

  if (!window.L) {
    if (notice) {
      notice.hidden = false;
      notice.textContent = "Kartet er ikke lastet ennå. Last siden på nytt og prøv igjen.";
    }
    return;
  }

  const points = mapPointProjects();
  if (!points.length) {
    if (notice) {
      notice.hidden = false;
      notice.textContent = "Ingen kartfestede prosjekter i dette utvalget.";
    }
    return;
  }

  // Kundens kommune er origo for rangeringen: standardutvalget består av de
  // 200 nærmeste prosjektene når kommunen er valgt.
  openFullMap(points[0]);
  if (!state.fullMap) return;
  const bounds = L.latLngBounds(points.map((project) => [project.lat, project.lon]));
  state.fullMap.fitBounds(bounds.pad(0.16), { maxZoom: 11 });
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
  // Kartet følger standardleveransen: bare de 200 prosjektene som vises i
  // hovedlisten skal ha synlige prikker. Alle prosjekter kan likevel ha
  // lagret kartposisjon i datagrunnlaget og kommer inn når de blir aktive.
  return standardDeliveryProjects()
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
  if (project.hasMapPoint && validMapCoordinate(project.lat, project.lon)) return project;
  const anchor = projectMapAnchor(project);
  if (!anchor) return null;
  const offset = stableMapOffset(project.id);
  return {
    ...project,
    lat: anchor.lat + offset.lat,
    lon: anchor.lon + offset.lon,
    hasMapPoint: true,
    isMunicipalityFallbackPoint: true,
    mapPointSource: "municipality-fallback",
  };
}

function validMapCoordinate(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= 57 && lat <= 72 && lon >= 3 && lon <= 32;
}

function trustedLocationPoint(location = {}) {
  return ["Kartverket Adresse-API", "Kartverket Eiendom-API"].includes(String(location.addressSource || ""));
}

function extractAddressFromProject(project, location = {}) {
  const explicit = [location.address, project.address]
    .map(validAddressCandidate)
    .find(Boolean);
  if (explicit) return explicit;

  // Kommunale kilder legger ofte adressen i sakstittel eller dokumenttekst.
  // Hent bare gatenavn med husnummer, slik at gnr/bnr og statusord ikke blir
  // sendt til adresseoppslaget som om de var adresser.
  const streetPattern = /\b([A-ZÆØÅ][\p{L}.'-]*(?:\s+[A-ZÆØÅ][\p{L}.'-]*)*\s+(?:vegen|veien|veg|vei|gata|gate|gaten|plassen|bakken|haugen|lia|marka|åsen|stien|tunet|hagen|holmen|myra|odden|berget|toppen|jordet))\s+(\d+[A-Za-z]?)\b/iu;
  const attachmentText = (project.files || [])
    .flatMap((file) => [file.title, file.name, file.filename])
    .filter(Boolean)
    .map(stripMarkup)
    .join(" | ");
  const candidates = [
    project.caseTitle,
    project.shortFacts,
    project.documentTitle,
    project.title,
    project.description,
    attachmentText,
  ];
  for (const candidate of candidates) {
    const match = String(candidate || "").match(streetPattern);
    const address = validAddressCandidate(match?.[0] || "");
    if (address) return address;
  }
  return "";
}

function extractMatrikkelFromProject(project) {
  const attachmentText = (project.files || [])
    .flatMap((file) => [file.title, file.name, file.filename])
    .filter(Boolean)
    .map(stripMarkup)
    .join(" | ");
  const sourceText = [project.caseTitle, project.shortFacts, project.documentTitle, project.address, project.description, attachmentText]
    .filter(Boolean)
    .join(" | ");
  const match = sourceText.match(/\bgnr\.?\s*(\d+)\s*(?:,\s*|\s+)bnr\.?\s*(\d+)/i);
  if (match) {
    return `${match[1]}/${match[2]}/0/0`;
  }
  const slashMatch = sourceText.match(/\b(?:gbnr\s*)?(\d+)\s*\/\s*(\d+)\b/i);
  if (slashMatch) {
    return `${slashMatch[1]}/${slashMatch[2]}/0/0`;
  }
  return project.matrikkel || "";
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:oslash|ouml|aring|aelig|ae|o|a);/gi, (entity) => ({
      "&oslash;": "ø", "&ouml;": "ö", "&aring;": "å", "&aelig;": "æ", "&ae;": "æ", "&o;": "ø", "&a;": "å",
    }[entity.toLowerCase()] || entity))
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveMissingMapPoints(projects) {
  const sourceProjects = projects.map((project) => state.projects.find((item) => item.id === project.id) || project);
  const candidates = sourceProjects.filter((project) => !project.hasMapPoint && hasMapLookupValue(project));
  if (!candidates.length) return false;

  let changed = false;
  // Hold Kartverket-belastningen kontrollert når en region har mange saker.
  // Kommuneankeret vises umiddelbart, mens eksakte treff erstatter det i puljer.
  for (let index = 0; index < candidates.length; index += 16) {
    const batch = candidates.slice(index, index + 16);
    const results = await Promise.all(batch.map((project) => geocodeProject(project)));
    changed = results.some(Boolean) || changed;
  }
  return changed;
}

function hasMapLookupValue(project) {
  return Boolean(extractAddressFromProject(project) || parseMatrikkel(extractMatrikkelFromProject(project)));
}

async function geocodeProject(project) {
  const queries = mapLookupQueries(project);
  if (!queries.length) return false;

  // Adresse har førsteprioritet. Matrikkel brukes bare dersom adressen ikke
  // gir treff, eller dersom adressen ikke finnes i prosjektet.
  for (const query of queries) {
    const cacheKey = JSON.stringify(query);
    if (state.mapGeocodeCache.has(cacheKey)) {
      const cachedResult = state.mapGeocodeCache.get(cacheKey);
      if (cachedResult && applyGeocodeResult(project, cachedResult)) return true;
      continue;
    }

    try {
      const endpoint = query.kind === "property" ? "/api/property-geocode" : "/api/geocode";
      const params = query.kind === "property"
        ? { ...query, utkoordsys: "4258" }
        : { ...query, treffPerSide: "1", utkoordsys: "4258", filtrer: "adresser.representasjonspunkt" };
      delete params.kind;
      const url = `${endpoint}?${new URLSearchParams(params)}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Kartverket ${response.status}`);
      const payload = await response.json();
      const address = payload.adresser?.[0];
      const property = payload.features?.[0];
      const point = query.kind === "property"
        ? { lat: property?.geometry?.coordinates?.[1], lon: property?.geometry?.coordinates?.[0] }
        : address?.representasjonspunkt;
      const result = point?.lat && point?.lon ? {
        lat: Number(point.lat),
        lon: Number(point.lon),
        address: address?.adressetekst || "",
        label: query.kind === "property" ? "Kartverket Eiendom-API" : "Kartverket Adresse-API",
      } : null;
      state.mapGeocodeCache.set(cacheKey, result);
      if (result && applyGeocodeResult(project, result)) return true;
    } catch (error) {
      state.mapGeocodeCache.set(cacheKey, null);
      console.warn("Kunne ikke plassere prosjektet i kartet", project.id, error);
    }
  }
  return false;
}

function mapLookupQueries(project) {
  const municipalityName = normalizeMunicipalityName(project.municipality);
  const municipalityNumber = municipalityNumbers[municipalityName];
  const address = extractAddressFromProject(project);
  const queries = [];
  if (address) {
    const variants = new Set([
      address,
      address.replace(/svegen\b/iu, "vegen"),
      address.replace(/sveien\b/iu, "veien"),
      address.replace(/vegen\b/iu, "veien"),
      address.replace(/veien\b/iu, "vegen"),
    ]);
    for (const variant of variants) {
      queries.push({
        kind: "address",
        sok: `${variant} ${municipalityName}`.trim(),
        kommunenummer: municipalityNumber || "",
      });
    }
  }
  const matrikkel = parseMatrikkel(extractMatrikkelFromProject(project));
  if (matrikkel && municipalityNumber) {
    const query = {
      kind: "property",
      kommunenummer: municipalityNumber,
      gardsnummer: matrikkel.gnr,
      bruksnummer: matrikkel.bnr,
    };
    if (matrikkel.fnr) query.festenummer = matrikkel.fnr;
    if (matrikkel.unr) query.seksjonsnummer = matrikkel.unr;
    queries.push(query);
  }
  return queries;
}

function validAddressCandidate(value) {
  const text = String(value || "")
    .replace(/^[-–—\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /\b(gbnr|gnr|bnr|matrikkel|s\.?nr\.?|seksjonsnummer|tiltak på|godkjent|søknad om|løyve|rammeløyve)\b/i.test(text)) return "";
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
    let handledMarkerSelect = false;
    const handleMarkerSelect = (event) => {
      if (handledMarkerSelect) return;
      handledMarkerSelect = true;
      if (window.L?.DomEvent && event.originalEvent) {
        L.DomEvent.stop(event.originalEvent);
        event.originalEvent.preventDefault?.();
        event.originalEvent.stopPropagation?.();
        event.originalEvent.stopImmediatePropagation?.();
      }
      options.onMarkerClick?.(project);
      setTimeout(() => {
        handledMarkerSelect = false;
      }, 300);
    };
    if (options.onMarkerClick) {
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
      if (options.onMarkerClick) {
        markerElement.addEventListener("click", (event) => {
          handleMarkerSelect({ originalEvent: event });
        }, true);
      }
    }
    if (isSelected) marker.bringToFront();
    return marker;
  });
}

function bindFullMapProjectSelection() {
  const canvas = document.querySelector("#fullMapCanvas");
  if (!canvas || !state.fullMap) return;
  canvas.addEventListener("click", (event) => {
    // Bakgrunnsklikk etter panorering skal aldri åpne et prosjekt. Selve
    // markøren har egen klikkbehandling i addProjectMarkers().
    if (!event.target.closest(".project-map-marker")) return;
  }, true);
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
  const typeText = shortTrade(project.projectTypeText || project.projectTypes?.join("; ") || project.tradeRelevance || project.status || "Ukjent tiltak");
  const fallback = project.isMunicipalityFallbackPoint ? " | Ikke bekreftet lokasjon" : "";
  return `${project.place || project.address || displayGeographyName(project.municipality) || "Ukjent adresse"} | ${typeText}${fallback}`;
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
    maxZoom: 18,
    updateWhenIdle: true,
    keepBuffer: options.compact ? 1 : 4,
    detectRetina: false,
    className: "byggradar-map-tiles",
  };
  // Bruk OpenStreetMap standard veikart som hovedkart. ArcGIS beholdes som reserve.
  const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    ...tileOptions,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });

  let fallbackStarted = false;

  layer.on("tileerror", (event) => {
    event.tile.classList.add("tile-load-error");
    if (fallbackStarted) return;
    fallbackStarted = true;
    const fallbackLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      ...tileOptions,
      attribution: '&copy; Esri, HERE, Garmin, Intermap, USGS, METI/NASA',
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
      ${project.contact?.email && emailHref ? `<a class="primary-action generated-mail-link" href="${escapeHtml(emailHref)}" title="Vil du sende mail?" aria-label="Vil du sende mail? E-post til ${escapeHtml(project.contact.email)}">E-post</a>` : ""}
    </div>

    <dl class="facts">
      <div><dt>Fag/tema</dt><dd>${escapeHtml(project.tradeRelevance || "Ikke tolket")}</dd></div>
      <div><dt>Dato/tidspunkt</dt><dd>${escapeHtml(formatNorwegianDate(project.date) || "Ikke oppgitt")}</dd></div>
      <div><dt>Matrikkel</dt><dd>${escapeHtml(project.matrikkel || "Ikke oppgitt")}</dd></div>
      <div><dt>Markedsområde</dt><dd>${escapeHtml(project.marketArea)}</dd></div>
    </dl>

    <section class="contact-box">
      <h2>Kontakt</h2>
      ${renderProjectContact(project)}
    </section>

    <section class="description">
      <h2>Prosjektinfo</h2>
      <p>${escapeHtml(project.description)}</p>
    </section>
  `;
}

function filterProjects() {
  const trade = normalize(state.trade);
  const area = normalize(state.area);
  // A typed search term must filter the projects even when a region is already selected.
  // The active region is only the fallback when the area field is empty.
  const textRegion = (area && findRegionByText(state.area)) || (!area ? state.activeRegion : null);

  return state.projects
    .filter((project) => !trade || tradeMatches(project, trade))
    .filter((project) => !textRegion || projectMatchesRegion(project, textRegion))
    .filter((project) => textRegion || !area || searchTextMatches(project.searchText, area))
    .sort(deliverySort);
}

function searchTextMatches(searchText, query) {
  const text = normalize(searchText);
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return terms.length > 0 && terms.every((term) => text.includes(term));
}

function standardDeliveryProjects() {
  const ranked = state.filtered.slice();
  if (ranked.length <= standardProjectLimit) return phaseBalancedSelection(ranked, ranked.length);

  // Når kunden har valgt kommune, skal de 200 nærmeste prosjektene være
  // standardleveransen. Kommunebalanseringen brukes ellers for å sikre bred
  // regional dekning når kunden ikke har valgt et lokalt origo.
  if (state.customerMunicipality) return phaseBalancedSelection(ranked, standardProjectLimit);

  // Fordel kartgrunnlaget mellom kommunene. Prosjektene står fortsatt i
  // aktualitetsrekkefølge internt i hver kommune, men én stor kommune skal
  // ikke fylle hele 200-grensen og gjøre Øygarden, Askøy, Osterøy med flere
  // nesten usynlige i kartet.
  const groups = new Map();
  ranked.forEach((project) => {
    const municipality = normalizeMunicipalityName(project.municipality) || "ukjent kommune";
    if (!groups.has(municipality)) groups.set(municipality, []);
    groups.get(municipality).push(project);
  });

  const balanced = [];
  let offset = 0;
  let added = true;
  while (balanced.length < standardProjectLimit && added) {
    added = false;
    for (const projects of groups.values()) {
      const project = projects[offset];
      if (!project) continue;
      balanced.push(project);
      added = true;
      if (balanced.length >= standardProjectLimit) break;
    }
    offset += 1;
  }
  return phaseBalancedSelection(balanced, standardProjectLimit);
}

function phaseBalancedSelection(projects, limit) {
  const phaseOne = [];
  const phaseTwo = [];
  const other = [];
  projects.forEach((project) => {
    const phase = projectPhaseRank(project);
    if (phase === 0) phaseTwo.push(project);
    else if (phase === 1) phaseOne.push(project);
    else other.push(project);
  });

  const targetPerPhase = Math.floor(limit / 2);
  const selected = [
    ...phaseTwo.slice(0, targetPerPhase),
    ...phaseOne.slice(0, targetPerPhase),
  ];
  const remaining = [
    ...phaseTwo.slice(targetPerPhase),
    ...phaseOne.slice(targetPerPhase),
    ...other,
  ];
  return [...selected, ...remaining].slice(0, limit);
}

function visibleDeliveryProjects() {
  const limit = Math.min(state.visibleCount, state.filtered.length);
  const visible = phaseBalancedSelection(state.filtered, limit);
  const selected = state.selected && state.filtered.find((project) => project.id === state.selected.id);

  // Kartet viser alle filtrerte prosjekter. Hvis et valgt prosjekt ligger
  // utenfor de første 200, må det likevel inn i listen slik at kortet kan
  // åpnes og brukeren får se full prosjektinformasjon.
  if (selected && !visible.some((project) => project.id === selected.id)) {
    visible.splice(Math.max(visible.length - 1, 0), 1, selected);
  }

  return visible.sort(markedFirstSort);
}

function weeklyDeliveryBatch() {
  return standardDeliveryProjects().slice(0, weeklyDeliveryCount);
}

function retiringDeliveryBatch() {
  return standardDeliveryProjects().slice(-weeklyDeliveryCount);
}

function deliverySort(a, b) {
  // Fase 2 prioriteres alltid foran fase 1. Innenfor hver fase rangeres
  // prosjektene videre etter kundens geografiske og kommersielle behov.
  const phaseDelta = projectPhaseRank(a) - projectPhaseRank(b);
  if (phaseDelta !== 0) return phaseDelta;

  // Rangeringen skal vise prosjektene som er nærmest faktisk oppstart først.
  // Dokumentdato brukes bare som siste tie-breaker, slik at en ny postliste-
  // linje ikke automatisk skyver et mer aktuelt prosjekt nedover.
  if (state.customerMunicipality) {
    const distanceDelta = customerProjectDistance(a) - customerProjectDistance(b);
    if (distanceDelta !== 0) return distanceDelta;
  }
  return b.attractivenessScore - a.attractivenessScore ||
    (stageRank[normalize(a.status)] || 20) - (stageRank[normalize(b.status)] || 20) ||
    parsedDateMs(b.deadline || b.date) - parsedDateMs(a.deadline || a.date) ||
    b.score - a.score ||
    Number(b.hasMapPoint) - Number(a.hasMapPoint) ||
    String(b.date).localeCompare(String(a.date));
}

function projectPhaseRank(project) {
  const phase = normalize(project?.phaseLabel || project?.phase || "");
  if (phase === "fase 2") return 0;
  if (phase === "fase 1") return 1;
  return 2;
}

function customerProjectDistance(project) {
  const origin = municipalityMapAnchors[state.customerMunicipality];
  if (!origin) return Infinity;
  const projectPoint = Number.isFinite(project.lat) && Number.isFinite(project.lon) && project.lat !== 0 && project.lon !== 0
    ? { lat: project.lat, lon: project.lon }
    : municipalityMapAnchor(project.municipality || project.place || project.marketArea);
  if (!projectPoint) return Infinity;
  return distanceKm(origin.lat, origin.lon, projectPoint.lat, projectPoint.lon);
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

  score += actualityScore(project.deadline || project.date);

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

function actualityScore(value) {
  const dateMs = parsedDateMs(value);
  if (!dateMs) return 0;

  const daysUntilStart = Math.round((dateMs - startOfDayMs(new Date())) / 86400000);
  if (daysUntilStart < -365) return 4;
  if (daysUntilStart < -90) return 12;
  if (daysUntilStart < 0) return 30;
  if (daysUntilStart <= 30) return 110;
  if (daysUntilStart <= 90) return 92;
  if (daysUntilStart <= 180) return 72;
  if (daysUntilStart <= 365) return 48;
  if (daysUntilStart <= 730) return 24;
  return 8;
}

function projectActors(project, contactProject) {
  const rawActors = [
    project.responsibleApplicant,
    project.responsibleApplicantName,
    project.applicant,
    project.applicantName,
    project.applicantCompany,
    project.developer,
    project.owner,
    project.contactName,
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

function assessContactQuality(contact, actors, hasAnonymizedActor, authorityContact) {
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
  if (authorityContact) {
    return {
      level: "authority",
      label: "Kun kommunal kontakt funnet",
      message: "Kommunens kontakt er vist som informasjonskilde. Ansvarlig søker eller tiltakshaver er ikke identifisert.",
      needsExternalLookup: true,
    };
  }
  if (actors.length) {
    return {
      level: "missing",
      label: "Kontakt må finnes",
      message: "Aktør er identifisert, men telefon/e-post mangler. Søk i åpne kontaktkilder.",
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
    authority: "kun kommunal kontakt",
    unknown: "kontakt uklar",
  };
  return labels[contactQuality.level] || "kontakt uklar";
}

function selectProjectContacts(project, contactProject) {
  const candidates = uniqueByKey([
    contactProject?.displayContact,
    ...(contactProject?.contacts || []),
    {
      name: project.contactName || "",
      phone: project.contactPhone || "",
      email: project.contactEmail || "",
      website: project.contactWebsite || "",
    },
  ].filter((contact) => contact && (contact.name || contact.phone || contact.email)), (contact) => normalize(`${contact.name}|${contact.email}|${contact.phone}`));

  const authority = candidates.find((contact) => isMunicipalContact(contact, project)) || null;
  const primary = candidates.find((contact) => !isMunicipalContact(contact, project)) || null;
  const role = primary ? contactRoleForProject(primary, project) : authority ? "authority" : "unknown";
  return { primary, authority, candidates, role };
}

function isMunicipalContact(contact, project = {}) {
  const name = normalize(contact?.name || contact?.queryName || "");
  const email = normalize(contact?.email || "");
  const website = normalize(contact?.website || "");
  const organizationForm = normalize(contact?.organizationForm || "");
  const municipality = normalize(project.municipality || "").replace(/[^a-z0-9]+/g, "");
  const emailDomain = email.split("@")[1] || "";
  const municipalityDomain = municipality && emailDomain.includes(municipality);

  return organizationForm === "komm" ||
    /\b(kommune|herad|fylkeskommune)\b/.test(name) ||
    /\.(kommune|herad)\.no$/.test(emailDomain) ||
    municipalityDomain && /^(post|postmottak|byggesak|servicetorg|info)@/.test(email) ||
    /\.(kommune|herad)\.no/.test(website);
}

function contactRoleForProject(contact, project) {
  const text = normalize([
    contact?.role,
    contact?.title,
    project.responsibleApplicant,
    project.responsibleApplicantName,
    project.applicant,
    project.applicantName,
    project.applicantCompany,
  ].filter(Boolean).join(" "));
  if (/ansvarlig soker|ansvarleg sokjar|soker/.test(text)) return "responsible_applicant";
  if (/tiltakshaver|utvikler|developer|eier|owner/.test(text)) return "applicant";
  return "company";
}

function contactRoleLabel(role) {
  return {
    responsible_applicant: "Ansvarlig søker",
    applicant: "Tiltakshaver/utvikler",
    company: "Virksomhetskontakt",
    authority: "Kommunens kontakt",
  }[role] || "Kontakt";
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
    { label: "AI-søk", url: `https://www.google.com/search?udm=50&q=${query}+telefonnummer+til+aktør+telefon` },
    { label: "Proff", url: `https://www.proff.no/s%C3%B8k-etter-firmanavn?q=${query}` },
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

function meaningfulProjectText(value) {
  return Boolean(value && !/^(ukjent|ukjent tiltak|mulig prosjekt|ikke tolket)$/i.test(String(value).trim()));
}

function projectClassificationText(project, title = "") {
  const attachments = (project.files || [])
    .flatMap((file) => [file.title, file.name, file.filename])
    .filter(Boolean)
    .map(fileDisplayTitle)
    .join(" ");
  return [
    title,
    project.title,
    project.shortFacts,
    project.caseTitle,
    project.documentTitle,
    project.description,
    project.address,
    attachments,
  ].filter(Boolean).join(" ");
}

function inferProjectTypes(value) {
  const text = normalize(value);
  const types = [];
  const add = (label, pattern) => {
    if (pattern.test(text) && !types.includes(label)) types.push(label);
  };

  add("Nybygg", /\b(nybygg|oppforing|ny bustad|ny bolig|nytt bygg|ny fritidsbustad|ny fritidsbolig)\b/);
  add("Tilbygg/påbygg", /\b(tilbygg|tilbygging|pabygg|utviding|utvidelse)\b/);
  add("Ombygging/rehabilitering", /\b(ombygg|rehabiliter|oppgradering|modernisering|istandsetting)\b/);
  add("Bruksendring", /\b(bruksendring|bruksendring|endring av bruk)\b/);
  add("Riving", /\b(riving|rive|rivning)\b/);
  add("Bolig", /\b(bolig|bustad|bustadhus|enebolig|tomannsbolig|leilighet|rekkehus)\b/);
  add("Fritidsbolig/hytte", /\b(fritidsbolig|fritidsbustad|hytte|hytter)\b/);
  add("Garasje/bod", /\b(garasje|garasj|bod|uthus|carport)\b/);
  add("Næring/offentlig", /\b(naering|naeringsbygg|kontor|lager|butikk|forretningsbygg|skule|skole|barnehage|sykehjem|offentlig)\b/);
  add("Brygge/kaianlegg", /\b(brygge|bryggje|kai|kaianlegg|flytebrygge|naust|smabathavn)\b/);
  add("Terrengarbeid", /\b(terreng|planering|forstotningsmur|stottemur|sprenging|fylling|landskap)\b/);
  add("Veg/infrastruktur", /\b(veg|vei|veganlegg|infrastruktur|avkjorsel|avkoyrsle|vann- og avlop|va-anlegg|bekkelop)\b/);
  add("Tekniske installasjoner", /\b(skorstein|vedkomfyr|sanitaer|ventilasjon|elektro|solcelle|transformator|ladestasjon)\b/);
  add("Fradeling/oppmåling", /\b(fradeling|matrikkeleining|matrikkelforing|oppmalingsforretning|tomtedeling)\b/);
  return types;
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
  const cleanMunicipality = displayGeographyName(municipality);
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
  const normalizedStatus = status.replace(/saksbehandling pågår/i, "Under behandling").trim();
  return normalizedStatus ? normalizedStatus.charAt(0).toLocaleUpperCase("nb-NO") + normalizedStatus.slice(1) : "Status ukjent";
}

function classifyProjectPhase(status) {
  const normalized = normalize(status);
  if (phaseTwoStatuses.has(normalized)) return "Fase 2";
  if (phaseOneStatuses.has(normalized)) return "Fase 1";
  if (/igangsetting|tillatelse|rammetillatelse|kontrakt|aktiv konkurranse|anbud/.test(normalized)) return "Fase 2";
  return "Fase 1";
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
  if (project.contactRole === "authority" || !project.contact) return "";
  const email = String(project.contact?.email || "").trim();
  if (!email) return "";
  const subject = `Vedr. prosjektet i ${projectMailPlace(project)}`;
  const body = projectMailBody(project);
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function projectMailBody(project) {
  const place = projectMailPlace(project);
  const municipality = displayGeographyName(project.municipality || project.marketArea || "");

  const lines = [
    "Hei,",
    "",
    `Vi har fått med oss prosjektet i ${place}${municipality ? ` i ${municipality}` : ""}, og dette ser ut som et prosjekt som kan passe oss godt.`,
    "",
    "Vi har kapasitet fremover og ønsker derfor gjerne litt mer informasjon om prosjektet, slik at vi kan få tilby våre tjenester.",
    "",
    "Dersom det passer, tar jeg gjerne en befaring for å se nærmere på prosjektet.",
  ];
  lines.push("", "På forhånd takk for tilbakemelding.", "Vennlig hilsen");

  return lines.join("\n");
}

function projectMailPlace(project) {
  return compactText(project.place || project.address || project.municipality || "aktuelt prosjekt");
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function saveFilters() {
  writeSavedValue(savedFiltersKey, JSON.stringify({
    trade: state.trade,
    area: state.area,
    customerMunicipality: state.customerMunicipality,
    regionId: state.activeRegion?.id || "",
    regionKey: state.regionKey,
  }));
}

function updateCustomerMunicipalityOptions() {
  const select = document.querySelector("#customerMunicipality");
  if (!select) return;
  const region = locationRegions.find((candidate) => candidate.id === state.regionKey) || locationRegions[0];
  const municipalities = region?.municipalities || [];
  const selected = municipalities.some((municipality) => normalizeMunicipalityName(municipality) === state.customerMunicipality)
    ? state.customerMunicipality
    : "";
  if (selected !== state.customerMunicipality) state.customerMunicipality = selected;
  select.innerHTML = [
    `<option value="">Velg kommune</option>`,
    ...municipalities.map((municipality) => {
      const value = normalizeMunicipalityName(municipality);
      return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(municipality)}</option>`;
    }),
  ].join("");
  select.value = selected;
}

function restoreSavedFilters() {
  try {
    const saved = JSON.parse(readSavedValue(savedFiltersKey) || "{}");
    const savedTrade = normalize(saved.trade || "");
    state.trade = tradePresets.includes(savedTrade) ? savedTrade : "";
    state.area = /^min posisjon|^region ved min posisjon/i.test(saved.area || "") ? "" : saved.area || "";
    state.customerMunicipality = saved.customerMunicipality || "";
    state.regionKey = regionDataPaths[saved.regionKey] ? saved.regionKey : "bergensregionen";
    state.activeRegion = locationRegions.find((region) => region.id === state.regionKey) || findRegionByText(state.area);
    document.querySelector("#tradeInput").value = state.trade;
    document.querySelector("#areaInput").value = state.area;
    updateCustomerMunicipalityOptions();
  } catch {
    state.trade = "";
    state.area = "";
    state.customerMunicipality = "";
    state.regionKey = "bergensregionen";
    state.activeRegion = locationRegions.find((region) => region.id === state.regionKey) || null;
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

function displayGeographyName(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return `${text.charAt(0).toLocaleUpperCase("nb-NO")}${text.slice(1)}`;
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
  if (state.showMap) renderMap();
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
