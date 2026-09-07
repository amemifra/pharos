/**
 * Data normalization pipeline — 100% synchronous and pure.
 *
 * archive.org metadata is dirty: titles with glued dates and venues, multiple
 * creators, unnumbered tracks, filenames standing in for titles. This pipeline
 * turns raw documents into aggregable records (Album, Track) on the fly, at
 * fetch time. No workers, no wasm: pure O(n) functions over data already in
 * memory. Why synchronous: the only unavoidable wait is the network fetch
 * itself; after that, normalization must add zero perceptible latency, even
 * on low-end phones (measured: ~0.07ms per 5 docs, see lib/bench.js).
 * If heavy binary parsing is ever needed (FLAC/ID3 tags), add a wasm stage
 * without changing this contract.
 */

/**
 * @typedef {Object} Album
 * @property {string} id archive.org identifier.
 * @property {string} title Normalized title.
 * @property {string} artist Normalized artist.
 * @property {number|null} year Release year, when inferable.
 * @property {string[]} collections archive.org collections the item belongs to.
 * @property {number} downloads Download count (0 for full album payloads).
 * @property {number} quality Quality score 0–4 (see qualityScore).
 * @property {string} [cover] Cover image URL.
 * @property {Track[]} [tracks] Present only for fully-loaded albums.
 */

/**
 * @typedef {Object} Track
 * @property {string} id Stable id "{identifier}/{fileName}".
 * @property {string} title Cleaned track title.
 * @property {number} number Sequential display number, 1..n.
 * @property {number|null} duration Duration in seconds, when known.
 * @property {string} url Streaming URL of the preferred format.
 * @property {string} format archive.org format label (e.g. "VBR MP3").
 * @property {string} __albumArtist Album-level artist (used by L1 canonicalization).
 */

/* ------------------------------------------------------------------ */
/* Pipeline stages (each stage is (doc) => doc)                         */
/* ------------------------------------------------------------------ */

/**
 * Rebuilds a readable title from the identifier (last-resort fallback).
 * Contract: pure, always returns a non-empty string for truthy input.
 * @param {string} identifier archive.org identifier.
 * @returns {string} Human-readable title-cased label.
 */
export function prettyIdentifier(identifier) {
  return String(identifier ?? "")
    .replace(/^(mc|hc|nm|netlabel|lbl)[-_]?/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Strips known noise from titles: dates, venues, underscores, brackets.
 * Contract: never returns empty (falls back to prettyIdentifier).
 * @param {Object} doc Raw or partially-cleaned doc.
 * @returns {Object} Doc with `cleanTitle`.
 */
const stageCleanTitle = (doc) => {
  let t = String(doc.title ?? "").trim();
  t = t
    .replace(/[_]+/g, " ")                                  // snake_case → spaces
    .replace(/\b\d{4}[-_/.]\d{2}[-_/.]\d{2}\b/g, "")   // 1977-05-08
    .replace(/\b\d{2}[-_/.]\d{2}[-_/.]\d{4}\b/g, "")   // 05-08-1977
    .replace(/\b\d{4}\b(?=[^0-9]*$)/, "")              // trailing lone year
    .replace(/\s*[-–—:|]\s*(live\s+at|at|@)\s+[^,;]+/gi, "")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s*\([^)]*\b(disc|cd|vol|volume|set)\b[^)]*\)/gi, " ")
    .replace(/\s*[-–—]_*[-–—]\s*/g, " - ")                 // "_-_" → " - "
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s-–—:_]+|[\s-–—:_]+$/g, "");
  return { ...doc, cleanTitle: t || prettyIdentifier(doc.identifier) };
};

/**
 * Derives the artist from the creator field (dirty array/string).
 * Contract: never returns empty; sentinel "Unknown artist" when missing.
 * @param {Object} doc
 * @returns {Object} Doc with `cleanArtist`.
 */
const stageCleanArtist = (doc) => {
  const raw = doc.creator;
  const first = Array.isArray(raw) ? raw[0] : raw;
  let a = String(first ?? UNKNOWN_ARTIST).trim();
  a = a
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { ...doc, cleanArtist: a || UNKNOWN_ARTIST };
};

/**
 * Extracts the year from date/year fields in any format.
 * Contract: returns null when no plausible year (1800–2099) is found.
 * @param {Object} doc
 * @returns {Object} Doc with `cleanYear`.
 */
const stageYear = (doc) => {
  const src = String(doc.year ?? doc.date ?? "");
  const m = src.match(/\b(1[89]\d{2}|20\d{2})\b/);
  return { ...doc, cleanYear: m ? Number(m[1]) : null };
};

/**
 * When creator is missing, infers the artist from an "Artist - Album" title.
 * Contract: only fires on missing artist; strips the inferred prefix from the title.
 * @param {Object} doc
 * @returns {Object} Doc with possibly-updated `cleanArtist` and `cleanTitle`.
 */
const stageInferArtist = (doc) => {
  if (doc.cleanArtist && doc.cleanArtist !== UNKNOWN_ARTIST) return doc;
  const m = doc.cleanTitle.match(/^(.{2,40}?)\s+[-–—]\s+(.+)$/);
  if (!m) return doc;
  return { ...doc, cleanArtist: m[1].trim(), cleanTitle: m[2].trim() };
};

/* ------------------------------------------------------------------ */

/**
 * Detects NON-musical content (interviews, radio PSAs, ads): the music
 * community does not consider them catalogable. Flags the doc as non-music;
 * quality drops to 0 and the UI excludes it by default.
 * NOTE: trailing \b only after word characters (a "psa:" alternative with a
 * trailing \b can never match — two consecutive non-word boundaries).
 */
const NON_MUSIC_RE = /\b(interview|intervista|psa|public service|radio spot|commercial[eo]|trailer|news broadcast)\b/i;
const stageNonMusic = (doc) => ({ ...doc, isNonMusic: NON_MUSIC_RE.test(String(doc.title ?? "")) });

/** Sentinel artist value, shared by every module (keep in sync across lib/). */
export const UNKNOWN_ARTIST = "Unknown artist";

/**
 * Record quality score (0–4): lets the UI discard or demote unrecognizable
 * data instead of showing it. One point each for:
 *   +1 plausible title (≥3 chars, not junk)
 *   +1 known artist
 *   +1 known year
 *   +1 downloads > 0 (someone considered it listenable)
 * Contract: non-music content always scores 0.
 * @param {Object} doc Cleaned doc.
 * @returns {number} Score 0–4.
 */
function qualityScore(doc) {
  if (doc.isNonMusic) return 0;
  let score = 0;
  const t = doc.cleanTitle ?? "";
  if (t.length >= 3 && !/^[*_\-.\s]+$/.test(t) && !/^(track|audio|untitled)$/i.test(t)) score++;
  if (doc.cleanArtist && doc.cleanArtist !== UNKNOWN_ARTIST) score++;
  if (doc.cleanYear) score++;
  if (Number(doc.downloads ?? 0) > 0) score++;
  return score;
}

/** Execution order of the stages applied to search docs. */
const SEARCH_STAGES = [stageCleanTitle, stageCleanArtist, stageInferArtist, stageYear, stageNonMusic];

/**
 * Runs the pipeline over a doc. Synchronous: no waiting after the fetch.
 * Contract: stages run in order, each receiving the previous output; the
 * function is pure (no side effects, no async).
 * @template T
 * @param {T} doc Raw document.
 * @param {((d: T) => T)[]} stages Ordered stage list.
 * @returns {T} Fully-processed document.
 */
function runPipeline(doc, stages) {
  let acc = doc;
  for (const stage of stages) acc = stage(acc);
  return acc;
}

/**
 * Normalizes a search result into an aggregable Album record.
 * Contract: synchronous and pure; output always contains id/title/artist/
 * year/collections/downloads/quality (tracks only via normalizeAlbum).
 * @param {Object} raw Raw advancedsearch doc.
 * @returns {Album}
 */
export function normalizeSearchItem(raw) {
  const doc = runPipeline(raw, SEARCH_STAGES);
  const collections = Array.isArray(raw.collection) ? raw.collection : [raw.collection].filter(Boolean);
  return {
    id: raw.identifier,
    title: doc.cleanTitle,
    artist: doc.cleanArtist,
    year: doc.cleanYear,
    collections,
    downloads: Number(raw.downloads ?? 0),
    quality: qualityScore(doc),
  };
}

/**
 * Predicate factory: rejects records below a quality threshold.
 * Contract: better fewer results than dirty ones; use .filter(minQuality(3)).
 * @param {number} score Minimum acceptable score (inclusive).
 * @returns {(album: Album) => boolean}
 */
export const minQuality = (score) => (album) => (album.quality ?? 0) >= score;

/** Comparator: most downloaded first (feed "popular"). */
export const byPopularity = (a, b) => b.downloads - a.downloads;
/** Comparator: newest first (unknown years last). */
export const byYear = (a, b) => (b.year ?? 0) - (a.year ?? 0);

/* ------------------------------------------------------------------ */
/* Album normalization (tracklist)                                      */
/* ------------------------------------------------------------------ */

/**
 * Streamable format choice: derived MP3s (always present) preferred over
 * FLAC as faithful alternative. The browser streams both.
 */
const FORMAT_PRIORITY = [
  (f) => /VBR MP3|MP3/i.test(f.format ?? ""),
  (f) => /Flac/i.test(f.format ?? ""),
];

/**
 * Extracts the track number from file.track ("1", "1.2", "Disc 1 - 03")
 * or from the filename.
 * Contract: always returns ≥1 (fallback = position index + 1).
 * @param {Object} file File entry.
 * @param {number} index Position in the group list (fallback base).
 * @returns {number}
 */
function parseTrackNumber(file, index) {
  const src = String(file.track ?? "");
  const m = src.match(/(\d+)\s*$/);
  if (m) return Number(m[1]);
  const fm = String(file.name ?? "").match(/(\d{1,2})\s*[-_.\s]/);
  return fm ? Number(fm[1]) : index + 1;
}

/**
 * Matches raw compound-file names (vinyl side rips, unaligned disc images):
 * e.g. "disc1/lp xxx disc1side1", "Side A", "disc1side2". These carry no
 * per-track identity — an honest neutral label beats a raw filename.
 */
const RAW_SIDE_RE = /disc\d+side\d+|^\s*side\s+[ab12]\b/i;

/**
 * Track title: dirty file.title → cleaned → filename → junk discarded.
 * Compound/unaligned side files get the neutral "Vinyl side N" label, with
 * the raw name preserved in `rawTitle` for title attributes/aria-labels.
 * Contract: never returns empty or pure-junk strings ("*", "Track 3").
 * @param {Object} file File entry.
 * @param {number} index Position fallback base.
 * @returns {{title: string, rawTitle: string}} Display title + raw name.
 */
function trackTitle(file, index) {
  const raw = String(file.title ?? file.name ?? `Track ${index + 1}`);
  const rawTitle = raw.replace(/\.(mp3|flac|ogg|wav|m4a)$/i, "");
  const base = rawTitle.replace(/[_]+/g, " ");
  const doc = runPipeline({ title: base }, [stageCleanTitle]);
  const t = doc.cleanTitle;
  // Junk titles (*, nameless tracks, lone numbers): rebuild from filename.
  if (!t || t === "*" || /^[-_.\s*]+$/.test(t) || /^(track|audio|untitled)?\s*\d*$/i.test(t)) {
    return { title: prettyIdentifier(file.name?.replace(/\.[^.]+$/, "")) || `Track ${index + 1}`, rawTitle };
  }
  // Raw side-file names (e.g. "disc1/lp four seasons disc1side1"): neutral,
  // honest label — the tracklist alignment (lib/tracklist.js) may refine later.
  if (RAW_SIDE_RE.test(t)) {
    const side = t.match(/side\s*(\d+)/i)?.[1] ?? t.match(/side\s*([ab])/i)?.[1]?.toUpperCase() ?? "?";
    return { title: `Vinyl side ${side} (tracklist not aligned)`, rawTitle };
  }
  return { title: t, rawTitle };
}

/**
 * Normalizes an item's metadata into an Album with a streamable tracklist.
 * Groups "original + derivative" files of the same track and picks the best
 * playback format.
 * Contract: synchronous; display numbering is always sequential 1..n (multiple
 * media in one item — LP sides, multi-CD — produce duplicate numbers); the
 * album title never repeats the artist prefix.
 * @param {string} identifier archive.org item identifier.
 * @param {Object} meta Raw /metadata/{id} payload (metadata + files).
 * @returns {Album}
 */
export function normalizeAlbum(identifier, meta) {
  const server = meta?.metadata ?? {};
  const files = meta?.files ?? [];

  const base = runPipeline(
    {
      title: server.title,
      creator: server.creator,
      date: server.date,
      year: server.year,
    },
    SEARCH_STAGES
  );

  // Grouping stage: key = file name without extension.
  const groups = new Map();
  for (const f of files) {
    if (!f.name || !/\.(mp3|flac|ogg|wav|m4a)$/i.test(f.name)) continue;
    const key = f.name.replace(/\.[^.]+$/, "").toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  const tracks = [...groups.values()].map((group, index) => {
    // All format variants of the same recording (quality ranking decides
    // which one plays — lib/formatpolicy.js). Keep url/format = best variant
    // for backward compatibility with anything reading the plain fields.
    const variants = group.map((f) => ({ format: f.format ?? "", url: fileUrlLocal(identifier, f.name) }));
    const file = group.reduce((best, f) =>
      (({ "24bit flac": 7, flac: 6, m4a: 5, aac: 5, "vbr mp3": 4, mp3: 3, ogg: 2, wav: 6 })[String(f.format ?? "").toLowerCase()] ?? 0)
        > (({ "24bit flac": 7, flac: 6, m4a: 5, aac: 5, "vbr mp3": 4, mp3: 3, ogg: 2, wav: 6 })[String(best?.format ?? "").toLowerCase()] ?? 0) ? f : best, null) ?? group[0];
    const duration = Number(file.length);
    const { title, rawTitle } = trackTitle(file, index);
    return {
      id: `${identifier}/${file.name}`,
      title,
      rawTitle,
      number: Math.max(1, parseTrackNumber(file, index)),
      duration: Number.isFinite(duration) && !String(file.length).includes(":") ? Math.round(duration) : null,
      url: fileUrlLocal(identifier, file.name),
      format: file.format ?? "",
      variants,
      // Album-level artist: needed by L1 canonicalization (MusicBrainz).
      __albumArtist: base.cleanArtist,
    };
  });

  tracks.sort((a, b) => a.number - b.number);

  // Sequential display numbering: see normalizeAlbum contract above.
  tracks.forEach((t, i) => { t.number = i + 1; });

  const img =
    files.find((f) => f.format === "JPEG Thumb") ||
    files.find((f) => /\.(jpe?g|png)$/i.test(f.name ?? ""));

  // Titles often already contain "Artist —": avoid the visible duplication
  // ("Edith Piaf — Edith Piaf - 30e Anniversaire" → "30e Anniversaire").
  let displayTitle = base.cleanTitle;
  const artistEsc = base.cleanArtist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sepRe = new RegExp(`^${artistEsc}\\s*[-–—:]\\s*`, "i");
  while (displayTitle.length > base.cleanArtist.length + 2 && sepRe.test(displayTitle)) {
    displayTitle = displayTitle.replace(sepRe, "").trim();
  }

  return {
    id: identifier,
    title: displayTitle,
    artist: base.cleanArtist,
    year: base.cleanYear,
    collections: Array.isArray(server.collection) ? server.collection : [],
    downloads: 0,
    quality: qualityScore(base),
    // archive.org lending/login-restricted item: files 401 on download —
    // surfaced to the UI so Play can refuse honestly (lib/AlbumCard guard).
    restricted: Boolean(server.access_restricted_item ?? server["access-restricted-item"]),
    cover: img ? `https://archive.org/download/${identifier}/${encodeURIComponent(img.name)}` : null,
    tracks,
  };
}

// Avoids a circular import with lib/archive.js.
function fileUrlLocal(identifier, fileName) {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;
}
