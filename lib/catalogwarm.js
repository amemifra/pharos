/**
 * Catalog warm-up — TOP-DOWN progressive population of the shared P2P catalog.
 *
 * DIRECTION (user decision, ratified): the queue starts from the CANONICAL
 * catalog — user intent first, then the encyclopedic canon and Wikipedia-
 * measured popularity — NOT from an archive.org crawl. The crawl is only a
 * long-tail afterthought (or exhausted last). Rationale: "we look for the
 * music the catalog says matters", not "we surface whatever archive.org has".
 *
 * Candidate order:
 *   (a) artists the user already visited (`pf.recent`) — freshest intent;
 *   (b) canonical catalog (CANON, tier desc) + Wikipedia-measured popularity
 *       (batchSitelinks/pageviews, the same objective signals the Home page
 *       uses for "popular artists");
 *   (c) curated PD queue (pdCandidates — sources where the law is settled);
 *   (d) the archive.org long-tail crawl, streamed page by page, LAST.
 *
 * Every candidate: cross-reference (MusicBrainz via the gate) → fill engine
 * (claim → extract → DQ → publish). All states are honest no-ops when another
 * peer holds the lease or the fill already exists. Rate limits are respected:
 * sequential units, idle gaps, batches bounded, cancellable — low-end phones
 * first.
 *
 * Contract: startWarmup() is idempotent and never throws; it returns a
 * cancel function. Progress is observable via onProgress for the UI badge.
 */

import { crossReference } from "./discography.js";
import { creatorStats, searchArchive } from "./archive.js";
import { canonKey, canonNames, canonScore, rankArtists } from "./popularity.js";
import { batchSitelinks, pageviews } from "./notability.js";
import { catalogGet, keys } from "./catalogstore.js";
import { pdCandidates } from "./pd.js";
import { fillArtist } from "./fillengine.js";
import { SOURCE_COLLECTIONS } from "./catalog.js";

/** @type {{running: boolean, cancel: boolean}} */
let state = { running: false, cancel: false };

/**
 * TRAWL (pesca a strascico) — persistent, resumable dragnet over archive.org.
 *
 * When the head streams (canon / popularity / PD) run dry, the warm-up sweeps
 * EVERY source collection from page 1, creator by creator, cataloging
 * everything not yet in the shared catalog. State lives in `pf.trawl`
 * ({ci: collection index, page, seen: canonKeys already offered}):
 *   - survives reloads → the dragnet continues session after session;
 *   - when the LAST collection is exhausted the cursor restarts from page 1
 *     while `seen` keeps growing — already-cataloged creators are skipped via
 *     the persisted set AND the crossref cache check, so re-sweeps get
 *     progressively cheaper (the shared catalog only ever grows).
 * Politeness: pages are pulled sequentially, one creator per unit, with the
 * same idle gaps as the rest of the warm-up.
 */
const TRAWL_KEY = "pf.trawl";
const TRAWL_SEEN_CAP = 25_000; // localStorage footprint bound (~5 bytes/key)
const TRAWL_PAGE_ROWS = 100;

function loadTrawl() {
  try {
    const t = JSON.parse(localStorage.getItem(TRAWL_KEY) ?? "null");
    if (t && Number.isInteger(t.ci) && Array.isArray(t.seen)) {
      return { ci: t.ci, page: t.page ?? 1, seen: new Set(t.seen) };
    }
  } catch {}
  return { ci: 0, page: 1, seen: new Set() };
}

function saveTrawl(t) {
  try {
    const seen = [...t.seen].slice(-TRAWL_SEEN_CAP); // newest last; old keys may re-scan once, cheap
    localStorage.setItem(TRAWL_KEY, JSON.stringify({ ci: t.ci, page: t.page, seen }));
  } catch { /* quota: dragnet continues, dedup degrades to the crossref check */ }
}

/**
 * Pulls the next batch of never-trawled creators from the cursor position.
 * Mutates the trawl state (cursor advance + seen marks). Never throws.
 * @param {number} [want=8] Target batch size.
 * @returns {Promise<{name: string}[]>}
 */
export async function trawlBatch(want = 8) {
  const t = loadTrawl();
  const out = [];
  let guard = 0;
  while (out.length < want && guard++ < 40) {
    const collection = SOURCE_COLLECTIONS[t.ci % SOURCE_COLLECTIONS.length];
    const { items: window, total } = await searchArchive({
      query: "", collection, page: t.page, rows: TRAWL_PAGE_ROWS, sort: "downloads desc",
    }).catch(() => ({ items: [], total: 0 }));
    if (!window.length || (total && (t.page - 1) * TRAWL_PAGE_ROWS >= total)) {
      t.ci += 1; t.page = 1; // collection exhausted → next one
      if (t.ci >= SOURCE_COLLECTIONS.length) { t.ci = 0; t.page = 1; saveTrawl(t); return out; } // sweep done
      continue;
    }
    t.page += 1;
    for (const doc of window) {
      const c = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator;
      if (typeof c !== "string" || !c.trim()) continue;
      const k = canonKey(c);
      if (!k || t.seen.has(k)) continue;
      t.seen.add(k);
      out.push({ name: c });
      if (out.length >= want) break;
    }
  }
  saveTrawl(t);
  return out;
}

/**
 * TOP-DOWN candidate ordering (pure): user-visited first, canonical catalog
 * before measured popularity, curated PD after, crawl last. Canon variants
 * ("Mozart" / "Wolfgang Amadeus Mozart", same tier, containment) collapse to
 * one candidate; any name already queued by an earlier source is skipped.
 * Contract: pure; never mutates inputs.
 * @param {{recent?: string[], canonNames?: string[], measured?: {name: string, score?: number}[], pd?: string[], crawl?: string[]}} streams
 * @returns {{name: string, source: "recent"|"canon"|"popular"|"pd"|"crawl"}[]}
 */
export function buildCandidates({ recent = [], canonNames: canon = [], measured = [], pd = [], crawl = [] } = {}) {
  const out = [];
  const seen = new Set();
  const push = (name, source) => {
    const n = String(name ?? "").trim();
    const k = canonKey(n);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ name: n, source });
  };

  // (a) user intent: the artists the visitor actually looked at.
  for (const r of recent) push(r, "recent");

  // (b1) canonical catalog by tier; containment-collapses tier-mates
  // ("Wolfgang Amadeus Mozart" subsumes the "Mozart" alias, and vice versa).
  const kept = [];
  const canonSorted = [...canon].sort((x, y) => canonScore(y) - canonScore(x));
  for (const name of canonSorted) {
    const k = canonKey(name);
    const tier = canonScore(name);
    if (kept.some((e) => e.tier === tier && (e.key.includes(k) || k.includes(e.key)))) continue;
    kept.push({ key: k, tier });
    push(name, "canon");
  }

  // (b2) measured popularity (Wikipedia sitelinks/pageviews via rankArtists).
  for (const m of rankArtists(measured)) push(m.name, "popular");

  // (c) curated PD queue; (d) long-tail crawl, last.
  for (const p of pd) push(p, "pd");
  for (const c of crawl) push(c, "crawl");
  return out;
}

/**
 * (a) Artists from the user's play history (`pf.recent`, written by
 * PlayerProvider): newest first, already deduped by PlayerProvider.
 */
function recentArtists() {
  try {
    const rec = JSON.parse(localStorage.getItem("pf.recent") ?? "[]");
    return [...new Set((rec ?? []).map((e) => e.artist).filter(Boolean))];
  } catch {
    return [];
  }
}

/**
 * (b2) Wikipedia-measured popular artists — the same objective signals the
 * Home page uses: creatorStats sample → batched sitelinks → pageviews for the
 * notable head → rankArtists. Only sitelinks>0 candidates qualify (real
 * encyclopedic notability, not crawl noise). Never throws. Returns ranked
 * artist objects (measures preserved for re-ranking downstream).
 */
async function popularCandidates() {
  try {
    const stats = await creatorStats("audio_music", 500);
    if (!stats.length) return [];
    const names = stats.map((s) => s.name);
    const sitelinks = new Map();
    for (let i = 0; i < names.length; i += 40) {
      // batchSitelinks caps at 40 titles per request → chunk.
      const part = await batchSitelinks(names.slice(i, i + 40));
      for (const [k, v] of part) sitelinks.set(k, v);
    }
    const notable = stats
      .map((s) => ({ ...s, sitelinks: sitelinks.get(s.name) ?? 0 }))
      .filter((s) => s.sitelinks > 0)
      .sort((a, b) => b.sitelinks - a.sitelinks)
      .slice(0, 24);
    await Promise.all(notable.map(async (s) => { s.pageviews = await pageviews(s.name); }));
    return rankArtists(notable);
  } catch {
    return []; // measures unavailable: canon + PD still drive the queue
  }
}

/**
 * Start the background warm-up loop (TOP-DOWN).
 * @param {{batch?: number, gapMs?: number, onProgress?: (info: {artist: string, done: number, total: number, source?: string, fill?: string}) => void}} [opts]
 * @returns {() => void} cancel()
 */
export function startWarmup({ batch = 4, gapMs = 30_000, onProgress } = {}) {
  if (state.running) return () => {};
  state = { running: true, cancel: false };
  let done = 0;

  (async () => {
    // Candidate construction (network-backed but each stream degrades to []
    // on failure: canon always exists, the rest is progressive).
    let units = [];
    try {
      const [recent, canon, measured, pd] = await Promise.all([
        recentArtists(),
        Promise.resolve(canonNames()),
        popularCandidates(),
        pdCandidates(100).catch(() => []),
      ]);
      units = buildCandidates({ recent, canonNames: canon, measured, pd });
    } catch { /* candidate construction must never block the loop */ }

    // Trawl long-tail (d): persistent dragnet across ALL source collections,
    // streamed when the head queue runs dry. Cursor survives reloads.
    while (!state.cancel) {
      if (!units.length) {
        try {
          const batch = await trawlBatch();
          if (!batch.length) { await new Promise((r) => setTimeout(r, gapMs)); continue; } // transient: retry
          for (const { name } of batch) units.push({ name, source: "crawl" });
        } catch {
          await new Promise((r) => setTimeout(r, gapMs));
          continue; // transient network failure: retry
        }
      }
      const chunk = units.splice(0, batch);
      for (const { name, source } of chunk) {
        if (state.cancel) break;
        await idleGap(gapMs);
        if (state.cancel) break;
        try {
          const known = await catalogGet(keys.crossref(name));
          if (known) { done++; onProgress?.({ artist: name, done, total: done + 1, source }); continue; }
        } catch { /* catalog read failure → recompute below */ }
        try {
          await crossReference(name);
        } catch { /* one artist failing must not stop the loop */ }
        done++;
        onProgress?.({ artist: name, done, total: done + 1, source });
        try {
          const res = await fillArtist(name);
          if (res?.state === "filled") onProgress?.({ artist: name, done, total: done + 1, source, fill: "filled" });
        } catch { /* fill failures must not stop the warm-up */ }
      }
    }
    state.running = false;
  })();

  return () => { state.cancel = true; };
}

/** Idle gap between fill/warm units: never background-aggressive. */
function idleGap(ms) {
  return new Promise((r) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(() => setTimeout(r, ms), { timeout: 5000 });
    } else {
      setTimeout(r, ms);
    }
  });
}

/** @returns {boolean} true while the warm-up loop is active. */
export function isWarming() {
  return state.running;
}
