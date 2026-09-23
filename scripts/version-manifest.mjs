// Emits out/version.json after the static export so the deployed Pages
// bundle carries an identifiable build: version/commit + builtAt.
//
// The commit comes from git (actions/checkout@v4 does a full fetch of the
// pushed ref, so HEAD is the deployed commit); the npm version and the build
// timestamp round it out. Values are read at build time only — the manifest is
// static, matching the static export by construction.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return null; // build without git metadata (e.g. tarball) — manifest stays honest
  }
}

const outDir = path.join(process.cwd(), "out");
mkdirSync(outDir, { recursive: true });

const manifest = {
  name: require("../package.json").name,
  version,
  commit: git("rev-parse", "HEAD"),
  builtAt: new Date().toISOString(),
  base: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
};

writeFileSync(
  path.join(outDir, "version.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log("version manifest:", JSON.stringify(manifest));
