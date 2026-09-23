/**
 * Build step (postbuild): stamp the build version into out/sw.js.
 *
 * The committed public/sw.js carries the __PHAROS_BUILD__ placeholder so the
 * source stays clean; after `next build` we rewrite the EXPORTED copy in
 * out/ with the build version (PHAROS_BUILD env, else git short SHA, else a
 * timestamp). The service worker derives every cache name from this version
 * and the page's one-notice-per-version update guard keys on it, so a new
 * deploy must produce a new value.
 *
 * Idempotent + zero-failure: a missing out/sw.js (no build) exits 0 quietly.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
// next.config.mjs computes the SAME fallback chain for the inlined client
// version — keep the two in lockstep.

const TARGET = "out/sw.js";
if (!existsSync(TARGET)) process.exit(0);

let version = process.env.PHAROS_BUILD ?? "";
if (!version) {
  try { version = execSync("git rev-parse --short HEAD").toString().trim(); } catch {}
}
if (!version) version = `dev-${Date.now()}`;

const src = readFileSync(TARGET, "utf8");
if (!src.includes("__PHAROS_BUILD__")) {
  console.log("[version-sw] out/sw.js already stamped:", src.match(/const BUILD = "([^"]*)"/)?.[1] ?? "?");
  process.exit(0);
}
writeFileSync(TARGET, src.replaceAll("__PHAROS_BUILD__", version));
console.log("[version-sw] out/sw.js stamped with build version:", version);
