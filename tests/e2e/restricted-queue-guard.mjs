/**
 * E2E: restricted episodes never enter the queue (task
 * plan::40::gap-podcast-restricted-guard).
 *
 * Zero network: a two-episode RSS feed is fulfilled by Playwright route
 * interception (direct-fetch CORS path of lib/podcast.fetchFeedXml), one
 * enclosure answers HEAD 401 (restricted), the other 200 with real WAV
 * bytes so the island player can emit pf.state → pf.queue. Assertions are
 * on localStorage pf.queue + honest UI feedback only.
 *
 * PROBE_MODE=pre  → reproduces the BUG: the restricted episode IS queued.
 * PROBE_MODE=post → proves the FIX: the restricted episode is excluded and
 *                   the UI shows the honest 🔒 restricted label.
 *
 * Run: PROBE_OUT=out PROBE_MODE=post node tests/e2e/restricted-queue-guard.mjs
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const OUT_DIR = process.env.PROBE_OUT ?? join(process.cwd(), "out");
const MODE = process.env.PROBE_MODE ?? "post";
const PORT = 4177;
const FEED_URL = "https://feeds.example.org/e2e-guard.rss";
const OK_URL = "https://cdn.example.org/ep-ok.mp3";
const RESTRICTED_URL = "https://cdn.example.org/ep-restricted.mp3";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".mjs": "text/javascript", ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  const base = decodeURIComponent(req.url.split("?")[0]);
  let p = base;
  if (p.startsWith("/pharos/")) p = p.slice("/pharos".length) || "/";
  if (p.endsWith("/")) p += "index.html";
  // out/ layout: routes export as <route>.html (podcast/ is a plain dir here),
  // so probe candidates in order: exact, <route>.html, <route>/index.html, SPA index.
  const candidates = [p, p.replace(/\/$/, "") + ".html", p.replace(/\/$/, "") + "/index.html", "index.html"];
  let body = null, file = null;
  for (const c of candidates) {
    if (!c) continue;
    try { body = readFileSync(join(OUT_DIR, c)); file = c; break; } catch {}
  }
  if (body === null) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, r));

// Minimal valid silent WAV so <audio> fires loadedmetadata in headless.
function wavBytes() {
  const rate = 8000, n = rate; // 1s of silence
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}
const WAV = wavBytes();

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>E2E Guard Show</title>
<item><guid>ep-ok</guid><title>Playable episode</title><pubDate>Mon, 01 Sep 2025 10:00:00 GMT</pubDate><enclosure url="${OK_URL}" type="audio/wav" length="${WAV.length}"/></item>
<item><guid>ep-restricted</guid><title>Restricted episode</title><pubDate>Tue, 02 Sep 2025 10:00:00 GMT</pubDate><enclosure url="${RESTRICTED_URL}" type="audio/wav" length="1234"/></item>
</channel></rss>`;

const results = [];
const check = (name, ok, extra = "") => results.push({ name, ok: !!ok, extra });

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--mute-audio"],
});
try {
  const page = await (await browser.newContext()).newPage();
  const violations = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(`http://localhost:${PORT}/`)) return route.continue();
    if (url === FEED_URL) return route.fulfill({ status: 200, contentType: "application/rss+xml", body: FEED_XML });
    if (url === RESTRICTED_URL) return route.fulfill({ status: 401, body: "restricted" });
    if (url === OK_URL) {
      if (route.request().method() === "HEAD") return route.fulfill({ status: 200, headers: { "content-length": String(WAV.length) } });
      return route.fulfill({ status: 200, contentType: "audio/wav", body: WAV });
    }
    violations.push(url);
    return route.abort();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

  await page.addInitScript(() => { localStorage.setItem("pf.splash.seen", "1"); });
  await page.goto(`http://localhost:${PORT}/pharos/podcast?url=${encodeURIComponent(FEED_URL)}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Restricted episode").waitFor({ timeout: 20_000 });

  // Click the bulk enqueue ("▶ Play") — the enqueue boundary under test.
  await page.getByRole("button", { name: "▶ Play" }).click();

  // Wait for the queue to reach the island → pf.state → pf.queue.
  const queued = await page
    .waitForFunction(
      () => {
        try {
          const q = JSON.parse(localStorage.getItem("pf.queue") ?? "null");
          return q?.queue?.length ? q : null;
        } catch { return null; }
      },
      { timeout: 20_000 }
    )
    .then((h) => h.jsonValue())
    .catch(() => null);

  const ids = (queued?.queue ?? []).map((t) => t.id);
  const hasRestricted = ids.includes("ep-restricted");
  const hasOk = ids.includes("ep-ok");

  if (MODE === "pre") {
    // Bug reproduction: BEFORE the fix the restricted episode IS enqueued and
    // will fail in playback (pf.trackerror auto-skip is the only net).
    check("PRE (bug reproduced): restricted episode entered the queue", hasRestricted && hasOk, `queue=${ids.join(",") || "empty"}`);
  } else {
    check("queue built from playable episodes only", hasOk && !hasRestricted, `queue=${ids.join(",") || "empty"}`);
    // Honest UI: the restricted row shows the 🔒 restricted label, the play
    // control is gone — never a button that does nothing.
    const locked = await page.getByText(/publisher restricts this episode/).count();
    check("honest 🔒 restricted label in the episode list", locked >= 1, `labels=${locked}`);
    const notice = await page.getByText(/skipped — restricted by the publisher/i).count();
    check("queue notice reports skipped restricted episodes", notice >= 1, `notices=${notice}`);
  }
  check("zero unexpected network requests (all fulfilled locally)", violations.length === 0, violations.slice(0, 3).join(" | "));
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
console.log(`═══ RESULT (${MODE}): ${results.length - failed} pass, ${failed} fail ═══`);
process.exit(failed ? 1 : 0);
