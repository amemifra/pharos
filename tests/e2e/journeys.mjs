/**
 * E2E journey tests — the real user path: "I want to listen to X".
 *
 * For each famous artist/track: search in the UI → open album → press play →
 * VERIFY REAL AUDIO (audio.paused === false && currentTime advances).
 * The UI reacting is not enough: the music must actually start (real
 * archive.org streaming, real network, no mocks).
 *
 * Usage: node tests/e2e/journeys.mjs   (dev server on :3000)
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

/** @type {{name: string, artist: string, query: string, expectArtist?: RegExp}[]} */
const JOURNEYS = [
  { name: "Vivaldi · The Four Seasons", query: "vivaldi four seasons", expectArtist: /vivaldi/i },
  { name: "Beethoven · Symphony No. 5", query: "beethoven symphony", expectArtist: /beethoven/i },
  { name: "Mozart · Requiem", query: "mozart requiem", expectArtist: /mozart/i },
  { name: "Liszt · Hungarian Rhapsody", query: "liszt hungarian rhapsody", expectArtist: /liszt/i },
  { name: "Jazz · Ella Fitzgerald", query: "ella fitzgerald", expectArtist: /fitzgerald/i },
  { name: "Chanson · Édith Piaf", query: "edith piaf", expectArtist: /piaf/i },
  { name: "Blues (shelf)", query: "blues", expectArtist: null },
];

/**
 * Beatles artist-page journey: canonical catalog division + correct ordering.
 * The artist page MUST show the MusicBrainz cross-referenced discography:
 * available albums ordered by release year (ascending), coverage stat present.
 */
async function beatlesCatalogJourney(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await page.goto(`${BASE}/artist?n=The%20Beatles`, { waitUntil: "domcontentloaded" });
    // Canonical cross-reference loaded (coverage stat renders only after MusicBrainz + archive.org)
    await page.waitForSelector("[data-testid='coverage']", { timeout: 120_000 });
    const coverage = await page.textContent("[data-testid='coverage']");
    if (!/\d+%/.test(coverage)) throw new Error("coverage not numeric");

    // Available section present; dated entries MUST be in ascending release-year order.
    // (Low coverage is CORRECT for catalog-restricted artists like The Beatles —
    // the test asserts structure and ordering, not generosity.)
    await page.waitForSelector("text=Discography · available", { timeout: 15_000 });
    const years = await page.$$eval("section .grid a", (els) =>
      els.map((el) => el.textContent?.match(/\b(19|20)\d{2}\b/)?.[0]).filter(Boolean).map(Number)
    );
    for (let i = 1; i < years.length; i++) {
      if (years[i] < years[i - 1]) throw new Error(`albums out of order: ${years[i - 1]} before ${years[i]}`);
    }
    results.push({ name: "Beatles · canonical catalog order", ok: true, ms: Date.now() - t0, src: `coverage ${coverage}, ${years.length} dated albums in order` });
  } catch (e) {
    results.push({ name: "Beatles · canonical catalog order", ok: false, ms: Date.now() - t0, err: String(e.message ?? e).slice(0, 120) });
  } finally {
    await ctx.close();
  }
}

const results = [];

/**
 * Runs a single journey against the live app.
 * @param {import("playwright").Browser} browser
 * @param {{name: string, query: string, expectArtist?: RegExp}} journey
 */
async function journey(browser, { name, query, expectArtist }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    // 1) Home + search. Wait for hydration: clicking before React hydrates
    // triggers a native form GET (full reload) and the SPA search never runs.
    await page.goto(`${BASE}/search`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder(/Artist, album/).fill(query);
    await page.getByRole("button", { name: "Search" }).click();
    // Hydration race retry: if the SPA didn't take over, re-fill and re-submit.
    // "Results" may legitimately stay absent when the quality filter empties
    // the result set (shelves remain visible) — cards are the real contract.
    try {
      await page.waitForSelector("text=Results", { timeout: 8_000 });
    } catch {
      await page.getByPlaceholder(/Artist, album/).fill(query);
      await page.getByRole("button", { name: "Search" }).click();
      await page.waitForSelector("text=Results", { timeout: 30_000 }).catch(() => {});
    }

    // 2+3) Play from the first result, with ONE retry: late journeys can hit
    // archive.org rate limiting (metadata fetch fails silently) — a fresh
    // attempt after a pause is the honest mitigation, not a fake pass.
    const audioUp = async () => page.waitForFunction(
      () => { const a = (() => { const inIsland = document.querySelector("iframe")?.contentDocument?.querySelector("audio"); return inIsland ?? document.querySelector("audio"); })(); return a && a.src && !a.paused && a.currentTime > 0; },
      { timeout: 45_000 }
    );
    let played = false;
    for (let attempt = 0; attempt < 3 && !played; attempt++) {
      try {
        if (attempt > 0) {
          await page.waitForTimeout(10_000 * attempt); // archive.org rate-limit backoff
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.getByPlaceholder(/Artist, album/).fill(query);
          await page.getByRole("button", { name: "Search" }).click();
        }
        // attempt 0 → first card; later attempts → next cards: restricted
        // (lending 🔒) items 401 on download and the island never plays them —
        // a real user moves to the next album, so does the journey.
        const card = page.locator("a[href*='/album']").nth(Math.min(attempt, 5));
        await card.waitFor({ timeout: 30_000 });
        await card.locator("button[aria-label^='Play']").click();
        await audioUp();
        played = true;
      } catch { /* retry with backoff */ }
    }
    if (!played) throw new Error("audio did not start after 3 attempts (rate limit or source offline)");
    const { src, time1 } = await page.evaluate(() => {
      const a = (() => { const inIsland = document.querySelector("iframe")?.contentDocument?.querySelector("audio"); return inIsland ?? document.querySelector("audio"); })();
      if (!a) throw new Error("no audio element found (island or inline)");
      return { src: a.src, time1: a.currentTime };
    });
    await page.waitForTimeout(2500);
    const time2 = await page.evaluate(() => ((() => { const inIsland = document.querySelector("iframe")?.contentDocument?.querySelector("audio"); return inIsland ?? document.querySelector("audio"); })()).currentTime);
    if (time2 <= time1) throw new Error(`audio not advancing (${time1} → ${time2})`);

    // 4) The NowPlayingBar shows something (UI consistent with the audio)
    const barText = await page.locator("footer").first().textContent();

    // 5) If expected: the page contains the right artist
    if (expectArtist) {
      const pageText = (await page.textContent("body")) ?? "";
      if (!expectArtist.test(pageText)) {
        throw new Error(`expected artist ${expectArtist} not found in results`);
      }
    }

    results.push({ name, ok: true, ms: Date.now() - t0, src: src.slice(0, 60) + "…", bar: barText.slice(0, 50) });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: String(e.message ?? e).slice(0, 120) });
  } finally {
    await ctx.close();
  }
}

console.log(`\n═══ E2E journeys on ${BASE} — real audio, real network ═══\n`);
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--mute-audio"],
});
for (const j of JOURNEYS) {
  process.stdout.write(`→ ${j.name} … `);
  const jb = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--mute-audio"] });
  await journey(jb, j);
  await jb.close();
  const r = results[results.length - 1];
  console.log(r.ok ? `OK (${(r.ms / 1000).toFixed(1)}s)` : `FAIL — ${r.err}`);
}

// Canonical catalog journey (artist page, inverse process)
process.stdout.write("→ Beatles · canonical catalog order … ");
await beatlesCatalogJourney(browser);
const br = results[results.length - 1];
console.log(br.ok ? `OK (${(br.ms / 1000).toFixed(1)}s)` : `FAIL — ${br.err}`);
await browser.close();

// —— Persistence journey: music must NOT stop while navigating (Spotify-like bug) ——
process.stdout.write("→ Player persistence during navigation … ");
try {
  // Dedicated browser: audio journeys can crash the shared GPU/network service.
  const pb = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--mute-audio"] });
  const ctx = await pb.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/search`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/Artist, album/).fill("edith piaf");
  await page.getByRole("button", { name: "Search" }).click();
  try {
    await page.waitForSelector("text=Results", { timeout: 8_000 });
  } catch {
    await page.getByPlaceholder(/Artist, album/).fill("edith piaf");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForSelector("text=Results", { timeout: 30_000 }).catch(() => {});
  }
  const firstCard = page.locator("a[href*='/album']").first();
  await firstCard.waitFor({ timeout: 30_000 });
  await firstCard.locator("button[aria-label^='Play']").click();
  await page.waitForFunction(() => { const a = (() => { const inIsland = document.querySelector("iframe")?.contentDocument?.querySelector("audio"); return inIsland ?? document.querySelector("audio"); })(); return a && !a.paused && a.currentTime > 0; }, { timeout: 45_000 });
  const t1 = await page.evaluate(() => ((() => { const inIsland = document.querySelector("iframe")?.contentDocument?.querySelector("audio"); return inIsland ?? document.querySelector("audio"); })()).currentTime);
  // Navigate away and back (client-side, via Link): artist page (AlbumCard's
  // cover link) then Home tab. The island audio must survive both.
  await page.locator("a[href*='/album']").first().click();
  await page.waitForTimeout(2000);
  await page.locator("a[href*='artist']").first().click();
  await page.waitForTimeout(2000);
  await page.locator("nav a, aside a").filter({ hasText: "Home" }).first().click();
  await page.waitForTimeout(2000);
  const persisted = await page.evaluate(() => {
    const a = (() => { const inIsland = document.querySelector("iframe")?.contentDocument?.querySelector("audio"); return inIsland ?? document.querySelector("audio"); })();
    if (!a) throw new Error("no audio element after navigation");
    return { paused: a.paused, t: a.currentTime };
  });
  if (persisted.paused) throw new Error("audio paused after navigation");
  if (persisted.t <= t1) throw new Error(`time went backwards (${t1} → ${persisted.t}) — audio restarted`);
  results.push({ name: "Player persistence", ok: true, ms: 0, src: `audio alive at t=${persisted.t.toFixed(1)}s` });
  console.log("OK");
  await ctx.close();
  await pb.close();
} catch (e) {
  results.push({ name: "Player persistence", ok: false, ms: 0, err: String(e.message ?? e).slice(0, 120) });
  console.log("FAIL — " + String(e.message ?? e).slice(0, 120));
}

// —— Static-export hash deep-link: legacy #/artist/X URLs must resolve ——
process.stdout.write("→ Hash deep-link shim (#/artist/…) … ");
try {
  const hb = await chromium.launch({ args: ["--disable-gpu"] });
  const hp = await (await hb.newContext()).newPage();
  await hp.goto(`${BASE}/#/artist/Giuseppe%20Verdi`, { waitUntil: "domcontentloaded" });
  await hp.waitForFunction(() => !window.location.hash, { timeout: 15_000 });
  const url = hp.url();
  const body = await hp.textContent("body");
  if (!url.includes("artist?n=Giuseppe") && !url.includes("artist/?n=Giuseppe")) {
    throw new Error(`hash not rewritten, url=${url}`);
  }
  if (!/Giuseppe Verdi/.test(body)) throw new Error("artist page did not render");
  results.push({ name: "Hash deep-link shim", ok: true, ms: 0, src: url.slice(0, 60) });
  console.log("OK");
  await hb.close();
} catch (e) {
  results.push({ name: "Hash deep-link shim", ok: false, ms: 0, err: String(e.message ?? e).slice(0, 120) });
  console.log("FAIL — " + String(e.message ?? e).slice(0, 120));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n═══ ${results.length - failed.length}/${results.length} journeys OK ═══`);
for (const r of results.filter((r) => r.ok)) {
  console.log(`  ✓ ${r.name} — ${r.src}`);
}
if (failed.length) process.exit(1);
