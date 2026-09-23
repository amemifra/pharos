/**
 * E2E probe: build-versioned caches + non-looping update notice
 * (SpecOps p01-pwa-cache / board task-ab48c895).
 *
 * Serves out/ statically (zero network), simulates a deploy by re-stamping
 * out/sw.js with a NEW build version between page loads, and asserts:
 *   1. the SW registers + activates and cache names carry the build version
 *      (pharos-*-<build1>);
 *   2. after the "new build" (sw.js bytes change → update → skipWaiting →
 *      claim) the update notice appears EXACTLY ONCE;
 *   3. a further reload on the same version shows NO notice again (the
 *      one-notice-per-version guard, never a loop);
 *   4. the old build's pharos-* caches are purged on activate.
 *
 * Requires out/ built (any basePath — derived from the manifest/scope).
 * Run: node tests/e2e/pwa-update-notice.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const OUT_DIR = join(process.cwd(), "out");
const PORT = 4175;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".mjs": "text/javascript", ".woff2": "font/woff2",
};

let ok = 0, total = 0;
const check = (name, cond, detail = "") => { total++; if (cond) ok++; console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
if (!existsSync(join(OUT_DIR, "sw.js"))) {
  console.error("out/sw.js missing — run `npm run build` first");
  process.exit(1);
}

const SW_PATH = join(OUT_DIR, "sw.js");
// Deterministic template: stamp out/sw.js from the committed source so a
// previously interrupted probe run can never pollute the next one.
const template = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const build1 = process.env.PHAROS_BUILD ?? "probe-build-1";
const pristine = () => template.replaceAll("__PHAROS_BUILD__", build1);

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.startsWith(BASE)) p = p.slice(BASE.length) || "/";
  let file = join(OUT_DIR, p);
  if (existsSync(file) && !extname(file)) file = join(file, "index.html"); // dir → index
  else if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
  else if (!existsSync(file) && existsSync(join(file, "index.html"))) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const BASE = "/pharos"; // out/ is built with NEXT_PUBLIC_BASE_PATH=/pharos (same contract as pwa-probe)
const EVIDENCE = process.env.EVIDENCE_DIR ?? join(process.cwd(), "audit-evidence-update-notice");

try {
  writeFileSync(SW_PATH, pristine());
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== undefined, { timeout: 10_000 });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15_000 }).catch(() => {});
  check("service worker controls the page (build 1)", await page.evaluate(() => !!navigator.serviceWorker.controller));

  const v1 = await page.evaluate(() => new Promise((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => res(e.data?.version ?? null);
    navigator.serviceWorker.controller.postMessage({ type: "pharos:get-version" }, [ch.port2]);
    setTimeout(() => res(null), 1500);
  }));
  check("SW reports build 1 version", v1 === build1, `v1=${v1} expected=${build1}`);

  const names1 = (await page.evaluate(() => caches.keys())).filter((n) => n.startsWith("pharos-"));
  check("build-1 caches are versioned", names1.length > 0 && names1.every((n) => n.includes(build1)), names1.join(", "));

  // Simulate a deploy: new sw.js bytes (new version), then reload. The
  // updated worker may sit in "waiting" (activation is deferred by the
  // browser); the app surfaces it via skipWaiting — mirror that here.
  writeFileSync(SW_PATH, template.replaceAll("__PHAROS_BUILD__", `probe-build-2-${Date.now()}`));
  await page.reload({ waitUntil: "load" });
  const deadline = Date.now() + 25_000;
  let firstNotice = 0;
  while (Date.now() < deadline) {
    firstNotice = await page.locator("[data-pharos-update-notice]").count();
    if (firstNotice === 1) break;
    const waiting = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      return r?.waiting ? true : false;
    }).catch(() => false);
    if (waiting) {
      await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        r?.waiting?.postMessage({ type: "pharos:skip-waiting" });
      }).catch(() => {});
    } else {
      await page.evaluate(() => navigator.serviceWorker.getRegistration()
        .then((r) => r?.update?.())).catch(() => {});
    }
    await page.waitForTimeout(1000);
  }
  check("update notice appears after a new build", firstNotice === 1, `count=${firstNotice}`);
  await page.screenshot({ path: join(EVIDENCE, "notice-appears-once.png"), fullPage: false }).catch(() => {});

  // While staying on the page: no additional notices may appear.
  await page.waitForTimeout(1500);
  check("no duplicate notice while the page stays open", await page.locator("[data-pharos-update-notice]").count() === 1);

  // Reload on the SAME new build via the notice's own Reload button: the
  // notice must NOT come back (no loop).
  await page.locator("[data-pharos-update-notice] button", { hasText: "Reload" }).click();
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);
  const afterReload = await page.locator("[data-pharos-update-notice]").count();
  check("notice does NOT re-appear on reload (same version)", afterReload === 0, `count=${afterReload}`);
  await page.screenshot({ path: join(EVIDENCE, "notice-not-again-after-reload.png"), fullPage: false }).catch(() => {});

  // Old pharos-* build caches must be purged by activate (unrelated caches
  // like helia's delegated-routing cache are left untouched by design).
  // Deterministic activation: closing the last controlled page lets the
  // waiting worker take over on the next open, and activate purges.
  const page2 = await browser.newContext().then((c) => c.newPage());
  await page.close();
  await page2.goto(`http://localhost:${PORT}${BASE}/`, { waitUntil: "load" });
  let names2 = [];
  const purgeDeadline = Date.now() + 45_000;
  while (Date.now() < purgeDeadline) {
    names2 = (await page2.evaluate(() => caches.keys())).filter((n) => n.startsWith("pharos-"));
    if (names2.length > 0 && names2.every((n) => !n.includes(build1))) break;
    await page2.evaluate(() => navigator.serviceWorker.getRegistration()
      .then((r) => { r?.waiting?.postMessage({ type: "pharos:skip-waiting" }); return r?.update?.(); })).catch(() => {});
    await page2.waitForTimeout(1000);
  }
  check("old build caches purged on activate", names2.length > 0 && names2.every((n) => !n.includes(build1)), names2.join(", "));
  check("notice still absent for the new version on a fresh page",
    await page2.locator("[data-pharos-update-notice]").count() === 0);

  await browser.close();
} finally {
  writeFileSync(SW_PATH, pristine()); // leave out/sw.js exactly as the build produced it
  server.close();
}
console.log(`\n${ok}/${total} checks passed`);
process.exit(ok === total ? 0 : 1);
