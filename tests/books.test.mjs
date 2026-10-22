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

console.log(`\n═══ RESULT: ${passed} pass, ${failed} fail ═══`);
process.exit(failed ? 1 : 0);
