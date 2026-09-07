/**
 * Implicit usage feedback → training examples for the ranker.
 *
 * Signals (standard for IR / production rankers):
 *   PLAY_COMPLETE  y=1   (track listened ≥ 60% or ≥ 30s)
 *   PLAY_SHORT     y=0.2 (started but abandoned quickly: probable false positive)
 *   RESULT_IGNORED y=0   (shown and not chosen — weak signal, lower weight)
 *
 * Persistence: events in localStorage for immediate local training; OrbitDB
 * receives ANONYMOUS AGGREGATES (feature means over positives), not individual
 * history: no user profiling, only collective intelligence about ranker weights.
 */

import { features, learn, loadWeights, saveWeights } from "./ranker.js";
import { urlHash } from "./versions.js";
import { catalogGet, catalogSet, keys } from "./catalogstore.js";

const QUEUE_KEY = "pf.feedback.queue";

/** Appends an event to the bounded queue (last 2000 kept); never throws. */
function enqueue(event) {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    q.push(event);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-2000)));
  } catch {}
}

/**
 * Records that a track/album was played.
 * Contract: pure side effect on storage; never throws; y assignment follows
 * the documented signal table.
 * @param {string} query Query that produced the result ("" for direct navigation).
 * @param {import("./pipeline").Album} album Played album.
 * @param {number} secondsPlayed Actual listening seconds.
 * @param {number} trackDuration Track duration (for the percentage).
 * @returns {void}
 */
export function recordPlay(query, album, secondsPlayed, trackDuration) {
  const ratio = trackDuration > 0 ? secondsPlayed / trackDuration : secondsPlayed >= 30 ? 1 : 0;
  const y = ratio >= 0.6 || secondsPlayed >= 30 ? 1 : 0.2;
  enqueue({ type: "play", query, f: features(query, album), y, at: Date.now() });
}

/**
 * Records per-version play feedback (F3): play / completion for ONE url of a
 * track, aggregated anonymously into `weights:versions` (P2P-shared). The
 * aggregation uses the same largest-evidence-wins consensus as the ranker:
 * per-track per-urlHash {plays, completes} counters are merged additively
 * locally, then published when our local table has more total plays than the
 * shared one (idempotent, no user profiling — only url hashes and counts).
 * Contract: pure side effect; never throws.
 * @param {string} trackKey Stable track id ("{identifier}/{fileName}").
 * @param {string} url Exact version url played.
 * @param {{completed?: boolean}} [opts] completed: listened ≥60% or ≥30s.
 * @returns {void}
 */
export function recordVersionPlay(trackKey, url, { completed = false } = {}) {
  try {
    const LS = "pf.version.local";
    const table = JSON.parse(localStorage.getItem(LS) ?? "{}");
    const h = urlHash(url);
    const cell = (table[trackKey] ??= {});
    cell[h] ??= { plays: 0, completes: 0 };
    cell[h].plays += 1;
    if (completed) cell[h].completes += 1;
    localStorage.setItem(LS, JSON.stringify(table));
  } catch {}
}

/** Reads the local per-version table (for merge/publish). */
function localVersionTable() {
  try { return JSON.parse(localStorage.getItem("pf.version.local") ?? "{}") ?? {}; } catch { return {}; }
}

/** Total plays across the table (evidence comparison for the consensus). */
function totalPlays(table) {
  return Object.values(table).reduce(
    (sum, cells) => sum + Object.values(cells).reduce((s, c) => s + (c.plays ?? 0), 0), 0);
}

/**
 * Publishes the local version aggregates to the shared catalog (F3, P2P).
 * Consensus: merge our local counters INTO the shared table (additive counts
 * are commutative and idempotent-enough: republishing the same local table
 * is harmless); publish when we hold more evidence than the last snapshot.
 * Contract: never throws; true when published.
 * @returns {Promise<boolean>}
 */
export async function publishVersionConsensus() {
  try {
    const local = localVersionTable();
    if (!totalPlays(local)) return false;
    // Delta only: what we published before is already in the shared table —
    // republishing it would double-count the community evidence.
    let published = {};
    try { published = JSON.parse(localStorage.getItem("pf.version.published") ?? "{}"); } catch {}
    const delta = {};
    for (const [trackKey, cells] of Object.entries(local)) {
      for (const [h, c] of Object.entries(cells)) {
        const already = published[trackKey]?.[h] ?? { plays: 0, completes: 0 };
        const dPlays = c.plays - already.plays;
        const dComp = c.completes - already.completes;
        if (dPlays > 0 || dComp > 0) {
          (delta[trackKey] ??= {})[h] = { plays: Math.max(0, dPlays), completes: Math.max(0, dComp) };
        }
      }
    }
    if (!totalPlays(delta)) return false;
    const key = keys.versionWeights();
    const shared = (await catalogGet(key)) ?? {};
    const merged = { ...shared };
    for (const [trackKey, cells] of Object.entries(delta)) {
      merged[trackKey] = { ...(merged[trackKey] ?? {}) };
      for (const [h, c] of Object.entries(cells)) {
        const prev = merged[trackKey][h] ?? { plays: 0, completes: 0 };
        merged[trackKey][h] = { plays: prev.plays + c.plays, completes: prev.completes + c.completes };
      }
    }
    // Cap the table (footprint): keep the 500 most-played tracks.
    const entries = Object.entries(merged)
      .sort((a, b) => totalPlays({ [b[0]]: b[1] }) - totalPlays({ [a[0]]: a[1] }))
      .slice(0, 500);
    await catalogSet(key, Object.fromEntries(entries));
    try { localStorage.setItem("pf.version.published", JSON.stringify(local)); } catch {}
    return true;
  } catch {
    return false;
  }
}

/**
 * Updates the ranker weights with all queued events, then saves them.
 * Contract: drains the queue; low learning rate (0.05) for stability;
 * returns counts so callers can log/verify training actually happened.
 * @returns {{trained: number}} Number of events consumed.
 */
export function trainFromFeedback() {
  let events = [];
  try { events = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch {}
  if (!events.length) return { trained: 0 };
  const w = loadWeights();
  for (const e of events) learn(e.f, e.y, w, 0.05); // low lr: stability
  saveWeights(w);
  localStorage.setItem(QUEUE_KEY, "[]");
  return { trained: events.length };
}

/**
 * Anonymous aggregate for OrbitDB: feature means over positive examples —
 * useful for peer consensus without exposing individual history.
 * Contract: null when there are no positive examples; contains no raw events.
 * @returns {Object|null}
 */
export function aggregateForSharing() {
  let events = [];
  try { events = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch {}
  const positives = events.filter((e) => e.y >= 1);
  if (!positives.length) return null;
  const mean = {};
  for (const k of Object.keys(positives[0].f)) {
    mean[k] = positives.reduce((s, e) => s + e.f[k], 0) / positives.length;
  }
  return { n: positives.length, mean, at: Date.now() };
}

/**
 * Publishes the local ranker aggregate to the shared catalog (P2P consensus).
 * Consensus rule (documented, simple, verifiable): the community adopts the
 * aggregate with the HIGHEST n (most positive examples) — no averaging math
 * to dispute, just the largest evidence base wins until a bigger one appears.
 * Contract: call after trainFromFeedback(); never throws.
 * @returns {Promise<boolean>} true when published to the P2P layer.
 */
export async function publishRankerConsensus() {
  try {
    const agg = aggregateForSharing();
    if (!agg) return false;
    const store = await import("./catalogstore.js");
    const current = await store.catalogGet(store.keys.rankerWeights());
    if (current && (current.n ?? 0) >= agg.n) return false; // community already has more evidence
    return store.catalogSet(store.keys.rankerWeights(), agg);
  } catch {
    return false;
  }
}

/**
 * Boot-time consensus merge: adopt the shared aggregate when it carries more
 * evidence than our own (n comparison, same rule as publish). The aggregate's
 * feature means are used as soft priors: each positive-equivalent example is
 * applied to the local weights with a low learning rate — the shared signal
 * nudges, the user's own feedback still dominates over time.
 * Contract: call once on shell boot; never throws.
 * @returns {Promise<boolean>} true when shared weights were adopted.
 */
export async function adoptRankerConsensus() {
  try {
    const store = await import("./catalogstore.js");
    const shared = await store.catalogGet(store.keys.rankerWeights());
    if (!shared?.mean || !(shared.n > 0)) return false;
    const local = aggregateForSharing();
    if (local && (local.n ?? 0) >= shared.n) return false; // we are the evidence leader
    const w = loadWeights();
    const { features: _f, learn } = await import("./ranker.js");
    const pseudoFeatures = { bias: 1, ...shared.mean };
    // Replayed as pseudo-examples (y=1) with very low lr, bounded replay count:
    // one large peer nudges the model without overriding local personalization.
    for (let i = 0; i < Math.min(shared.n, 20); i++) {
      learn(pseudoFeatures, 1, w, 0.01);
    }
    saveWeights(w);
    return true;
  } catch {
    return false;
  }
}
