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
import { execFileSync, execSync } from "node:child_process";

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

// Full immutable source identity for the public runtime telemetry bootstrap.
let sourceCommit = process.env.NEXT_PUBLIC_PASSO_SOURCE_COMMIT || "";
let gitCommit = "";
try { gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
if (sourceCommit && !/^[0-9a-f]{40}$/i.test(sourceCommit)) throw new Error("Invalid telemetry source commit");
if (sourceCommit && gitCommit && sourceCommit !== gitCommit) throw new Error("Telemetry source commit differs from build source");
sourceCommit ||= gitCommit;
if (process.env.NEXT_PUBLIC_PASSO_TELEMETRY_URL) {
  const collector = new URL(process.env.NEXT_PUBLIC_PASSO_TELEMETRY_URL);
  if (collector.protocol !== "https:" || collector.username || collector.password || collector.search || collector.hash || !["/", "/vibe/runtime/config"].includes(collector.pathname)) throw new Error("Invalid public telemetry collector URL");
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) throw new Error("Telemetry requires the full build source commit");
}

const config = {
  env: { NEXT_PUBLIC_PHAROS_BUILD: pharosBuild || "dev", NEXT_PUBLIC_PASSO_SOURCE_COMMIT: sourceCommit },
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
