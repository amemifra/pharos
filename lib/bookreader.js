/**
 * In-app book text reader — page-by-page reading of public-domain texts.
 * Companion to lib/books.js: takes a BookDetail from fetchBook, picks the
 * best in-app readable file (the "Plain text" reading format, sourced from
 * Text or DjVuTXT files), fetches it in the browser from its archive.org
 * file URL, decodes it as text and splits it into bounded pages.
 * Native browser fetch only — zero dependencies, zero servers, no build-time
 * network (static export).
 *
 * Contract:
 *   - Only "Plain text" files are read in place. When a book offers none,
 *     the outcome is reported explicitly (no_readable_file) — never a guess,
 *     never a fallback to PDF/EPUB/DjVu.
 *   - Bounded reading: a fixed READER_PAGE_CHARS per page and at most
 *     READER_MAX_PAGES pages, so a very large book cannot freeze a low-end
 *     phone (the split is a linear scan, and reading is lazy page by page).
 *   - Failures throw a typed BookReaderError carrying the real cause,
 *     mirroring the BooksError codes (network / http / rate_limited / parse).
 */

import { BooksError } from "./books.js";

/** Characters per reader page. Small enough for a low-end phone to render at once. */
export const READER_PAGE_CHARS = 20000;
/** Hard ceiling on pages produced from one book (READER_PAGE_CHARS × this bounds memory). */
export const READER_MAX_PAGES = 800;
/** Hard ceiling on the fetched file itself; larger plain-text files are refused. */
export const READER_MAX_BYTES = 30 * 1024 * 1024;

/**
 * Source formats the app can read in place as plain text, in preference order.
 * `Text` is the cleanest; `DjVuTXT` is the text layer of a scanned DjVu.
 * @type {string[]}
 */
export const READABLE_SOURCE_FORMATS = ["Text", "DjVuTXT"];

/**
 * Typed reader failure. Codes mirror BooksError ("network", "http",
 * "rate_limited", "parse") plus "no_readable_file" when the book offers
 * nothing the app can read in place. Carries the real cause in `cause`.
 */
export class BookReaderError extends BooksError {
  /**
   * @param {"http"|"rate_limited"|"network"|"parse"|"no_readable_file"} code
   * @param {string} message
   * @param {{status?: number, retryAfter?: number|null, cause?: unknown}} [extra]
   */
  constructor(code, message, extra = {}) {
    super(code, message, extra);
    this.name = "BookReaderError";
    this.cause = extra.cause ?? null;
  }
}

/**
 * Picks the best in-app readable file from a BookDetail.
 * Only "Plain text" files (source Text or DjVuTXT) qualify; Text is preferred
 * over DjVuTXT, then the largest reported file wins. Pure: takes only the
 * detail object.
 * @param {import("./books.js").BookDetail|null|undefined} detail
 * @returns {import("./books.js").BookFile|null} null when no readable file exists.
 */
export function selectReadableFile(detail) {
  const files = Array.isArray(detail?.files) ? detail.files : [];
  const readable = files
    .filter((f) => f && READABLE_SOURCE_FORMATS.includes(f.sourceFormat) && f.format === "Plain text")
    .sort((a, b) => {
      const pref = READABLE_SOURCE_FORMATS.indexOf(a.sourceFormat) - READABLE_SOURCE_FORMATS.indexOf(b.sourceFormat);
      if (pref !== 0) return pref;
      return (b.size ?? -1) - (a.size ?? -1);
    });
  return readable[0] ?? null;
}

/** fetch → text with typed errors, following lib/books.js getJson. */
async function getText(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new BookReaderError("network", `archive.org unreachable: ${e?.message ?? e}`, { cause: e });
  }
  if (res.status === 429) {
    const ra = Number(res.headers?.get?.("Retry-After"));
    throw new BookReaderError("rate_limited", "archive.org is rate limiting requests", { status: 429, retryAfter: Number.isFinite(ra) ? ra : null });
  }
  if (!res.ok) throw new BookReaderError("http", `archive.org HTTP ${res.status}`, { status: res.status });
  try {
    return await res.text();
  } catch (e) {
    throw new BookReaderError("parse", "archive.org returned an unreadable payload", { cause: e });
  }
}

/**
 * Splits text into bounded pages: paragraphs are kept intact where possible,
 * a page never exceeds `pageChars`, and at most READER_MAX_PAGES pages are
 * produced (truncated: true when text was left out). Pure.
 * @param {string} text
 * @param {{pageChars?: number, maxPages?: number}} [opts]
 * @returns {{pages: string[], pageCount: number, truncated: boolean}}
 */
export function splitIntoPages(text, { pageChars = READER_PAGE_CHARS, maxPages = READER_MAX_PAGES } = {}) {
  const chars = Math.max(1, Math.floor(pageChars) || 1);
  const cap = Math.max(1, Math.floor(maxPages) || 1);
  const clean = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return { pages: [], pageCount: 0, truncated: false };

  const pages = [];
  let current = "";
  const flush = () => { if (current.trim()) pages.push(current.trim()); current = ""; };

  for (const para of clean.split(/\n{2,}/)) {
    // A single paragraph longer than a page is itself split at the bound.
    for (let start = 0; start < para.length; start += chars) {
      const chunk = para.slice(start, start + chars);
      if (current && (current.length + chunk.length + 2) > chars) flush();
      current = current ? `${current}\n\n${chunk}` : chunk;
      if (pages.length >= cap) {
        current = "";
        return { pages, pageCount: pages.length, truncated: true };
      }
    }
    if (pages.length >= cap) { current = ""; return { pages, pageCount: pages.length, truncated: true }; }
  }
  flush();
  const truncated = pages.length > cap;
  return { pages: pages.slice(0, cap), pageCount: Math.min(pages.length, cap), truncated: pages.length > cap };
}

/**
 * Fetches a book's plain text and returns it as an ordered list of bounded pages.
 * @param {import("./books.js").BookDetail} detail BookDetail from fetchBook.
 * @param {{pageChars?: number, maxPages?: number}} [opts]
 * @returns {Promise<{pages: string[], pageCount: number, truncated: boolean, file: import("./books.js").BookFile}>}
 * @throws {BookReaderError} no_readable_file / network / http / rate_limited / parse
 */
export async function fetchBookText(detail, opts = {}) {
  const file = selectReadableFile(detail);
  if (!file) throw new BookReaderError("no_readable_file", "this book offers no format the app can read in place");
  if (file.size != null && file.size > READER_MAX_BYTES) {
    throw new BookReaderError("parse", `plain-text file is too large to read in the app (${file.size} bytes)`, { status: null });
  }
  const text = await getText(file.url);
  const { pages, pageCount, truncated } = splitIntoPages(text, opts);
  return { pages, pageCount, truncated, file };
}
