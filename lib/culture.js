/**
 * CULTURAL CANON (user decision: "follow a cultural canon, not a global one"):
 * the proposals shown to a user are weighted by the canon of THEIR language
 * and culture — Verdi weighs more for an Italian listener, Händel for a
 * German one, Tchaikovsky for a Russian one — on top of the shared global
 * canon (lib/popularity.js CANON) and the community listening chart.
 *
 * Detection: navigator.languages → culture key; overridable persistently via
 * `pf.culture` (the explicit choice always wins over detection).
 *
 * ANTI-HALLUCINATION SCOPE: these tables are a RANKING PRIOR (order of
 * presentation), never a factual claim: every proposed artist still comes
 * from the shared catalog / real archive.org items (R1–R6 unchanged). The
 * lists stay conservative (figures already central to the public-domain
 * repertoire of each culture) — a name missing here only means "no cultural
 * boost", never "excluded".
 */

import { setCultureCanon } from "./popularity.js";

const CULTURE_KEY = "pf.culture";

/** Language → culture key (first match wins, longest prefix first). */
const LANG_TO_CULTURE = [
  ["it", "it"], ["en", "en"], ["de", "de"], ["fr", "fr"], ["es", "es"],
  ["pt", "pt"], ["ru", "ru"], ["ja", "ja"], ["zh", "zh"], ["ko", "ko"],
  ["nl", "nl"], ["pl", "pl"], ["sv", "sv"], ["no", "no"], ["da", "da"],
  ["fi", "fi"], ["cs", "cs"], ["el", "el"], ["tr", "tr"], ["ar", "ar"],
  ["he", "he"], ["hi", "hi"], ["id", "id"],
];

/**
 * Per-culture canon boost: artist key (canonKey-normalized) → extra tier
 * (added on top of the global CANON tier, capped at 10).
 * Figures already in the global table keep their tier and gain affinity;
 * culture-central names absent from the global table enter the canon.
 */
export const CULTURAL_CANON = {
  // Italian culture: opera is the national canon (already global-heavy).
  it: {
    "enrico caruso": 3, "titta ruffo": 2,
    "fedele fenaroli": 2, "giovanni pierluigi da palestrina": 3,
    "orlando di lasso": 2, "arcangelo corelli": 2, "pietro locatelli": 2,
    "tomaso albinoni": 2, "baldassare galuppi": 2, "giovanni battista pergolesi": 2,
    "luigi boccherini": 2, "muzio clementi": 2, "saverio mercadante": 2,
    "giovanni bottesini": 2, "amilcare ponchielli": 2, "alfredo catalani": 2,
    "francesco cilea": 2, "umberto giordano": 2, "ruggero leoncavallo": 1,
  },
  // Anglo culture: early American/British public repertoire.
  en: {
    "stephen foster": 3, "scott joplin": 3, "john philip sousa": 3,
    "irving berlin": 2, "george gershwin": 2, "jerome kern": 2,
    "cole porter": 2, "richard rodgers": 2, "duke ellington": 2,
    "bessie smith": 2, "lead belly": 2, "woody guthrie": 2,
    "henry purcell": 2, "william byrd": 2, "thomas tallis": 2,
    "john dowland": 2, "george frideric handel": 1, "edward elgar": 1,
    "arthur sullivan": 2, "ralph vaughan williams": 2, "gustav holst": 1,
  },
  // German culture: the German-speaking classical heartland.
  de: {
    "george frideric handel": 3, "joseph haydn": 2, "felix mendelssohn": 2,
    "robert schumann": 2, "clara schumann": 3, "fanny mendelssohn": 3,
    "carl maria von weber": 2, "carl philipp emanuel bach": 3,
    "johann christian bach": 2, "dietrich buxtehude": 3,
    "heinrich schütz": 3, "johannes ockeghem": 1, "jacob obrecht": 2,
    "max reger": 2, "carl orff": 2, "paul hindemith": 2,
    "arnold schoenberg": 2, "alban berg": 2, "anton webern": 2,
    "hugo wolf": 1, "franz liszt": 1, "friedrich siletius": 0,
  },
  // French culture.
  fr: {
    "claude debussy": 2, "maurice ravel": 2, "erik satie": 3,
    "camille saint-saëns": 2, "gabriel fauré": 3, "césar franck": 2,
    "hector berlioz": 3, "jules massenet": 2, "charles gounod": 2,
    "georges bizet": 3, "jacques offenbach": 3, "léo delibes": 2,
    "francis poulenc": 2, "darius milhaud": 2, "arthur honegger": 2,
    "olivier messiaen": 2, "guillaume de machaut": 3, "josquin des prez": 2,
  },
  // Hispanic culture.
  es: {
    "manuel de falla": 3, "isaac albéniz": 3, "enrique granados": 3,
    "joaquín turina": 3, "heitor villa-lobos": 1,
    "agustín barrios": 3, "fernando sor": 3, "mauro giuliani": 1,
    "tomas luis de victoria": 3, "cristobal de morales": 3,
    "domenico scarlatti": 2, "vicente martín y soler": 2,
    "joaquín rodrigo": 2,
  },
  // Portuguese/Lusophone culture.
  pt: {
    "carlos seixas": 3, "joão domingos bomtempo": 3, "fernando lopes-graça": 2,
    "heitor villa-lobos": 3, "alberto nepomuceno": 3, "brasílio itiberê": 2,
    "ernesto nazareth": 3, "pixinguinha": 3, "chiquinha gonzaga": 3,
  },
  // Russian culture.
  ru: {
    "modest mussorgsky": 2, "nikolai rimsky-korsakov": 3, "mily balakirev": 3,
    "alexander scriabin": 2, "alexander borodin": 3, "cesar cui": 3,
    "mikhail glinka": 3, "anton rubinstein": 3, "sergei prokofiev": 2,
    "dmitri shostakovich": 2, "aram khachaturian": 2,
    "reinhold glière": 2, "vasily kalinnikov": 3, "anatoly lyadov": 3,
  },
  // Japanese culture (public-era: Meiji/Taishō early recordings).
  ja: {
    "rentaro taki": 3, "kosaku yamada": 3, "yamada kosaku": 3,
    "tamezo narita": 2, "nobu koda": 3,
    "rinsho kurokawa": 1,
  },
  zh: {
    "xian xinghai": 3, "liu tianhua": 3, "huang zi": 3,
    "li shutong": 3,
  },
  // Dutch culture.
  nl: { "jan pieterszoon sweelinck": 3, "alphonse diepenbrock": 3, "willem pijper": 2, "henk badings": 2 },
  // Polish culture.
  pl: {
    "frédéric chopin": 2, "karol szymanowski": 3, "stanisław moniuszko": 3,
    "ignacy jan paderewski": 3, "grazyna bacewicz": 3, "wojciech kilar": 1,
    "karol lipiński": 3, "michał kleofas ogiński": 3,
  },
  // Nordic cultures.
  sv: { "franz berwald": 3, "hugo alfven": 3, "wilhelm stenhammar": 3, "allan pettersson": 2 },
  no: { "edvard grieg": 2, "johan svendsen": 3, "christian sinding": 3, "gerhard schjelderup": 2 },
  da: { "carl nielsen": 3, "niels gade": 3, "friedrich kuhlau": 2, "rued langgaard": 3 },
  fi: { "jean sibelius": 2, "toivo kuula": 3, "leevi madetoja": 3, "einojuhani rautavaara": 1, "selim palmgren": 3 },
  cs: {
    "bedřich smetana": 2, "antonín dvořák": 2, "leoš janáček": 3,
    "bohuslav martinů": 3, "zdeněk fibich": 3,
  },
  el: { "spyridon samaras": 3, "dionysios lavrangas": 3, "manolis kalomiris": 3, "mikis theodorakis": 2 },
  tr: { "cemal reşit rey": 3, "hasan ferit alnar": 3, "ulvi cemal erkin": 3,  },
};

/**
 * Detects the user culture: explicit `pf.culture` override first, then
 * navigator.languages (longest prefix match), then "en".
 * Contract: pure read; never throws; safe outside the browser.
 * @returns {string} Culture key (see CULTURAL_CANON keys).
 */
export function detectCulture() {
  try {
    const saved = localStorage.getItem(CULTURE_KEY);
    if (saved && CULTURAL_CANON[saved]) return saved;
    const langs = navigator.languages ?? [navigator.language];
    for (const l of langs ?? []) {
      const tag = String(l ?? "").toLowerCase();
      for (const [prefix, culture] of LANG_TO_CULTURE) {
        if (tag === prefix || tag.startsWith(`${prefix}-`)) return CULTURAL_CANON[culture] ? culture : "en";
      }
    }
  } catch {}
  return "en";
}

/**
 * Persists an explicit culture choice (survives reloads, wins over detection).
 * @param {string} culture
 * @returns {void}
 */
export function setCulture(culture) {
  try { localStorage.setItem(CULTURE_KEY, String(culture)); } catch {}
}

/**
 * Activates the cultural canon for the CURRENT user: merges the culture's
 * boost table into the active canon (lib/popularity.js). Idempotent.
 * Contract: call once at shell boot, BEFORE the warm-up reads canonNames.
 * @param {string} [culture] Explicit culture (default: detectCulture()).
 * @returns {string} The culture applied.
 */
export function applyCulturalCanon(culture) {
  const c = culture ?? detectCulture();
  setCultureCanon(CULTURAL_CANON[c] ?? {});
  return c;
}
