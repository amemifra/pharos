/**
 * Book data adapter — public-domain / openly licensed texts from archive.org.
 * Native browser fetch only — zero dependencies, zero servers, no build-time
 * network: every request runs in the browser at runtime (static export).
 *
 * Contract:
 *   - Only lawfully public items: lending / print-disabled / login-restricted
 *     items are excluded at the SOURCE (query clause) and again by a local
 *     post-filter (isLawfullyPublic), because the search index can lag.
 *   - Honest records: a field archive.org did not return is `null` (or an
 *     empty list), never a default or an invented value.
 *   - Bounded paging: a fixed BOOK_PAGE_SIZE per request and at most
 *     BOOK_MAX_PAGE pages per query.
 *   - Failures throw a typed BooksError the UI can report truthfully.
 */

import { escapeLucene, thumbUrl, fileUrl } from "./archive.js";

const SEARCH_URL = "https://archive.org/advancedsearch.php";
const METADATA_URL = "https://archive.org/metadata";
const DETAILS_BASE = "https://archive.org/details";

/** Fixed page size for every search / shelf request. */
export const BOOK_PAGE_SIZE = 24;
/** Hard ceiling on pages per query (archive.org deep paging is slow and capped). */
export const BOOK_MAX_PAGE = 40;

/**
 * Collections whose items are NOT lawfully public: controlled digital lending,
 * print-disabled access, or loan-only libraries. Any item carrying one of
 * these is excluded.
 */
export const RESTRICTED_COLLECTIONS = ["inlibrary", "printdisabled", "lendinglibrary"];

/** Source-side exclusion clause appended to every search. */
const PUBLIC_CLAUSE = [
  "mediatype:texts",
  "-access-restricted-item:true",
  `-collection:(${RESTRICTED_COLLECTIONS.join(" OR ")})`,
].join(" AND ");

/**
 * Catalogue shelves: internal Lucene syntax (never user input, never escaped).
 * @type {{id: string, label: string, query: string}[]}
 */
export const BOOK_SHELVES = [
  { id: "gutenberg", label: "Project Gutenberg", query: "collection:gutenberg" },
  { id: "fiction", label: "Fiction", query: "subject:(fiction)" },
  { id: "poetry", label: "Poetry", query: "subject:(poetry)" },
  { id: "history", label: "History", query: "subject:(history)" },
  { id: "philosophy", label: "Philosophy", query: "subject:(philosophy)" },
  { id: "science", label: "Science", query: "subject:(science)" },
  { id: "children", label: "Children's books", query: "subject:(juvenile)" },
];

/**
 * Reading formats shown to the user, keyed by archive.org's `format` name.
 * Daisy is deliberately absent: on archive.org it is the print-disabled
 * (encrypted) delivery format, not a public download.
 */
export const READING_FORMATS = {
  "EPUB": "EPUB",
  "Text PDF": "PDF",
  "Additional Text PDF": "PDF",
  "Image Container PDF": "PDF (scanned)",
  "DjVuTXT": "Plain text",
  "Text": "Plain text",
  "DjVu": "DjVu",
  "Kindle": "Kindle",
  "Mobipocket": "Mobipocket",
  "HTML": "HTML",
};

const SEARCH_FIELDS = ["identifier", "title", "creator", "year", "date", "language", "subject", "format", "collection", "downloads"];

/**
 * Typed adapter failure.
 * code: "http" (non-2xx), "rate_limited" (429), "network" (fetch rejected),
 * "parse" (unexpected payload), "not_found" (unknown id), "restricted"
 * (item exists but is not lawfully public).
 */
export class BooksError extends Error {
  /**
   * @param {"http"|"rate_limited"|"network"|"parse"|"not_found"|"restricted"} code
   * @param {string} message
   * @param {{status?: number, retryAfter?: number|null}} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "BooksError";
    this.code = code;
    this.status = extra.status ?? null;
    this.retryAfter = extra.retryAfter ?? null;
  }
}

/**
 * @typedef {Object} BookRecord
 * @property {string} id archive.org identifier.
 * @property {string|null} title
 * @property {string[]} creators Empty when archive.org lists no creator.
 * @property {number|null} year Four-digit year, or null when unknown.
 * @property {string|null} language archive.org language code/name as returned.
 * @property {string[]} subjects
 * @property {string[]} formats Human labels of available reading formats (READING_FORMATS).
 * @property {number|null} downloads
 * @property {string} coverUrl archive.org thumbnail service URL (may 404: handle onError).
 * @property {string} detailsUrl Canonical archive.org page of the item.
 */

/**
 * @typedef {Object} BookFile
 * @property {string} format Human label (READING_FORMATS value).
 * @property {string} sourceFormat archive.org format name.
 * @property {string} name File name inside the item.
 * @property {string} url Direct download URL.
 * @property {number|null} size Bytes, null when not reported.
 */

/**
 * @typedef {BookRecord & {
 *   description: string|null,
 *   publisher: string|null,
 *   licenseUrl: string|null,
 *   rights: string|null,
 *   files: BookFile[],
 * }} BookDetail
 */

const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String).map((s) => s.trim()).filter(Boolean);
const first = (v) => list(v)[0] ?? null;

/** Four-digit year from `year` or `date`, or null — never guessed. */
function parseYear(year, date) {
  for (const v of [first(year), first(date)]) {
    const m = v && /\b(\d{4})\b/.exec(v);
    if (m) return Number(m[1]);
  }
  return null;
}

const toNumber = (v) => {
  if (v == null || v === "") return null;
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : null;
};

/**
 * archive.org descriptions are uploader-supplied HTML: reduce to plain text
 * so the UI never renders foreign markup.
 */
export function plainText(v) {
  const s = first(v);
  if (!s) return null;
  const text = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return text || null;
}

const readingFormats = (formats) => [...new Set(list(formats).map((f) => READING_FORMATS[f]).filter(Boolean))];

/**
 * Local lawful-access post-filter (the source query already excludes these;
 * this is the defence against index lag and stale caches).
 * Contract: pure; accepts a raw search doc or a /metadata `metadata` block.
 * @param {Object} doc
 * @returns {boolean}
 */
export function isLawfullyPublic(doc) {
  if (!doc || typeof doc !== "object") return false;
  const restricted = doc["access-restricted-item"];
  if (restricted === true || String(restricted).toLowerCase() === "true") return false;
  const mediatype = first(doc.mediatype);
  if (mediatype && mediatype !== "texts") return false;
  const collections = list(doc.collection).map((c) => c.toLowerCase());
  return !collections.some((c) => RESTRICTED_COLLECTIONS.includes(c));
}

/**
 * Normalizes a raw search doc into a BookRecord. Missing fields stay null.
 * @param {Object} doc Raw archive.org search doc.
 * @returns {BookRecord}
 */
export function normalizeBook(doc) {
  const id = String(doc.identifier);
  return {
    id,
    title: first(doc.title),
    creators: list(doc.creator),
    year: parseYear(doc.year, doc.date),
    language: first(doc.language),
    subjects: list(doc.subject),
    formats: readingFormats(doc.format),
    downloads: toNumber(doc.downloads),
    coverUrl: thumbUrl(id),
    detailsUrl: `${DETAILS_BASE}/${encodeURIComponent(id)}`,
  };
}

/** fetch → JSON with typed errors. */
async function getJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new BooksError("network", `archive.org unreachable: ${e?.message ?? e}`);
  }
  if (res.status === 429) {
    const ra = Number(res.headers?.get?.("Retry-After"));
    throw new BooksError("rate_limited", "archive.org is rate limiting requests", { status: 429, retryAfter: Number.isFinite(ra) ? ra : null });
  }
  if (!res.ok) throw new BooksError("http", `archive.org HTTP ${res.status}`, { status: res.status });
  try {
    return await res.json();
  } catch {
    throw new BooksError("parse", "archive.org returned an unreadable response");
  }
}

/** Clamp a 1-based page number into [1, BOOK_MAX_PAGE]. */
const clampPage = (page) => Math.min(BOOK_MAX_PAGE, Math.max(1, Math.floor(Number(page) || 1)));

/**
 * Builds the advancedsearch URL. Exported for tests.
 * @param {{query?: string, rawQuery?: string, page?: number, sort?: string}} opts
 *   query: user text (escaped); rawQuery: internal shelf syntax (not escaped).
 */
export function buildSearchUrl({ query, rawQuery, page = 1, sort = "downloads desc" }) {
  const parts = [PUBLIC_CLAUSE];
  if (rawQuery) parts.push(`(${rawQuery})`);
  if (query && query.trim()) parts.push(`(${escapeLucene(query.trim())})`);
  const params = new URLSearchParams();
  params.set("q", parts.join(" AND "));
  for (const f of SEARCH_FIELDS) params.append("fl[]", f);
  params.set("rows", String(BOOK_PAGE_SIZE));
  params.set("page", String(clampPage(page)));
  params.set("output", "json");
  if (sort) params.append("sort[]", sort);
  return `${SEARCH_URL}?${params}`;
}

/**
 * @typedef {Object} BookPage
 * @property {BookRecord[]} items
 * @property {number} total numFound reported by archive.org (before the post-filter).
 * @property {number} page The page actually fetched (after clamping).
 * @property {boolean} hasMore Whether another page may be requested.
 */

async function runSearch(opts) {
  const page = clampPage(opts.page);
  const json = await getJson(buildSearchUrl({ ...opts, page }));
  const response = json?.response;
  if (!response || !Array.isArray(response.docs)) throw new BooksError("parse", "archive.org search payload has no docs");
  const total = Number(response.numFound) || 0;
  const items = response.docs.filter((d) => d?.identifier && isLawfullyPublic(d)).map(normalizeBook);
  return { items, total, page, hasMore: page < BOOK_MAX_PAGE && page * BOOK_PAGE_SIZE < total };
}

/**
 * Free-text book search.
 * @param {string} query User-typed text (Lucene-escaped here).
 * @param {{page?: number}} [opts]
 * @returns {Promise<BookPage>}
 */
export async function searchBooks(query, { page = 1 } = {}) {
  if (!query || !String(query).trim()) return { items: [], total: 0, page: 1, hasMore: false };
  return runSearch({ query: String(query), page, sort: "downloads desc" });
}

/**
 * One catalogue shelf (BOOK_SHELVES), most downloaded first.
 * @param {string} shelfId
 * @param {{page?: number}} [opts]
 * @returns {Promise<BookPage>}
 */
export async function shelfBooks(shelfId, { page = 1 } = {}) {
  const shelf = BOOK_SHELVES.find((s) => s.id === shelfId);
  if (!shelf) throw new RangeError(`unknown book shelf: ${shelfId}`);
  return runSearch({ rawQuery: shelf.query, page, sort: "downloads desc" });
}

/**
 * Full record of one book from /metadata, with its downloadable reading files.
 * @param {string} id archive.org identifier.
 * @returns {Promise<BookDetail>}
 * @throws {BooksError} not_found / restricted / network / http / rate_limited / parse
 */
export async function fetchBook(id) {
  if (!id || typeof id !== "string") throw new BooksError("not_found", "no book id given");
  const json = await getJson(`${METADATA_URL}/${encodeURIComponent(id)}`);
  const meta = json?.metadata;
  if (!meta || typeof meta !== "object" || !Object.keys(meta).length) throw new BooksError("not_found", `no archive.org item "${id}"`);
  if (!isLawfullyPublic(meta)) throw new BooksError("restricted", "this item is not publicly available (lending or restricted access)");
  const files = (Array.isArray(json.files) ? json.files : [])
    .filter((f) => f?.name && READING_FORMATS[f.format] && f.private !== "true")
    .map((f) => ({
      format: READING_FORMATS[f.format],
      sourceFormat: f.format,
      name: f.name,
      url: fileUrl(id, f.name),
      size: toNumber(f.size),
    }));
  const base = normalizeBook({ ...meta, identifier: meta.identifier ?? id, format: files.map((f) => f.sourceFormat), downloads: json.item?.downloads ?? meta.downloads });
  return {
    ...base,
    description: plainText(meta.description),
    publisher: first(meta.publisher),
    licenseUrl: first(meta.licenseurl),
    rights: first(meta.rights),
    files,
  };
}
