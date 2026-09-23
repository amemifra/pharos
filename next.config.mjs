/**
 * Next.js configuration — static export for GitHub Pages.
 *
 * output: "export" writes a fully static ./out bundle (no server): every
 * route is prerendered as index.html and all data is fetched client-side at
 * runtime (the whole app is browser-only by design — zero servers).
 *
 * basePath/assetPrefix come from NEXT_PUBLIC_BASE_PATH so the same build
 * works at the repo root locally (empty) and under /<repo>/ on Pages.
 */
import { execSync } from "node:child_process";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Build version (git short SHA) inlined into the client bundle: the page
 * compares it against the service worker's reported build (lib/notify.js
 * verifyBuildVersion) to show the non-looping update notice when a new
 * deploy has landed. Must match scripts/version-sw.mjs.
 */
let pharosBuild = process.env.NEXT_PUBLIC_PHAROS_BUILD ?? "";
if (!pharosBuild) {
  try { pharosBuild = execSync("git rev-parse --short HEAD").toString().trim(); } catch {}
}

const config = {
  env: { NEXT_PUBLIC_PHAROS_BUILD: pharosBuild || "dev" },
  output: "export",
  // Identifiable build: commit + timestamp land in out/BUILD_ID and in the
  // client bundle identity, so the deployed artifact can be matched against
  // out/version.json written by scripts/version-manifest.mjs (postbuild).
  generateBuildId: async () => {
    const { execFileSync } = await import("node:child_process");
    let commit = null;
    try {
      commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
        encoding: "utf8",
      }).trim();
    } catch {}
    return commit ? `${commit}-${Date.now()}` : Date.now().toString();
  },
  images: { unoptimized: true }, // plain <img> everywhere; next/image unused
  trailingSlash: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default config;
