/**
 * E2E: book catalogue journey — Books tab → catalogue → search → detail.
 *
 * Deterministic part: archive.org is stubbed with page.route() fixtures
 * (advancedsearch, metadata, thumbnails), so assertions never depend on live
 * network timing. Covers the honest empty and error states produced by the
 * adapter (lib/books.js), including a restricted item on the detail page.
 * Live part: one unstubbed search that SKIPs with an explicit message when
 * archive.org is slow, instead of failing.
 *
 * Run: node tests/e2e/books.mjs   (dev server on :3000, or BASE_URL=…)
 * Also invoked by tests/e2e/journeys.mjs (same `npm run e2e` command).
 */

import { pathToFileURL } from "node:url";

/* —— Fixtures ———————————————————————————————————————————————————————— */

const SHELF_DOCS = [
  { identifier: "shelf-book-one", title: "Leaves of Grass", creator: "Whitman, Walt", year: "1855", language: "eng", subject: ["Poetry"], format: ["EPUB", "Text PDF"], collection: ["gutenberg"], downloads: 1200 },
  { identifier: "shelf-book-two", title: "Pride and Prejudice", creator: "Austen, Jane", year: "1813", language: "eng", subject: ["Fiction"], format: ["EPUB"], collection: ["gutenberg"], downloads: 900 },
];

const SEARCH_DOCS = [
  { identifier: "mobydick-fixture", title: "Moby Dick", creator: "Melville, Herman", year: "1851", language: "eng", subject: ["Whaling", "Fiction"], format: ["EPUB", "Text PDF"], collection: ["gutenberg"], downloads: 5000 },
  // Sparse doc: no creator, no year — the UI must not invent them.
  { identifier: "sparse-fixture", title: "An Anonymous Pamphlet", format: ["DjVuTXT"], collection: ["americana"] },
];

const METADATA = {
  "mobydick-fixture": {
    metadata: { identifier: "mobydick-fixture", mediatype: "texts", title: "Moby Dick", creator: "Melville, Herman", year: "1851", language: "eng", description: "<p>The whale.</p>", collection: ["gutenberg"] },
    files: [
      { name: "mobydick.epub", format: "EPUB", size: "1048576" },
      { name: "mobydick.pdf", format: "Text PDF", size: "4194304" },
      { name: "mobydick_meta.xml", format: "Metadata" },
    ],
  },
  "restricted-fixture": {
    metadata: { identifier: "restricted-fixture", mediatype: "texts", title: "A Lending-Only Book", collection: ["inlibrary", "printdisabled"], "access-restricted-item": "true" },
    files: [{ name: "restricted.pdf", format: "Text PDF" }],
  },
};

const isShelfQuery = (q) => /subject:\(|collection:gutenberg/.test(q);

/**
 * Installs archive.org stubs on a page. `state.search` is read per request so
 * a test can flip it (e.g. error → results) before clicking Retry.
 * @param {import("playwright").Page} page
 * @param {{search: "results"|"empty"|"error"}} state
 */
async function stubArchive(page, state) {
  await page.route("https://archive.org/advancedsearch.php**", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    if (isShelfQuery(q)) {
      return route.fulfill({ json: { response: { numFound: SHELF_DOCS.length, docs: SHELF_DOCS } } });
    }
    if (state.search === "error") return route.fulfill({ status: 503, body: "Service Unavailable" });
    const docs = state.search === "empty" ? [] : SEARCH_DOCS;
    return route.fulfill({ json: { response: { numFound: docs.length, docs } } });
  });
  await page.route("https://archive.org/metadata/**", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    const body = METADATA[id];
    return body ? route.fulfill({ json: body }) : route.fulfill({ json: {} });
  });
  await page.route("https://archive.org/services/img/**", (route) => route.fulfill({ status: 404, body: "" }));
}

/* —— Helpers ————————————————————————————————————————————————————————— */

const BOOKS_URL = /\/books\/?(\?.*)?$/;
const DETAIL_URL = /\/books\/detail\/?\?id=/;

/** Search via the catalogue form, with one hydration-race retry (see journeys.mjs). */
async function searchFor(page, text) {
  const form = page.getByRole("search");
  const submit = async () => {
    await form.getByPlaceholder("Search books").fill(text);
    await form.getByRole("button", { name: "Search" }).click();
  };
  await submit();
  try {
    await page.locator("[data-testid='book-results'] [data-testid='books-state']:not([data-state='loading'])").first().waitFor({ timeout: 8_000 });
  } catch {
    await submit();
  }
}

const resultsState = (page, s) =>
  page.locator(`[data-testid='book-results'] [data-testid='books-state'][data-state='${s}']`).first();

async function timed(name, browser, fn) {
  const t0 = Date.now();
  // serviceWorkers: "block" — the PWA worker would otherwise serve fetches
  // itself after the first load, bypassing the page.route() fixtures.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  try {
    const src = await fn(page, errors);
    return { name, ok: true, ms: Date.now() - t0, src: src ?? "ok" };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, err: String(e.message ?? e).slice(0, 140) };
  } finally {
    await ctx.close();
  }
}

/* —— Journeys ———————————————————————————————————————————————————————— */

/**
 * Runs every book journey and returns one result row per journey.
 * @param {{BASE: string, chromium: import("playwright").BrowserType}} opts
 * @returns {Promise<{name: string, ok: boolean, ms: number, src?: string, err?: string, skipped?: boolean}[]>}
 */
export async function runBooksJourneys({ BASE, chromium }) {
  const browser = await chromium.launch({ args: ["--disable-gpu", "--mute-audio"] });
  const results = [];
  try {
    // 1) Happy path: tab → catalogue → search → detail → back (stubbed).
    results.push(await timed("Books · tab → catalogue → search → detail", browser, async (page, errors) => {
      await stubArchive(page, { search: "results" });
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const tab = page.locator("aside nav").getByRole("link", { name: "Books" });
      await tab.click();
      await page.waitForURL(BOOKS_URL, { timeout: 15_000 });
      await page.locator("[data-testid='books-page']").waitFor({ timeout: 15_000 });
      if ((await tab.getAttribute("aria-current")) !== "page") throw new Error("Books tab not marked active");

      // Shelves render from the (stubbed) adapter.
      await page.locator("[data-testid^='book-shelf-'] [data-testid='book-card']").first().waitFor({ timeout: 15_000 });

      await searchFor(page, "moby");
      const cards = page.locator("[data-testid='book-results'] [data-testid='book-card']");
      await cards.first().waitFor({ timeout: 15_000 });
      if ((await cards.count()) !== SEARCH_DOCS.length) throw new Error(`expected ${SEARCH_DOCS.length} result cards, got ${await cards.count()}`);
      const sparseText = await cards.filter({ hasText: "An Anonymous Pamphlet" }).first().textContent();
      if (/\b1[0-9]{3}\b/.test(sparseText ?? "")) throw new Error("sparse card shows an invented year");

      await cards.filter({ hasText: "Moby Dick" }).first().click();
      await page.waitForURL(DETAIL_URL, { timeout: 15_000 });
      await page.locator("[data-testid='book-detail-state'][data-state='ready']").waitFor({ timeout: 15_000 });
      const h1 = (await page.locator("[data-testid='book-detail'] h1").textContent())?.trim();
      if (h1 !== "Moby Dick") throw new Error(`detail title "${h1}"`);
      const hrefs = await page.locator("[data-testid='book-formats'] li a").evaluateAll((as) => as.map((a) => a.href));
      if (hrefs.length !== 2) throw new Error(`expected 2 format links, got ${hrefs.length}`);
      if (!hrefs.every((h) => h.startsWith("https://archive.org/download/mobydick-fixture/"))) throw new Error(`bad format links: ${hrefs.join(", ")}`);
      // Publisher is absent from the fixture: must read "Unknown", not a default.
      if (!(await page.locator("[data-testid='book-detail']").getByText("Unknown").first().isVisible())) throw new Error("missing field not labelled Unknown");

      await page.getByRole("link", { name: "Back to catalogue" }).click();
      await page.waitForURL(BOOKS_URL, { timeout: 15_000 });
      if (errors.length) throw new Error(`page errors: ${errors[0]}`);
      return `${SEARCH_DOCS.length} results, ${hrefs.length} formats, back to catalogue`;
    }));

    // 2) Honest empty state.
    results.push(await timed("Books · empty search state", browser, async (page) => {
      await stubArchive(page, { search: "empty" });
      await page.goto(`${BASE}/books/`, { waitUntil: "domcontentloaded" });
      await searchFor(page, "zzzz-no-such-book");
      await resultsState(page, "empty").waitFor({ timeout: 15_000 });
      const text = await page.locator("[data-testid='book-results']").textContent();
      if (!/No books found/.test(text ?? "")) throw new Error("empty state text missing");
      if (await page.locator("[data-testid='book-results'] [data-testid='book-card']").count()) throw new Error("cards shown for an empty result");
      return "empty state reported";
    }));

    // 3) Honest error state + Retry recovers.
    results.push(await timed("Books · error state + retry", browser, async (page) => {
      const state = { search: "error" };
      await stubArchive(page, state);
      await page.goto(`${BASE}/books/`, { waitUntil: "domcontentloaded" });
      await searchFor(page, "moby");
      await resultsState(page, "error").waitFor({ timeout: 15_000 });
      if (await page.locator("[data-testid='book-results'] [data-testid='book-card']").count()) throw new Error("cards shown alongside an error");
      state.search = "results";
      await page.locator("[data-testid='book-results']").getByRole("button", { name: "Retry" }).click();
      await page.locator("[data-testid='book-results'] [data-testid='book-card']").first().waitFor({ timeout: 15_000 });
      return "503 → error, Retry → results";
    }));

    // 4) Restricted item on the detail page → error, no download links.
    results.push(await timed("Books · restricted detail refused", browser, async (page) => {
      await stubArchive(page, { search: "results" });
      await page.goto(`${BASE}/books/detail/?id=restricted-fixture`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-testid='book-detail-state'][data-state='error']").waitFor({ timeout: 15_000 });
      if (await page.locator("[data-testid='book-formats'] li a").count()) throw new Error("download links shown for a restricted item");
      return "restricted → error state";
    }));

    // 5) Live network (optional): skip, never fail, when archive.org is slow.
    const t0 = Date.now();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/books/`, { waitUntil: "domcontentloaded" });
      await searchFor(page, "moby dick");
      await page.locator("[data-testid='book-results'] [data-testid='book-card'], [data-testid='book-results'] [data-testid='books-state'][data-state='error']").first().waitFor({ timeout: 25_000 });
      if (await resultsState(page, "error").count()) {
        results.push({ name: "Books · live archive.org search", ok: true, skipped: true, ms: Date.now() - t0, src: "SKIP (archive.org slow): live search returned an error state" });
      } else {
        const n = await page.locator("[data-testid='book-results'] [data-testid='book-card']").count();
        results.push({ name: "Books · live archive.org search", ok: true, ms: Date.now() - t0, src: `${n} live results` });
      }
    } catch (e) {
      const timeout = /Timeout/i.test(String(e?.message ?? e));
      results.push(timeout
        ? { name: "Books · live archive.org search", ok: true, skipped: true, ms: Date.now() - t0, src: "SKIP (archive.org slow): no live result within 25s" }
        : { name: "Books · live archive.org search", ok: false, ms: Date.now() - t0, err: String(e.message ?? e).slice(0, 140) });
    } finally {
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

/* —— Standalone ——————————————————————————————————————————————————————— */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import("playwright");
  const BASE = process.env.BASE_URL ?? "http://localhost:3000";
  const results = await runBooksJourneys({ BASE, chromium });
  console.log("\n═══ Books E2E ═══");
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? (r.skipped ? "↷" : "✓") : "✗"} ${r.name} — ${r.ok ? r.src : r.err}`);
    if (!r.ok) failed++;
  }
  console.log(`═══ ${results.length - failed}/${results.length} OK ═══`);
  process.exit(failed ? 1 : 0);
}
