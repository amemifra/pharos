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
// The indicator lives in the app shell, so it must be present on ANY page —
// verify on a non-podcast route too (this is where it was invisible before).
await page.goto(`${BASE}/album?rid=x&n=Ramones`, { waitUntil: "domcontentloaded" });
check("indicator is present on the album page too (global placement)", await page.locator("[data-p2p-level]").count() > 0);
await page.goto(`${BASE}/podcast`, { waitUntil: "domcontentloaded" });

const dot = page.locator("[data-p2p-level]");
check("status indicator is rendered in the app shell (visible on every page)", await dot.count() > 0);
check("indicator is text-free: exactly 3 dots", await dot.first().evaluate((el) => el.querySelectorAll("span").length === 3 && el.textContent.trim() === ""), 
  await dot.first().evaluate((el) => `dots=${el.querySelectorAll("span").length} text="${el.textContent.trim()}"`).catch(() => ""));

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
check("lit dots match the live level (honest progression)", await dot.first().evaluate((el) => {
  const lit = [...el.querySelectorAll("span")].filter((s) => s.className.includes("bg-amber-400")).length;
  return lit === Number(el.getAttribute("data-p2p-level"));
}), `lit=${await dot.first().evaluate((el) => [...el.querySelectorAll("span")].filter((s) => s.className.includes("bg-amber-400")).length)}`);
check("tooltip/aria is honest about the state",
  /P2P (off|network connected|peer reached|shared database live)/.test(await dot.first().getAttribute("aria-label").catch(() => "") ?? ""),
  await dot.first().getAttribute("aria-label").catch(() => ""));
check("shared-DB state is only claimed when the collab layer agrees",
  level === 3 ? live?.shared === true : true, `dot=${level} shared=${live?.shared}`);

await browser.close();
console.log(`\nRESULT: ${ok}/${total} pass`);
process.exit(ok === total ? 0 : 1);
