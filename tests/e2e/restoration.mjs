/**
 * E2E: gramophone-restoration feature.
 * Plays a real old-recording track (georgeblood 78rpm collection), toggles
 * "light" restoration, and verifies: the island exposes the restoration state,
 * the worklet graph is active, and audio keeps advancing (never broken by the
 * feature). The AI path is only asserted as honest-unavailable (no model file
 * ships by default — documented in lib/restore-model.js).
 *
 * Run: node tests/e2e/restoration.mjs   (dev server on :3000)
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];

const check = (name, fn) => results.push({ name, ok: !!fn });

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--mute-audio"],
});
try {
  const page = await (await browser.newContext()).newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 120)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });

  // 1) Set light restoration BEFORE load (policy read at island boot).
  await page.goto(BASE + "/search", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("pf.restoration", JSON.stringify({ mode: "light" })));
  await page.getByPlaceholder(/Artist, album/).fill("georgeblood");
  await page.getByRole("button", { name: "Search" }).click();
  const card = page.locator("a[href*='/album']").first();
  try {
    await card.waitFor({ timeout: 30_000 });
  } catch {
    // archive.org can be slow: one honest reload-and-retry
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByPlaceholder(/Artist, album/).fill("georgeblood");
    await page.getByRole("button", { name: "Search" }).click();
    await card.waitFor({ timeout: 60_000 });
  }
  await card.locator("button[aria-label^='Play']").click();

  // 2) Audio playing despite (and with) the restoration graph.
  await page.waitForFunction(
    () => { const a = (() => { const isl = document.querySelector("iframe")?.contentDocument?.querySelector("audio"); return isl ?? document.querySelector("audio"); })(); return a && !a.paused && a.currentTime > 0; },
    { timeout: 45_000 }
  );
  const t1 = await page.evaluate(() => { const a = document.querySelector("iframe")?.contentDocument?.querySelector("audio") ?? document.querySelector("audio"); return a.currentTime; });
  check("audio plays with restoration graph active", t1 > 0);

  // 3) Island exposes the restoration state (contract for tests and UI).
  await page.waitForFunction(() => !!window.__pharosRestoration, { timeout: 10_000 });
  const state = await page.evaluate(() => window.__pharosRestoration);
  check("island exposes __pharosRestoration", state && state.mode === "light" && state.active === true);

  // 4) Time keeps advancing 2.5s later (graph did not stall playback).
  await page.waitForTimeout(2500);
  const t2 = await page.evaluate(() => { const a = document.querySelector("iframe")?.contentDocument?.querySelector("audio") ?? document.querySelector("audio"); return a.currentTime; });
  check("audio advances with worklet in the graph", t2 > t1);

  // 5) Off mode tears down (flag goes inactive).
  await page.evaluate(() => { localStorage.setItem("pf.restoration", JSON.stringify({ mode: "off" })); window.dispatchEvent(new Event("pharos:restoration")); });
  await page.waitForTimeout(1500);
  const off = await page.evaluate(() => window.__pharosRestoration);
  check("off mode deactivates the graph", off && off.mode === "off" && off.active === false);

  // 6) AI mode reports honest unavailability (no model file ships).
  await page.evaluate(() => { localStorage.setItem("pf.restoration", JSON.stringify({ mode: "ai" })); window.dispatchEvent(new Event("pharos:restoration")); });
  await page.waitForTimeout(3000);
  const ai = await page.evaluate(() => window.__pharosRestoration);
  check("ai mode honest-unavailable without model", ai && ai.mode === "ai" && ai.active === false && /unavailable/i.test(ai.status ?? ""));

  // 7) No page errors introduced by the feature.
  check("no page errors", consoleErrors.length === 0);
} catch (e) {
  check("journey crashed", false);
  results[results.length - 1].err = String(e.message ?? e).slice(0, 140);
} finally {
  await browser.close();
}

console.log("\n═══ Restoration E2E ═══");
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : " — " + (r.err ?? "assertion failed")}`);
  if (!r.ok) failed++;
}
console.log(`═══ ${results.length - failed}/${results.length} OK ═══`);
process.exit(failed ? 1 : 0);
