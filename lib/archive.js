/**
 * Client for the public archive.org APIs.
 * Native browser fetch only — zero dependencies.
 *
 * Contract: every function here returns raw archive.org documents untouched.
 * All cleaning/normalization belongs to lib/pipeline.js; this module only
 * knows endpoints, query shapes and URL conventions.
 */

import { normalizeSearchItem } from "./pipeline.js";

const SEARCH_URL = "https://archive.org/advancedsearch.php";
const METADATA_URL = "https://archive.org/metadata";
const DOWNLOAD_BASE = "https://archive.org/download";

/** Public music collections indexed by the search UI. */
export const COLLECTIONS = [
  { id: "etree", label: "Live Music Archive", hint: "authorized live concerts" },
  { id: "netlabels", label: "Netlabels", hint: "indie music under free licenses" },
  { id: "georgeblood", label: "78rpm", hint: "digitized 78 rpm discs" },
  { id: "audio_music", label: "Music (general)", hint: "all music audio" },
];

/**
 * Two-phase ranked search: fielded query first, general second.
 *
 * Strategy (classic IR, confirmed by E2E journeys): a query like "Ella
 * Fitzgerald" SHOULD prefer items whose creator matches; the generic
 * full-text query drowns them under VOA radio broadcasts. Phase 1 searches
 * creator:"..." (only when no collection filter is set); phase 2 runs the
 * general full-text query. Results are merged, deduped by identifier, then
 * ranked by the learning-to-rank model (lib/ranker.js), whose weights improve
 * from usage feedback (lib/feedback.js).
 *
 * @param {Object} opts
 * @param {string} opts.query Free-text query.
 * @param {string} [opts.collection] Collection id, e.g. "etree".
 * @param {number} [opts.page=1] Page number, 1-based.
 * @param {number} [opts.rows=24] Results per page.
 * @returns {Promise<{items: import("./pipeline.js").Album[], total: number}>} Ranked albums.
 */
export async function searchRanked({ query, collection, page = 1, rows = 24 }) {
  const [fielded, general] = await Promise.all([
    query && !collection
      ? searchArchive({ query: `creator:("${query}")`, collection, page, rows })
      : Promise.resolve({ items: [], total: 0 }),
    searchArchive({ query, collection, page, rows }),
  ]);

  const seen = new Set();
  const deduped = [...fielded.items, ...general.items].filter((d) =>
    seen.has(d.identifier) ? false : (seen.add(d.identifier), true)
  );

  const { features, predict, loadWeights } = await import("./ranker.js");
  const weights = loadWeights();
  const items = deduped.map(normalizeSearchItem);
  items.sort((a, b) => predict(features(query, b), weights) - predict(features(query, a), weights));

  return { items, total: Math.max(fielded.total, general.total) };
}

/**
 * Runs a full-text search against archive.org.
 * Contract: returns RAW docs (no normalization); never returns fewer fields
 * than requested; throws on HTTP errors so callers can show a retry state.
 * @param {Object} opts
 * @param {string} opts.query Free-text query.
 * @param {string} [opts.collection] Collection id, e.g. "etree".
 * @param {number} [opts.page=1] Page number, 1-based.
 * @param {number} [opts.rows=24] Results per page.
 * @returns {Promise<{items: Object[], total: number}>} Raw docs + total hit count.
 */
export async function searchArchive({ query, collection, page = 1, rows = 24 }) {
  // Exclude lending/login-restricted items at the SOURCE: they pollute the
  // index as "audio" but 401 on download. Verified against the live API:
  // "blues" top results were 100% restricted before this filter.
  const parts = ['mediatype:audio', '-access-restricted-item:true'];
  if (collection) parts.push(`collection:${collection}`);
  if (query) parts.push(`(${query})`);

  const params = new URLSearchParams();
  params.set("q", parts.join(" AND "));
  for (const f of ["identifier", "title", "creator", "date", "year", "collection", "downloads"]) {
    params.append("fl[]", f);
  }
  params.set("rows", String(rows));
  params.set("page", String(page));
  params.set("output", "json");

  const res = await fetch(`${SEARCH_URL}?${params}`);
  if (!res.ok) throw new Error(`archive.org search HTTP ${res.status}`);
  const json = await res.json();
  const docs = json?.response?.docs ?? [];
  return { items: docs, total: json?.response?.numFound ?? 0 };
}

/**
 * Fetches the raw metadata payload of an item (album).
 * Contract: returns the /metadata payload verbatim; throws on HTTP errors.
 * @param {string} identifier archive.org item identifier.
 * @returns {Promise<Object>} Raw payload of /metadata/{identifier}.
 */
export async function fetchItemMetadata(identifier) {
  const res = await fetch(`${METADATA_URL}/${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error(`archive.org metadata HTTP ${res.status}`);
  return res.json();
}

/**
 * Streaming/download URL for a file inside an item.
 * Contract: pure string composition — no network call, never throws.
 * @param {string} identifier Item identifier.
 * @param {string} fileName File name as listed in the item metadata.
 * @returns {string} Direct file URL (supports HTTP Range).
 */
export function fileUrl(identifier, fileName) {
  return `${DOWNLOAD_BASE}/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;
}

/**
 * Cover-image URL for an item, if the item's file list has one.
 * Contract: purely local scan of the given file list — no network call.
 * @param {string} identifier Item identifier.
 * @param {Object[]} files File list from the item metadata.
 * @returns {string|null} Image URL, or null when no image exists.
 */
export function coverUrl(identifier, files) {
  const img =
    files.find((f) => f.format === "JPEG Thumb") ||
    files.find((f) => /\.(jpe?g|png)$/i.test(f.name ?? "") && !/_surgem/.test(f.name ?? ""));
  return img ? fileUrl(identifier, img.name) : null;
}

/**
 * Official thumbnail URL of an item — always available when the item has any
 * image. Ideal for grid cards: it requires no metadata fetch at all.
 * Contract: pure string composition; the URL may 404 if the item has no image
 * (callers must handle onError).
 * @param {string} identifier Item identifier.
 * @returns {string} Thumbnail URL served by archive.org.
 */
export function thumbUrl(identifier) {
  return `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
}

/**
 * Search by artist (creator field), sorted by downloads.
 * Contract: returns RAW docs sorted server-side by downloads desc.
 * @param {string} artist Artist name as it appears in the creator field.
 * @param {number} [rows=100] Maximum number of docs.
 * @returns {Promise<Object[]>} Raw docs; empty array on HTTP error.
 */
export async function searchByArtist(artist, rows = 100) {
  const res = await fetch(
    `${SEARCH_URL}?q=${encodeURIComponent(`mediatype:audio AND creator:"${artist}"`)}` +
      "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=date&fl%5B%5D=year&fl%5B%5D=collection&fl%5B%5D=downloads" +
      `&sort%5B%5D=downloads+desc&rows=${rows}&output=json`
  );
  if (!res.ok) throw new Error(`archive.org search HTTP ${res.status}`);
  const json = await res.json();
  return json?.response?.docs ?? [];
}

/**
 * Per-artist statistics for a collection (input for our popularity ranking).
 * Contract: aggregates downloads/recordings case-insensitively (first creator
 * only); returns empty array on HTTP error instead of throwing.
 * @param {string} [collection="audio_music"] Collection to scan.
 * @param {number} [rows=500] Number of docs scanned (most downloaded first).
 * @returns {Promise<{name: string, recordings: number, downloads: number}[]>}
 */
/**
 * Creator stats with pagination support.
 * @param {string} [collection="audio_music"]
 * @param {number} [rows=300]
 * @param {number} [page=1] 1-based page for the unbounded catalog crawl.
 */
export async function creatorStats(collection = "audio_music", rows = 300, page = 1) {
  const res = await fetch(
    `${SEARCH_URL}?q=${encodeURIComponent(`mediatype:audio AND -access-restricted-item:true AND collection:${collection}`)}` +
      `&fl%5B%5D=creator&fl%5B%5D=downloads&sort%5B%5D=downloads+desc&rows=${rows}&page=${page}&output=json`
  );
  if (!res.ok) return [];
  const json = await res.json();
  const stats = new Map();
  for (const doc of json?.response?.docs ?? []) {
    const c = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator;
    if (typeof c !== "string" || !c.trim()) continue;
    const key = c.toLowerCase();
    const prev = stats.get(key) ?? { name: c, recordings: 0, downloads: 0 };
    prev.recordings += 1;
    prev.downloads += Number(doc.downloads ?? 0);
    stats.set(key, prev);
  }
  return [...stats.values()];
}
