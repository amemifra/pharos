/**
 * Project popularity index: OBJECTIVE community measures, not memorized
 * judgments.
 *
 * Formula with numeric examples:
 *
 *   score = W_SITELINKS  * log2(1 + sitelinks)   (encyclopedic notability:
 *            how many Wikipedia language communities cover the artist —
 *            the standard noteworthiness measure curated by Wikimedia)
 *         + W_PAGEVIEWS * log10(1 + pageviews_12mo)  (current attention,
 *            public Wikimedia API, independent of archive.org)
 *         + W_RECORDINGS * log2(1 + recordings)   (catalog depth)
 *         + W_DOWNLOADS  * log1p(downloads)          (tiebreaker, lowest weight)
 *         + W_CANON * canon                          (OFFLINE FALLBACK ONLY:
 *            when measures are unavailable, e.g. first launch with no network)
 *
 * Numeric example: Mozart (170 sitelinks, 9.5M views/yr) ≈ 60*log2(171) + 10*log10(9.5e6)
 * ≈ 447 + 70 = 547. An indie band with 9000 downloads but 0 sitelinks ≈ 4+9*log1p
 * ≈ 17. With sitelinks=0 and pageviews=0 (non-encyclopedic artist) the offline
 * canon weight only applies while measures are missing: data governs, and the
 * table cannot survive contrary evidence. We do not declare Mozart's supremacy,
 * we measure it.
 */

/** Formula weights: documented and discussible, no magic. */
export const W_SITELINKS = 60;   // log2: 170 sitelinks (Mozart) ≈ +447 points
export const W_PAGEVIEWS = 10;   // log10: 10M views/yr ≈ +70 points
export const W_RECORDINGS = 4;   // log2: 500 recordings ≈ +36 points
export const W_DOWNLOADS = 1;
export const W_CANON = 100;      // offline fallback only

/**
 * ACTIVE canonical table: starts from builtin defaults and is extended/
 * overridden by community data on OrbitDB (see importCanon). Synchronous to
 * use: the table is updated in place before ranking renders.
 * @type {Map<string, number>}
 */
const activeCanon = new Map();

/**
 * Replaces the active table (used by canonScore) with a new one.
 * Contract: in-place replacement; unknown keys default to 0 — no errors.
 * @param {Object} canonTable Map name → tier.
 * @returns {void}
 */
export function setActiveCanon(canonTable) {
  activeCanon.clear();
  for (const [k, v] of Object.entries(canonTable)) activeCanon.set(k, v);
}

/**
 * Loads the community canon from OrbitDB (or localStorage cache) and merges
 * it over the defaults. Local-first: if OrbitDB does not start, cache and
 * builtin still work — the app always functions, ranking improves when the
 * network is available.
 * Contract: never throws; source tells which tier of data is active.
 * @param {any} [db] Open OrbitDB keyvalue database (lib/collab.js).
 * @returns {Promise<{source: "orbitdb"|"cache"|"builtin", entries: number}>}
 */
export async function importCanon(db) {
  let table = null;
  let source = "builtin";

  if (db) {
    try {
      table = await db.get("canon");
      if (table && typeof table === "object") {
        source = "orbitdb";
        try { localStorage.setItem("pf.canon", JSON.stringify(table)); } catch {}
      }
    } catch { /* db not ready: fall through */ }
  }
  if (!table) {
    try {
      const cached = JSON.parse(localStorage.getItem("pf.canon") ?? "null");
      if (cached && typeof cached === "object") {
        table = cached;
        source = "cache";
      }
    } catch {}
  }

  if (table) setActiveCanon({ ...CANON, ...table });
  return { source, entries: activeCanon.size };
}

/**
 * Publishes an updated canon to OrbitDB (community curation).
 * Contract: merges over builtin defaults; writes are additive (partial tables OK).
 * @param {any} db Open OrbitDB database.
 * @param {Object} canonTable Full or partial table (merged over defaults).
 * @returns {Promise<string>} CID of the written entry.
 */
export async function publishCanon(db, canonTable) {
  const current = await db.get("canon");
  const merged = { ...CANON, ...(current ?? {}), ...canonTable };
  return db.put("canon", merged);
}

/**
 * Canonical importance by tier (0–10). Not a complete list: artists not in
 * the table score canon 0 and rank only on catalog/downloads signals.
 * Tier 10: absolute canon of the public classical repertoire.
 */
export const CANON = {
  // — Tier 10: the absolute fundamentals —
  "wolfgang amadeus mozart": 10,
  "ludwig van beethoven": 10,
  "johann sebastian bach": 10,
  "mozart": 10,
  "beethoven": 10,
  "bach": 10,
  // — Tier 9 —
  "johannes brahms": 9,
  "franz schubert": 9,
  "pyotr ilyich tchaikovsky": 9,
  "giuseppe verdi": 9,
  "richard wagner": 9,
  "frédéric chopin": 9,
  "frederic chopin": 9,
  // — Tier 8 —
  "antonio vivaldi": 8,
  "george frideric handel": 8,
  "georg friedrich händel": 8,
  "joseph haydn": 8,
  "claude debussy": 8,
  "maurice ravel": 8,
  "robert schumann": 8,
  "felix mendelssohn": 8,
  "franz liszt": 8,
  "gioachino rossini": 8,
  "gaetano donizetti": 8,
  "richard strauss": 8,
  "igor stravinsky": 8,
  "sergei rachmaninoff": 8,
  "sergei rachmaninov": 8,
  "edvard grieg": 8,
  "antonín dvořák": 8,
  "antonin dvorak": 8,
  "giacomo puccini": 8,
  // — Tier 7: great repertoire and early 20th century —
  "schumann": 7, "mendelssohn": 7, "handel": 7, "vivaldi": 7,
  "eric satie": 7, "erik satie": 7,
  "bedřich smetana": 7, "bedrich smetana": 7,
  "camille saint-saëns": 7, "gabriel fauré": 7, "gabriel faure": 7,
  "gustav mahler": 7, "anton bruckner": 7, "hugo wolf": 7,
  "modest mussorgsky": 7, "mily balakirev": 7, "nikolai rimsky-korsakov": 7,
  "alexander scriabin": 7, "alexander scorpio": 7,
  "manuel de falla": 7, "isaac albéniz": 7, "enrique granados": 7,
  "edward elgar": 7, "gustav holst": 7, "jean sibelius": 7,
  "carl maria von weber": 7, "hector berlioz": 7, "charles gounod": 7,
  "jules massenet": 7, "césar franck": 7, "cesar franck": 7,
  "vincent d'indy": 7, "leoncavallo": 7, "ruggero leoncavallo": 7,
  "pietro mascagni": 7, "arrigo boito": 7,
  // — Tier 6: jazz and adjacent, essentials of the public repertoire —
  "scott joplin": 6, "stephen foster": 6,
};

// Initialize the active table from the defaults (CANON is now declared).
for (const [k, v] of Object.entries(CANON)) activeCanon.set(k, v);

/**
 * Canonical key for an artist name: lowercase, stripped of punctuation and
 * trailing articles/nobility particles.
 * Contract: pure; two names mapping to the same key are the same artist.
 * @param {string} name Raw artist name.
 * @returns {string} Normalized key.
 */
function canonKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // accents
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+(the|a|de|di|van|von|da|del)$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Canonical importance of an artist (0 when not in the table).
 * Contract: fuzzy matching only applies to tier ≥ 9 to avoid false positives;
 * "Mozart", "W A Mozart", "J S Bach" all resolve via containment.
 * @param {string} name Artist name.
 * @returns {number} Tier 0–10.
 */
export function canonScore(name) {
  const key = canonKey(name);
  if (activeCanon.get(key) != null) return activeCanon.get(key);
  // Tolerance: "mozart", "w a mozart" → containment match on the canonical key
  for (const [k, v] of activeCanon.entries()) {
    if (v < 9) continue;
    if (key.includes(k)) return v;
    if (key.length >= 5 && k.includes(key)) return v;
  }
  return 0;
}

/**
 * Computes an artist's popularity score.
 * Contract: deterministic; when sitelinks is undefined (measures not yet
 * loaded) only the offline canonical fallback is added.
 * @param {string} name Artist name.
 * @param {{recordings?: number, downloads?: number, sitelinks?: number, pageviews?: number}} [signals]
 *     sitelinks/pageviews: Wikimedia measures (lib/notability.js).
 * @returns {number} Unbounded score; higher = more popular.
 */
export function popularityScore(name, { recordings = 0, downloads = 0, sitelinks, pageviews } = {}) {
  const measured =
    W_SITELINKS * Math.log2(1 + (sitelinks ?? 0)) +
    W_PAGEVIEWS * Math.log10(1 + (pageviews ?? 0)) +
    W_RECORDINGS * Math.log2(1 + recordings) +
    W_DOWNLOADS * Math.log1p(downloads);
  // Canonical fallback only when the encyclopedic measure is missing.
  const fallback = sitelinks == null ? W_CANON * canonScore(name) : 0;
  return measured + fallback;
}

/**
 * Sorts an artist list by popularity: Wikimedia measures first, then (for
 * artists without measures) canonical fallback and catalog signals.
 * Contract: does not mutate the input; returns copies with `score` attached.
 * @param {{name: string, recordings?: number, downloads?: number, sitelinks?: number, pageviews?: number}[]} artists
 * @returns {{name: string, score: number}[]} Sorted descending by score.
 */
export function rankArtists(artists) {
  return artists
    .map((a) => ({ ...a, score: popularityScore(a.name, a) }))
    .sort((x, y) => y.score - x.score);
}

/** Canonical key of an artist name (exported for candidate dedup). */
export { canonKey };

/** Names in the active canon table (static CANON + any P2P-imported table). */
export function canonNames() {
  return [...activeCanon.keys()];
}
