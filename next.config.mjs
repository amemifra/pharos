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
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const config = {
  output: "export",
  images: { unoptimized: true }, // plain <img> everywhere; next/image unused
  trailingSlash: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default config;
