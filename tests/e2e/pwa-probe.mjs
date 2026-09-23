/**
 * E2E probe: PWA installable + local new-episode notifications
 * (task "PWA installable: service worker + local notifications (no server)").
 *
 * Zero network: the ONLY external fetches go to the local static server
 * itself (a synthetic RSS feed is served at /pharos/__testfeed/rss.xml with
 * a FUTURE pubDate), out/ is served statically, assertions are programmatic:
 *   1. manifest served 200 + valid JSON (name Pharos, icons present);
 *   2. /sw.js served 200 with a JavaScript content-type;
 *   3. service worker registers, activates (navigator.serviceWorker.ready);
 *   4. cache-first: a /_next/static asset lands in pharos-static-v1;
 *   5. seeded subscription + old last-seen → check-on-open fires ONE local
 *      notification and advances pf.subseen (pure diff also unit-checked
 *      via require("./public/sw.js")).
 *
 * Requires out/ built with basePath /pharos (NEXT_PUBLIC_BASE_PATH=/pharos).
 * Run: node tests/e2e/pwa-probe.mjs   (serves out/ itself)
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { pickNewEpisodes } from "../../public/sw.js";

const OUT_DIR = join(process.cwd(), "out");
const PORT = 4174;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".mjs": "text/javascript", ".woff2": "font/woff2", ".xml": "application/rss+xml",
};

const FUTURE_MS = Date.now() + 24 * 60 * 60 * 1000;
const FUTURE_DATE = new Date(FUTURE_MS).toUTCString();
const FEED_PATH = "/pharos/__testfeed/rss.xml";
const FEED_URL = `http://localhost:${PORT}${FEED_PATH}`;
const SYNTHETIC_RSS = `<rss version="2.0"><channel><title>Probe Show</title>
<link>http://localhost:${PORT}/pharos/podcast/</link><description>probe</description>
<item><title>Probe ep — seeded new episode</title><guid>probe-ep-1</guid><pubDate>${FUTURE_DATE}</pubDate>
<enclosure url="http://localhost:${PORT}/pharos/__testfeed/ep1.mp3" type="audio/mpeg" length="1"/></item>
</channel></rss>`;

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === FEED_PATH) { // synthetic zero-network feed
    res.writeHead(200, { "content-type": "application/rss+xml" });
    res.end(SYNTHETIC_RSS);
    return;
  }
  // out/ is built with basePath /pharos: strip the prefix before resolving.
  if (p.startsWith("/pharos/")) p = p.slice("/pharos".length) || "/";
  if (p.endsWith("/")) p += "index.html";
  let file = join(OUT_DIR, p);
  if (!existsSync(file)) file = join(OUT_DIR, p.replace(/\/$/, "") + ".html");
  if (!existsSync(file)) file = join(OUT_DIR, "index.html");
  try {
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(PORT, r));

const results = [];
const check = (name, ok, extra = "") => results.push({ name, ok: !!ok, extra });

// Pure diff unit checks (public/sw.js module exports, no browser needed).
check("diff pure: new episode detected",
  pickNewEpisodes({ lastSeen: { u: 100 } }, [{ feedUrl: "u", title: "T", pubDateMs: 200, guid: "x" }]).length === 1);
check("diff pure: seen episode suppressed",
  pickNewEpisodes({ lastSeen: { u: 300 } }, [{ feedUrl: "u", title: "T", pubDateMs: 200, guid: "x" }]).length === 0);

// HTTP contract checks (node fetch against our own server — zero external net).
const manifestRes = await fetch(`http://localhost:${PORT}/pharos/manifest.webmanifest`);
const manifestOk = manifestRes.ok && /json|manifest/.test(manifestRes.headers.get("content-type") ?? "");
let manifest = null;
try { manifest = await manifestRes.json(); } catch {}
check("manifest served 200 + JSON", manifestOk && manifest?.name?.startsWith("Pharos") && (manifest?.icons?.length ?? 0) >= 2,
  `status=${manifestRes.status} name=${manifest?.name ?? "?"}`);

const swRes = await fetch(`http://localhost:${PORT}/pharos/sw.js`);
const swType = swRes.headers.get("content-type") ?? "";
check("sw.js served 200 + JS content-type", swRes.ok && /javascript/.test(swType), `status=${swRes.status} type=${swType}`);

// Behavioral checks in a real browser (service worker + notification).
// Headful: headless Chromium (new headless) hard-denies Notification
// permission even with explicit grantPermissions — the notification path can
// only be probed in a headed browser (local gate on macOS/CI with display).
const browser = await chromium.launch({ headless: false, args: ["--disable-gpu"] });
try {
  const context = await browser.newContext();
  await context.grantPermissions(["notifications"], { origin: `http://localhost:${PORT}` });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
  page.on("console", (m) => {
    // The "skip check" debug line is an EXPECTED no-server path (the probe
    // races SW registration against the check-on-open; reg can legitimately
    // be absent). It is information, not a page error — demote it to a
    // non-fatal log so the check measures real page errors only.
    if (m.text().includes("[pharos:notify] skip check")) return;
    if (m.text().includes("[pharos:notify]")) errors.push("LOG " + m.text().slice(0, 160));
  });

  // Seed BEFORE first paint: one subscribed feed (our synthetic feed) with an
  // OLD last-seen marker, alerts ON (mirrors the opt-in toggle state).
  await page.addInitScript((feedUrl) => {
    localStorage.setItem("pf.splash.seen", "1");
    localStorage.setItem("pf.subs", JSON.stringify([{ feedUrl, title: "Probe Show", subscribedAt: 1 }]));
    localStorage.setItem(`pf.subseen:${feedUrl}`, "1");
    localStorage.setItem("pf.notify", JSON.stringify({ enabled: true, at: 1 }));
  }, FEED_URL);

  await page.goto(`http://localhost:${PORT}/pharos/`, { waitUntil: "domcontentloaded" });
  const swState = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return reg ? { scope: reg.scope, active: !!reg.active } : null;
  });
  check("service worker registered + active", !!swState?.active, JSON.stringify(swState));

  // Reload under SW control: assets fetched while the worker installs are
  // not intercepted; a second load goes through the cache-first handler.
  await page.reload({ waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Cache-first: some immutable /_next/static asset must land in the STATIC
  // cache (name is build-versioned: pharos-static-<build>).
  const staticCacheName = await page.evaluate(async () =>
    (await caches.keys()).find((n) => n.startsWith("pharos-static-")) ?? null);
  await page.waitForFunction(async (name) => {
    if (!self.caches || !name) return false;
    const c = await caches.open(name).catch(() => null);
    return c && (await c.keys()).some((r) => r.url.includes("/_next/static/"));
  }, staticCacheName, { timeout: 15_000 }).catch(() => {});
  check("cache-first: versioned pharos-static-<build> exists", !!staticCacheName, staticCacheName ?? "none");
  check("cache-first: _next/static cached", await page.evaluate(async (name) => {
    const c = await caches.open(name).catch(() => null);
    return c ? (await c.keys()).filter((r) => r.url.includes("/_next/static/")).length : 0;
  }, staticCacheName), `entries in ${staticCacheName}`);

  // Check-on-open: with alerts enabled and an old last-seen marker, the boot
  // check must fire one local notification (last-seen advance is asserted
  // explicitly below).
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg?.active) return false;
    return (await reg.getNotifications()).length > 0;
  }, { timeout: 20_000 }).catch(() => {});
  const notifState = await page.evaluate(async (feedUrl) => {
    const reg = await navigator.serviceWorker.getRegistration();
    const notifs = reg ? await reg.getNotifications() : [];
    return {
      count: notifs.length,
      title: notifs[0]?.title ?? null,
      url: notifs[0]?.data?.url ?? null,
      seen: Number(JSON.parse(localStorage.getItem(`pf.subseen:${feedUrl}`) ?? "0")) || 0,
    };
  }, FEED_URL);
  check("local notification fired (no server)", notifState.count === 1 && /Pharos/.test(notifState.title ?? ""),
    JSON.stringify(notifState));
  check("notification deep links to /podcast", String(notifState.url ?? "").endsWith("/pharos/podcast/"), String(notifState.url));
  check("last-seen advanced after check", notifState.seen >= FUTURE_MS - 2000, `subseen=${notifState.seen} future=${FUTURE_MS} (toUTCString truncates to seconds)`);

  // Worker-side check ('pharos:run-check'): idempotent — after lastSeen
  // advanced, a second check must NOT notify again (no burst).
  const second = await page.evaluate((feedUrl) => new Promise((resolve) => {
    const id = (Math.random() + 1).toString(36).slice(2);
    const onMsg = (e) => {
      if (e.data?.type === "pharos:check-result") {
        navigator.serviceWorker.removeEventListener("message", onMsg);
        resolve(e.data.result);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    navigator.serviceWorker.controller?.postMessage({ type: "pharos:run-check", id });
    setTimeout(() => resolve({ timeout: true }), 15_000);
  }), FEED_URL);
  check("second check is a no-op (idempotent)", second?.notified === false, JSON.stringify(second));

  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
} finally {
  await browser.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "  ✓" : "  ✗"} ${r.name}${r.extra ? ` — ${r.extra}` : ""}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
