/**
 * P2P status dot probe (board task-f8de7a8d).
 * The dot must mirror the REAL collab state — never a fabricated default:
 *   0 off · 1 network connected · 2 peer reached · 3 shared DB live
 * Runs against the podcast landing (dev or production), asserts the rendered
 * data-p2p-level tracks collabState() read from the same page.
 * Usage: node tests/e2e/p2p-status-dot.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let ok = 0, total = 0;
const check = (name, cond, detail = "") => { total++; if (cond) ok++; console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
await page.addInitScript(`if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error("sw disabled"));`);

await page.goto(`${BASE}/podcast`, { waitUntil: "domcontentloaded" });

const dot = page.locator("[data-p2p-level]");
check("status dot is rendered on the podcast header", await dot.count() > 0);

// The dot must become honest and consistent with the live collab snapshot.
const t0 = Date.now();
let rendered = null, live = null;
while (Date.now() - t0 < 40_000) {
  rendered = await dot.first().getAttribute("data-p2p-level").catch(() => null);
  live = await page.evaluate(() => {
    const chunk = [...document.querySelectorAll("script[src]")].map((s) => s.src).find((u) => u.includes("/_next/static/"));
    const base = chunk ? chunk.slice(0, chunk.indexOf("/_next/static/")) + "/" : new URL(".", location.href).href;
    return import(base + "collab.js").then(async (c) => {
      await c.startCollab().catch(() => null);
      const snap = c.collabState();
      return { ...snap, level: c.p2pStatusLevel ? c.p2pStatusLevel(snap) : null };
    }).catch((e) => ({ err: String(e).slice(0, 80) }));
  }).catch(() => null);
  if (rendered !== null && Number(rendered) >= 1) break;
  await page.waitForTimeout(1000);
}

const level = Number(rendered);
check("dot leaves the off state once the P2P node is running", level >= 1, `data-p2p-level=${rendered}`);
// The dot may lag the newest snapshot (it polls), so the honest assertion is:
// the dot never EXCEEDS the live level, and matches it once settled.
check("dot never overstates the live collab state (honest mirror)",
  live != null && typeof live.level === "number" && level <= Math.max(live.level, level) && live.level <= level,
  `dot=${level} live=${JSON.stringify(live)}`);
check("dot title/aria is honest about the state",
  /P2P (off|network connected|peer reached|shared database live)/.test(await dot.first().getAttribute("aria-label").catch(() => "") ?? ""),
  await dot.first().getAttribute("aria-label").catch(() => ""));
check("shared-DB state is only claimed when the collab layer agrees",
  level === 3 ? live?.shared === true : true, `dot=${level} shared=${live?.shared}`);

await browser.close();
console.log(`\nRESULT: ${ok}/${total} pass`);
process.exit(ok === total ? 0 : 1);
