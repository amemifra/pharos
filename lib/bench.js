/**
 * Pipeline benchmark harness.
 *
 * Philosophy: the numbers govern. Compute-intensive pipeline stages stay in
 * plain JS until this harness — on real data, on the target device (low-end
 * smartphones) — proves that a WASM port is faster INCLUDING module
 * load/initialization cost.
 *
 * Decision criterion, documented: WASM wins only if
 *   t_js_p95 > t_wasm_p95 + t_wasm_load  (on the target device, low battery)
 *
 * Usage (browser console in dev):
 *   import("/lib/bench.js").then(b => b.benchEndToEnd("netlabels"))
 */

import { normalizeSearchItem, normalizeAlbum } from "./pipeline.js";
import { fetchItemMetadata, searchArchive } from "./archive.js";

/** Robust statistics: median and p95 — the mean lies on low-end devices. */
function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    n: times.length,
    median: pct(0.5),
    p95: pct(0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * Measures the search pipeline on real data.
 * Contract: synchronous loop, no allocations inside the timed section beyond
 * the pipeline itself; results are stable enough for p95 decisions.
 * @param {Object[]} rawDocs Raw advancedsearch docs.
 * @param {number} [iterations=50] Repetitions for the distribution.
 * @returns {Object} Statistics in ms (n/median/p95/min/max).
 */
export function benchSearchPipeline(rawDocs, iterations = 50) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    for (const doc of rawDocs) normalizeSearchItem(doc);
    times.push(performance.now() - t0);
  }
  const s = stats(times);
  console.table([{ stage: "normalizeSearchItem x" + rawDocs.length, ...s }]);
  return s;
}

/**
 * Fetches real albums and measures the tracklist pipeline.
 * Contract: network failures are skipped (not counted); throws nothing.
 * @param {string[]} identifiers Item identifiers to fetch.
 * @param {number} [iterations=20] Repetitions for the distribution.
 * @returns {Promise<Object>} Statistics in ms over the valid metadatas.
 */
export async function benchAlbumPipeline(identifiers, iterations = 20) {
  const metas = await Promise.all(identifiers.map((id) => fetchItemMetadata(id).catch(() => null)));
  const valid = metas.filter(Boolean);
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    valid.forEach((meta, j) => normalizeAlbum(identifiers[j], meta));
    times.push(performance.now() - t0);
  }
  const s = stats(times);
  console.table([{ stage: `normalizeAlbum x${valid.length}`, ...s }]);
  return s;
}

/**
 * End-to-end: fetch + normalization, to measure the RELATIVE weight of
 * compute vs network (usually negligible → no WASM).
 * Contract: prints an explicit verdict using the same threshold we would use
 * to justify a WASM port (5% of network time).
 * @param {string} [collection="netlabels"] Collection to fetch a page from.
 * @returns {Promise<{netMs: number, normMs: number, ratio: number}>}
 */
export async function benchEndToEnd(collection = "netlabels") {
  const net0 = performance.now();
  const { items } = await searchArchive({ query: "", collection, rows: 24 });
  const netMs = performance.now() - net0;
  const t0 = performance.now();
  items.forEach(normalizeSearchItem);
  const normMs = performance.now() - t0;
  const ratio = normMs / netMs;
  console.log(`network: ${netMs.toFixed(0)} ms · pipeline: ${normMs.toFixed(2)} ms · ratio ${(ratio * 100).toFixed(2)}%`);
  // Explicit verdict — the same one we would use to justify a WASM port.
  console.log(ratio < 0.05 ? "✓ negligible pipeline: plain JS remains the right choice" : "⚠ heavy pipeline: consider a WASM port of the slow stage");
  return { netMs, normMs, ratio };
}

/**
 * Records results in localStorage for cross-device comparisons.
 * Contract: appends (never overwrites other entries); keys include the
 * device signature so two runs never collide.
 * @param {string} label Stage label.
 * @param {Object} statsObj Statistics object (e.g. from stats()).
 * @returns {void}
 */
export function saveResult(label, statsObj) {
  const key = "pf.bench";
  const all = JSON.parse(localStorage.getItem(key) ?? "{}");
  all[`${label} @ ${navigator.hardwareConcurrency ?? "?"}c ${navigator.userAgent.slice(0, 40)}`] = {
    ...statsObj, at: new Date().toISOString(),
  };
  localStorage.setItem(key, JSON.stringify(all));
}

/**
 * Measures the track-alignment cost (canonical order + compound merge).
 * Decision data for the WASM silence-detection upgrade: if alignment on the
 * median device is already < 1ms, the wasm path is unnecessary.
 * @param {Object[]} tracks Normalized tracks (album.tracks).
 * @param {{title: string, number: number|null, durationMs: number|null}[]} canonical Canonical tracklist.
 * @param {number} [iterations=100]
 */
export async function benchTrackAlignment(tracks, canonical, iterations = 100) {
  const { alignTracks } = await import("./tracklist.js");
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    alignTracks({ tracks }, canonical);
    times.push(performance.now() - t0);
  }
  const s = stats(times);
  console.table([{ phase: `alignTracks n=${tracks.length} x${canonical.length}`, ...s }]);
  return s;
}
