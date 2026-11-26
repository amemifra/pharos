import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("onnxruntime-web/wasm"));
const target = new URL("../public/ort/", import.meta.url).pathname;
mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) {
  if (/^ort-wasm-simd-threaded(?:\.(?:asyncify|jsep|jspi))?\.(?:mjs|wasm)$/.test(name)) {
    copyFileSync(join(source, name), join(target, name));
  }
}
