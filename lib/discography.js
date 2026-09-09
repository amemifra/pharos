/**
 * Cross-reference between canonical discography catalogs and actual availability.
 *
 * The catalog inverse problem: until now we started from dirty data and
 * normalized it. The correct direction is the opposite: start from the
 * CANONICAL catalog (MusicBrainz release-groups: community-curated, one stable
 * ID per album) and measure COVERAGE — what exists officially vs what is
 * actually available from our open legal sources (archive.org).
 *
 * Output per artist:
 *   { canonical: [{title, year, type, mbid}], available: N, missing: M }
 * Each entry gets status:
 *   "available" — matched an archive.org item (trigram ≥ 0.62 + year ±2)
 *   "missing"   — canonical but not found → catalog gap, drives acquisition
 *
 * All MusicBrainz data is factual metadata under CC0: caching it locally and
 * sharing it via OrbitDB is legal and encouraged by MusicBrainz itself.
 */

import { searchArchiveAll, escapeLucene } from "./archive.js";
import { mbRequest } from "./mbgate.js";
import { normalizeSearchItem } from "./pipeline.js";
import { catalogMemo, keys, UNVERIFIED_TTL_MS } from "./catalogstore.js";
import { parseWork } from "./classical.js";
import { SOURCE_COLLECTION_QUERY } from "./catalog.js";

const MB_RG = "https://musicbrainz.org/ws/2/release-group";
const MB_DELAY_MS = 1100; // community rate limit: 1 req/s
let lastMbCall = 0;

async function mbThrottle() {
  const wait = lastMbCall + MB_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMbCall = Date.now();
}

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Trigram-Dice similarity (same objective measure used in canonical.js). */
export function trigram(a, b) {
  const gram = (s) => { const g = new Set(); for (let i = 0; i < s.length - 2; i++) g.add(s.slice(i, i + 3)); return g; };
  const A = gram(norm(a)), B = gram(norm(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Canonical discography of an artist from MusicBrainz (album release-groups).
 * @param {string} mbid MusicBrainz artist ID (stable, community-maintained).
 * @param {number} [limit=100]
 * @returns {Promise<{title: string, year: number|null, type: string, mbid: string}[]>}
 */
export async function canonicalDiscography(mbid, limit = 100) {
  // Catalog-cached (P2P): an artist's release-group list essentially never
  // changes — permanent key, zero repeat calls across the whole network.
  const cacheKey = `rg:${mbid}`;
  try {
    const store = await import("./catalogstore.js");
    const hit = await store.catalogGet(cacheKey);
    if (hit) return hit;
  } catch {}

  // Paginated fetch: `limit` is a PAGE size, not a catalog cap. MusicBrainz
  // returns at most `limit` release-groups per call; we walk `offset` until
  // the source is exhausted OR the bounded budget is hit (MAX_PAGES):
  // canonical artists like Beethoven have 6000+ release-groups (mostly
  // compilation/bootleg editions) and paging all of them costs minutes of
  // rate-limited quota for entries the availability matching (≤ a few
  // hundred archive.org items) could never use anyway.
  const PAGE = Math.min(limit, 100); // MB hard page cap is 100
  const MAX_PAGES = 5;               // 500 canonical entries: bounded, honest
  const all = [];
  for (let offset = 0, pages = 0; pages < MAX_PAGES; offset += PAGE, pages++) {
    const url = `${MB_RG}?artist=${mbid}&type=album|ep&fmt=json&limit=${PAGE}&offset=${offset}`;
    const res = await mbRequest(url, { priority: "background" }); // warm-up traffic
    if (!res.ok) break; // partial failure: return what we have (honest subset)
    const json = await res.json();
    const page = json["release-groups"] ?? [];
    all.push(...page);
    if (page.length < PAGE) break; // exhausted
  }

  const out = all.map((rg) => ({
    title: rg.title,
    // first-release-date can be just a year
    year: rg["first-release-date"] ? Number(String(rg["first-release-date"]).slice(0, 4)) : null,
    type: rg["primary-type"] ?? "",
    mbid: rg.id,
  }));
  if (out.length) {
    try {
      const store = await import("./catalogstore.js");
      store.catalogSet(cacheKey, out);
    } catch {}
  }
  return out;
}

/**
 * Resolve artist name → MusicBrainz artist MBID (exact-match preferred).
 * @param {string} name
 * @returns {Promise<{mbid: string, score: number}|null>}
 */
export async function resolveArtistMbid(name, { priority = "user" } = {}) {
  const headers = typeof window === "undefined" ? { "User-Agent": "Pharos/0.1 (catalog crossref)" } : undefined;
  // Priority is caller-declared: interactive pages resolve at "user", the
  // warm-up/fill engine at "background" — the warm-up must NEVER compete at
  // user priority (it did before: the shared per-IP quota was consumed by
  // background work and /artist saw "temporarily unreachable").
  const res = await mbRequest(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${escapeLucene(name)}"`)}&fmt=json&limit=5`, { priority });
  if (!res.ok) return null;
  const json = await res.json();
  const artists = json.artists ?? [];
  if (!artists.length) return null;
  // exact normalized name match wins over score
  const exact = artists.find((a) => norm(a.name) === norm(name));
  return { mbid: (exact ?? artists[0]).id, score: (exact ?? artists[0]).score / 100 };
}

const MATCH_THRESHOLD = 0.62; // trigram: below this we prefer "missing" over a wrong match
/**
 * Bump when the matching logic changes in a way that invalidates previously
 * computed crossrefs: cached records stamped with an older version are
 * recomputed on read (quality-driven cache lifecycle, see crossReference).
 */
export const MATCHER_VERSION = 3;

/**
 * Edition containment: "<Work> (Deluxe|Remaster|Mono|...)" IS the work. A
 * bounded trigram misses it (short titles dilute fast: "Revolver" vs "Revolver
 * (Deluxe)" ≈ 0.38) and the year window rejects reissue dates (1966 vs 2022).
 * Rule: one normalized title starts with the other AND the remainder is pure
 * edition vocabulary ("deluxe", "remaster", "mono", "vol. 2", ...). Real
 * different albums fail it: "With The Beatles" ⊄ "With The Beatles (Purple
 * Chick...)" only if the tail is edition words — "purple chick" is not.
 * Contract: pure; both titles ≥ 5 chars (no "1"-style RGs).
 */
const EDITION_TAIL = /^(?:(?:super|special|deluxe|expanded|remastered?|remastered?\s+edition|remix(?:ed)?|anniversary|mono|stereo|reissue|edition|version|mix|digitally\s+remastered|vol(?:ume)?\.?\s*\d*|part\s*\d+)[\s()\-–—.]*)+$/i;
function editionMatch(rgTitle, itemTitle) {
  const a = norm(rgTitle);
  const b = norm(itemTitle);
  if (a.length < 5 || b.length < 5) return false;
  // norm() leaves a leading space where punctuation separated the words
  // ("revolver (deluxe)" → "revolver deluxe"): strip glue from the tail head.
  const tail = (t) => t.replace(/^[\s()\-–—.]+/, "");
  if (b.startsWith(a) && EDITION_TAIL.test(tail(b.slice(a.length)))) return true;
  if (a.startsWith(b) && EDITION_TAIL.test(tail(a.slice(b.length)))) return true;
  return false;
}

/**
 * Full cross-reference for an artist: canonical catalog × source availability.
 * Memoized in the shared OrbitDB catalog (lib/catalogstore.js): the first peer
 * to visit an artist computes and publishes it; everyone else reads it.
 * @param {string} artistName
 * @param {Object} [opts]
 * @param {string} [opts.sourceCollection] archive.org collection query (defaults to SOURCE_COLLECTION_QUERY: every open music collection, not just audio_music).
 * @returns {Promise<{artist: string, entries: Array, available: number, missing: number, coverage: number}>}
 */
/**
 * The canonical × source matcher (pure, exported for DQ testing).
 * For each canonical release-group: best available match by trigram + year
 * window, under honesty guards:
 *   IDENTITY GUARD — an item whose title adds nothing beyond the artist name
 *   ("The Beatles", "20150205 The-Beatles") is a collection/artist page, not
 *   an identified album: trigram would match on the ARTIST name, not album
 *   identity, and any same-named release-group would "match". Such items stay
 *   out of the canonical discography — honest missing beats a wrong match.
 *   ONE ITEM, ONE ALBUM — the same archive.org item cannot stand for multiple
 *   canonical releases: if several release-groups claim it, only the highest
 *   score wins, the others stay missing.
 *   EDITION CONTAINMENT — "<Work> (Deluxe|Remaster|...)" IS the work (see
 *   editionMatch): boosts the score above threshold and waives the year window
 *   (a reissue's date is the edition's date, not the work's).
 * Contract: pure; never mutates inputs; unmatched → status "missing".
 * @param {string} artistName Artist the canonical list belongs to.
 * @param {{title: string, year: number|null, mbid: string}[]} canonical MB release-groups.
 * @param {{id: string, title: string, year: number|null}[]} sourceItems Normalized archive.org items.
 * @returns {{entries: Object[]}} Entries with status available|missing (+match).
 */
export function matchCanonicalEntries(artistName, canonical, sourceItems) {
  // Two honesty guards BEFORE trigram:
  //   IDENTITY GUARD — an item whose title adds nothing beyond the artist
  //   name ("The Beatles", "20150205 The-Beatles") is a collection/artist
  //   page, not an identified album: trigram would match on the ARTIST name,
  //   not album identity, and any same-named release-group would "match".
  //   Such items stay out of the canonical discography (raw items still list
  //   them) — honest missing beats a confident wrong match.
  //   ONE ITEM, ONE ALBUM — the same archive.org item cannot stand for
  //   multiple canonical releases: if several release-groups claim it, only
  //   the highest-scoring claim wins, the others stay missing.
  const artistNorm = norm(artistName);
  const isGenericTitle = (t) => {
    const tn = norm(t).replace(/\b\d+(\d{3,})?\b/g, "").replace(/\s{2,}/g, " ").trim();
    return tn === artistNorm;
  };
  const claims = new Map(); // item id → { index, score }
  const entries = canonical.map((rg, index) => {
    let best = null;
    let bestScore = 0;
    for (const item of sourceItems) {
      if (isGenericTitle(item.title)) continue; // identity guard
      const s0 = trigram(rg.title, item.title);
      // Edition containment boosts the score above threshold and waives the
      // year window (a reissue's date is the edition's date, not the work's).
      const s = editionMatch(rg.title, item.title) ? Math.max(s0, 0.8) : s0;
      const yearOk = s > s0 || rg.year == null || item.year == null || Math.abs(rg.year - item.year) <= 2;
      // Work-number guard: "Symphony no. 3" must never match "Symphony No. 5"
      // even when trigram similarity is high — when BOTH titles declare a work
      // number in the same category, differing numbers disqualify the match.
      const a = parseWork(rg.title);
      const b = parseWork(item.title);
      const numberConflict =
        a.categoryRank === b.categoryRank && a.categoryRank !== 99 &&
        a.workNo !== 9999 && b.workNo !== 9999 && a.workNo !== b.workNo;
      if (numberConflict) continue;
      if (s > bestScore && yearOk) { bestScore = s; best = item; }
    }
    if (best && bestScore >= MATCH_THRESHOLD) {
      const prev = claims.get(best.id);
      if (prev && prev.score >= bestScore) return { ...rg, status: "missing" };
      claims.set(best.id, { index, score: bestScore });
      return { ...rg, status: "available", match: { id: best.id, title: best.title, year: best.year, score: bestScore } };
    }
    return { ...rg, status: "missing" };
  });
  // Resolve one-item-one-album: a claim that was later outbid becomes missing.
  for (const [i, e] of entries.entries()) {
    if (e.status === "available" && claims.get(e.match.id)?.index !== i) {
      entries[i] = { ...e, status: "missing" };
      delete entries[i].match;
    }
  }
  return { entries };
}

export function crossReference(artistName, { sourceCollection = SOURCE_COLLECTION_QUERY, priority = "user" } = {}) {
  return catalogMemo(keys.crossref(artistName), () => crossReferenceCompute(artistName, { sourceCollection, priority }), {
    // Quality-driven lifecycle: a cached crossref is reused only while it was
    // produced by the CURRENT matcher and it is a verified catalogation.
    validate: (r) =>
      // Rate-limited/offline marker: honest but unverified — short life only.
      (r.unreachable
        ? Date.now() - (r.at ?? 0) < UNVERIFIED_TTL_MS
        : r.matcherVersion === MATCHER_VERSION &&
          // "available: 0" is unverified (sources may grow / matching may
          // have been incomplete): retry after the short ceiling, not a week.
          (r.available > 0 || Date.now() - (r.at ?? 0) < UNVERIFIED_TTL_MS)),
  });
}

async function crossReferenceCompute(artistName, { sourceCollection = SOURCE_COLLECTION_QUERY, priority = "user" } = {}) {
  const resolved = await resolveArtistMbid(artistName, { priority });
  if (!resolved) {
    // Distinguish "catalog unreachable (rate limited/offline)" from a real
    // empty result — the UI must never present a network failure as 0% coverage.
    return { artist: artistName, entries: [], available: 0, missing: 0, coverage: 0, unreachable: true };
  }

  const [canonical, sourceItems] = await Promise.all([
    canonicalDiscography(resolved.mbid),
    searchArchiveAll({ query: `creator:"${escapeLucene(artistName)}"`, collection: sourceCollection, rows: 100, maxItems: 1000, sort: "downloads desc" }).then((r) => r.items.map(normalizeSearchItem)),
  ]);

  const entries = matchCanonicalEntries(artistName, canonical, sourceItems).entries;

    // Dedupe missing entries by normalized title: multiple MB release-groups of
  // the same work (editions, remasters) would repeat "Aida" five times — the
  // acquisition queue should list WORKS, not editions.
  const seenTitles = new Set();
  const deduped = entries.filter((e) => {
    const key = e.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (e.status === "missing" && seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  const available = deduped.filter((e) => e.status === "available").length;
  return {
    artist: artistName,
    entries: deduped,
    available,
    missing: deduped.length - available,
    coverage: deduped.length ? available / deduped.length : 0,
    matcherVersion: MATCHER_VERSION,
    at: Date.now(),
  };
}
