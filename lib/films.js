import { escapeLucene, thumbUrl, fileUrl } from "./archive.js";
import { plainText } from "./books.js";

const SEARCH_URL = "https://archive.org/advancedsearch.php";
const METADATA_URL = "https://archive.org/metadata";
const DETAILS_BASE = "https://archive.org/details";

export const FILM_PAGE_SIZE = 24;
export const FILM_MAX_PAGE = 40;

export const FILM_SHELVES = [
  { id: "feature_films", label: "Feature films", query: "collection:feature_films" },
  { id: "film_noir", label: "Film noir", query: "collection:film_noir" },
  { id: "moviesandfilms", label: "Movies and films", query: "collection:moviesandfilms" },
  { id: "prelinger", label: "Prelinger Archives", query: "collection:prelinger" },
];

export const FILM_COLLECTIONS = FILM_SHELVES.map((s) => s.id);

export const RESTRICTED_COLLECTIONS = ["inlibrary", "printdisabled", "lendinglibrary"];

export const PLAYABLE_FORMATS = {
  "h.264": { label: "MP4", mimeType: "video/mp4" },
  "h.264 IA": { label: "MP4", mimeType: "video/mp4" },
  "MPEG4": { label: "MP4", mimeType: "video/mp4" },
  "512Kb MPEG4": { label: "MP4 (low quality)", mimeType: "video/mp4" },
  "HiRes MPEG4": { label: "MP4 (high quality)", mimeType: "video/mp4" },
  "Ogg Video": { label: "Ogg", mimeType: "video/ogg" },
  "WebM": { label: "WebM", mimeType: "video/webm" },
};

const PUBLIC_CLAUSE = [
  "mediatype:movies",
  `collection:(${FILM_COLLECTIONS.join(" OR ")})`,
  "-access-restricted-item:true",
  `-collection:(${RESTRICTED_COLLECTIONS.join(" OR ")})`,
].join(" AND ");

const SEARCH_FIELDS = ["identifier", "title", "director", "cast", "year", "date", "runtime", "description", "mediatype", "collection", "access-restricted-item", "downloads"];

export class FilmsError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "FilmsError";
    this.code = code;
    this.status = extra.status ?? null;
    this.retryAfter = extra.retryAfter ?? null;
  }
}

const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String).map((s) => s.trim()).filter(Boolean);
const first = (v) => list(v)[0] ?? null;

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : null;
}

function parseYear(year, date) {
  for (const v of [first(year), first(date)]) {
    const m = v && /\b(\d{4})\b/.exec(v);
    if (m) return Number(m[1]);
  }
  return null;
}

const isRestrictedFlag = (v) => v === true || String(v).toLowerCase() === "true";
const lowerCollections = (doc) => list(doc.collection).map((c) => c.toLowerCase());
const isMovieOrUnstated = (doc) => [null, "movies"].includes(first(doc.mediatype));

function isInCuratedCollection(collections) {
  return collections.some((c) => FILM_COLLECTIONS.includes(c)) && !collections.some((c) => RESTRICTED_COLLECTIONS.includes(c));
}

export function isLawfullyPublic(doc) {
  if (!doc || typeof doc !== "object") return false;
  if (isRestrictedFlag(doc["access-restricted-item"])) return false;
  return isMovieOrUnstated(doc) && isInCuratedCollection(lowerCollections(doc));
}

export function normalizeFilm(doc) {
  const id = String(doc.identifier);
  return {
    id,
    title: first(doc.title),
    director: first(doc.director),
    cast: list(doc.cast),
    year: parseYear(doc.year, doc.date),
    runtime: first(doc.runtime),
    description: plainText(doc.description),
    downloads: toNumber(doc.downloads),
    posterUrl: thumbUrl(id),
    detailsUrl: `${DETAILS_BASE}/${encodeURIComponent(id)}`,
  };
}

function rateLimitedError(res) {
  const ra = Number(res.headers?.get?.("Retry-After"));
  return new FilmsError("rate_limited", "archive.org is rate limiting requests", { status: 429, retryAfter: Number.isFinite(ra) ? ra : null });
}

async function fetchResponse(url) {
  try {
    return await fetch(url);
  } catch (e) {
    throw new FilmsError("network", `archive.org unreachable: ${e?.message ?? e}`);
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    throw new FilmsError("parse", "archive.org returned an unreadable response");
  }
}

async function getJson(url) {
  const res = await fetchResponse(url);
  if (res.status === 429) throw rateLimitedError(res);
  if (!res.ok) throw new FilmsError("http", `archive.org HTTP ${res.status}`, { status: res.status });
  return readJson(res);
}

const clampPage = (page) => Math.min(FILM_MAX_PAGE, Math.max(1, Math.floor(Number(page) || 1)));

function searchClause({ query, rawQuery }) {
  const parts = [PUBLIC_CLAUSE];
  if (rawQuery) parts.push(`(${rawQuery})`);
  if (query && query.trim()) parts.push(`(${escapeLucene(query.trim())})`);
  return parts.join(" AND ");
}

export function buildSearchUrl({ query, rawQuery, page = 1, sort = "downloads desc" }) {
  const params = new URLSearchParams();
  params.set("q", searchClause({ query, rawQuery }));
  for (const f of SEARCH_FIELDS) params.append("fl[]", f);
  params.set("rows", String(FILM_PAGE_SIZE));
  params.set("page", String(clampPage(page)));
  params.set("output", "json");
  if (sort) params.append("sort[]", sort);
  return `${SEARCH_URL}?${params}`;
}

function searchResponse(json) {
  const response = json?.response;
  if (!response || !Array.isArray(response.docs)) throw new FilmsError("parse", "archive.org search payload has no docs");
  return response;
}

async function runSearch(opts) {
  const page = clampPage(opts.page);
  const response = searchResponse(await getJson(buildSearchUrl({ ...opts, page })));
  const total = Number(response.numFound) || 0;
  const items = response.docs.filter((d) => d?.identifier && isLawfullyPublic(d)).map(normalizeFilm);
  return { items, total, page, hasMore: page < FILM_MAX_PAGE && page * FILM_PAGE_SIZE < total };
}

export async function searchFilms(query, { page = 1 } = {}) {
  if (!query || !String(query).trim()) return { items: [], total: 0, page: 1, hasMore: false };
  return runSearch({ query: String(query), page, sort: "downloads desc" });
}

export async function shelfFilms(shelfId, { page = 1 } = {}) {
  const shelf = FILM_SHELVES.find((s) => s.id === shelfId);
  if (!shelf) throw new RangeError(`unknown film shelf: ${shelfId}`);
  return runSearch({ rawQuery: shelf.query, page, sort: "downloads desc" });
}

function playableFile(id, f) {
  const format = PLAYABLE_FORMATS[f.format];
  return { format: format.label, mimeType: format.mimeType, sourceFormat: f.format, name: f.name, url: fileUrl(id, f.name), size: toNumber(f.size) };
}

function playableFiles(id, files) {
  return (Array.isArray(files) ? files : [])
    .filter((f) => f?.name && PLAYABLE_FORMATS[f.format] && f.private !== "true")
    .map((f) => playableFile(id, f));
}

function publicMetadata(json, id) {
  const meta = json?.metadata;
  if (!meta || typeof meta !== "object" || !Object.keys(meta).length) throw new FilmsError("not_found", `no archive.org item "${id}"`);
  if (!isLawfullyPublic(meta)) throw new FilmsError("restricted", "this film is not publicly available (lending, restricted access or outside the curated collections)");
  return meta;
}

export async function fetchFilm(id) {
  if (!id || typeof id !== "string") throw new FilmsError("not_found", "no film id given");
  const json = await getJson(`${METADATA_URL}/${encodeURIComponent(id)}`);
  const meta = publicMetadata(json, id);
  const base = normalizeFilm({ ...meta, identifier: meta.identifier ?? id, downloads: json.item?.downloads ?? meta.downloads });
  return { ...base, files: playableFiles(id, json.files) };
}
