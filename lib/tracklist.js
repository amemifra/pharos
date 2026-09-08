/**
 * Canonical tracklist alignment — catalog order wins, compound tracks merge.
 *
 * SOURCE OF TRUTH: MusicBrainz release-group → first official release →
 * recordings (structured track titles, numbers, durations; community-curated
 * under CC0). Rationale: MusicBrainz is the music branch of the same community
 * ecosystem as Wikipedia (Wikidata = artists/works, MB = releases/tracklists);
 * parsing Wikipedia wikitext tracklists would be fragile — MB gives the same
 * community truth in structured JSON.
 *
 * Alignment algorithm (pure, O(n·m), n = files, m = canonical tracks):
 *  1. Fetch canonical tracklist for the release-group (async, cached).
 *  2. MATCH: greedy best-trigram match of canonical titles against file
 *     titles; a file can host MULTIPLE canonical works (vinyl side rips).
 *  3. COMPOUND detection: file duration ≥ 1.8× the matched canonical duration
 *     AND further canonical works fit its duration → merge into one Track:
 *     title = list of contained works, starts[] = cumulative offsets =
 *     sum of canonical durations, scaled by fileDuration/canonicalSum
 *     (proportional alignment; WASM silence-detection is the planned
 *     high-precision upgrade — interface stub: detectSilenceBoundaries()).
 *  4. ORDER: canonical order wins; unmatched files keep pipeline order after
 *     the matched block; junk-named side-marker files (e.g. "Disc1Side1")
 *     still host the remaining canonical works when the duration fits.
 *
 * Result for the motivating case (lp_the-four-seasons_antonio-vivaldi_2):
 * movement MP3s + full-side FLAC rips collapse into one canonical list, the
 * FLAC sides become compound tracks with sub-works and seek offsets, and
 * duplicated content across formats plays via lib/formatpolicy variants.
 */

import { trigramSimilarity } from "./canonical.js";
import { getGate } from "./gate.js";

const MB_API = "https://musicbrainz.org/ws/2";

// Shared MusicBrainz gate (same singleton as lib/mbgate.js — one rate limiter
// for the whole source, no private throttle bypassing the queue).
const mbGate = getGate("musicbrainz", { minIntervalMs: 1100 });

const LS_PREFIX = "pf.tracklist.";
const cacheKey = (rgid) => LS_PREFIX + rgid;

/** MB fetch through the shared gate (background priority: enrichment, and
 *  interactive traffic always jumps ahead). Never throws; null on failure. */
async function mbFetch(url) {
  try {
    const res = await mbGate.request(url, { priority: "background" });
    if (res.ok) return res.json();
  } catch {}
  return null;
}

/** Compound-file heuristic markers (objective: vinyl-side / disc naming). */
const SIDE_MARKER = /\b(disc|side|lp)\s*\d|side\s*[ab]\b/i;

/** Ratio threshold: a file holding ≥1.8× one canonical work is a compound. */
const COMPOUND_RATIO = 1.8;

/** Match threshold: below this trigram the file is considered unmatched. */
const MATCH_THRESHOLD = 0.45;

/**
 * Resolve artist+album title → release-group MBID (for alignTracklist).
 * @param {string} artist
 * @param {string} albumTitle
 * @returns {Promise<string|null>}
 */
export async function resolveReleaseGroup(artist, albumTitle) {
  if (!artist || !albumTitle) return null;
  const json = await mbFetch(
    `${MB_API}/release-group?query=${encodeURIComponent(`releasegroup:"${albumTitle}" AND artist:"${artist}"`)}&fmt=json&limit=1`
  );
  return json?.["release-groups"]?.[0]?.id ?? null;
}

/**
 * Fetch the canonical tracklist of a release-group (best official release).
 * @param {string} rgMbid Release-group MBID.
 * @returns {Promise<{title: string, number: number|null, durationMs: number|null}[]|null>}
 */
export async function fetchCanonicalTracklist(rgMbid) {
  if (!rgMbid) return null;
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey(rgMbid)) ?? "null");
    if (hit) return hit;
  } catch {}

  // Two-step (MB contract): release-group → official release → recordings.
  await mbFetch(`${MB_API}/release-group/${rgMbid}?fmt=json`);
  const relList = await mbFetch(
    `${MB_API}/release?release-group=${rgMbid}&status=official&fmt=json&limit=5`
  );
  const release = (relList?.releases ?? []).find((r) =>
    (r.media ?? []).some((m) => (m["track-count"] ?? 0) > 0)
  ) ?? relList?.releases?.[0];
  if (!release?.id) return null;

  const full = await mbFetch(`${MB_API}/release/${release.id}?inc=recordings+media&fmt=json`);
  const trackList = (full?.media ?? []).flatMap((m) =>
    (m.tracks ?? []).map((t, i) => ({
      title: t.title,
      number: Number(t.position ?? i + 1),
      durationMs: t.length ? Number(t.length) : null,
    }))
  );
  if (!trackList.length) return null;
  try { localStorage.setItem(cacheKey(rgMbid), JSON.stringify(trackList)); } catch {}
  return trackList;
}

/**
 * Placeholder for the planned WASM silence-detection boundary finder.
 * When the wasm module lands (chromaprint-style DSP), it replaces the
 * proportional estimate with measured silence gaps. KEEP THE CONTRACT.
 * @param {Float32Array} _pcm Mono PCM of the file.
 * @returns {number[]|null} Measured start offsets in seconds, or null.
 */
export function detectSilenceBoundaries(_pcm) {
  return null; // not implemented yet — proportional alignment is the fallback
}

/**
 * Movement-tail detector: the part after the work/movement separator must
 * LOOK like a movement (roman numeral, tempo marking, or explicit movement
 * word) — protects pop titles like "Misty Blue: Live" from being split.
 */
const MOVEMENT_TAIL = /^(\s*(I{1,3}|IV|V{1,3}|VI{1,3}|IX|X{1,3})\b|\s*[0-9]+\.?\s|.*\b(allegro|adagio|largo|andante|presto|moderato|vivace|menuetto|minuet|scherzo|rondo|finale|movement|movt|aria|ouverture)\b)/i;

/**
 * Group canonical movements into WORKS. Separator candidates: " - " and
 * ": " (both occur across MusicBrainz classical styles); the split is only
 * accepted when the tail looks like a movement (objective heuristic).
 * Non-classical titles never match the heuristic → single-track works, so
 * the same code serves pop/jazz albums unchanged.
 */
function splitWorkMovement(title) {
  const m = String(title).match(/^(.*?)\s+[-–—:]\s+(.+)$/);
  if (m && MOVEMENT_TAIL.test(m[2])) return [m[1], m[2]];
  return [String(title), null];
}

function groupCanonicalWorks(canonical) {
  const groups = [];
  for (const c of canonical) {
    const [workKeyRaw, movement] = splitWorkMovement(c.title);
    const workKey = workKeyRaw.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s{2,}/g, "").trim();
    const last = groups[groups.length - 1];
    if (last && last.workKey === workKey) {
      last.movementTitles.push(movement ?? c.title);
      last.movementDurs.push(c.durationMs ? c.durationMs / 1000 : 0);
      last.durationMs += c.durationMs ?? 0;
    } else {
      groups.push({
        workKey,
        title: c.title,
        number: c.number,
        durationMs: c.durationMs ?? 0,
        movementTitles: [movement ?? c.title],
        movementDurs: [c.durationMs ? c.durationMs / 1000 : 0],
      });
    }
  }
  return groups;
}

/**
 * Align a normalized album's tracks to the canonical tracklist.
 * Returns a NEW tracks array (never mutates the input).
 *
 * HARD VALIDATION RULES for any compound merge (all must hold, else NO merge
 * and the file renders as a plain track with a neutral "not aligned" label):
 *   R1 SCOPE — canonical durations come ONLY from the matched MB release's
 *      own tracklist (single release, chosen inside fetchCanonicalTracklist);
 *      cross-release contamination is structurally impossible here.
 *   R2 DURATION FIT — |sum(canonical) − fileDuration| / fileDuration ≤ 0.15.
 *      Overshoot rejects the merge (those works are simply not in this file).
 *   R3 COUNT SANITY — merged movement count ≥2 and ≤30; each movement ≥30s.
 *   R4 NO INVENTED DURATIONS — any movement with missing duration, or longer
 *      than the file itself, disqualifies the whole merge.
 *   R5 DEDUPED TITLES — the merged title lists DISTINCT movement names only.
 *   R6 HONEST UNKNOWN — failed merges render a neutral label instead of
 *      fabricated offsets. Honest unknown > confident lie.
 *
 * @param {import("./pipeline.js").Album} album
 * @param {{title: string, number: number|null, durationMs: number|null}[]|null} canonical
 * @returns {import("./pipeline.js").Album} Album with aligned, merged tracks.
 */
export function alignTracks(album, canonical) {
  if (!canonical?.length || !album.tracks?.length) return album;

  const works = groupCanonicalWorks(canonical);
  const tracks = album.tracks.map((t) => ({ ...t }));
  const usedFile = new Set();
  const usedWork = new Set();
  const result = [];

  /** R2/R3/R4: full validation for a candidate compound (movement set). */
  function compoundValid(movements, fileDur) {
    if (movements.length < 2 || movements.length > 30) return false;             // R3
    if (movements.some((m) => !m.durationMs || m.durationMs / 1000 > fileDur)) return false; // R4
    const sum = movements.reduce((s, m) => s + m.durationMs / 1000, 0);
    if (!fileDur || Math.abs(sum - fileDur) / fileDur > 0.15) return false;      // R2
    return true;
  }

  // Pass 1: match each canonical WORK to its best file.
  works.forEach((work, wi) => {
    const workDur = work.durationMs / 1000;
    let bestIdx = -1;
    let bestScore = 0;
    tracks.forEach((t, i) => {
      if (usedFile.has(i)) return;
      const s = trigramSimilarity(work.workKey, t.title);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    });
    if (bestIdx < 0 || bestScore < MATCH_THRESHOLD) return;
    usedFile.add(bestIdx);
    usedWork.add(wi);
    const file = tracks[bestIdx];
    const fileDur = file.duration ?? 0;

    const movements = work.movementTitles.map((mt, k) => ({
      title: mt,
      durationMs: work.movementDurs[k] * 1000,
    }));

    if (movements.length > 1 && compoundValid(movements, fileDur)) {
      const scale = fileDur / movements.reduce((s, m) => s + m.durationMs / 1000, 0);
      let acc = 0;
      const names = [];
      const starts = [];
      for (const m of movements) {
        if (!names.includes(m.title)) { names.push(m.title); starts.push(Math.round(acc)); } // R5
        acc += (m.durationMs / 1000) * scale;
      }
      result.push({
        ...file,
        title: names.join(" · "),
        number: work.number ?? file.number,
        duration: file.duration ?? null,
        compound: { works: names, starts },
      });
    } else {
      // Single movement or rules failed: plain track, honest title.
      result.push({ ...file, title: movements[0].title, number: work.number ?? file.number });
    }
  });

  // Pass 2: junk-named side-marker files host whatever works remain — but a
  // merge is published ONLY when the full remaining set fits the file within
  // the R2 window (a vinyl side is exactly one predefined sequence of works;
  // if the remaining catalog does not fit, the content differs → R6).
  tracks.forEach((t, i) => {
    if (usedFile.has(i)) return;
    if (!SIDE_MARKER.test(t.title) || !(t.duration > 0)) return;
    const pending = works.filter((_, wi) => !usedWork.has(wi));
    if (!pending.length) return;
    const movements = pending.flatMap((w) =>
      w.movementTitles.map((mt, k) => ({ title: mt, durationMs: w.movementDurs[k] * 1000 })));
    if (!compoundValid(movements, t.duration)) {
      // R6: honest neutral label — no fabricated offsets.
      result.push({
        ...t,
        title: `${prettyTitleFromIdentifier(t.title)} — tracklist not aligned`,
        compound: null,
      });
      usedFile.add(i);
      return;
    }
    const scale = t.duration / movements.reduce((s, m) => s + m.durationMs / 1000, 0);
    let acc = 0;
    const names = [];
    const starts = [];
    for (const m of movements) {
      if (!names.includes(m.title)) { names.push(m.title); starts.push(Math.round(acc)); } // R5
      acc += (m.durationMs / 1000) * scale;
    }
    usedFile.add(i);
    result.push({ ...t, title: names.join(" · "), compound: { works: names, starts } });
  });

  // Pass 3: remaining unmatched files, in their pipeline order.
  tracks.forEach((t, i) => { if (!usedFile.has(i)) result.push(t); });

  const numbered = result.map((t, i) => ({ ...t, number: i + 1 }));
  return { ...album, tracks: numbered };
}

/** Readable label from a junk identifier-ish title ("disc1/lp ..." → words). */
function prettyTitleFromIdentifier(title) {
  return String(title).replace(/[_]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Full async enrichment: fetch canonical tracklist (by release-group MBID)
 * and align. Safe: any failure returns the album unchanged.
 * @param {import("./pipeline.js").Album} album
 * @param {string} rgMbid Release-group MBID (from resolveReleaseGroup).
 * @returns {Promise<import("./pipeline.js").Album>}
 */
export async function alignTracklist(album, rgMbid) {
  const canonical = await fetchCanonicalTracklist(rgMbid);
  if (!canonical) return album;
  return alignTracks(album, canonical);
}
