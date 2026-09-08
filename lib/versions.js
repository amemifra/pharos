/**
 * Version ranking (F3) — which of a track's published versions plays by default.
 *
 * Default selection (deterministic, honest):
 *   score = qualityTier(format) × (1 + completionRatio)
 * where qualityTier comes from lib/formatpolicy.js FORMAT_RANK (0–7, objective
 * bit-depth/bitrate reality) and completionRatio is the aggregated community
 * completion ratio for that exact URL from `weights:versions` (OrbitDB, same
 * consensus mechanism as the ranker weights). When no feedback exists for any
 * version the result is quality-tier order and the UI says so honestly.
 *
 * Manual override (persistent): `pf.version.choice` — the user's explicit
 * pick always wins over the aggregate (pattern of the format policy manual).
 */

import { rankOf } from "./formatpolicy.js";
import { catalogGet, keys } from "./catalogstore.js";

const LS_KEY = "pf.version.choice";

/** The user's manual version overrides: trackKey → url. */
export function loadChoices() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") ?? {}; } catch { return {}; }
}

export function saveChoice(trackKey, url) {
  try {
    const all = loadChoices();
    if (url) all[trackKey] = url;
    else delete all[trackKey];
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {}
}

/**
 * Reads the aggregated community stats for one track's versions.
 * Shape fix (#30): the shared/local table is trackKey → {urlHash: {plays,
 * completes}} — the CELL is an object keyed by urlHash, not an array. Map it
 * into the array form chooseVersion expects.
 * @param {string} trackKey
 * @returns {Promise<{urlHash: string, plays: number, completes: number}[]>}
 */
export async function versionStats(trackKey) {
  const all = (await catalogGet(keys.versionWeights())) ?? {};
  const cell = all[trackKey];
  if (!cell || typeof cell !== "object") return [];
  return Object.entries(cell).map(([urlHash, s]) => ({
    urlHash,
    plays: Number(s?.plays) || 0,
    completes: Number(s?.completes) || 0,
  }));
}

/** FNV-1a hash of a URL: compact key for the weights table (no URL privacy leak). */
export function urlHash(url) {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Picks the default version of a track.
 * @param {{url: string, format?: string}[]} versions
 * @param {{urlHash: string, plays: number, completes: number}[]} [stats]
 * @returns {{version: Object|null, basis: "choice"|"aggregate"|"quality"|"empty"}}
 */
export function chooseVersion(versions, stats = [], trackKey) {
  if (!versions?.length) return { version: null, basis: "empty" };

  // 1) Explicit user choice wins (persistent manual override).
  const choices = loadChoices();
  const picked = trackKey && versions.find((v) => v.url === choices[trackKey]);
  if (picked) return { version: picked, basis: "choice" };

  // 2) Aggregate: completion ratio weighted by evidence, tiered by quality.
  const byHash = new Map(stats.map((s) => [s.urlHash, s]));
  const scored = versions.map((v) => {
    const s = byHash.get(urlHash(v.url));
    const completion = s && s.plays > 0 ? s.completes / s.plays : 0;
    const evidence = s ? Math.min(1, s.plays / 10) : 0; // <10 plays: weak evidence
    const score = rankOf(v.format) * (1 + completion * evidence);
    return { v, score, evidence };
  });
  const withEvidence = scored.filter((s) => s.evidence > 0);
  if (withEvidence.length) {
    withEvidence.sort((a, b) => b.score - a.score);
    return { version: withEvidence[0].v, basis: "aggregate" };
  }

  // 3) No data: quality tier order — and the caller should SAY so.
  scored.sort((a, b) => rankOf(b.v.format) - rankOf(a.v.format));
  return { version: scored[0].v, basis: "quality" };
}

/**
 * Convenience: async default-version resolution for a track (stats from P2P).
 * @param {string} trackKey
 * @param {{url: string, format?: string}[]} versions
 * @returns {Promise<{version: Object|null, basis: string}>}
 */
export async function chooseVersionAsync(trackKey, versions) {
  const stats = await versionStats(trackKey);
  return chooseVersion(versions, stats, trackKey);
}
