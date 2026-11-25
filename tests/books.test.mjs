/**
 * Book adapter contract (lib/books.js) — fixture-based, no live network:
 * global fetch is stubbed per case.
 *   - lawful-access filter (source clause + local post-filter);
 *   - honest records (missing fields stay null, never defaulted);
 *   - bounded paging (fixed page size, page ceiling);
 *   - typed errors (http / rate_limited / network / parse / not_found / restricted).
 *
 * Usage: node tests/books.test.mjs
 */

const books = await import("../lib/books.js");
const { BOOK_PAGE_SIZE, BOOK_MAX_PAGE, BooksError, isLawfullyPublic, normalizeBook, buildSearchUrl, searchBooks, shelfBooks, fetchBook, plainText } = books;

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`);
}
async function rejects(fn, code) {
  try { await fn(); return false; } catch (e) { return e instanceof BooksError && e.code === code; }
}

let lastUrl = null;
const stub = (impl) => { globalThis.fetch = async (url) => { lastUrl = String(url); return impl(String(url)); }; };
const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
});

console.log("\n═══ Books adapter ═══");

// —— Lawful-access filter ——
check("public text item passes", isLawfullyPublic({ mediatype: "texts", collection: ["gutenberg"] }));
check("lending (inlibrary) excluded", !isLawfullyPublic({ collection: ["inlibrary", "americana"] }));
check("print-disabled excluded", !isLawfullyPublic({ collection: "printdisabled" }));
check("access-restricted flag excluded (string)", !isLawfullyPublic({ "access-restricted-item": "true" }));
check("access-restricted flag excluded (bool)", !isLawfullyPublic({ "access-restricted-item": true }));
check("non-text mediatype excluded", !isLawfullyPublic({ mediatype: "audio" }));
check("garbage excluded", !isLawfullyPublic(null));

const url = new URL(buildSearchUrl({ query: "moby dick" }));
const q = url.searchParams.get("q");
check("source query restricts to texts", q.includes("mediatype:texts"));
check("source query excludes restricted flag", q.includes("-access-restricted-item:true"));
check("source query excludes lending collections", /-collection:\(inlibrary OR printdisabled OR lendinglibrary\)/.test(q));
check("user text is Lucene-escaped", new URL(buildSearchUrl({ query: 'title:(x) OR "y"' })).searchParams.get("q").includes('title\\:\\(x\\) OR \\"y\\"'));

// —— Bounded paging ——
check("fixed page size", url.searchParams.get("rows") === String(BOOK_PAGE_SIZE));
check("page clamped to ceiling", new URL(buildSearchUrl({ query: "a", page: 10_000 })).searchParams.get("page") === String(BOOK_MAX_PAGE));
check("page clamped to 1", new URL(buildSearchUrl({ query: "a", page: -3 })).searchParams.get("page") === "1");

// —— Honest normalization ——
const sparse = normalizeBook({ identifier: "x1" });
check("missing title → null", sparse.title === null);
check("missing creator → []", Array.isArray(sparse.creators) && sparse.creators.length === 0);
check("missing year → null (not 0)", sparse.year === null);
check("missing language → null", sparse.language === null);
check("missing downloads → null (not 0)", sparse.downloads === null);
check("missing formats → []", sparse.formats.length === 0);
const full = normalizeBook({ identifier: "x2", title: "T", creator: ["A", "B"], date: "1851-01-01T00:00:00Z", language: "eng", format: ["EPUB", "Text PDF", "Daisy", "Abbyy GZ"], downloads: "12" });
check("year parsed from date", full.year === 1851);
check("reading formats mapped, Daisy/internal dropped", JSON.stringify(full.formats) === JSON.stringify(["EPUB", "PDF"]));
check("downloads numeric", full.downloads === 12);
check("cover + details URLs", full.coverUrl.endsWith("/x2") && full.detailsUrl === "https://archive.org/details/x2");

// —— Search: post-filter + hasMore ——
stub(() => json({ response: { numFound: 100, docs: [
  { identifier: "ok1", title: "Ok", mediatype: "texts", collection: ["gutenberg"] },
  { identifier: "lend", title: "Lent", collection: ["inlibrary"] },
  { title: "no id" },
] } }));
const r1 = await searchBooks("whale");
check("post-filter drops restricted + id-less docs", r1.items.length === 1 && r1.items[0].id === "ok1");
check("hasMore true when more pages exist", r1.hasMore === true && r1.page === 1);
stub(() => json({ response: { numFound: 30, docs: [] } }));
const r2 = await searchBooks("whale", { page: 2 });
check("hasMore false on last page", r2.hasMore === false);
check("empty query → no request, honest empty", (await searchBooks("  ")).items.length === 0);
check("shelf query uses internal syntax", (await shelfBooks("poetry"), new URL(lastUrl).searchParams.get("q").includes("(subject:(poetry))")));
let unknownShelf = false;
try { await shelfBooks("nope"); } catch (e) { unknownShelf = e instanceof RangeError; }
check("unknown shelf rejected", unknownShelf);

// —— Typed errors ——
stub(() => json({}, 503));
check("HTTP 503 → http", await rejects(() => searchBooks("x"), "http"));
stub(() => json({}, 429, { "Retry-After": "30" }));
let ra = null;
try { await searchBooks("x"); } catch (e) { ra = e; }
check("HTTP 429 → rate_limited with retryAfter", ra?.code === "rate_limited" && ra.retryAfter === 30);
stub(() => { throw new TypeError("Failed to fetch"); });
check("fetch rejection → network", await rejects(() => searchBooks("x"), "network"));
stub(() => json({ nope: true }));
check("missing docs → parse", await rejects(() => searchBooks("x"), "parse"));
stub(() => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("bad"); } }));
check("unreadable JSON → parse", await rejects(() => searchBooks("x"), "parse"));

// —— Detail ——
stub(() => json({}));
check("unknown id → not_found", await rejects(() => fetchBook("ghost"), "not_found"));
stub(() => json({ metadata: { identifier: "lent", collection: ["inlibrary"] }, files: [] }));
check("lending item → restricted", await rejects(() => fetchBook("lent"), "restricted"));
stub(() => json({
  metadata: { identifier: "moby", title: "Moby Dick", creator: "Melville, Herman", year: "1851", description: "<p>A <b>whale</b> &amp; a man</p>", collection: ["gutenberg"] },
  item: { downloads: 99 },
  files: [
    { name: "moby.epub", format: "EPUB", size: "1000" },
    { name: "moby.pdf", format: "Text PDF" },
    { name: "moby_daisy.zip", format: "Daisy" },
    { name: "moby_meta.xml", format: "Metadata" },
  ],
}));
const d = await fetchBook("moby");
check("detail files limited to reading formats", d.files.map((f) => f.format).join(",") === "EPUB,PDF");
check("detail file URL points at archive.org download", d.files[0].url === "https://archive.org/download/moby/moby.epub");
check("unknown file size → null", d.files[1].size === null);
check("detail description is plain text", d.description === "A whale & a man");
check("detail missing publisher → null", d.publisher === null);
check("detail formats derived from files", JSON.stringify(d.formats) === JSON.stringify(["EPUB", "PDF"]));
check("plainText(empty) → null", plainText("<p> </p>") === null);

// —— Book reader (lib/bookreader.js) ——
const reader = await import("../lib/bookreader.js");
const { READER_PAGE_CHARS, READER_MAX_PAGES, READER_MAX_BYTES, READABLE_SOURCE_FORMATS, BookReaderError, selectReadableFile, splitIntoPages, fetchBookText } = reader;

async function rejectsReader(fn, code) {
  try { await fn(); return false; } catch (e) { return e instanceof BookReaderError && e.code === code; }
}
const detail = (files) => ({ id: "moby", title: "Moby Dick", files });
const f = (name, sourceFormat, size = null) => ({
  format: sourceFormat === "Text" || sourceFormat === "DjVuTXT" ? "Plain text" : sourceFormat,
  sourceFormat, name, url: `https://archive.org/download/moby/${name}`, size,
});

console.log("\n═══ Book reader ═══");

// —— File selection (criterion #1: readable file → pages) ——
check("selects the plain Text file", selectReadableFile(detail([f("a.pdf", "Text PDF"), f("a.txt", "Text")]))?.name === "a.txt");
check("selects DjVuTXT when no Text file", selectReadableFile(detail([f("a.pdf", "Text PDF"), f("a.xml", "DjVuTXT", 500)]))?.name === "a.xml");
check("prefers Text over DjVuTXT", selectReadableFile(detail([f("a.xml", "DjVuTXT", 9999), f("a.txt", "Text", 10)]))?.name === "a.txt");
check("prefers largest within a source format", selectReadableFile(detail([f("s.txt", "Text", 100), f("l.txt", "Text", 5000)]))?.name === "l.txt");
check("ignores EPUB/PDF/DjVu files", selectReadableFile(detail([f("a.epub", "EPUB"), f("a.pdf", "Text PDF"), f("a.djvu", "DjVu")])) === null);
check("ignores private/garbage shapes", selectReadableFile(detail([null, {}])) === null);
check("no detail → null", selectReadableFile(null) === null);
check("readable source formats are Text + DjVuTXT only", JSON.stringify(READABLE_SOURCE_FORMATS) === JSON.stringify(["Text", "DjVuTXT"]));

// —— Page splitting (criteria #1 + #2) ——
const one = splitIntoPages("hello world");
check("short text → one page, known count", one.pageCount === 1 && one.pages[0] === "hello world" && one.truncated === false);
check("empty text → zero pages", splitIntoPages("   ").pageCount === 0);
const multi = splitIntoPages(Array.from({ length: 50 }, (_, i) => `para ${i} ` + "x".repeat(600)).join("\n\n"), { pageChars: 2000 });
check("multi-paragraph text splits into ordered pages", multi.pageCount > 1 && multi.pages.every((p) => p.length <= 2000));
check("pages are in reading order", multi.pages[0].startsWith("para 0") && multi.pages[multi.pageCount - 1].includes("para 49"));
const hugePara = splitIntoPages("y".repeat(5500), { pageChars: 2000 });
check("oversized paragraph is split at the bound", hugePara.pageCount === 3 && hugePara.pages[2] === "y".repeat(1500));
const capped = splitIntoPages(Array.from({ length: 3000 }, (_, i) => `p${i}`).join("\n\n"), { pageChars: 100, maxPages: 5 });
check("page count is capped", capped.pageCount === 5 && capped.truncated === true);
check("default bounds exported", READER_PAGE_CHARS > 0 && READER_MAX_PAGES > 0 && READER_MAX_BYTES > 0);

// —— No readable file (criterion #3) ——
check("no readable file → clear no_readable_file, no guess", await rejectsReader(() => fetchBookText(detail([f("a.pdf", "Text PDF")])), "no_readable_file"));
check("no files at all → no_readable_file", await rejectsReader(() => fetchBookText(detail([])), "no_readable_file"));

// —— Fetch errors (criterion #4: typed errors carrying the real cause) ——
const plainDetail = detail([f("a.txt", "Text", 100)]);
stub(() => { throw new TypeError("fetch failed"); });
check("fetch rejects → network with cause", await rejectsReader(() => fetchBookText(plainDetail), "network"));
stub(() => json({ ok: true }, 500));
check("HTTP 500 → http", await rejectsReader(() => fetchBookText(plainDetail), "http"));
stub(() => json({ ok: true }, 429, { "Retry-After": "30" }));
try { await fetchBookText(plainDetail); check("429 → rate_limited", false); }
catch (e) { check("429 → rate_limited with Retry-After", e instanceof BookReaderError && e.code === "rate_limited" && e.retryAfter === 30 && e.status === 429); }
check("fetches the archive.org file URL", lastUrl === "https://archive.org/download/moby/a.txt");
stub(() => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => { throw new SyntaxError("stream broken"); } }));
check("unreadable payload → parse", await rejectsReader(() => fetchBookText(plainDetail), "parse"));

// —— Oversized file guard (criterion #2) ——
check("file over READER_MAX_BYTES refused without fetching", await rejectsReader(() => fetchBookText(detail([f("big.txt", "Text", READER_MAX_BYTES + 1)])), "parse"));

// —— Happy path end to end (criterion #1) ——
const bookText = Array.from({ length: 8 }, (_, i) => `Chapter ${i + 1}. ` + "word ".repeat(300)).join("\n\n");
stub(() => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => bookText }));
const read = await fetchBookText(plainDetail, { pageChars: 1200 });
check("returns ordered pages with known page count", read.pageCount === read.pages.length && read.pageCount > 1 && read.pages.every((p) => typeof p === "string" && p.length <= 1200));
check("page text comes from the book", read.pages[0].startsWith("Chapter 1."));
check("truncated false for a normal book", read.truncated === false);
check("returned file is the selected one", read.file.name === "a.txt");

console.log(`\n═══ RESULT: ${passed} pass, ${failed} fail ═══`);
process.exit(failed ? 1 : 0);
