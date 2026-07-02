// Woninggegevens-opzoekmodule: haalt bouwjaar, gebruiksoppervlakte, perceelgrootte en
// historische WOZ-waarden op voor een adres.
//
// Alle drie de bronnen hieronder zijn publieke, gratis Nederlandse overheids-API's zonder
// API-sleutel en met open CORS, dus dit kan volledig los van een backend in de browser
// draaien:
//   - PDOK Locatieserver: adres -> BAG- en kadaster-identificaties.
//   - PDOK BAG WFS (service.pdok.nl/lv/bag/wfs): bouwjaar en gebruiksoppervlakte. Dit is
//     de vrij toegankelijke BAG-kaartendienst, niet de sleutelverplichte Kadaster
//     "individuelebevragingen"-API.
//   - api.kadaster.nl/lvwoz/wozwaardeloket-api: dit is de daadwerkelijke, publieke API die
//     wozwaardeloket.nl zelf in de browser aanroept (gevonden via assets/endpoints.json op
//     die site). Geen scraping of nagebootste sessie nodig: het is een documentloos maar
//     volledig open JSON-endpoint.

const PDOK_LOCATIESERVER_BASE = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';
const BAG_WFS_URL = 'https://service.pdok.nl/lv/bag/wfs/v2_0';
const WOZ_API_BASE = 'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Verzoek naar ${new URL(url).hostname} gaf status ${res.status}`);
  }
  return res.json();
}

// Stap A: adres -> BAG-identificaties via PDOK Locatieserver.
async function findAddress(addressString) {
  const url = `${PDOK_LOCATIESERVER_BASE}/free?q=${encodeURIComponent(addressString)}&fq=type:adres&rows=1`;
  const data = await fetchJson(url);
  const doc = data?.response?.docs?.[0];
  if (!doc) {
    throw new Error('Adres niet gevonden. Controleer straat, huisnummer en plaats.');
  }
  // BAG-identificaties zijn altijd 16 tekens; sommige bronnen leveren ze zonder leading
  // zeros aan, dus expliciet opvullen om WFS-vergelijkingen niet te laten mislukken.
  const adresseerbaarobjectId = String(doc.adresseerbaarobject_id ?? '').padStart(16, '0');
  return {
    weergavenaam: doc.weergavenaam,
    postcode: doc.postcode,
    huisnummer: doc.huisnummer,
    adresseerbaarobjectId,
    perceelAanduiding: doc.gekoppeld_perceel?.[0] ?? null,
  };
}

// Stap B: grondoppervlakte (perceelgrootte) in m2 via PDOK.
// Niet elk adres heeft een eigen, gekoppeld perceel (bijv. bij appartementsrechten delen
// meerdere adressen hetzelfde perceel zonder 1-op-1 koppeling); dan geeft dit null terug.
async function findPerceelGrootte(perceelAanduiding) {
  if (!perceelAanduiding) return null;
  const url = `${PDOK_LOCATIESERVER_BASE}/free?q=${encodeURIComponent(perceelAanduiding)}&fq=type:perceel&rows=1`;
  const data = await fetchJson(url);
  const doc = data?.response?.docs?.[0];
  return doc?.kadastrale_grootte ?? null;
}

// Stap C: bouwjaar en gebruiksoppervlakte via de gratis, open BAG-kaartendienst (WFS) van
// PDOK. PDOK's WFS gebruikt een deegree-achtige engine die het GeoServer-specifieke
// CQL_FILTER negeert; een standaard OGC-XML-filter is wel vereist.
async function findBagKenmerken(adresseerbaarobjectId) {
  const filter =
    `<Filter xmlns="http://www.opengis.net/ogc"><PropertyIsEqualTo>` +
    `<PropertyName>identificatie</PropertyName><Literal>${adresseerbaarobjectId}</Literal>` +
    `</PropertyIsEqualTo></Filter>`;
  const url =
    `${BAG_WFS_URL}?service=WFS&version=2.0.0&request=GetFeature&typeName=bag:verblijfsobject` +
    `&outputFormat=application/json&filter=${encodeURIComponent(filter)}`;
  const data = await fetchJson(url);
  const props = data?.features?.[0]?.properties;
  if (!props) {
    throw new Error('Geen BAG-kenmerken gevonden voor dit adres.');
  }
  return {
    bouwjaar: props.bouwjaar ?? null,
    gebruiksoppervlakte: props.oppervlakte ?? null,
    gebruiksdoel: props.gebruiksdoel ?? null,
    status: props.status ?? null,
  };
}

// Stap D: historische WOZ-waarden via de publieke wozwaardeloket-API.
async function findWozHistorie(postcode, huisnummer) {
  const query = `${postcode} ${huisnummer}`;
  const suggestUrl = `${WOZ_API_BASE}/suggest?q=${encodeURIComponent(query)}`;
  const suggestData = await fetchJson(suggestUrl);
  const docs = suggestData?.docs ?? [];
  const match =
    docs.find((d) => d.postcode === postcode && String(d.huisnummer) === String(huisnummer)) ??
    docs[0];
  if (!match) {
    throw new Error('Geen WOZ-object gevonden voor dit adres.');
  }
  const wozUrl = `${WOZ_API_BASE}/wozwaarde/wozobjectnummer/${match.wozobjectnummer}`;
  const wozData = await fetchJson(wozUrl);
  const waarden = (wozData?.wozWaarden ?? [])
    .slice()
    .sort((a, b) => new Date(b.peildatum) - new Date(a.peildatum));
  return {
    wozobjectnummer: match.wozobjectnummer,
    waarden,
  };
}

// Hoofdfunctie: doorloopt stap A (verplicht) t/m D (elk onafhankelijk) en geeft per
// onderdeel een apart resultaat/foutstatus terug, zodat één mislukte bron (bijv. geen
// gekoppeld perceel) de andere onderdelen niet blokkeert.
export async function getCompleteHousingData(addressString) {
  const address = await findAddress(addressString);

  const [perceelResult, bagResult, wozResult] = await Promise.allSettled([
    findPerceelGrootte(address.perceelAanduiding),
    findBagKenmerken(address.adresseerbaarobjectId),
    findWozHistorie(address.postcode, address.huisnummer),
  ]);

  return {
    address,
    grondoppervlakte: perceelResult.status === 'fulfilled' ? perceelResult.value : null,
    grondoppervlakteError: perceelResult.status === 'rejected' ? perceelResult.reason.message : null,
    bag: bagResult.status === 'fulfilled' ? bagResult.value : null,
    bagError: bagResult.status === 'rejected' ? bagResult.reason.message : null,
    woz: wozResult.status === 'fulfilled' ? wozResult.value : null,
    wozError: wozResult.status === 'rejected' ? wozResult.reason.message : null,
  };
}
