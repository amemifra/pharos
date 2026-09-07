/**
 * Central asset-path helper (defect P0#1 — HANDOFF-REVIEW).
 *
 * The app is a static export deployed under GitHub Pages basePath /pharos
 * (NEXT_PUBLIC_BASE_PATH, set by .github/workflows/deploy.yml and inlined
 * by Next into client bundles at build time). Raw absolute paths like
 * "/player" or "/worklets/x.js" 404 in production: ALWAYS route public
 * assets through assetPath().
 *
 * Contract: pure; idempotent under the root build (basePath "" → p unchanged).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a public path with the configured basePath. */
export function assetPath(p) {
  return BASE_PATH + p;
}
