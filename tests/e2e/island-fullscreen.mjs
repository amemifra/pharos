/**
 * E2E: detail click expands the player island to full page for video
 * podcasts (task "Fix player island: full screen on detail click").
 *
 * Zero network: the queue is seeded into localStorage (pf.queue) with a
 * synthetic video track, out/ is served statically, and the assertions are
 * purely DOM — the island iframe must switch from hidden (h-0 w-0) to the
 * full-page class (fixed inset-0) after a click on the NowPlayingBar detail
 * area, and collapse again on Escape.
 *
 * Run: node tests/e2e/island-fullscreen.mjs   (serves out/ itself)
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const OUT_DIR = join(process.cwd(), "out");
const PORT = 4173;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".mjs": "text/javascript", ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
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

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--mute-audio"],
});
try {
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

  // Seed the queue BEFORE first paint: one synthetic video-podcast track
  // (medium podcast, AUDIO-ONLY — the owner's real case) at index 0, paused.
  const track = {
    id: "e2e-island/test-episode.mp4",
    title: "E2E video podcast episode",
    artist: "E2E show",
    url: "/podcast/media/definitely-missing.mp4",
    format: "mp4",
    medium: "podcast",
    feedUrl: "https://example.invalid/feed.rss",
    video: false,
    variants: [{ format: "mp4", url: "/podcast/media/definitely-missing.mp4" }],
  };
  await page.addInitScript((seed) => {
    localStorage.setItem("pf.queue", JSON.stringify(seed));
    localStorage.setItem("pf.splash.seen", "1");
  }, { queue: [track], index: 0, position: 0, playing: false });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("iframe[title='Pharos player island']", { timeout: 15_000, state: "attached" });

  const frameSel = "iframe[title='Pharos player island']";
  const iframeClass = () => page.getAttribute("iframe[title='Pharos player island']", "class");

  // Hidden at rest.
  const atRest = await iframeClass();
  check("island hidden at rest", /h-0 w-0/.test(atRest), atRest ?? "(null)");

  // Click the DETAIL area (title/artist button) in the NowPlayingBar.
  await page.getByRole("button", { name: "Expand player to full screen" }).click();
  await page.waitForFunction(() => {
    const f = document.querySelector("iframe[title='Pharos player island']");
    return f && /fixed inset-0 z-50/.test(f.className);
  }, { timeout: 5_000 }).catch(() => {});
  const expanded = await iframeClass();
  check("island full-page after detail click", /fixed inset-0 z-50/.test(expanded ?? ""), expanded ?? "(null)");

  // Native DOCUMENT fullscreen (owner: "tutto il documento") — the iframe
  // element itself requested requestFullscreen. Headless honors it when a
  // user gesture is present; if a browser refuses, CSS full-page remains
  // and this check fails loudly (it is the owner requirement, not optional).
  await page.waitForFunction(() => document.fullscreenElement !== null, { timeout: 3_000 })
    .catch(() => {});
  const fsEl = await page.evaluate(() => {
    const f = document.fullscreenElement;
    return f ? (f.getAttribute("title") ?? f.tagName) : null;
  });
  check("native document fullscreen entered", fsEl === "Pharos player island", `fullscreenElement=${fsEl ?? "null"}`);

  // The in-shell overlay must NOT be open for a video track.
  const dialogOpen = await page.locator("[role=dialog][aria-label='Now playing']").count();
  check("overlay not opened for video track", dialogOpen === 0, `dialogs=${dialogOpen}`);


  // The full-screen island renders a real UI inside the iframe (cover,
  // title, transport — owner: "non mostra una UI decente ne niente immagini").
  await page.waitForFunction(() => {
    const f = document.querySelector("iframe[title='Pharos player island']");
    return f?.contentDocument?.body?.innerText.includes("E2E video podcast episode");
  }, { timeout: 5_000 }).catch(() => {});
  const uiText = await page.evaluate(() => {
    const f = document.querySelector("iframe[title='Pharos player island']");
    return f?.contentDocument?.body?.innerText ?? "";
  });
  check("island full-screen UI shows title", uiText.includes("E2E video podcast episode"), uiText.slice(0, 90).replace(/\n/g, " | "));
  check("island full-screen UI has seek bar", uiText.includes("0:00"), "seek/time text missing");

  // The island's own ✕ posts pf.exit and the shell collapses the view.
  await page.locator("iframe[title='Pharos player island']").contentFrame()
    .getByRole("button", { name: "Close full screen player" }).click();
  await page.waitForFunction(() => {
    const f = document.querySelector("iframe[title='Pharos player island']");
    return f && /h-0 w-0/.test(f.className);
  }, { timeout: 5_000 }).catch(() => {});
  const afterExit = await iframeClass();
  check("island ✕ collapses the view", /h-0 w-0/.test(afterExit ?? ""), afterExit ?? "(null)");

  // Esc collapses back to hidden.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const f = document.querySelector("iframe[title='Pharos player island']");
    return f && /h-0 w-0/.test(f.className);
  }, { timeout: 5_000 }).catch(() => {});
  const collapsed = await iframeClass();
  check("Esc collapses the island", /h-0 w-0/.test(collapsed ?? ""), collapsed ?? "(null)");

  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "  ✓" : "  ✗"} ${r.name}${r.ok ? "" : ` — ${r.extra ?? ""}`}`);
  if (!r.ok) failed++;
}
console.log(`═══ RESULT: ${results.length - failed} pass, ${failed} fail ═══`);
process.exit(failed ? 1 : 0);
