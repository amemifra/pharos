/**
 * Metadata canonicalization: from dirty to canonical, with confidence.
 *
 * Cascading strategy (each level raises confidence):
 *   L1 TEXTUAL — MusicBrainz search (public, free API, the open music
 *      community's standard). Given "artist + title" cleaned by the pipeline,
 *      finds the canonical recording. Confidence = MusicBrainz score combined
 *      with the textual similarity of the returned pair.
 *   L2 COMMUNITY — identifications shared on OrbitDB: when multiple peers
 *      confirm the same metadata for the same track, consensus outweighs any
 *      single source (weighted majority vote).
 *   L3 ACOUSTIC — AcoustID/chromaprint (lib/fingerprint.js), when the client
 *      key is configured. Maximum confidence.
 *
 * Cache: localStorage (permanent — recordings don't change) + OrbitDB (P2P
 * sharing). Zero repeated calls for the same data.
 */

import { identifyCached } from "../lib/fingerprint.js";
import { mbRequest } from "./mbgate.js";
import { UNKNOWN_ARTIST } from "../lib/pipeline.js";

const MB_SEARCH = "https://musicbrainz.org/ws/2/recording";
// MusicBrainz asks for an identifiable User-Agent; browsers cannot set it
// (their real UA is accepted), light usage is tolerated (1 req/s).
const MB_DELAY_MS = 1100; // respect the community's rate limit

let lastMbCall = 0;
const mbThrottle = () =>
  new Promise((r) => setTimeout(r, Math.max(0, lastMbCall + MB_DELAY_MS - Date.now())));

const cacheKey = (k) => `pf.canon.${k}`;

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(cacheKey(key)) ?? "null"); } catch { return null; }
}
function writeCache(key, value) {
  try { localStorage.setItem(cacheKey(key), JSON.stringify(value)); } catch {}
}

/**
 * Trigram-based textual similarity (0–1): objective measure of how well a
 * MusicBrainz return matches the query. No opinions: characters.
 * Contract: pure; returns 0 for empty/undefined inputs.
 * @param {string} a First string.
 * @param {string} b Second string.
 * @returns {number} Dice coefficient over character trigrams.
 */
export function trigramSimilarity(a, b) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const gram = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const A = gram(norm(a));
  const B = gram(norm(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size); // Dice coefficient
}

/**
 * L1 — Textual canonicalization via MusicBrainz.
 * Contract: never throws (network failures → null); confidence ≤ 0.5 when the
 * artist does not match exactly (covers/collaborations must not pass as
 * canonical: they escalate to L2/L3); results below 0.4 are not cached.
 * @param {string} artist Cleaned artist (may be UNKNOWN_ARTIST).
 * @param {string} title Cleaned track title.
 * @returns {Promise<{artist: string, title: string, mbid: string, confidence: number, level: "text"}|null>}
 */
export async function canonicalByText(artist, title) {
  const key = `${artist}|${title}`.toLowerCase();
  // L0 — shared catalog store first (OrbitDB P2P + local): a lookup computed
  // by ANY peer is a lookup nobody repeats. Local localStorage remains the
  // offline last-resort read.
  try {
    const store = await import("./catalogstore.js");
    const shared = await store.catalogGet(store.keys.identification(`text:${key}`));
    if (shared) return shared;
  } catch {}
  const cached = readCache(key);
  if (cached) return cached;

  // L1a — ListenBrainz (same MetaBrainz ecosystem, generous limits): the
  // default first shot; MusicBrainz stays for structured discographies.
  try {
    const { lbLookup } = await import("./listenbrainz.js");
    const lb = await lbLookup(artist, title);
    if (lb && lb.confidence >= 0.4) {
      writeCache(key, lb);
      try {
        const store = await import("./catalogstore.js");
        store.catalogSet(store.keys.identification(`text:${key}`), lb);
      } catch {}
      return lb;
    }
  } catch {}

  // L1b — MusicBrainz search (1 req/s via mbgate; user priority).
  await mbThrottle();
  lastMbCall = Date.now();
  const query = artist && artist !== UNKNOWN_ARTIST
    ? `recording:"${title}" AND artist:"${artist}"`
    : `recording:"${title}"`;
  let json;
  try {
    // Browsers cannot set User-Agent (already real); node can (for DQ tests).
    const headers = typeof window === "undefined"
      ? { "User-Agent": "Pharos/0.1 (https://github.com/pharos-app)" } : undefined;
    const res = await mbRequest(`${MB_SEARCH}?query=${encodeURIComponent(query)}&fmt=json&limit=5`, { priority: "user" });
    if (!res.ok) return null;
    json = await res.json();
  } catch { return null; }

  const best = json?.recordings?.[0];
  if (!best) return null;

  const mbArtist = best["artist-credit"]?.[0]?.name ?? "";
  // Objective anti-false-positive rule: a textual match is acceptable ONLY if
  // the canonical artist matches exactly (after normalization). Containments
  // ("Jon Batiste, Beethoven" ⊃ "Beethoven") = cover/collaboration →
  // confidence ≤ 0.5 → the track escalates to higher levels (consensus /
  // acoustic fingerprint).
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const exactArtist = artist !== UNKNOWN_ARTIST && norm(mbArtist) === norm(artist);
  const simTitle = trigramSimilarity(title, best.title ?? title);
  const confidence = exactArtist
    ? Math.min(1, 0.6 + 0.4 * simTitle)          // certain artist: title may differ ("Requiem" vs "Requiem, K626: …")
    : Math.min(0.5, 0.5 * simTitle);             // uncertain artist: never acceptable via text alone

  const result = {
    artist: mbArtist || artist,
    title: best.title ?? title,
    mbid: best.id,
    confidence: Math.min(confidence, 1),
    level: "text",
  };
  if (result.confidence >= 0.4) {
    writeCache(key, result); // below threshold: don't pollute the cache
    // Publish to the shared catalog: one peer's lookup serves everyone.
    try {
      const store = await import("./catalogstore.js");
      store.catalogSet(store.keys.identification(`text:${key}`), result);
    } catch {}
  }
  return result;
}

/**
 * L2 — Community consensus via the shared catalog store (lib/catalogstore.js,
 * OrbitDB-backed with local fallback). Votes per trackId are appended lists;
 * majority = trusted metadata. Contract: async; returns null unless at least
 * 2 peers agree (a single vote is not consensus).
 * @param {string} trackId Stable track id.
 * @returns {Promise<{artist: string, title: string, votes: number, level: "community"}|null>}
 */
export async function canonicalByCommunity(trackId) {
  const store = await import("./catalogstore.js");
  const votes = await store.catalogGet(store.keys.identification(trackId));
  if (!Array.isArray(votes) || votes.length === 0) return null;
  const tally = new Map();
  for (const v of votes) {
    const k = `${v.artist}|${v.title}`.toLowerCase();
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const [winner, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (count < 2) return null; // confirmation required: one vote is not consensus
  const [artist, title] = winner.split("|");
  return { artist, title, votes: count, level: "community" };
}

/**
 * Publishes an identification vote to the shared catalog (L2).
 * Contract: appends to the vote list; never throws; publishing is optional,
 * never a failure (offline → the vote stays local only).
 * @param {string} trackId Stable track id.
 * @param {{artist: string, title: string, confidence?: number}} result
 * @returns {Promise<boolean>} true when published to the P2P layer.
 */
export async function publishIdentification(trackId, result) {
  try {
    const store = await import("./catalogstore.js");
    const prev = (await store.catalogGet(store.keys.identification(trackId))) ?? [];
    const votes = Array.isArray(prev) ? prev : [];
    votes.push({ artist: result.artist, title: result.title, confidence: result.confidence ?? null, at: Date.now() });
    return store.catalogSet(store.keys.identification(trackId), votes);
  } catch {
    return false;
  }
}

/**
 * Full cascade for a track. Cost order: local cache → community → text
 * (MusicBrainz) → fingerprint (when key is set).
 * Contract: always resolves (never rejects); only returns results with
 * confidence ≥ the acceptance threshold of their level, else the cached one.
 * @param {import("./pipeline").Track} track Track with id/url/__albumArtist.
 * @param {{db?: any, allowFingerprint?: boolean}} [opts]
 * @returns {Promise<Object|null>} Canonical metadata or null when unknown.
 */
export async function canonicalFor(track, { allowFingerprint = true } = {}) {
  const cached = readCache(track.id);
  if (cached && cached.confidence >= 0.6) return cached;

  // L2 first (cheap: catalog store, local cache or P2P snapshot).
  const community = await canonicalByCommunity(track.id);
  if (community && (!cached || community.votes >= 2)) {
    const result = { ...community, confidence: Math.min(0.7 + 0.05 * community.votes, 0.95) };
    writeCache(track.id, result);
    return result;
  }

  const text = await canonicalByText(track.__albumArtist ?? "", track.title);
  if (text && text.confidence >= 0.55) {
    writeCache(track.id, text);
    return text;
  }

  // L3: only when the textual level did not convince (this is the case that
  // justifies the cost).
  if (allowFingerprint) {
    const fp = await identifyCached(track.id, track.url).catch(() => null);
    if (fp) {
      const result = { ...fp, level: "acoustic", confidence: Math.max(0.85, fp.score) };
      writeCache(track.id, result);
      return result;
    }
  }

  return cached ?? null;
}
