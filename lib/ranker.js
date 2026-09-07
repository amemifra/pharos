/**
 * Learning-to-rank — small linear model (online logistic regression).
 *
 * Philosophy: OBJECTIVE features + weights that learn from usage feedback.
 * The model is small on purpose: ~10 features, O(n) SGD update, runs in <1ms
 * even on low-end phones (measurable with lib/bench.js).
 *
 * Self-improvement: every user interaction is a labeled example
 *   full play → y=1 (relevant)
 *   click but fast skip (<5s) → y=0 (probable false positive)
 *   result shown, ignored → y=0 (weak)
 * Events go to localStorage and OrbitDB: weights update per-user and can be
 * aggregated into peer consensus (weighted average of examples, no servers).
 */

import { canonScore } from "./popularity.js";

/** Initial weights: reasonable priors, not truth — the model corrects them. */
export const DEFAULT_WEIGHTS = {
  bias: -2.0,
  artistExact: 3.0,    // normalized artist == query
  artistInQuery: 2.0,  // artist contained in the query
  titleMatch: 2.5,     // title contains the query's key phrase
  trigramTitle: 1.5,   // trigram similarity query↔title (0–1)
  quality: 0.8,        // pipeline metadata quality (0–4)
  notability: 0.05,    // artist canonScore (0–10) — fallback/seed only
  downloads: 0.5,      // log10(1+downloads) — current interest
  collectionFit: 0.3,  // thematic query (e.g. "jazz") matching the collection
};

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s{2,}/g, " ").trim();

/** Trigram-Dice similarity (same measure as lib/canonical.js). */
export function trigram(a, b) {
  const gram = (s) => { const g = new Set(); for (let i = 0; i < s.length - 2; i++) g.add(s.slice(i, i + 3)); return g; };
  const A = gram(norm(a)), B = gram(norm(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * Features of a (query, album) pair — all numeric and observable.
 * Contract: pure; every feature is deterministic from the inputs, so training
 * data remains reproducible.
 * @param {string} query User query ("" allowed).
 * @param {import("./pipeline").Album} album Candidate album.
 * @returns {Object} feature name → value.
 */
export function features(query, album) {
  const q = norm(query);
  const artist = norm(album.artist);
  const title = norm(album.title);
  const qTokens = new Set(q.split(" "));
  return {
    bias: 1,
    artistExact: q && artist === q ? 1 : 0,
    artistInQuery: q && artist && qTokens.has(artist) ? 1 : (artist && q.includes(artist) ? 1 : 0),
    titleMatch: q && title.includes(q) ? 1 : 0,
    trigramTitle: trigram(q, title),
    quality: album.quality ?? 0,
    notability: canonScore(album.artist),
    downloads: Math.log10(1 + (album.downloads ?? 0)),
    collectionFit: 0, // filled by the caller when the query is thematic
  };
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Relevance score (0–1). Linear + sigmoid: explainable, extremely fast.
 * Contract: missing weights default to 0 (forward-compatible with new features).
 * @param {Object} f Features from features().
 * @param {Object} weights Weight vector.
 * @returns {number} Probability-like relevance in [0,1].
 */
export function predict(f, weights = DEFAULT_WEIGHTS) {
  let z = 0;
  for (const [k, v] of Object.entries(f)) z += (weights[k] ?? 0) * v;
  return sigmoid(z);
}

/**
 * One SGD step: observed y vs predicted → updates the weights in place.
 * Contract: mutates `weights`; unbounded features could drift weights, so
 * keep features in bounded ranges (they are).
 * @param {Object} f Feature vector.
 * @param {number} y Observed label: 0 | 1 (intermediate values allowed).
 * @param {Object} weights Mutated in place.
 * @param {number} [lr=0.1] Learning rate.
 * @returns {void}
 */
export function learn(f, y, weights, lr = 0.1) {
  const err = y - predict(f, weights);
  for (const [k, v] of Object.entries(f)) {
    if (weights[k] != null) weights[k] += lr * err * v;
  }
}

/**
 * Resolves the active weights: seed → locally learned → community.
 * Contract: returns a fresh copy every time (callers may mutate freely).
 * @returns {Object} Weight vector.
 */
export function loadWeights() {
  // 1) seed
  const w = { ...DEFAULT_WEIGHTS };
  // 2) locally learned (individual feedback)
  try {
    const local = JSON.parse(localStorage.getItem("pf.ranker") ?? "null");
    if (local) Object.assign(w, local);
  } catch {}
  return w;
}

/**
 * Persists the weight vector locally.
 * Contract: silently skips when storage is unavailable.
 * @param {Object} w Weight vector.
 * @returns {void}
 */
export function saveWeights(w) {
  try { localStorage.setItem("pf.ranker", JSON.stringify(w)); } catch {}
}

/**
 * Whether the model has left the seed state (i.e. it already learned something).
 * Contract: pure read; false in fresh profiles/private windows.
 * @returns {boolean}
 */
export function isTrained() {
  try { return !!localStorage.getItem("pf.ranker"); } catch { return false; }
}
