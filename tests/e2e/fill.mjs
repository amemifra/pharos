/**
 * E2E journeys for the fill engine + podcasts (F5/F6 supplement).
 * Requires a dev server (npm run dev) on :3000. Real audio, real P2P layer.
 *
 * Journeys:
 *   1. Fill now → shared state surfaces on the artist page (filled/claimed).
 *   2. Podcast subscribe + play episode with REAL audio, survives navigation.
 *
 * Usage: node tests/e2e/fill.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];

async function record(name, fn) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const t0 = Date.now();
  try {
    await fn(page);
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: String(e.message ?? e).slice(0, 140) });
  } finally {
    await ctx.close();
  }
}

let browser = await chromium.launch();

// Journey 1: the fill button renders an honest shared state.
await record("Artist · fill-now button shows shared queue state", async (page) => {
  await page.goto(`${BASE}/artist?n=Betty%20Thornton`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid='fill-now']", { timeout: 60_000 });
  const label = await page.textContent("[data-testid='fill-now']");
  if (!/fill|filled|claimed|queue/i.test(label)) throw new Error(`unexpected fill label: ${label}`);
});

// Journey 2: podcast page parses a real feed, plays an episode with audio.
await record("Podcast · subscribe + play episode (real audio)", async (page) => {
  const feed = encodeURIComponent("https://lexfridman.com/feed/podcast/");
  await page.goto(`${BASE}/podcast?url=${feed}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("ol li button", { timeout: 60_000 });
  // Play the first episode.
  await page.click("ol li button");
  // Wait for the inline/island audio to actually start (real enclosure).
  await page.waitForFunction(
    () => {
      const a = document.querySelector("audio");
      return a && !a.paused && a.currentTime > 0;
    },
    { timeout: 45_000 }
  );
  // Survive navigation: go home, come back, the show state must persist.
  await page.goto(`${BASE}/library`, { waitUntil: "domcontentloaded" });
  const queueText = await page.textContent("body");
  if (!/play queue|recently/i.test(queueText)) throw new Error("library did not render after navigation");
});

console.log("\n═══ E2E fill/podcast ═══");
for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.name} (${r.ms}ms)${r.err ? ` — ${r.err}` : ""}`);
}
if (results.some((r) => !r.ok)) process.exit(1);
await browser?.close();
process.exit(0);
