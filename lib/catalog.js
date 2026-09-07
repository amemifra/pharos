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

/** Collection the "popular artists" experience works best on. */
export const ARTIST_COLLECTION = "etree";
