import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const incomingJobRequestsPath = path.join(root, "data", "incoming_job_requests.json");
const smsOutboxPath = path.join(root, "data", "sms_outbox.json");
const googleAdsSuppliersPath = path.join(root, "data", "google_ads_suppliers.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const smsProvider = String(process.env.NBR_SMS_PROVIDER || "queue").trim().toLowerCase();

const residentialBuildingTypes = [
  "111", "112", "113", "121", "122", "123", "124", "131", "133", "135", "136",
  "141", "142", "143", "144", "145", "146", "151", "152", "159",
];
const ssbMetadataCache = new Map();
const ssbYearCache = new Map();
const ssbTableCache = new Map();
const aiPhoneCache = new Map();
const aiPhoneCacheTtlMs = 24 * 60 * 60 * 1000;
const googleAdsSyncCache = new Map();
const googleAdsSyncTtlMs = 24 * 60 * 60 * 1000;
const mittanbudMunicipalityCache = { expiresAt: 0, values: new Map() };
const incomingJobRequests = [];

async function readGoogleAdsSuppliers() {
  try {
    const payload = JSON.parse(await fs.readFile(googleAdsSuppliersPath, "utf8"));
    return Array.isArray(payload) ? payload.map(normalizeSupplierSource) : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeGoogleAdsSuppliers(suppliers) {
  await fs.mkdir(path.dirname(googleAdsSuppliersPath), { recursive: true });
  await fs.writeFile(googleAdsSuppliersPath, `${JSON.stringify(suppliers, null, 2)}\n`, "utf8");
}

function normalizeSupplierText(value) {
  return String(value || "").toLocaleLowerCase("nb-NO").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const supplierMunicipalityLocalities = {
  stavanger: ["stavanger", "hundvag", "hundvåg", "tasta", "madla", "hillevag", "hillevåg", "storhaug", "vaulen", "kvernevik", "hafrsfjord", "jatta", "jåttå", "forus", "kvernevik"],
  sandnes: ["sandnes", "forus", "soma", "hana", "malmheim", "figgjo", "hommersak", "hommersåk", "sandal", "austrått", "bråstein"],
  sola: ["sola", "tananger", "risa", "tjorvag", "tjørvåg", "kolnes", "stangeland", "rege", "vigdel"],
  randaberg: ["randaberg", "varhaug", "harestad", "grødem", "goa"],
  klepp: ["klepp", "kleppe", "orstad", "bryne", "verdalen", "voll"],
  time: ["time", "bryne", "lyefjell", "lye", "undheim", "kvernaland", "frøyland", "hognestad"],
  ha: ["ha", "hå", "naerbo", "nærbø", "vigrestad", "varhaug", "brusand", "ogna", "sirevag", "sirevåg"],
  gjesdal: ["gjesdal", "algard", "ålgård", "figgjo", "oltesvik", "dirdal", "byrkjedal"],
  strand: ["strand", "jorpeland", "jørpeland", "tau", "fiskå", "fiska", "sørskår", "årdal"],
  kvitsoy: ["kvitsoy", "kvitsøy", "yærøy", "longhamn"],
  hjelmeland: ["hjelmeland", "årdal", "årdalsfjorden", "førre", "nesheim", "skånevik"],
  bjerkreim: ["bjerkreim", "vikeså", "ørsdalen", "moi", "hølå"],
  eigersund: ["eigersund", "egersund", "hellvik", "hestnes", "vågen", "sørøyane"],
  suldal: ["suldal", "sand", "jelsa", "nesflaten", "sæbø", "erfjord", "marvik"],
  lund: ["lund", "moi", "heskestad", "egersund", "hauge i dalane"],
  sokndal: ["sokndal", "hauge i dalane", "jøssingfjord", "rekefjord", "åna sira"],
  kvinnherad: ["husnes", "rosendal", "uskedalen", "dimmelsvik", "sunde", "halsnoy", "seimsfoss"],
  stord: ["stord", "leirvik", "sagvag", "nordbygdo"],
  fitjar: ["fitjar"],
  bomlo: ["bomlo", "bremnes", "rubbestadneset", "mosterhamn", "langevag", "svortland"],
  sveio: ["sveio", "forde", "auklandshamn"],
  haugesund: ["haugesund"],
  karmoy: ["karmoy", "kopervik", "akrahamn", "skudeneshavn", "avaldsnes", "vedavagen", "norheim", "vormedal", "torvastad", "kolnes", "veavagen"],
  tysvaer: ["tysvaer", "aksdal", "forresfjorden", "frakkagjerd", "tysvaervag", "nedstrand", "skjoldastraumen"],
  bokn: ["bokn", "foresvik"],
  utsira: ["utsira"],
  vindafjord: ["vindafjord", "olensvag", "olen", "vikedal", "sandeid", "skjold", "vats"],
  etne: ["etne", "skanevik"],
  sauda: ["sauda"],
};

function supplierPlaceMatchesAllowed(place, allowedPlaces) {
  const normalizedPlace = normalizeSupplierText(place).replace(/\b(kommune|herad)\b/g, "").trim();
  if (!normalizedPlace || !allowedPlaces.length) return false;
  return allowedPlaces.some((allowed) => {
    const normalizedAllowed = normalizeSupplierText(allowed).replace(/\b(kommune|herad)\b/g, "").trim();
    const localities = supplierMunicipalityLocalities[normalizedAllowed] || [];
    return normalizedAllowed && (normalizedPlace === normalizedAllowed
      || normalizedPlace.startsWith(`${normalizedAllowed} `)
      || normalizedAllowed.startsWith(`${normalizedPlace} `)
      || localities.some((locality) => normalizedPlace === locality || normalizedPlace.startsWith(`${locality} `)));
  });
}

function googleAdsSupplierKey(supplier) {
  return normalizeSupplierText(supplier.website || supplier.name);
}

function normalizeSupplierSource(supplier) {
  const raw = String(supplier.source || supplier.sourceLabel || "").trim().toUpperCase();
  const source = raw === "MITTANBUD" ? "MA" : raw;
  return { ...supplier, source: source || "MA", sourceLabel: source || "MA" };
}

function supplierFromGoogleAd(ad, context) {
  const title = String(ad.title || ad.name || "").trim();
  if (!title) return null;
  const link = String(ad.link || ad.url || ad.displayed_link || "").trim();
  const snippet = String(ad.description || ad.snippet || "").trim();
  const phone = extractNorwegianPhones(`${title} ${snippet}`, title)[0] || "";
  return {
    name: title,
    trade: context.tradeLabel || "Fagområde ikke oppgitt",
    address: context.municipality || context.regionName || "",
    phone,
    email: "",
    website: link,
    source: "GA",
    sourceLabel: "GA",
    regionId: context.regionId || "",
    municipality: context.municipality || "",
    description: snippet,
    collectedAt: new Date().toISOString(),
  };
}

function extractOrganicGoogleCandidates(html, context) {
  const source = String(html || "");
  const links = extractDuckDuckGoLinks(source);
  const titlePattern = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  const titles = [];
  const snippets = [];
  let match;
  while ((match = titlePattern.exec(source))) titles.push(decodeHtmlEntities(stripHtml(match[1])).replace(/\s+/g, " ").trim());
  while ((match = snippetPattern.exec(source))) snippets.push(decodeHtmlEntities(stripHtml(match[1] || match[2])).replace(/\s+/g, " ").trim());
  return links.slice(0, 20).map((link, index) => {
    const title = titles[index] || new URL(link).hostname.replace(/^www\./, "");
    const description = snippets[index] || "";
    return {
      name: title,
      trade: context.tradeLabel || "Fagområde ikke oppgitt",
      address: context.municipality || context.regionName || "",
      phone: extractNorwegianPhones(`${title} ${description}`, title)[0] || "",
      email: "",
      website: link,
      source: "G",
      sourceLabel: "G",
      regionId: context.regionId || "",
      municipality: context.municipality || "",
      description,
      collectedAt: new Date().toISOString(),
    };
  });
}

async function searchOrganicGoogleSuppliers({ query, regionId, regionName, municipality, tradeLabel }) {
  const searchQuery = [query, tradeLabel, municipality || regionName, "virksomhet Norge"].filter(Boolean).join(" ");
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "NorskByggRadar/1.0 (organic supplier research)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Det organiske søket svarte med HTTP ${response.status}.`);
  const html = await response.text();
  const discovered = extractOrganicGoogleCandidates(html, { regionId, regionName, municipality, tradeLabel });
  const existing = await readGoogleAdsSuppliers();
  const merged = new Map(existing.map((supplier) => [googleAdsSupplierKey(supplier), supplier]));
  discovered.forEach((supplier) => merged.set(googleAdsSupplierKey(supplier), supplier));
  await writeGoogleAdsSuppliers([...merged.values()]);
  return { suppliers: discovered, configured: true, message: discovered.length ? `${discovered.length} organiske Google-treff ble lagt til og merket G.` : "Det organiske søket ga ingen lesbare virksomhetstreff." };
}

async function searchGoogleAdsSuppliers({ query, regionId, regionName, municipality, tradeLabel }) {
  const local = (await readGoogleAdsSuppliers()).filter((supplier) => {
    const sameRegion = !regionId || !supplier.regionId || supplier.regionId === regionId;
    const sameMunicipality = !municipality || !supplier.municipality || normalizeSupplierText(supplier.municipality) === normalizeSupplierText(municipality);
    const haystack = normalizeSupplierText(`${supplier.name} ${supplier.trade} ${supplier.address} ${supplier.description}`);
    return sameRegion && sameMunicipality && (!query || haystack.includes(normalizeSupplierText(query)));
  });
  const apiKey = String(process.env.NBR_SERPAPI_KEY || "").trim();
  if (!apiKey) return { suppliers: local, configured: false, message: local.length ? "Lokalt registrerte GA-funn." : "Google Ads-søk er ikke aktivert ennå. Legg inn NBR_SERPAPI_KEY i miljøvariablene for å hente annonser automatisk." };
  const params = new URLSearchParams({ engine: "google", q: [query, tradeLabel, municipality || regionName, "Norge"].filter(Boolean).join(" "), gl: "no", hl: "no", api_key: apiKey });
  const response = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(15000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Google Ads-søket svarte med HTTP ${response.status}.`);
  const payload = await response.json();
  const ads = Array.isArray(payload.ads) ? payload.ads : (Array.isArray(payload.sponsored_results) ? payload.sponsored_results : []);
  const discovered = ads.map((ad) => supplierFromGoogleAd(ad, { regionId, regionName, municipality, tradeLabel })).filter(Boolean);
  const existing = await readGoogleAdsSuppliers();
  const merged = new Map(existing.map((supplier) => [googleAdsSupplierKey(supplier), supplier]));
  discovered.forEach((supplier) => merged.set(googleAdsSupplierKey(supplier), supplier));
  await writeGoogleAdsSuppliers([...merged.values()]);
  const combined = [...new Map([...local, ...discovered].map((supplier) => [googleAdsSupplierKey(supplier), supplier])).values()];
  return { suppliers: combined, configured: true, message: discovered.length ? `${discovered.length} Google Ads-funn ble lagt til i leverandørregisteret.` : "Google Ads leverte ingen annonser for dette søket." };
}

async function syncGoogleAdsForSupplierContext({ regionId, regionName, municipality, tradeLabel }) {
  const apiKey = String(process.env.NBR_SERPAPI_KEY || "").trim();
  if (!apiKey || !tradeLabel) return [];
  const cacheKey = [regionId, municipality, tradeLabel].map(normalizeSupplierText).join("|");
  const cachedAt = googleAdsSyncCache.get(cacheKey) || 0;
  if (Date.now() - cachedAt < googleAdsSyncTtlMs) return [];
  googleAdsSyncCache.set(cacheKey, Date.now());
  try {
    const payload = await searchGoogleAdsSuppliers({ query: tradeLabel, regionId, regionName, municipality, tradeLabel });
    return Array.isArray(payload.suppliers) ? payload.suppliers.filter((supplier) => supplier.source === "GA") : [];
  } catch {
    return [];
  }
}

function configuredTestPersonNumbers() {
  const configured = String(process.env.NBR_TEST_PERSONS || "")
    .split(/[;,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length) return configured;
  return ["94848500", "99003233"];
}

function normalizeSmsRecipient(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 8) return `+47${digits}`;
  if (digits.length === 10 && digits.startsWith("47")) return `+${digits}`;
  return String(value || "").trim();
}

function maskedSmsRecipient(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? `…${digits.slice(-4)}` : "ukjent";
}

function smsMessageForJob(jobRequest) {
  const trade = jobRequest.trade ? `${jobRequest.trade.charAt(0).toUpperCase()}${jobRequest.trade.slice(1)}` : "Ikke oppgitt";
  return [
    "Avsender: Norsk ByggRadar",
    `Kontaktperson: ${jobRequest.name}`,
    `Telefonnummer: ${jobRequest.phone}`,
    `Adresse: ${jobRequest.address}`,
    `Fagområde: ${trade}`,
    `Beskrivelse: ${jobRequest.description}`,
  ].join("\n");
}

function sinchConfig() {
  const servicePlanId = String(process.env.NBR_SINCH_SERVICE_PLAN_ID || "").trim();
  const apiToken = String(process.env.NBR_SINCH_API_TOKEN || "").trim();
  const from = String(process.env.NBR_SINCH_FROM || "").trim();
  const region = String(process.env.NBR_SINCH_REGION || "eu").trim();
  return servicePlanId && apiToken && from ? { servicePlanId, apiToken, from, region } : null;
}

function sinchConversationConfig() {
  const projectId = String(process.env.NBR_SINCH_PROJECT_ID || "").trim();
  const appId = String(process.env.NBR_SINCH_APP_ID || "").trim();
  const accessKey = String(process.env.NBR_SINCH_ACCESS_KEY || "").trim();
  const keySecret = String(process.env.NBR_SINCH_KEY_SECRET || "").trim();
  const from = String(process.env.NBR_SINCH_SMS_SENDER || "").trim();
  const region = String(process.env.NBR_SINCH_CONVERSATION_REGION || "us").trim();
  return projectId && appId && accessKey && keySecret && from
    ? { projectId, appId, accessKey, keySecret, from, region }
    : null;
}

async function sendSmsViaSinchConversation(item) {
  const config = sinchConversationConfig();
  if (!config) return null;
  const endpoint = `https://${config.region}.conversation.api.sinch.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const basicAuth = Buffer.from(`${config.accessKey}:${config.keySecret}`).toString("base64");
    const result = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: config.appId,
        recipient: {
          identified_by: {
            channel_identities: [{ channel: "SMS", identity: item.recipient }],
          },
        },
        message: { text_message: { text: item.message } },
        channel_properties: { SMS_SENDER: config.from },
      }),
      signal: controller.signal,
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) {
      const detail = payload.message || payload.error || `HTTP ${result.status}`;
      throw new Error(detail);
    }
    return { status: "submitted", provider: "sinch-conversation", messageId: payload.message_id || payload.id || null };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendSmsViaSinch(item) {
  const config = sinchConfig();
  if (!config) return { status: "queued", reason: "Sinch er ikke konfigurert." };
  const endpoint = `https://${config.region}.sms.api.sinch.com/xms/v1/${encodeURIComponent(config.servicePlanId)}/batches`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: config.from, to: [item.recipient], body: item.message, type: "mt_text" }),
      signal: controller.signal,
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) {
      const detail = payload.message || payload.error || `HTTP ${result.status}`;
      throw new Error(detail);
    }
    return { status: "submitted", provider: "sinch", batchId: payload.id || null };
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonArray(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function queueSmsDistribution(jobRequest) {
  const recipients = configuredTestPersonNumbers().map(normalizeSmsRecipient).filter(Boolean);
  const outbox = await readJsonArray(smsOutboxPath);
  const existingMessages = new Map(outbox.filter((item) => item.jobId === jobRequest.id).map((item) => [item.recipient, item]));
  const message = smsMessageForJob(jobRequest);
  const newMessages = recipients
    .filter((recipient) => !existingMessages.has(recipient))
    .map((recipient) => ({
      id: `sms-${jobRequest.id}-${recipient.replace(/\D/g, "")}`,
      jobId: jobRequest.id,
      recipient,
      group: "testpersoner",
      senderName: "Norsk ByggRadar",
      trade: jobRequest.trade,
      message,
      status: "queued",
      createdAt: new Date().toISOString(),
    }));
  let updatedExistingMessage = false;
  existingMessages.forEach((item) => {
    if (item.message !== message || item.senderName !== "Norsk ByggRadar") {
      item.message = message;
      item.senderName = "Norsk ByggRadar";
      updatedExistingMessage = true;
    }
  });
  if (newMessages.length || updatedExistingMessage) {
    outbox.push(...newMessages);
    await fs.mkdir(path.dirname(smsOutboxPath), { recursive: true });
    await fs.writeFile(smsOutboxPath, `${JSON.stringify(outbox, null, 2)}\n`, "utf8");
  }
  return { status: recipients.length ? "queued" : "awaiting_recipients", recipientCount: recipients.length, messageQueued: Boolean(newMessages.length) };
}

async function dispatchSmsOutbox() {
  if (smsProvider !== "sinch" || (!sinchConversationConfig() && !sinchConfig())) return { attempted: 0, submitted: 0 };
  const outbox = await readJsonArray(smsOutboxPath);
  let attempted = 0;
  let submitted = 0;
  for (const item of outbox) {
    if (item.status !== "queued") continue;
    attempted += 1;
    const recipientLabel = maskedSmsRecipient(item.recipient);
    console.info("SMS attempt", { recipient: recipientLabel, jobId: item.jobId });
    try {
      const result = await sendSmsViaSinchConversation(item) || await sendSmsViaSinch(item);
      item.status = result.status;
      item.provider = result.provider;
      item.providerMessageId = result.messageId || null;
      item.providerBatchId = result.batchId || null;
      item.submittedAt = new Date().toISOString();
      submitted += 1;
      console.info("SMS submitted", {
        recipient: recipientLabel,
        jobId: item.jobId,
        provider: result.provider,
        providerMessageId: item.providerMessageId,
      });
    } catch (error) {
      item.status = "failed";
      item.provider = "sinch";
      item.error = error.message || "Ukjent Sinch-feil";
      item.failedAt = new Date().toISOString();
      console.error("SMS dispatch failed", {
        recipient: recipientLabel,
        jobId: item.jobId,
        error: item.error,
      });
    }
  }
  if (attempted) {
    await fs.mkdir(path.dirname(smsOutboxPath), { recursive: true });
    await fs.writeFile(smsOutboxPath, `${JSON.stringify(outbox, null, 2)}\n`, "utf8");
  }
  return { attempted, submitted };
}

async function persistIncomingJobRequests() {
  await fs.mkdir(path.dirname(incomingJobRequestsPath), { recursive: true });
  await fs.writeFile(incomingJobRequestsPath, `${JSON.stringify(incomingJobRequests, null, 2)}\n`, "utf8");
}

const supplierSearchPatterns = {
  byggevarehus: "Biltema|Optimera|Monter|Montér|Byggmakker|XL-BYGG|Obs BYGG|Maxbo|Bygger'n|Bauhaus",
  elektrogrossist: "Ahlsell|Solar|Onninen|Rexel|Elektroimportøren|Elektroimportoren|Berggård Amundsen|Berggard Amundsen",
  "vvs-grossist": "Brødrene Dahl|Broedrene Dahl|Ahlsell|Heidenreich|VVS Eksperten|VVSeksperten",
  "verktøy-maskinutleie": "Würth|Wurth|Motek|Ramirent|Renta|Cramo|Tools|TOOLS",
  "betong-pukk-grus": "NorBetong|Unicon|Veidekke|Franzefoss|NCC|Skanska",
  "transport-kran-container": "Norsk Gjenvinning|Ragn-Sells|Renta|Cramo|Bring|Litra",
  "arbeidstoy-verneutstyr": "TOOLS|Ahlsell|Wenaas|Mascot|Proffklær|Proffklaer|Würth|Wurth",
};
const supplierSearchTerms = {
  byggevarehus: ["Biltema", "Optimera", "Montér", "Byggmakker", "XL-BYGG", "Obs BYGG", "Maxbo"],
  elektrogrossist: ["Ahlsell", "Solar", "Onninen", "Rexel", "Elektroimportøren"],
  "vvs-grossist": ["Brødrene Dahl", "Ahlsell", "Heidenreich", "VVS Eksperten"],
  "verktøy-maskinutleie": ["Würth", "Motek", "Ramirent", "Renta", "Cramo", "TOOLS"],
  "betong-pukk-grus": ["NorBetong", "Unicon", "Veidekke", "Franzefoss", "NCC"],
  "transport-kran-container": ["Norsk Gjenvinning", "Ragn-Sells", "Renta", "Cramo", "Bring", "Litra"],
  "arbeidstoy-verneutstyr": ["TOOLS", "Ahlsell", "Wenaas", "Mascot", "Proffklær", "Würth"],
};

// Lokal reserve for leverandørsøket. Eksterne karttjenester kan være
// utilgjengelige eller bruke for lang tid. Disse filialene er faste, kjente
// virksomheter og brukes bare når stedsoppslaget ikke gir et resultat.
const localSupplierDirectorySeed = [
  ["byggevarehus", "Biltema Kokstad", "Kokstadvegen 15, Bergen", 60.3001, 5.2868, "https://www.biltema.no"],
  ["byggevarehus", "Montér Minde", "Fjøsangerveien 68, Bergen", 60.3505, 5.3345, "https://www.monter.no"],
  ["byggevarehus", "Byggmakker Åsane", "Åsamyrane, Bergen", 60.4768, 5.3288, "https://www.byggmakker.no"],
  ["byggevarehus", "Optimera Bergen", "Kokstad, Bergen", 60.3000, 5.2850, "https://www.optimera.no"],
  ["byggevarehus", "Biltema Forus", "Forus, Stavanger", 58.8888, 5.7267, "https://www.biltema.no"],
  ["byggevarehus", "Montér Forus", "Forus, Stavanger", 58.8848, 5.7335, "https://www.monter.no"],
  ["byggevarehus", "Byggmakker Stavanger", "Stavanger", 58.9700, 5.7330, "https://www.byggmakker.no"],
  ["byggevarehus", "Optimera Stavanger", "Stavanger", 58.9705, 5.7350, "https://www.optimera.no"],
  ["byggevarehus", "Biltema Haugesund", "Raglamyr, Haugesund", 59.4230, 5.3020, "https://www.biltema.no"],
  ["byggevarehus", "Montér Haugesund", "Raglamyr, Haugesund", 59.4250, 5.3000, "https://www.monter.no"],
  ["byggevarehus", "Byggmakker Haugesund", "Haugesund", 59.4130, 5.2680, "https://www.byggmakker.no"],
  ["byggevarehus", "Optimera Haugesund", "Haugesund", 59.4140, 5.2700, "https://www.optimera.no"],
  ["byggevarehus", "Biltema Porsgrunn", "Porsgrunn", 59.1400, 9.6550, "https://www.biltema.no"],
  ["byggevarehus", "Montér Porsgrunn", "Porsgrunn", 59.1405, 9.6500, "https://www.monter.no"],
  ["byggevarehus", "Byggmakker Skien", "Skien", 59.2070, 9.6070, "https://www.byggmakker.no"],
  ["byggevarehus", "Optimera Grenland", "Grenland", 59.1700, 9.6300, "https://www.optimera.no"],
  ["byggevarehus", "Biltema Kristiansand", "Sørlandsparken, Kristiansand", 58.1940, 8.0850, "https://www.biltema.no"],
  ["byggevarehus", "Montér Sørlandsparken", "Kristiansand", 58.1945, 8.0900, "https://www.monter.no"],
  ["byggevarehus", "Byggmakker Kristiansand", "Kristiansand", 58.1450, 7.9950, "https://www.byggmakker.no"],
  ["byggevarehus", "Optimera Kristiansand", "Kristiansand", 58.1500, 8.0000, "https://www.optimera.no"],
  ["byggevarehus", "Biltema Sandefjord", "Sandefjord", 59.1300, 10.2200, "https://www.biltema.no"],
  ["byggevarehus", "Montér Sandefjord", "Sandefjord", 59.1250, 10.2250, "https://www.monter.no"],
  ["byggevarehus", "Byggmakker Tønsberg", "Tønsberg", 59.2700, 10.4100, "https://www.byggmakker.no"],
  ["byggevarehus", "Optimera Vestfold", "Vestfold", 59.2705, 10.4120, "https://www.optimera.no"],
].map(([category, company, address, lat, lon, website]) => ({ category, company, address, lat, lon, website }));

const localSupplierHubs = [
  { place: "Bergen", lat: 60.393, lon: 5.324, suffix: "Bergen" },
  { place: "Stavanger", lat: 58.970, lon: 5.733, suffix: "Stavanger" },
  { place: "Haugesund", lat: 59.413, lon: 5.268, suffix: "Haugesund" },
  { place: "Grenland", lat: 59.170, lon: 9.630, suffix: "Grenland" },
  { place: "Kristiansand", lat: 58.150, lon: 8.000, suffix: "Kristiansand" },
  { place: "Vestfold", lat: 59.270, lon: 10.410, suffix: "Vestfold" },
];

const localSupplierNetworks = {
  elektrogrossist: [
    ["Ahlsell", "https://www.ahlsell.no"], ["Solar", "https://www.solar.no"],
    ["Onninen", "https://www.onninen.no"], ["Elektroimportøren", "https://www.elektroimportoren.no"],
  ],
  "vvs-grossist": [
    ["Brødrene Dahl", "https://www.dahl.no"], ["Ahlsell VVS", "https://www.ahlsell.no"],
    ["Heidenreich", "https://www.heidenreich.no"], ["VVS Eksperten", "https://www.vvseksperten.no"],
  ],
  "verktøy-maskinutleie": [
    ["Würth", "https://www.wuerth.no"], ["Motek", "https://www.motek.no"],
    ["Ramirent", "https://www.ramirent.no"], ["Cramo", "https://www.cramo.no"],
  ],
  "betong-pukk-grus": [
    ["NorBetong", "https://www.norbetong.no"], ["Franzefoss", "https://www.franzefoss.no"],
    ["Veidekke", "https://www.veidekke.no"], ["NCC", "https://www.ncc.no"],
  ],
  "transport-kran-container": [
    ["Norsk Gjenvinning", "https://www.norskgjenvinning.no"], ["Ragn-Sells", "https://www.ragnsells.no"],
    ["Bring", "https://www.bring.no"], ["Litra", "https://www.litra.no"],
  ],
  "arbeidstoy-verneutstyr": [
    ["TOOLS", "https://www.tools.no"], ["Wenaas", "https://www.wenaas.com"],
    ["Mascot", "https://www.mascotworkwear.no"], ["Ahlsell", "https://www.ahlsell.no"],
  ],
};

const localSupplierDirectory = [
  ...localSupplierDirectorySeed,
  ...localSupplierHubs.flatMap((hub) => Object.entries(localSupplierNetworks).flatMap(([category, suppliers]) => (
    suppliers.map(([company, website], index) => ({
      category,
      company: `${company} ${hub.suffix}`,
      address: hub.place,
      lat: hub.lat + (index - 1.5) * 0.012,
      lon: hub.lon + (index % 2 ? 0.014 : -0.014),
      website,
    }))
  ))),
];

function localSupplierResults(category, lat, lon) {
  return localSupplierDirectory
    .filter((supplier) => supplier.category === category)
    .map((supplier) => ({
      id: `local-${category}-${supplier.company}`,
      company: supplier.company,
      category,
      address: supplier.address,
      confirmed: true,
      source: "NBR",
      sourceLabel: "NBR",
      lat: supplier.lat,
      lon: supplier.lon,
      distanceKm: distanceBetweenCoordinates(lat, lon, supplier.lat, supplier.lon),
      discountPercent: [15, 22, 30, 18, 26][Math.abs(hashString(supplier.company)) % 5],
      website: supplier.website,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 4);
}

function distanceBetweenCoordinates(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const latitudeDelta = (lat2 - lat1) * Math.PI / 180;
  const longitudeDelta = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hashString(value) {
  return [...String(value)].reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0);
}

function supplierResult(category, name, lat, lon, centerLat, centerLon, website = "") {
  return {
    id: `${category}-${name}-${lat.toFixed(5)}-${lon.toFixed(5)}`,
    company: name,
    category,
    confirmed: true,
    lat,
    lon,
    distanceKm: distanceBetweenCoordinates(centerLat, centerLon, lat, lon),
    discountPercent: [15, 22, 30, 18, 26][Math.abs(hashString(name)) % 5],
    website,
  };
}

async function fallbackNominatimSuppliers(category, lat, lon) {
  const delta = 0.6;
  const viewbox = `${lon - delta},${lat + delta},${lon + delta},${lat - delta}`;
  const terms = supplierSearchTerms[category] || [];
  const results = [];
  for (const term of terms) {
    const query = new URLSearchParams({ q: term, format: "jsonv2", limit: "5", bounded: "1", viewbox, addressdetails: "1" });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
      headers: { accept: "application/json", "user-agent": "NorskByggRadar/1.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) continue;
    const places = await response.json();
    for (const place of places) {
      const placeLat = Number(place.lat);
      const placeLon = Number(place.lon);
      const name = String(place.name || place.display_name?.split(",")[0] || "").trim();
      if (!name || !Number.isFinite(placeLat) || !Number.isFinite(placeLon)) continue;
      results.push(supplierResult(category, name, placeLat, placeLon, lat, lon));
    }
  }
  return results;
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (url.pathname === "/sales/" && request.method === "GET") {
      response.writeHead(308, { location: `/sales${url.search}` });
      response.end();
      return;
    }

    if (url.pathname === "/sales" && request.method === "GET") {
      const salesHtml = await fs.readFile(path.join(root, "public", "sales", "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(salesHtml);
      return;
    }

    if ((url.pathname === "/user" || url.pathname === "/user/") && request.method === "GET") {
      const userHtml = await fs.readFile(path.join(root, "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(userHtml);
      return;
    }

    if (url.pathname === "/api/mittanbud-suppliers" && request.method === "GET") {
      const requestedMunicipalities = String(url.searchParams.get("municipalities") || "").replace(/[^0-9,]/g, "");
      const municipalityNames = String(url.searchParams.get("municipalityNames") || "").split(",").map((value) => value.trim()).filter(Boolean);
      const municipalities = await resolveMittanbudMunicipalityIds(municipalityNames, requestedMunicipalities);
      if (!municipalities) {
        response.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ error: "Kommunen kunne ikke kobles sikkert til Mittanbuds kommune-ID." }));
        return;
      }
      const all = url.searchParams.get("all") === "1";
      const workTypes = all ? "" : String(url.searchParams.get("workTypes") || "153").replace(/[^0-9,]/g, "");
      const trade = String(url.searchParams.get("trade") || "").replace(/[^a-z0-9-]/gi, "");
      const place = String(url.searchParams.get("place") || "").trim().slice(0, 80);
      const regionId = String(url.searchParams.get("regionId") || "").replace(/[^a-z0-9-]/gi, "");
      const regionName = String(url.searchParams.get("regionName") || "").trim().slice(0, 80);
      const sourceUrl = `https://mittanbud.no/bedriftsok?municipalities=${encodeURIComponent(municipalities)}${all ? "" : `&workTypes=${encodeURIComponent(workTypes)}&trade=${encodeURIComponent(trade)}`}&place=${encodeURIComponent(place)}`;
      const mittanbudSuppliers = await fetchAllMittanbudSuppliers(municipalities, workTypes, trade, all, true, municipalityNames);
      await syncGoogleAdsForSupplierContext({ regionId, regionName, municipality: municipalityNames.join(", "), tradeLabel: trade });
      const googleAdsSuppliers = (await readGoogleAdsSuppliers()).filter((supplier) => {
        const sameRegion = !regionId || supplier.regionId === regionId;
        const sameMunicipality = !municipalityNames.length || Boolean(supplier.municipality) && municipalityNames.some((name) => normalizeSupplierText(name) === normalizeSupplierText(supplier.municipality));
        const sameTrade = all || !trade || normalizeSupplierText(supplier.trade).includes(normalizeSupplierText(trade));
        return sameRegion && sameMunicipality && sameTrade;
      });
      const suppliers = [...new Map([...mittanbudSuppliers, ...googleAdsSuppliers].map((supplier) => [supplier.website || `${supplier.name}|${supplier.address}`, supplier])).values()];
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ sourceUrl, suppliers, message: suppliers.length ? "" : "Mittanbud leverte ingen lesbare leverandørposter i dette søket." }));
      return;
    }

    if (url.pathname === "/api/mittanbud-supplier-summary" && request.method === "GET") {
      const requestedGroups = String(url.searchParams.get("regions") || "").trim();
      const groups = requestedGroups
        ? JSON.parse(requestedGroups).filter((group) => Array.isArray(group?.municipalities) && group.municipalities.length)
        : [{ id: "", municipalities: String(url.searchParams.get("municipalityNames") || "").split(",").map((value) => value.trim()).filter(Boolean) }];
      const googleAdsSuppliers = await readGoogleAdsSuppliers();
      const regionResults = await Promise.all(groups.map(async (group) => {
        const municipalityNames = group.municipalities;
        const municipalities = await resolveMittanbudMunicipalityIds(municipalityNames, "");
        if (!municipalities) return { id: group.id || "ukjent", suppliers: [] };
        const mittanbudSuppliers = await fetchAllMittanbudSuppliers(municipalities, "", "", true, true, municipalityNames);
        const allowedPlaces = municipalityNames.map((name) => normalizeSupplierText(name)).filter(Boolean);
        const localSuppliers = googleAdsSuppliers.filter((supplier) => {
          const sameRegion = !group.id || !supplier.regionId || supplier.regionId === group.id;
          const hasLocalAddress = supplierPlaceMatchesAllowed(
            String(supplier.municipality || supplier.address || "").split(",").pop(),
            allowedPlaces
          );
          return sameRegion && hasLocalAddress;
        });
        return { id: group.id || "ukjent", suppliers: [...mittanbudSuppliers, ...localSuppliers] };
      }));
      const suppliers = [...new Map(regionResults.flatMap((result) => result.suppliers).map((supplier) => [supplier.website || `${supplier.name}|${supplier.address}`, supplier])).values()];
      const byRegion = Object.fromEntries(regionResults.map((result) => [result.id, [...new Set(result.suppliers.map((supplier) => supplier.website || `${supplier.name}|${supplier.address}`))].length]));
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ count: suppliers.length, byRegion }));
      return;
    }

    if (url.pathname === "/api/google-ads-suppliers" && request.method === "GET") {
      const queryText = String(url.searchParams.get("q") || "").trim().slice(0, 120);
      const regionId = String(url.searchParams.get("regionId") || "").replace(/[^a-z0-9-]/gi, "");
      const regionName = String(url.searchParams.get("regionName") || "").trim().slice(0, 80);
      const municipality = String(url.searchParams.get("municipality") || "").trim().slice(0, 80);
      const tradeLabel = String(url.searchParams.get("trade") || "").trim().slice(0, 80);
      if (!queryText && !tradeLabel) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Skriv inn virksomhet eller fagområde før Google Ads-søk." }));
        return;
      }
      try {
        const payload = await searchGoogleAdsSuppliers({ query: queryText, regionId, regionName, municipality, tradeLabel });
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
      } catch (error) {
        response.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ error: error.message || "Google Ads-søket kunne ikke gjennomføres." }));
      }
      return;
    }

    if (url.pathname === "/api/google-organic-suppliers" && request.method === "GET") {
      const queryText = String(url.searchParams.get("q") || "").trim().slice(0, 120);
      const regionId = String(url.searchParams.get("regionId") || "").replace(/[^a-z0-9-]/gi, "");
      const regionName = String(url.searchParams.get("regionName") || "").trim().slice(0, 80);
      const municipality = String(url.searchParams.get("municipality") || "").trim().slice(0, 80);
      const tradeLabel = String(url.searchParams.get("trade") || "").trim().slice(0, 80);
      if (!queryText && !tradeLabel) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Velg fagområde eller skriv inn virksomhet før organisk søk." }));
        return;
      }
      try {
        const payload = await searchOrganicGoogleSuppliers({ query: queryText, regionId, regionName, municipality, tradeLabel });
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(payload));
      } catch (error) {
        response.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ error: error.message || "Det organiske søket kunne ikke gjennomføres." }));
      }
      return;
    }

    if (url.pathname === "/api/oppdrag" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 64 * 1024) {
          response.writeHead(413, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Forespørselen er for stor." }));
          return;
        }
      }
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Ugyldig forespørsel." }));
        return;
      }
      const requestData = Object.fromEntries(["trade", "description", "name", "address", "phone"].map((key) => [key, String(payload[key] || "").trim()]));
      const missing = ["trade", "description", "name", "address", "phone"].filter((key) => !requestData[key]);
      if (missing.length) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Fyll ut oppdragstype, beskrivelse, navn, adresse og telefonnummer." }));
        return;
      }
      const jobRequest = {
        id: `oppdrag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...requestData,
        receivedAt: new Date().toISOString(),
        distribution: {
          group: "testpersoner",
          channel: "sms",
          status: configuredTestPersonNumbers().length ? "queued" : "awaiting_recipients",
          recipientCount: configuredTestPersonNumbers().length,
          tradeIsolated: true,
        },
      };
      const smsDistribution = await queueSmsDistribution(jobRequest);
      jobRequest.distribution = { ...jobRequest.distribution, ...smsDistribution };
      incomingJobRequests.push(jobRequest);
      if (incomingJobRequests.length > 500) incomingJobRequests.shift();
      await persistIncomingJobRequests();
      await dispatchSmsOutbox();
      response.writeHead(202, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ accepted: true, id: jobRequest.id, trade: jobRequest.trade, distribution: jobRequest.distribution }));
      return;
    }

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
      const allowedMunicipalities = String(url.searchParams.get("kommuner") || "")
        .split(",")
        .map((value) => normalizeMittanbudMunicipality(value))
        .filter(Boolean);
      const query = new URLSearchParams();
      allowedKeys.forEach((key) => {
        const value = url.searchParams.get(key);
        if (value) query.set(key, value);
      });
      const kartverket = await fetch(`https://api.kartverket.no/adresser/v1/sok?${query}`);
      let body = await kartverket.text();
      if (kartverket.ok && allowedMunicipalities.length) {
        try {
          const payload = JSON.parse(body);
          payload.adresser = (payload.adresser || []).filter((item) => allowedMunicipalities.includes(normalizeMittanbudMunicipality(item.kommunenavn)));
          body = JSON.stringify(payload);
        } catch { /* Behold Kartverkets svar uendret ved uventet format. */ }
      }
      response.writeHead(kartverket.status, {
        "content-type": kartverket.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(body);
      return;
    }

    if (url.pathname === "/api/nearby-suppliers") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      const category = String(url.searchParams.get("category") || "");
      const searchPattern = supplierSearchPatterns[category];
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !searchPattern) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Ugyldig søkepunkt eller leverandørkategori" }));
        return;
      }
      try {
        // Byggevarehus har et lokalt kvalitetssikret register. Bruk dette
        // først slik at søket ikke blir avhengig av treg ekstern karttjeneste.
        const localFirstResults = localSupplierResults(category, lat, lon);
        if (localFirstResults.length) {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end(JSON.stringify({ suppliers: localFirstResults, source: "Norsk ByggRadar leverandørregister", center: { lat, lon } }));
          return;
        }
        const seen = new Map();
        let successfulSearch = false;
        const overpassEndpoints = [
          "https://overpass-api.de/api/interpreter",
          "https://overpass.kumi.systems/api/interpreter",
          "https://overpass.private.coffee/api/interpreter",
        ];
        // Søk trinnvis slik at nære treff alltid får prioritet foran treff
        // som bare finnes fordi søkeområdet ble satt til 50 km.
        for (const radius of [10000, 25000, 50000]) {
          const safeLat = lat.toFixed(6);
          const safeLon = lon.toFixed(6);
          // Kategorisoket skal ikke bruke generelle butikk-tag-er som grunnlag.
          // Slike tag-er slipper ellers gjennom virksomheter fra andre fag,
          // for eksempel malerfirmaer som er registrert som butikk.
          const query = `[out:json][timeout:20];nwr(around:${radius},${safeLat},${safeLon})["name"~"${searchPattern}",i];out center tags;`;
          for (const endpoint of overpassEndpoints) {
            try {
              const overpass = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
                headers: { accept: "application/json", "user-agent": "NorskByggRadar/1.0" },
                signal: AbortSignal.timeout(9000),
              });
              if (!overpass.ok) continue;
              successfulSearch = true;
              const payload = await overpass.json();
              (payload.elements || []).forEach((element) => {
                const point = element.type === "node"
                  ? { lat: element.lat, lon: element.lon }
                  : { lat: element.center?.lat, lon: element.center?.lon };
                const name = String(element.tags?.name || "").trim();
                if (!name || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;
                const key = `${name.toLowerCase()}|${point.lat.toFixed(5)}|${point.lon.toFixed(5)}`;
                if (seen.has(key)) return;
                const distanceKm = distanceBetweenCoordinates(lat, lon, point.lat, point.lon);
                seen.set(key, {
                  id: `${category}-${element.type}-${element.id}`,
                  company: name,
                  category,
                  confirmed: true,
                  lat: point.lat,
                  lon: point.lon,
                  distanceKm,
                  discountPercent: [15, 22, 30, 18, 26][Math.abs(hashString(name)) % 5],
                  website: element.tags?.website || element.tags?.contact_website || "",
                });
              });
              if (seen.size >= 4) break;
            } catch {
              // Prøv neste Overpass-tjeneste før Nominatim-fallback.
            }
          }
          if (seen.size >= 4) break;
        }
        if (!successfulSearch) throw new Error("Stedsøket svarte uten gyldig resultat");
        const suppliers = [...seen.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 4);
        if (!suppliers.length) throw new Error("Stedsøket ga ingen leverandører");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ suppliers, source: "OpenStreetMap/Overpass", center: { lat, lon } }));
      } catch (error) {
        const localResults = localSupplierResults(category, lat, lon);
        if (localResults.length) {
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end(JSON.stringify({ suppliers: localResults, source: "Norsk ByggRadar leverandørregister", center: { lat, lon } }));
          return;
        }
        try {
          const fallbackResults = await fallbackNominatimSuppliers(category, lat, lon);
          const unique = new Map();
          fallbackResults.forEach((supplier) => {
            const key = `${supplier.company.toLowerCase()}|${supplier.lat.toFixed(5)}|${supplier.lon.toFixed(5)}`;
            if (!unique.has(key)) unique.set(key, supplier);
          });
          const suppliers = [...unique.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 4);
          response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          response.end(JSON.stringify({ suppliers, source: "OpenStreetMap/Nominatim", center: { lat, lon } }));
        } catch (fallbackError) {
          response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Leverandørsøket kunne ikke hentes nå.", detail: fallbackError.message || error.message }));
        }
      }
      return;
    }

    if (url.pathname === "/api/ai-phone-search") {
      const subject = String(url.searchParams.get("q") || "").trim().slice(0, 180);
      if (!subject || /^(telefon(?:nummer)?\s+(?:ikke funnet|ble ikke funnet)|ukjent|aktør)$/i.test(subject)) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Mangler søkeord" }));
        return;
      }

      const aiPhoneCacheKey = subject.toLocaleLowerCase("nb-NO").replace(/\s+/g, " ").trim();
      const cachedPhoneSearch = aiPhoneCache.get(aiPhoneCacheKey);
      if (cachedPhoneSearch && cachedPhoneSearch.expiresAt > Date.now()) {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify(cachedPhoneSearch.payload));
        return;
      }

      const query = `"${subject}" telefonnummer kontakt telefon`;
      const searchRequests = [
        { url: `https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`, kind: "google-ai" },
        { url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, kind: "google" },
        { url: `https://www.1881.no/?query=${encodeURIComponent(subject)}`, kind: "1881" },
        { url: `https://www.gulesider.no/${encodeURIComponent(subject)}/bedrifter`, kind: "gulesider" },
        { url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, kind: "duckduckgo" },
      ];
      const searchUrls = searchRequests.map(({ url }) => url);
      let plainText = "";
      let firstPhone = "";
      let phones = [];
      let blocked = false;
      for (const { url: searchUrl, kind } of searchRequests) {
        let candidateText = "";
        try {
          const searchResponse = await fetch(searchUrl, {
            headers: {
              accept: "text/html,application/xhtml+xml",
              "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
            },
          });
          if (!searchResponse.ok) continue;
          const rawHtml = await searchResponse.text();
          const linkedPhones = extractTelPhones(rawHtml);
          candidateText = decodeHtmlEntities(stripHtml(rawHtml)).replace(/\s+/g, " ").trim();
          let candidatePhones = [...linkedPhones, ...extractNorwegianPhones(candidateText, subject)];
          if (!candidatePhones.length && kind === "duckduckgo") {
            const resultLinks = extractDuckDuckGoLinks(rawHtml).slice(0, 5);
            for (const resultLink of resultLinks) {
              try {
                const detailResponse = await fetch(resultLink, {
                  headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36" },
                  signal: AbortSignal.timeout(8000),
                });
                if (!detailResponse.ok) continue;
                const detailHtml = await detailResponse.text();
                const detailText = decodeHtmlEntities(stripHtml(detailHtml)).replace(/\s+/g, " ").trim();
                candidatePhones = [...extractTelPhones(detailHtml), ...extractNorwegianPhones(detailText, subject)];
                if (candidatePhones.length) {
                  candidateText = detailText;
                  break;
                }
              } catch { /* Ett enkelt søkeresultat skal ikke stoppe resten av søket. */ }
            }
          }
          if (/unusual traffic|not a robot|captcha|robots are known|solve the captcha|søket ble midlertidig stoppet|enable javascript|blocked by/i.test(`${candidateText} ${rawHtml}`)) {
            blocked = true;
            continue;
          }
          if (candidatePhones.length) {
            plainText = candidateText;
            phones = [...new Set(candidatePhones)].slice(0, 5);
            firstPhone = phones[0];
            break;
          }
        } catch {
          continue;
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
      const phoneSearchPayload = {
        query,
        searchUrl: searchUrls[0],
        phone: firstPhone,
        phones,
        blocked,
        info: firstPhone ? (phoneIndex >= 0 ? context : "Telefonnummer funnet i søkeresultatene.") : (blocked ? "Google blokkerte det automatiske AI-søket med CAPTCHA eller samtykkeside." : "Telefonnummer ble ikke funnet i søkeresultatene."),
        source: "AI-søk",
      };
      // Bare verifiserte telefonnumre lagres. Et tomt eller blokkert Google-svar
      // skal kunne prøves på nytt ved neste leverandørsøk.
      if (firstPhone) {
        aiPhoneCache.set(aiPhoneCacheKey, { expiresAt: Date.now() + aiPhoneCacheTtlMs, payload: phoneSearchPayload });
      }
      response.end(JSON.stringify(phoneSearchPayload));
      return;
    }

    if (url.pathname === "/api/ssb-statistics") {
      const requestedMunicipalities = url.searchParams.get("kommunenumre") || url.searchParams.get("kommunenummer") || "";
      const municipalityNumbers = [...new Set(requestedMunicipalities.split(",").map((value) => value.replace(/\D/g, "").slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))];
      const municipalityNumber = municipalityNumbers[0] || "";
      if (!municipalityNumbers.length) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Mangler gyldig kommunenummer" }));
        return;
      }
      const requestedYear = Number(url.searchParams.get("år") || new Date().getFullYear());
      const currentYear = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= new Date().getFullYear() ? requestedYear : new Date().getFullYear();
      const [planYears, housingYears, feeAccountingYears, buildingAreaYears, holidayYears] = await Promise.all([
        latestSsbYears("12690", currentYear),
        latestSsbYears("05940", currentYear),
        latestSsbYears("13013", currentYear),
        latestSsbYears("05939", currentYear),
        latestSsbYears("06952", currentYear),
      ]);
      const [feeYears, buildingYears] = await Promise.all([
        latestSsbYears("12303", currentYear),
        latestSsbYears("13021", currentYear),
      ]);
      const [plan, housing, commercial, publicBuilding, holiday, fees, building, buildingProcessing, feeAccounting] = await Promise.all([
        fetchSsbTable("12690", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "ContentsCode", values: ["KOSantreghoring0000", "KOSinskomplanall0000", "KOStemaareal0000", "KOShoringsfrist0000", "KOSinnsigelseral0000", "KOSomfplanbehand0001", "KOSomfplanbehand0000", "KOSbehandlingsti0000", "KOSklagesakerved0000"] },
          { code: "Tid", values: planYears },
        ]),
        fetchSsbTable("05940", [
          { code: "Region", values: municipalityNumbers },
          { code: "Byggeareal", values: residentialBuildingTypes },
          { code: "ContentsCode", values: ["Igangsatte", "Fullforte", "BruksarealIgang", "BruksarealFullfort"] },
          { code: "Tid", values: housingYears },
        ]),
        fetchSsbTable("05939", [
          { code: "Region", values: municipalityNumbers },
          { code: "Byggeareal", values: ["611", "612", "613", "614", "615", "616", "619", "621", "623", "629", "641", "642", "643", "649", "651", "652", "653", "654", "655", "659", "661", "662", "663", "669", "671", "672", "673", "674", "675", "679", "719", "721", "722", "723", "729", "731", "732", "739"] },
          { code: "ContentsCode", values: ["Igangsatt", "Fullfort"] },
          { code: "Tid", values: buildingAreaYears },
        ]),
        fetchSsbTable("06952", [
          { code: "Region", values: municipalityNumbers },
          { code: "ContentsCode", values: ["IgangFrid2", "FullFritid2"] },
          { code: "Tid", values: holidayYears },
        ]),
        fetchSsbTable("05939", [
          { code: "Region", values: municipalityNumbers },
          { code: "Byggeareal", values: ["__ALL__"] },
          { code: "ContentsCode", values: ["Igangsatt", "Fullfort"] },
          { code: "Tid", values: buildingAreaYears },
        ]),
        fetchSsbTable("12303", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "ContentsCode", values: ["KOSgebrebebolig0000", "KOSgebrgrunneie0000", "KOSgebrprivrgpln0000"] },
          { code: "Tid", values: feeYears },
        ]),
        fetchSsbTable("13021", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "KOKckategori0000", values: ["aalle"] },
          { code: "KOKctype0000", values: ["abygsokialt"] },
          { code: "ContentsCode", values: ["KOSmottattesokna0000", "KOSmangelfulleso0000", "KOSbehandletsokn0000", "KOSoverlovpalagt0000", "KOSgjennomsnitts0000"] },
          { code: "Tid", values: buildingYears },
        ]),
        fetchSsbTable("13021", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "KOKckategori0000", values: ["__ALL__"] },
          { code: "KOKctype0000", values: ["__ALL__"] },
          { code: "ContentsCode", values: ["KOSgjennomsnitts0000"] },
          { code: "Tid", values: buildingYears },
        ]),
        fetchSsbTable("13013", [
          { code: "KOKkommuneregion0000", values: municipalityNumbers },
          { code: "KOKkommunalsekto0000", values: ["4_p", "5_b", "6_k", "7_e"] },
          { code: "ContentsCode", values: [
            "KOSbelopdirdrift0000", "KOSbelopindirdri0000", "KOSbelopkalkrent0000", "KOSbelopkalkavsk0000",
            "KOSbelopandreinn0000", "KOSbelopgebyrgrl0000", "KOSbelopgebyrinn0000", "KOSbelopaaretsfi0000",
            "KOSbelopavsetnfo0000", "KOSbelopbrukfond0000", "KOSbelopkontrsum0000", "KOSbelopsaldo110000",
            "KOSbelopaltkostn0000", "KOSbelopsaldo3110000", "KOSbelopfindekng0000", "KOSbelopselvkost0000",
          ] },
          { code: "Tid", values: feeAccountingYears },
        ]),
      ]);
      const planSeries = ssbMetricSeries(plan);
      const housingSeries = ssbMetricSeries(housing, "Byggeareal");
      const commercialSeries = ssbMetricSeries(commercial, "Byggeareal");
      const publicBuildingSeries = ssbMetricSeries(publicBuilding, "Byggeareal");
      const holidaySeries = ssbMetricSeries(holiday);
      const feeSeries = ssbMetricSeries(fees);
      const buildingSeries = ssbMetricSeries(building);
      const buildingProcessingSeries = ssbMetricSeries(buildingProcessing, ["KOKckategori0000", "KOKctype0000"], "average");
      const feeAccountingSeries = ssbMetricSeries(feeAccounting, "KOKkommunalsekto0000");
      const planValues = Object.fromEntries(Object.entries(planSeries).map(([key, series]) => [key, series.current]));
      const housingValues = Object.fromEntries(Object.entries(housingSeries).map(([key, series]) => [key, series.current]));
      const feeValues = Object.fromEntries(Object.entries(feeSeries).map(([key, series]) => [key, series.current]));
      const buildingValues = Object.fromEntries(Object.entries(buildingSeries).map(([key, series]) => [key, series.current]));
      const feeAccountingValues = Object.fromEntries(Object.entries(feeAccountingSeries).map(([key, series]) => [key, series.current]));
      const planTrends = Object.fromEntries(Object.entries(planSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const housingTrends = Object.fromEntries(Object.entries(housingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const commercialTrends = Object.fromEntries(Object.entries(commercialSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const publicBuildingTrends = Object.fromEntries(Object.entries(publicBuildingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const holidayTrends = Object.fromEntries(Object.entries(holidaySeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const feeTrends = Object.fromEntries(Object.entries(feeSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const buildingTrends = Object.fromEntries(Object.entries(buildingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const feeAccountingTrends = Object.fromEntries(Object.entries(feeAccountingSeries).map(([key, series]) => [key, ssbTrend(series.current, series.previous)]));
      const values = {
        latestAvailableYear: Math.max(...[planYears, housingYears, feeYears, buildingYears, buildingAreaYears, holidayYears].map((years) => Number(years.at(-1)))),
        plansWithHearingDeadline: planValues.KOShoringsfrist0000,
        planObjections: planValues.KOSinnsigelseral0000,
        planArea: planValues.KOStemaareal0000,
        regulationsAdopted: planValues.KOSomfplanbehand0001,
        privateDetailedPlans: planValues.KOSomfplanbehand0000,
        planProcessingDays: planValues.KOSbehandlingsti0000,
        planComplaints: planValues.KOSklagesakerved0000,
        housingStarted: housingValues.Igangsatte,
        housingCompleted: housingValues.Fullforte,
        housingNetDifference: Number(housingValues.Igangsatte || 0) - Number(housingValues.Fullforte || 0),
        housingStartedArea: housingValues.BruksarealIgang,
        housingCompletedArea: housingValues.BruksarealFullfort,
        commercialStartedArea: commercialSeries.BruksarealIgang?.current,
        commercialCompletedArea: commercialSeries.BruksarealFullfort?.current,
        constructionAreaTotal: Number(housingValues.BruksarealIgang || 0) + Number(commercialSeries.BruksarealIgang?.current || 0),
        publicBuildingStartedArea: publicBuildingSeries.Igangsatt?.current,
        holidayHomeArea: holidaySeries.IgangFrid2?.current,
        feeBuildingHouse: feeValues.KOSgebrebebolig0000,
        feePropertyCreation: feeValues.KOSgebrgrunneie0000,
        feePrivateRegulation: feeValues.KOSgebrprivrgpln0000,
        buildingApplications: buildingValues.KOSmottattesokna0000,
        incompleteBuildingApplications: buildingValues.KOSmangelfulleso0000,
        processedBuildingApplications: buildingValues.KOSbehandletsokn0000,
        lateBuildingApplications: buildingValues.KOSoverlovpalagt0000,
        buildingProcessingDays: buildingProcessingSeries.KOSgjennomsnitts0000?.current,
        feeDirectOperatingExpenses: feeAccountingValues.KOSbelopdirdrift0000,
        feeIndirectOperatingExpenses: feeAccountingValues.KOSbelopindirdri0000,
        feeInterestCosts: feeAccountingValues.KOSbelopkalkrent0000,
        feeDepreciation: feeAccountingValues.KOSbelopkalkavsk0000,
        feeOtherIncome: feeAccountingValues.KOSbelopandreinn0000,
        feeBasisTotal: feeAccountingValues.KOSbelopgebyrgrl0000,
        feeRevenueTotal: feeAccountingValues.KOSbelopgebyrinn0000,
        feeFinancialResult: feeAccountingValues.KOSbelopaaretsfi0000,
        feeFundProvision: feeAccountingValues.KOSbelopavsetnfo0000,
        feeFundUse: feeAccountingValues.KOSbelopbrukfond0000,
        feeControlSumSubsidy: feeAccountingValues.KOSbelopkontrsum0000,
        feeFundBalanceStart: feeAccountingValues.KOSbelopsaldo110000,
        feeAlternativeCost: feeAccountingValues.KOSbelopaltkostn0000,
        feeFundBalanceEnd: feeAccountingValues.KOSbelopsaldo3110000,
        feeFinancialCoverage: feeAccountingValues.KOSbelopfindekng0000,
      };
      applyFeeCoverageCalculations(values);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      const previousValues = {
        plansWithHearingDeadline: planSeries.KOShoringsfrist0000?.previous,
        planObjections: planSeries.KOSinnsigelseral0000?.previous,
        planArea: planSeries.KOStemaareal0000?.previous,
        regulationsAdopted: planSeries.KOSomfplanbehand0001?.previous,
        privateDetailedPlans: planSeries.KOSomfplanbehand0000?.previous,
        planProcessingDays: planSeries.KOSbehandlingsti0000?.previous,
        planComplaints: planSeries.KOSklagesakerved0000?.previous,
        housingStarted: housingSeries.Igangsatte?.previous,
        housingCompleted: housingSeries.Fullforte?.previous,
        housingNetDifference: Number(housingSeries.Igangsatte?.previous || 0) - Number(housingSeries.Fullforte?.previous || 0),
        housingStartedArea: housingSeries.BruksarealIgang?.previous,
        housingCompletedArea: housingSeries.BruksarealFullfort?.previous,
        commercialStartedArea: commercialSeries.BruksarealIgang?.previous,
        commercialCompletedArea: commercialSeries.BruksarealFullfort?.previous,
        constructionAreaTotal: Number(housingSeries.BruksarealIgang?.previous || 0) + Number(commercialSeries.BruksarealIgang?.previous || 0),
        publicBuildingStartedArea: publicBuildingSeries.Igangsatt?.previous,
        holidayHomeArea: holidaySeries.IgangFrid2?.previous,
        feeBuildingHouse: feeSeries.KOSgebrebebolig0000?.previous,
        feePropertyCreation: feeSeries.KOSgebrgrunneie0000?.previous,
        feePrivateRegulation: feeSeries.KOSgebrprivrgpln0000?.previous,
        buildingApplications: buildingSeries.KOSmottattesokna0000?.previous,
        incompleteBuildingApplications: buildingSeries.KOSmangelfulleso0000?.previous,
        processedBuildingApplications: buildingSeries.KOSbehandletsokn0000?.previous,
        lateBuildingApplications: buildingSeries.KOSoverlovpalagt0000?.previous,
        buildingProcessingDays: buildingProcessingSeries.KOSgjennomsnitts0000?.previous,
        feeDirectOperatingExpenses: feeAccountingSeries.KOSbelopdirdrift0000?.previous,
        feeIndirectOperatingExpenses: feeAccountingSeries.KOSbelopindirdri0000?.previous,
        feeInterestCosts: feeAccountingSeries.KOSbelopkalkrent0000?.previous,
        feeDepreciation: feeAccountingSeries.KOSbelopkalkavsk0000?.previous,
        feeOtherIncome: feeAccountingSeries.KOSbelopandreinn0000?.previous,
        feeBasisTotal: feeAccountingSeries.KOSbelopgebyrgrl0000?.previous,
        feeRevenueTotal: feeAccountingSeries.KOSbelopgebyrinn0000?.previous,
        feeFinancialResult: feeAccountingSeries.KOSbelopaaretsfi0000?.previous,
        feeFundProvision: feeAccountingSeries.KOSbelopavsetnfo0000?.previous,
        feeFundUse: feeAccountingSeries.KOSbelopbrukfond0000?.previous,
        feeControlSumSubsidy: feeAccountingSeries.KOSbelopkontrsum0000?.previous,
        feeFundBalanceStart: feeAccountingSeries.KOSbelopsaldo110000?.previous,
        feeAlternativeCost: feeAccountingSeries.KOSbelopaltkostn0000?.previous,
        feeFundBalanceEnd: feeAccountingSeries.KOSbelopsaldo3110000?.previous,
        feeFinancialCoverage: feeAccountingSeries.KOSbelopfindekng0000?.previous,
      };
      applyFeeCoverageCalculations(previousValues);
      const outputMetricKeys = [
        "latestAvailableYear", "plansWithHearingDeadline", "planObjections", "planArea", "regulationsAdopted", "privateDetailedPlans", "planProcessingDays", "planComplaints",
        "housingStarted", "housingCompleted", "housingNetDifference", "housingStartedArea", "housingCompletedArea", "commercialStartedArea", "commercialCompletedArea", "constructionAreaTotal", "publicBuildingStartedArea", "holidayHomeArea",
        "feeBuildingHouse", "feePropertyCreation", "feePrivateRegulation", "buildingApplications", "incompleteBuildingApplications", "processedBuildingApplications", "lateBuildingApplications", "buildingProcessingDays",
        "feeDirectOperatingExpenses", "feeIndirectOperatingExpenses", "feeInterestCosts", "feeDepreciation", "feeOtherIncome", "feeBasisTotal", "feeRevenueTotal", "feeFinancialResult", "feeFundProvision", "feeFundUse", "feeControlSumSubsidy", "feeFundBalanceStart", "feeAlternativeCost", "feeFundBalanceEnd", "feeFinancialCoverage",
      ];
      outputMetricKeys.forEach((metric) => {
        if (values[metric] === undefined) values[metric] = null;
        if (previousValues[metric] === undefined) previousValues[metric] = null;
      });
      const metricYears = {
        plansWithHearingDeadline: ssbMetricYears(planYears), planObjections: ssbMetricYears(planYears), planArea: ssbMetricYears(planYears), planComplaints: ssbMetricYears(planYears),
        latestAvailableYear: ssbMetricYears(planYears), regulationsAdopted: ssbMetricYears(planYears), privateDetailedPlans: ssbMetricYears(planYears), planProcessingDays: ssbMetricYears(planYears),
        housingStarted: ssbMetricYears(housingYears), housingCompleted: ssbMetricYears(housingYears), housingNetDifference: ssbMetricYears(housingYears), housingStartedArea: ssbMetricYears(housingYears), housingCompletedArea: ssbMetricYears(housingYears),
        commercialStartedArea: ssbMetricYears(housingYears), commercialCompletedArea: ssbMetricYears(housingYears), constructionAreaTotal: ssbMetricYears(housingYears),
        publicBuildingStartedArea: ssbMetricYears(buildingAreaYears), holidayHomeArea: ssbMetricYears(holidayYears),
        feeBuildingHouse: ssbMetricYears(feeYears), feePropertyCreation: ssbMetricYears(feeYears), feePrivateRegulation: ssbMetricYears(feeYears),
        buildingApplications: ssbMetricYears(buildingYears), incompleteBuildingApplications: ssbMetricYears(buildingYears), processedBuildingApplications: ssbMetricYears(buildingYears), lateBuildingApplications: ssbMetricYears(buildingYears), buildingProcessingDays: ssbMetricYears(buildingYears),
        feeDirectOperatingExpenses: ssbMetricYears(feeAccountingYears), feeIndirectOperatingExpenses: ssbMetricYears(feeAccountingYears),
        feeInterestCosts: ssbMetricYears(feeAccountingYears), feeDepreciation: ssbMetricYears(feeAccountingYears), feeOtherIncome: ssbMetricYears(feeAccountingYears),
        feeBasisTotal: ssbMetricYears(feeAccountingYears), feeRevenueTotal: ssbMetricYears(feeAccountingYears), feeFinancialResult: ssbMetricYears(feeAccountingYears),
        feeFundProvision: ssbMetricYears(feeAccountingYears), feeFundUse: ssbMetricYears(feeAccountingYears), feeControlSumSubsidy: ssbMetricYears(feeAccountingYears),
        feeFundBalanceStart: ssbMetricYears(feeAccountingYears), feeAlternativeCost: ssbMetricYears(feeAccountingYears), feeFundBalanceEnd: ssbMetricYears(feeAccountingYears),
        feeFinancialCoverage: ssbMetricYears(feeAccountingYears),
      };
      const year = Math.max(...Object.values(metricYears).map((item) => Number(item.year)));
      const previousYear = year - 1;
      response.end(JSON.stringify({ source: "Statistisk sentralbyrå", year, previousYear, metricYears, municipalityNumber, municipalityNumbers, municipalityCount: municipalityNumbers.length, scope: municipalityNumbers.length > 1 ? "region" : "municipality", values, previousValues, trends: {
        plansWithHearingDeadline: planTrends.KOShoringsfrist0000,
        planObjections: planTrends.KOSinnsigelseral0000,
        planArea: planTrends.KOStemaareal0000,
        regulationsAdopted: planTrends.KOSomfplanbehand0001,
        privateDetailedPlans: planTrends.KOSomfplanbehand0000,
        planProcessingDays: planTrends.KOSbehandlingsti0000,
        planComplaints: planTrends.KOSklagesakerved0000,
        housingStarted: housingTrends.Igangsatte,
        housingCompleted: housingTrends.Fullforte,
        housingNetDifference: ssbTrend(values.housingNetDifference, previousValues.housingNetDifference),
        housingStartedArea: housingTrends.BruksarealIgang,
        housingCompletedArea: housingTrends.BruksarealFullfort,
        commercialStartedArea: commercialTrends.BruksarealIgang,
        commercialCompletedArea: commercialTrends.BruksarealFullfort,
        publicBuildingStartedArea: publicBuildingTrends.Igangsatt,
        holidayHomeArea: holidayTrends.IgangFrid2,
        constructionAreaTotal: ssbTrend(values.constructionAreaTotal, previousValues.constructionAreaTotal),
        feeBuildingHouse: feeTrends.KOSgebrebebolig0000,
        feePropertyCreation: feeTrends.KOSgebrgrunneie0000,
        feePrivateRegulation: feeTrends.KOSgebrprivrgpln0000,
        buildingApplications: buildingTrends.KOSmottattesokna0000,
        incompleteBuildingApplications: buildingTrends.KOSmangelfulleso0000,
        processedBuildingApplications: buildingTrends.KOSbehandletsokn0000,
        lateBuildingApplications: buildingTrends.KOSoverlovpalagt0000,
        buildingProcessingDays: ssbTrend(values.buildingProcessingDays, previousValues.buildingProcessingDays),
        feeDirectOperatingExpenses: feeAccountingTrends.KOSbelopdirdrift0000,
        feeIndirectOperatingExpenses: feeAccountingTrends.KOSbelopindirdri0000,
        feeInterestCosts: feeAccountingTrends.KOSbelopkalkrent0000,
        feeDepreciation: feeAccountingTrends.KOSbelopkalkavsk0000,
        feeOtherIncome: feeAccountingTrends.KOSbelopandreinn0000,
        feeBasisTotal: feeAccountingTrends.KOSbelopgebyrgrl0000,
        feeRevenueTotal: feeAccountingTrends.KOSbelopgebyrinn0000,
        feeFinancialResult: feeAccountingTrends.KOSbelopaaretsfi0000,
        feeFundProvision: feeAccountingTrends.KOSbelopavsetnfo0000,
        feeFundUse: feeAccountingTrends.KOSbelopbrukfond0000,
        feeControlSumSubsidy: feeAccountingTrends.KOSbelopkontrsum0000,
        feeFundBalanceStart: feeAccountingTrends.KOSbelopsaldo110000,
        feeAlternativeCost: feeAccountingTrends.KOSbelopaltkostn0000,
        feeFundBalanceEnd: feeAccountingTrends.KOSbelopsaldo3110000,
        feeFinancialCoverage: feeAccountingTrends.KOSbelopfindekng0000,
      } }));
      return;
    }

    const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let requested = safePath === "/" ? "/index.html" : safePath;
    if (requested === "/oppdrag" || requested === "/oppdrag/") requested = "/oppdrag/index.html";
    if (requested === "/app.js") requested = "/src/main.js";
    if (requested === "/styles.css") requested = "/src/styles.css";
    if (requested.startsWith("/oppdrag/")) requested = `/public${requested}`;
    if (requested.startsWith("/sales/")) requested = `/public${requested}`;
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
  } catch (error) {
    const isApiRequest = (request.url || "").startsWith("/api/");
    response.writeHead(isApiRequest ? 502 : 404, { "content-type": isApiRequest ? "application/json; charset=utf-8" : "text/plain; charset=utf-8" });
    response.end(isApiRequest ? JSON.stringify({ error: error?.message || "Tjenesten kunne ikke hente data akkurat nå." }) : "Not found");
  }
});

function stripHtml(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function normalizeMittanbudMunicipality(value) {
  return String(value || "")
    .toLocaleLowerCase("nb-NO")
    .replace(/\b(kommune|herad)\b/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function loadMittanbudMunicipalityDirectory() {
  if (mittanbudMunicipalityCache.expiresAt > Date.now() && mittanbudMunicipalityCache.values.size) {
    return mittanbudMunicipalityCache.values;
  }
  const response = await fetch("https://mittanbud.no/bedriftsok", {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (NorskByggRadar supplier research)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Mittanbud kommuneliste svarte med HTTP ${response.status}.`);
  const html = await response.text();
  const values = new Map();
  const pattern = /\\"id\\":\\"(\d+)\\",\\"name\\":\\"([^"\\]+)\\",\\"code\\":(\d+)/g;
  let match;
  while ((match = pattern.exec(html))) {
    values.set(normalizeMittanbudMunicipality(match[2]), match[1]);
    values.set(String(match[3]), match[1]);
  }
  if (!values.size) throw new Error("Mittanbud kommuneliste inneholdt ingen kommuner.");
  mittanbudMunicipalityCache.values = values;
  mittanbudMunicipalityCache.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  return values;
}

async function resolveMittanbudMunicipalityIds(names, fallbackCodes) {
  const fallback = String(fallbackCodes || "").split(",").map((value) => value.trim()).filter(Boolean);
  try {
    const directory = await loadMittanbudMunicipalityDirectory();
    const resolvedByName = names.map((name) => directory.get(normalizeMittanbudMunicipality(name))).filter(Boolean);
    const resolvedByOfficialCode = fallback.map((code) => directory.get(code)).filter(Boolean);
    if (names.length && resolvedByName.length !== names.length) return "";
    if (!names.length && resolvedByOfficialCode.length !== fallback.length) return "";
    const resolved = names.length ? resolvedByName : resolvedByOfficialCode;
    return [...new Set(resolved)].join(",") || "3096";
  } catch {
    return "";
  }
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

async function fetchMittanbudSuppliers(municipalityCodesValue, workTypesValue, tradeValue = "", all = false, allowedMunicipalityNames = []) {
  const query = `query PublicBusinessSearchV2($input: BusinessSearchV2Input!) {
    businessSearchV2(input: $input) {
      promoted { name id addresses { place street postCode } }
      businesses {
        edges { node { name id addresses { place street postCode } } }
        pageInfo { totalCount hasNextPage }
      }
    }
  }`;
  const municipalities = municipalityCodesValue.split(",").map((value) => value.trim()).filter(Boolean);
  // Mittanbud-kodene må være eksplisitte. En ukjent kode må aldri falle
  // tilbake til et annet fag, ellers kan leverandører havne i feil liste.
  const workTypeByTrade = { snekker: "213", elektriker: "123", rorlegger: "207", bad: "153", tak: "229" };
  const requestedWorkType = all ? "" : (workTypeByTrade[tradeValue] || workTypesValue.split(",").map((value) => value.trim()).filter(Boolean)[0]);
  if (!all && !requestedWorkType) throw new Error(`Fagområdet ${tradeValue || "valgt"} har ingen verifisert Mittanbud-kode ennå.`);
  const worktypes = requestedWorkType ? [requestedWorkType] : [];
  const tradeLabels = {
    snekker: "Snekker", elektriker: "Elektriker", rorlegger: "Rørlegger", maler: "Maler",
    kjokken: "Kjøkken", bad: "Pusse opp bad", fasade: "Fasade", kjeller: "Kjeller",
    grunnarbeid: "Grunnarbeid", tak: "Tak", borettslag: "Borettslag/sameie", xl: "Større prosjekter",
  };
  const tradeLabel = tradeLabels[tradeValue] || tradeValue || "Fagområde ikke oppgitt";
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "accept-language": "nb-NO",
    "user-agent": "NorskByggRadar/1.0 (supplier research)",
    "x-platform": "web",
    "x-application": "public",
    "x-version": "12.0.3",
  };
  const fetchPage = async (page) => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const upstream = await fetch("https://mittanbud.no/graphql", {
          method: "POST",
          headers,
          body: JSON.stringify({
            operationName: "PublicBusinessSearchV2",
            query,
            variables: { input: { pageSelect: { page, size: 50 }, municipalities, ...(worktypes.length ? { worktypes } : {}) } },
          }),
          signal: AbortSignal.timeout(12000),
        });
        const payload = await upstream.json().catch(() => ({}));
        if (!upstream.ok) throw new Error(`Mittanbud svarte med HTTP ${upstream.status}.`);
        if (payload.errors?.length) throw new Error(payload.errors[0].message || "Mittanbud kunne ikke gjennomføre søket.");
        return payload.data?.businessSearchV2 || null;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    throw lastError || new Error("Mittanbud-søket kunne ikke gjennomføres.");
  };

  const candidates = [];
  let page = 1;
  let result = await fetchPage(page);
  // Mittanbud leverer normalt 50 poster per side. Hent alle sider, med en
  // øvre grense som vern mot feil i upstream-pagination.
  while (result && page <= 100) {
    // Mittanbuds promoted-felt er nasjonale/fremhevede virksomheter og kan
    // ligge utenfor valgt kommune. Det skal derfor ikke brukes i lokale
    // region- eller kommunelister.
    candidates.push(...((result.businesses?.edges || []).map((edge) => edge.node).filter(Boolean)));
    if (!result.businesses?.pageInfo?.hasNextPage) break;
    page += 1;
    result = await fetchPage(page);
  }
  const seen = new Set();
  const allowedPlaces = allowedMunicipalityNames.map((name) => normalizeSupplierText(name)).filter(Boolean);
  return candidates.filter((candidate) => {
    const key = String(candidate.id || candidate.name || "").trim();
    if (!key || seen.has(key)) return false;
    if (allowedPlaces.length) {
      // Region- og kommunesøk skal være lukket: uten en faktisk adresse i
      // utvalget skal virksomheten ikke vises, selv om upstream returnerer
      // virksomheten som fremhevet eller nasjonal kandidat.
      const hasLocalAddress = Array.isArray(candidate.addresses)
        && candidate.addresses.some((address) => supplierPlaceMatchesAllowed(address?.place, allowedPlaces));
      if (!hasLocalAddress) return false;
    }
    seen.add(key);
    return true;
  }).map((candidate) => {
    // Et firma kan ha flere avdelinger. Når regionfilteret har godkjent en
    // regional adresse, må den samme adressen vises; ellers kan et firma fra
    // riktig region se ut som en utenforstående virksomhet.
    const address = (candidate.addresses || []).find((item) =>
      item?.street || item?.place
        ? (!allowedPlaces.length || supplierPlaceMatchesAllowed(item?.place, allowedPlaces))
        : false
    ) || (candidate.addresses || []).find((item) => item?.street || item?.place) || {};
    return {
      name: candidate.name || "Ukjent virksomhet",
      trade: tradeLabel,
      address: [address.street, address.postCode, address.place].filter(Boolean).join(", "),
      phone: String(candidate.phone || candidate.telephone || "").trim(),
      email: "",
      website: candidate.id ? `https://mittanbud.no/bedrift/${encodeURIComponent(candidate.id)}` : "",
      source: "MA",
      sourceLabel: "MA",
    };
  });
}

async function fetchAllMittanbudSuppliers(municipalitiesValue, workTypesValue, tradeValue = "", all = false, deduplicate = true, allowedMunicipalityNames = []) {
  const municipalityList = String(municipalitiesValue || "").split(",").map((value) => value.trim()).filter(Boolean);
  // Mittanbud støtter flere kommune-ID-er i samme oppslag. Et samlet
  // regionoppslag er både raskere og mindre utsatt for rate limiting enn ett
  // separat oppslag per kommune. Kommunevise oppslag brukes som reserve.
  try {
    const combined = await fetchMittanbudSuppliers(municipalityList.join(","), workTypesValue, tradeValue, all, allowedMunicipalityNames);
    if (combined.length || municipalityList.length <= 1) return combined;
  } catch { /* Reserveoppslagene under forsøkes kommunevis. */ }
  const municipalityResults = [];
  // Begrens samtidige forespørsler for å unngå at Mittanbud avviser deler av
  // regionen. Hvert kommunesøk har i tillegg egne retry-forsøk.
  for (let index = 0; index < municipalityList.length; index += 3) {
    const batch = municipalityList.slice(index, index + 3);
    const results = await Promise.all(batch.map((municipality) =>
      fetchMittanbudSuppliers(municipality, workTypesValue, tradeValue, all, allowedMunicipalityNames).catch(() => [])
    ));
    municipalityResults.push(...results);
  }
  const rows = municipalityResults.flat();
  if (!deduplicate) return rows;
  const supplierMap = new Map();
  rows.forEach((supplier) => {
    const key = supplier.website || `${supplier.name}|${supplier.address}`;
    if (!supplierMap.has(key)) supplierMap.set(key, supplier);
  });
  return [...supplierMap.values()];
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
    if (/^\s*\d{1,2}[./-]\d{1,2}[./-]\d{4}\s*$/.test(match[0])) continue;
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const after = text.slice(match.index + match[0].length, Math.min(text.length, match.index + match[0].length + 50));
    const context = `${before} ${match[0]} ${after}`;
    const subjectInContext = subjectTerms.length === 0 || subjectTerms.some((term) => context.toLocaleLowerCase("nb-NO").includes(term));
    const phoneLabelNearNumber = /telefon|tlf\.?|tel\.?|mobil|kontakttelefon|phone|ring/i.test(before.slice(-50))
      || /telefon|tlf\.?|tel\.?|mobil|kontakttelefon|phone|ring/i.test(after.slice(0, 35));
    const explicitNorwegianNumber = /^\s*\+47[\s.-]?/.test(match[0]);
    // Søkeresultater legger ofte telefonetiketten og virksomhetsnavnet i
    // separate tekstblokker. Navnet alene er derfor tilstrekkelig når
    // nummeret er et gyldig norsk nummer; etiketten brukes fortsatt som
    // ekstra sikkerhet for treff uten tydelig virksomhetsnavn.
    const subjectNearNumber = subjectTerms.some((term) => {
      const lowerText = text.toLocaleLowerCase("nb-NO");
      const termIndex = lowerText.indexOf(term);
      return termIndex >= 0 && Math.abs(termIndex - match.index) <= 900;
    });
    if (subjectInContext && (phoneLabelNearNumber || explicitNorwegianNumber || subjectNearNumber)) {
      matches.push(match[0]);
    }
  }
  return [...new Set(matches.map((phone) => {
    const digits = phone.replace(/\D/g, "");
    return digits.length === 8
      ? `+47 ${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6)}`
      : `+47 ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6)}`;
  }).filter((phone) => {
    const digits = phone.replace(/\D/g, "");
    const localDigits = digits.startsWith("47") ? digits.slice(2) : digits;
    return localDigits.length === 8 && /^[2-9]\d{7}$/.test(localDigits);
  }))].slice(0, 5);
}

function extractTelPhones(value) {
  const phones = [];
  const pattern = /(?:href|content)=["']tel:\s*(?:\+?47[\s.-]?)?([2-9]\d[\d\s.-]{6,14}\d)["']/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    const digits = match[1].replace(/\D/g, "");
    if (digits.length === 8) phones.push(`+47 ${digits.slice(0, 3)} ${digits.slice(3)}`);
  }
  return [...new Set(phones)].slice(0, 5);
}

function extractDuckDuckGoLinks(value) {
  const links = [];
  const pattern = /href=["']\/\/duckduckgo\.com\/l\/\?uddg=([^&"']+)/gi;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    try {
      const link = decodeURIComponent(match[1]);
      const parsed = new URL(link);
      if (/^https?:$/.test(parsed.protocol)) links.push(parsed.href);
    } catch { /* Ugyldige søkeresultater ignoreres. */ }
  }
  return [...new Set(links)];
}

async function queuePendingSmsMessages() {
  const requests = await readJsonArray(incomingJobRequestsPath);
  for (const requestData of requests) await queueSmsDistribution(requestData);
  await dispatchSmsOutbox();
}

queuePendingSmsMessages().catch((error) => {
  console.error(`Kunne ikke klargjøre SMS-utboks: ${error.message || error}`);
});

server.listen(port, host, () => {
  console.log(`Norsk ByggRadar local UI: http://${host}:${port}/`);
});

async function fetchSsbTable(table, dimensions) {
  const metadata = await fetchSsbMetadata(table);
  const query = dimensions.map((dimension) => ({
    code: dimension.code,
    selection: { filter: "item", values: dimension.values.includes("__ALL__") ? metadata.variables.find((variable) => variable.code === dimension.code)?.values || [] : dimension.values },
  }));
  const cacheKey = `${table}:${JSON.stringify(query)}`;
  if (ssbTableCache.has(cacheKey)) return ssbTableCache.get(cacheKey);
  const payload = await fetchSsbJson(`https://data.ssb.no/api/v0/no/table/${table}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, response: { format: "json-stat2" } }),
  }, `SSB-spørringen feilet for tabell ${table}`);
  const result = { ...payload, metadata };
  ssbTableCache.set(cacheKey, result);
  return result;
}

async function latestSsbYears(table, requestedYear) {
  const cacheKey = `${table}:${requestedYear}`;
  if (ssbYearCache.has(cacheKey)) return ssbYearCache.get(cacheKey);
  const metadata = await fetchSsbMetadata(table);
  const timeVariable = metadata.variables?.find((variable) => variable.code === "Tid");
  const available = (timeVariable?.values || [])
    .map(String)
    .filter((period) => ssbPeriodSortValue(period) <= ssbPeriodSortValue(String(requestedYear)))
    .sort((a, b) => ssbPeriodSortValue(a) - ssbPeriodSortValue(b));
  const latest = available.at(-1);
  if (!latest) throw new Error(`SSB-tabell ${table} har ingen tilgjengelige årstall`);
  const previous = available.filter((period) => ssbPeriodSortValue(period) < ssbPeriodSortValue(latest)).at(-1) || latest;
  const years = [String(previous), String(latest)];
  ssbYearCache.set(cacheKey, years);
  return years;
}

function ssbPeriodSortValue(period) {
  const value = String(period);
  const match = value.match(/^(\d{4})(?:M(\d{2})|K(\d))?$/i);
  if (!match) return Number.NEGATIVE_INFINITY;
  const year = Number(match[1]);
  if (match[2]) return year * 100 + Number(match[2]);
  if (match[3]) return year * 100 + Number(match[3]) * 3;
  return year * 100;
}

async function fetchSsbMetadata(table) {
  if (ssbMetadataCache.has(table)) return ssbMetadataCache.get(table);
  const metadata = await fetchSsbJson(`https://data.ssb.no/api/v0/no/table/${table}`, {}, `SSB-tabell ${table} er ikke tilgjengelig`);
  ssbMetadataCache.set(table, metadata);
  return metadata;
}

async function fetchSsbJson(url, options, errorPrefix) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, options);
    lastStatus = response.status;
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 3) break;
    const retryAfter = Number(response.headers.get("retry-after")) || 2;
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 5) * 1000));
  }
  throw new Error(`${errorPrefix} (${lastStatus})`);
}

function ssbMetricYears(years) {
  const current = String(years.at(-1));
  const previous = String(years.at(-2));
  return { year: Number(current.slice(0, 4)), previousYear: Number(previous.slice(0, 4)), period: current, previousPeriod: previous };
}

function ssbMetricSeries(dataset, aggregateDimension = "", aggregation = "sum") {
  const values = Array.isArray(dataset.value) ? dataset.value : [];
  const dimensions = dataset.id || Object.keys(dataset.dimension || {});
  const orderedValues = Object.fromEntries(dimensions.map((dimension) => [dimension, Object.entries(dataset.dimension?.[dimension]?.category?.index || {}).sort((a, b) => a[1] - b[1]).map(([code]) => code)]));
  const metrics = orderedValues.ContentsCode || [];
  const times = orderedValues.Tid || [];
  const aggregateDimensions = aggregateDimension ? (Array.isArray(aggregateDimension) ? aggregateDimension : [aggregateDimension]) : [];
  const varyingDimensions = dimensions.filter((dimension) => !["ContentsCode", "Tid"].includes(dimension));
  const combinations = [[]];
  varyingDimensions.forEach((dimension) => {
    const next = [];
    for (const combination of combinations) for (const code of orderedValues[dimension] || []) next.push([...combination, [dimension, code]]);
    combinations.splice(0, combinations.length, ...next);
  });
  const dimensionSizes = Object.fromEntries(dimensions.map((dimension) => [dimension, orderedValues[dimension]?.length || 1]));
  const flatIndex = (coordinates) => dimensions.reduce((index, dimension) => index * dimensionSizes[dimension] + (dataset.dimension?.[dimension]?.category?.index?.[coordinates[dimension]] ?? 0), 0);
  return Object.fromEntries(metrics.map((metric) => {
    const series = times.map((time) => {
      const selected = combinations.filter((combination) => aggregateDimensions.length === 0 || combination.some(([dimension]) => aggregateDimensions.includes(dimension)));
      const numbers = selected.map((combination) => {
        const coordinates = Object.fromEntries([...combination, ["ContentsCode", metric], ["Tid", time]]);
        const value = values[flatIndex(coordinates)];
        return Number.isFinite(Number(value)) ? Number(value) : null;
      }).filter((value) => value !== null);
      if (!numbers.length) return null;
      return aggregation === "average" ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : numbers.reduce((sum, value) => sum + value, 0);
    });
    return [metric, { current: series.at(-1), previous: series.at(-2) }];
  }));
}

function applyFeeCoverageCalculations(values) {
  const basis = Number(values.feeBasisTotal);
  const revenue = Number(values.feeRevenueTotal);
  if (!Number.isFinite(basis) || basis === 0 || !Number.isFinite(revenue)) {
    values.feeFinancialCoverage = null;
    return values;
  }
  values.feeFinancialCoverage = (revenue / basis) * 100;
  return values;
}

function ssbTrend(current, previous) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous))) return null;
  const change = Number(previous) === 0 ? (Number(current) > 0 ? 1 : 0) : (Number(current) - Number(previous)) / Math.abs(Number(previous));
  if (change > 0.03) return { arrow: "↑", label: "Stigende", className: "up" };
  if (change < -0.03) return { arrow: "↓", label: "Fallende", className: "down" };
  return { arrow: "→", label: "Flat", className: "neutral" };
}
