/**
 * Mobile "New episodes" probe (board task-984a3211 + children 92cae8cd/35698359).
 * Real podcast landing page in a MOBILE viewport (iPhone 12, 390×844) with a
 * seeded followed show whose feed serves a REAL RSS document (fetch override,
 * deterministic — no route interception) with an episode published 1h ago.
 * The section must leave the loading state and list the episode in bounded
 * time. Also verifies the catalog layer never hangs: catalogGet is bounded.
 * Usage: node tests/e2e/mobile-new-episodes.mjs   (dev server on :3000)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const feedUrl = "https://feeds.example.test/show.xml";
const pubDate = new Date(Date.now() - 3600_000).toUTCString();
const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<title>Probe Show</title><itunes:image href="http://127.0.0.1:1/art.jpg"/>
<item><title>Brand new episode</title><guid>probe-g1</guid>
<pubDate>${pubDate}</pubDate>
<enclosure url="http://127.0.0.1:1/e1.mp3" type="audio/mpeg" length="1"/>
</item></channel></rss>`;

let ok = 0, total = 0;
const check = (name, cond, detail = "") => { total++; if (cond) ok++; console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();
await page.addInitScript(`
  // PWA sw intercepts cross-origin fetches in its own context — page-level
  // fetch overrides never see them. Tests must not register it.
  if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error("sw disabled in test"));
  localStorage.setItem("pf.subs", JSON.stringify([{ feedUrl: ${JSON.stringify(feedUrl)}, title: "Probe Show", image: null, subscribedAt: Date.now() }]));
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    if (url.includes("feeds.example.test")) {
      return Promise.resolve(new Response(${JSON.stringify(RSS)}, { status: 200, headers: { "content-type": "application/xml" } }));
    }
    return realFetch(input, init);
  };
`);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));

await page.goto(`${BASE}/podcast`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "New episodes" }).waitFor({ timeout: 15_000 }).catch(() => {});

const section = page.locator("section[aria-label='New episodes']");
check("New episodes section is present on mobile viewport", await section.count() > 0);

// Bounded wait: the section must RESOLVE (fix behavior), not hang forever.
const t0 = Date.now();
let body = "";
let populated = false;
while (Date.now() - t0 < 30_000) {
  body = (await section.textContent().catch(() => "")) ?? "";
  if (!/Checking your shows/.test(body) || /Brand new episode/.test(body)) { populated = true; break; }
  await page.waitForTimeout(500);
}
check("section leaves the loading state (bounded, no hang)", populated, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
check("section lists the fresh episode", /Brand new episode/.test(body), body?.trim().slice(0, 120));

// The catalog layer must not hang either: catalogGet bounded → answer in <15s.
const catalogOk = await page.evaluate(() => {
  // BasePath-aware: on GitHub Pages the app lives under /pharos/, so the
  // precompiled bundle is served at <basePath>/collab.js — a root-absolute
  // "/collab.js" import 404s there. Derive the base from a Next static chunk
  // URL (the page URL itself is nested and not a valid base).
  const chunk = [...document.querySelectorAll("script[src]")].map((s) => s.src).find((u) => u.includes("/_next/static/"));
  const base = chunk ? chunk.slice(0, chunk.indexOf("/_next/static/")) + "/" : new URL(".", location.href).href;
  return Promise.race([
    import(base + "collab.js").then(async (c) => {
      await c.startCollab().catch(() => null);
      return c.collabState();
    }).catch((e) => "collab-import-fail:" + String(e).slice(0, 80)),
    new Promise((r) => setTimeout(() => r("timeout-15s"), 15_000)),
  ]);
});
check("collab import resolves in bounded time (no hang)", catalogOk !== "timeout-15s", JSON.stringify(catalogOk).slice(0, 120));
check("collab is ready with the shared DB open (pubsub present)", catalogOk?.ready === true && catalogOk?.dbOpen === true, JSON.stringify(catalogOk).slice(0, 120));
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 200));

await browser.close();
console.log(`\nRESULT: ${ok}/${total} pass`);
process.exit(ok === total ? 0 : 1);
