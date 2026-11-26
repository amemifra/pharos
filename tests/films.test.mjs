const films = await import("../lib/films.js");
const { FILM_PAGE_SIZE, FILM_MAX_PAGE, FILM_SHELVES, FILM_COLLECTIONS, FilmsError, isLawfullyPublic, normalizeFilm, buildSearchUrl, searchFilms, shelfFilms, fetchFilm } = films;

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `: ${detail}` : ""}`);
}
async function rejects(fn, code) {
  try { await fn(); return false; } catch (e) { return e instanceof FilmsError && e.code === code; }
}

let lastUrl = null;
let lastInit = null;
const stub = (impl) => { globalThis.fetch = async (url, init) => { lastUrl = String(url); lastInit = init; return impl(String(url)); }; };
const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
});

console.log("\n═══ Films adapter ═══");

check("public feature film passes", isLawfullyPublic({ mediatype: "movies", collection: ["feature_films"] }));
check("prelinger film passes", isLawfullyPublic({ mediatype: "movies", collection: "prelinger" }));
check("film outside curated collections excluded", !isLawfullyPublic({ mediatype: "movies", collection: ["opensource_movies"] }));
check("lending collection excluded", !isLawfullyPublic({ mediatype: "movies", collection: ["feature_films", "inlibrary"] }));
check("access-restricted flag excluded (string)", !isLawfullyPublic({ collection: ["film_noir"], "access-restricted-item": "true" }));
check("access-restricted flag excluded (bool)", !isLawfullyPublic({ collection: ["film_noir"], "access-restricted-item": true }));
check("non-movie mediatype excluded", !isLawfullyPublic({ mediatype: "texts", collection: ["feature_films"] }));
check("garbage excluded", !isLawfullyPublic(null));

const url = new URL(buildSearchUrl({ query: "nosferatu" }));
const q = url.searchParams.get("q");
check("source query restricts to movies", q.includes("mediatype:movies"));
check("source query restricts to curated collections", q.includes(`collection:(${FILM_COLLECTIONS.join(" OR ")})`) && FILM_COLLECTIONS.join() === "feature_films,film_noir,moviesandfilms,prelinger");
check("source query excludes restricted flag", q.includes("-access-restricted-item:true"));
check("source query excludes lending collections", /-collection:\(inlibrary OR printdisabled OR lendinglibrary\)/.test(q));
check("user text is Lucene-escaped", new URL(buildSearchUrl({ query: 'title:(x) OR "y"' })).searchParams.get("q").includes('title\\:\\(x\\) OR \\"y\\"'));
check("plain https archive.org endpoint", url.origin === "https://archive.org" && url.pathname === "/advancedsearch.php");

check("fixed page size", url.searchParams.get("rows") === String(FILM_PAGE_SIZE));
check("page clamped to ceiling", new URL(buildSearchUrl({ query: "a", page: 10_000 })).searchParams.get("page") === String(FILM_MAX_PAGE));
check("page clamped to 1", new URL(buildSearchUrl({ query: "a", page: -3 })).searchParams.get("page") === "1");

const sparse = normalizeFilm({ identifier: "f1" });
check("missing title → null", sparse.title === null);
check("missing director → null", sparse.director === null);
check("missing cast → []", Array.isArray(sparse.cast) && sparse.cast.length === 0);
check("missing year → null (not 0)", sparse.year === null);
check("missing runtime → null", sparse.runtime === null);
check("missing description → null", sparse.description === null);
check("missing downloads → null (not 0)", sparse.downloads === null);
check("creator is never guessed as director", normalizeFilm({ identifier: "f3", creator: "Some Studio" }).director === null);
const full = normalizeFilm({ identifier: "f2", title: "Nosferatu", director: "F. W. Murnau", cast: ["Max Schreck", "Gustav von Wangenheim"], date: "1922-03-04", runtime: "1:34:00", description: "<p>A <b>vampire</b></p>", downloads: "7" });
check("director kept as returned", full.director === "F. W. Murnau");
check("cast kept as list", full.cast.join("|") === "Max Schreck|Gustav von Wangenheim");
check("year parsed from date", full.year === 1922);
check("runtime kept as returned", full.runtime === "1:34:00");
check("description is plain text", full.description === "A vampire");
check("downloads numeric", full.downloads === 7);
check("poster via thumbnail service + details URL", full.posterUrl === "https://archive.org/services/img/f2" && full.detailsUrl === "https://archive.org/details/f2");

stub(() => json({ response: { numFound: 100, docs: [
  { identifier: "ok1", title: "Ok", mediatype: "movies", collection: ["feature_films"] },
  { identifier: "lend", title: "Lent", mediatype: "movies", collection: ["feature_films", "inlibrary"] },
  { identifier: "other", title: "Other", mediatype: "movies", collection: ["opensource_movies"] },
  { title: "no id", collection: ["feature_films"] },
] } }));
const r1 = await searchFilms("vampire");
check("post-filter drops restricted, uncurated and id-less docs", r1.items.length === 1 && r1.items[0].id === "ok1");
check("hasMore true when more pages exist", r1.hasMore === true && r1.page === 1);
check("plain fetch with no credentials", lastInit === undefined);
stub(() => json({ response: { numFound: 30, docs: [] } }));
const r2 = await searchFilms("vampire", { page: 2 });
check("hasMore false on last page", r2.hasMore === false);
stub(() => json({ response: { numFound: 5000, docs: [] } }));
const rCeil = await searchFilms("vampire", { page: 99 });
check("hasMore false at page ceiling", rCeil.page === FILM_MAX_PAGE && rCeil.hasMore === false);
check("empty query → honest empty", (await searchFilms("  ")).items.length === 0);

check("one shelf per curated collection", FILM_SHELVES.map((s) => s.id).join() === FILM_COLLECTIONS.join() && FILM_SHELVES.every((s) => s.label));
check("shelf query uses internal syntax", (await shelfFilms("film_noir"), new URL(lastUrl).searchParams.get("q").includes("(collection:film_noir)")));
let unknownShelf = false;
try { await shelfFilms("nope"); } catch (e) { unknownShelf = e instanceof RangeError; }
check("unknown shelf rejected", unknownShelf);

stub(() => json({}, 503));
check("HTTP 503 → http", await rejects(() => searchFilms("x"), "http"));
stub(() => json({}, 429, { "Retry-After": "30" }));
let ra = null;
try { await searchFilms("x"); } catch (e) { ra = e; }
check("HTTP 429 → rate_limited with retryAfter", ra?.code === "rate_limited" && ra.retryAfter === 30);
stub(() => { throw new TypeError("Failed to fetch"); });
check("fetch rejection → network", await rejects(() => searchFilms("x"), "network"));
stub(() => json({ nope: true }));
check("missing docs → parse", await rejects(() => searchFilms("x"), "parse"));
stub(() => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("bad"); } }));
check("unreadable JSON → parse", await rejects(() => searchFilms("x"), "parse"));

stub(() => json({}));
check("unknown id → not_found", await rejects(() => fetchFilm("ghost"), "not_found"));
check("missing id → not_found", await rejects(() => fetchFilm(""), "not_found"));
stub(() => json({ metadata: { identifier: "lent", mediatype: "movies", collection: ["feature_films", "inlibrary"] }, files: [] }));
check("lending item → restricted", await rejects(() => fetchFilm("lent"), "restricted"));
stub(() => json({}, 404));
check("detail HTTP 404 → http", await rejects(() => fetchFilm("x"), "http"));
stub(() => json({}, 429));
check("detail HTTP 429 → rate_limited", await rejects(() => fetchFilm("x"), "rate_limited"));
stub(() => { throw new TypeError("Failed to fetch"); });
check("detail fetch rejection → network", await rejects(() => fetchFilm("x"), "network"));
stub(() => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("bad"); } }));
check("detail unreadable JSON → parse", await rejects(() => fetchFilm("x"), "parse"));

stub(() => json({
  metadata: { identifier: "nosferatu", title: "Nosferatu", director: "F. W. Murnau", year: "1922", mediatype: "movies", collection: ["feature_films"] },
  item: { downloads: 99 },
  files: [
    { name: "nosferatu.mp4", format: "h.264", size: "1000" },
    { name: "nosferatu.ogv", format: "Ogg Video" },
    { name: "nosferatu_meta.xml", format: "Metadata" },
    { name: "nosferatu.thumbs/1.jpg", format: "Thumbnail" },
    { name: "secret.mp4", format: "h.264", private: "true" },
  ],
}));
const d = await fetchFilm("nosferatu");
check("detail metadata normalized", d.title === "Nosferatu" && d.director === "F. W. Murnau" && d.year === 1922 && d.downloads === 99);
check("detail fetched from archive.org metadata", lastUrl === "https://archive.org/metadata/nosferatu");
check("detail files limited to playable video", d.files.map((f) => f.format).join(",") === "MP4,Ogg");
check("detail file URL points at archive.org download", d.files[0].url === "https://archive.org/download/nosferatu/nosferatu.mp4");
check("detail file mime type", d.files[0].mimeType === "video/mp4" && d.files[1].mimeType === "video/ogg");
check("unknown file size → null", d.files[1].size === null);
check("detail missing cast → []", d.cast.length === 0);
check("detail missing runtime → null", d.runtime === null);

console.log(`\n═══ RESULT: ${passed} pass, ${failed} fail ═══`);
process.exit(failed ? 1 : 0);
