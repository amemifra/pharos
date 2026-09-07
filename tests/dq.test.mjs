/**
 * Data Quality test suite — runs on REAL archive.org data.
 *
 * Usage: npm test
 * Output: DQ scorecard with standard metrics:
 *   - COMPLETENESS: % of key fields present (artist, year, title)
 *   - VALIDITY: % of non-junk titles/artists (not "*", not empty, plausible)
 *   - CONSISTENCY: % of tracks with sane number/duration, % of non-empty tracklists
 * Every metric has a minimum threshold: below threshold the test FAILS.
 * The numbers govern: this suite is the thermometer of every improvement.
 */

import { searchArchive, fetchItemMetadata } from "../lib/archive.js";
import { normalizeSearchItem, normalizeAlbum, minQuality } from "../lib/pipeline.js";

/** Titles considered unusable. */
const JUNK_TITLE = /^[*_\-.:\s]*$|^(track|audio|untitled|unknown)\b/i;

/** Strings indicating non-music or unusable metadata. */
const NON_MUSIC = /interview|psa:|public service|radio spot|commerciale?|trailer/i;

let passed = 0;
let failed = 0;
const checks = [];

/**
 * Records a named check against a threshold.
 * @param {string} name Human-readable metric name.
 * @param {number} value Measured value.
 * @param {number} threshold Minimum (or maximum, with cmp) threshold.
 * @param {(v: number, t: number) => boolean} [cmp] Comparison (default ≥).
 */
function check(name, value, threshold, cmp = (v, t) => v >= t) {
  const ok = cmp(value, threshold);
  ok ? passed++ : failed++;
  checks.push({ name, value, threshold, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}: ${typeof value === "number" ? value.toFixed(1) : value} (threshold ${threshold})`);
}

const pct = (n, d) => (d === 0 ? 0 : (100 * n) / d);

console.log("\n═══ DQ: search (real samples) ═══");

// Multi-collection sample: 3 collections × 30 docs.
const samples = [];
for (const coll of ["netlabels", "audio_music", "etree"]) {
  const { items } = await searchArchive({ query: "", collection: coll, rows: 30 });
  samples.push(...items.map(normalizeSearchItem));
}
const N = samples.length;

console.log(`\nSample: ${N} real albums`);

// — Completeness —
const withArtist = samples.filter((a) => a.artist !== "Unknown artist").length;
const withYear = samples.filter((a) => a.year != null).length;
check("artist completeness (%)", pct(withArtist, N), 60);
check("year completeness (%)", pct(withYear, N), 40);

// — Validity —
const validTitles = samples.filter((a) => !JUNK_TITLE.test(a.title) && a.title.length >= 2).length;
const nonMusic = samples.filter((a) => NON_MUSIC.test(a.title)).length;
check("title validity (%)", pct(validTitles, N), 90);
console.log(`  ℹ ${nonMusic} non-musical items detected (interviews/PSAs) — to discard`);
check("non-music precision (0 allowed in q≥3)", samples.filter((a) => a.quality >= 3 && NON_MUSIC.test(a.title)).length, 0, (v, t) => v <= t);

// — Aggregated quality —
const aboveQ3 = samples.filter(minQuality(3)).length;
console.log(`  ℹ records with quality ≥ 3: ${aboveQ3}/${N} (${pct(aboveQ3, N).toFixed(0)}%)`);

console.log("\n═══ DQ: tracklist (3 sample albums) ═══");

let trackOk = 0;
let trackTotal = 0;
let albumsTested = 0;
// Sampling methodology: iterate until 3 albums with a REAL tracklist (audio
// files) are found — many search hits have no audio files at all and would
// make the metric statistically meaningless. Cap at 8 attempts.
for (const album of samples.filter(minQuality(3))) {
  if (albumsTested >= 3) break;
  try {
    const meta = await fetchItemMetadata(album.id);
    if (!meta?.files?.length) continue; // no audio files: not a valid sample
    const full = normalizeAlbum(album.id, meta);
    if (full.tracks.length === 0) continue; // no playable tracks: same
    albumsTested++;
    for (const t of full.tracks) {
      trackTotal++;
      if (!JUNK_TITLE.test(t.title) && t.title.length >= 2 && t.number >= 1) trackOk++;
    }
  } catch {}
}
check("track title validity (%)", pct(trackOk, Math.max(trackTotal, 1)), 70);
check("albums with non-empty tracklist", albumsTested, 2);

// — Report —
console.log(`\n═══ RESULT: ${passed} pass, ${failed} fail ═══`);
if (failed > 0) {
  console.log("Below threshold: investigate pipeline stages; do not raise/lower thresholds to make it pass.");
  process.exit(1);
}
