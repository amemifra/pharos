/**
 * Thematic catalog: the home page "shelves", Spotify-style.
 * Each shelf is an archive.org query — no manual curation to maintain:
 * the normalization pipeline cleans whatever comes back.
 */

/**
 * @typedef {Object} Shelf
 * @property {string} id Stable id, used for anchors and cache keys.
 * @property {string} label UI label (English).
 * @property {string} query advancedsearch query ("" = whole collection).
 * @property {string} [collection] Collection to constrain the query to.
 */

/** @type {Shelf[]} */
export const SHELVES = [
  { id: "jazz", label: "Jazz", query: "subject:(jazz)", collection: "audio_music" },
  { id: "blues", label: "Blues", query: "subject:(blues)", collection: "audio_music" },
  { id: "classical", label: "Classical", query: "subject:(classical)", collection: "audio_music" },
  { id: "electronic", label: "Electronic", query: "subject:(electronic OR ambient)", collection: "netlabels" },
  { id: "rock", label: "Rock", query: "subject:(rock)", collection: "audio_music" },
  { id: "folk", label: "Folk & Country", query: "subject:(folk OR country)", collection: "audio_music" },
  { id: "live", label: "Live concerts", query: "", collection: "etree" },
  { id: "oldies", label: "78 rpm · early 1900s", query: "", collection: "georgeblood" },
];

// Assertive guard (#14): shelf ids are the map keys everywhere (shelves
// state, dedup, tests) — a duplicate id would silently drop a shelf.
if (new Set(SHELVES.map((s) => s.id)).size !== SHELVES.length) {
  throw new Error("SHELVES: duplicate shelf id");
}

/** Collection the "popular artists" experience works best on. */
export const ARTIST_COLLECTION = "etree";

/**
 * Open music collections the canonical cross-reference scans for albums.
 * One collection is not enough: e.g. The Beatles "Revolver (Deluxe)" lives in
 * `hifidelity`, etree hosts live shows, georgeblood the curated PD 78s. The
 * identity/dedup guards in lib/discography.js keep the broader scan honest.
 */
export const SOURCE_COLLECTIONS = ["audio_music", "hifidelity", "etree", "netlabels", "georgeblood"];

/** OR-query fragment ready for searchArchive's `collection` param (parenthesized). */
export const SOURCE_COLLECTION_QUERY = `(${SOURCE_COLLECTIONS.join(" OR ")})`;
