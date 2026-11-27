#!/usr/bin/env node
/**
 * Fetch the default open-license ONNX denoiser for lib/restore-model.js.
 *
 * Model:    GTCRN (gtcrn_simple.onnx) — a tiny (~66k parameter) speech
 *           enhancement network, exported to ONNX with a single float32
 *           input and a single float32 output over a mono raw waveform.
 * Source:   https://raw.githubusercontent.com/Xiaobin-Rong/gtcrn/main/models/gtcrn_simple.onnx
 *           (pinned upstream export of the gtcrn_simple checkpoint)
 * License:  MIT (https://github.com/Xiaobin-Rong/gtcrn/blob/main/LICENSE)
 *
 * Contract (from lib/restore-model.js): exactly one float32 input and one
 * float32 output, mono raw waveform with shape [T], [1,T] or [1,1,T], frame
 * size 128..4096 samples; a dynamic last dimension is treated as 1024.
 * The downloaded file is validated against that contract with
 * onnxruntime-web (wasm proxy disabled) before it is installed; a model that
 * fails validation is never written to public/models/denoise.onnx.
 *
 * Idempotent: if a valid model is already in place, nothing is downloaded.
 * Exits non-zero with a clear message if the download or validation fails.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_NAME = "gtcrn_simple.onnx (GTCRN)";
const MODEL_URL =
  "https://raw.githubusercontent.com/Xiaobin-Rong/gtcrn/main/models/gtcrn_simple.onnx";
const MODEL_LICENSE = "MIT";
const TARGET = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models", "denoise.onnx");
const FRAME_MIN = 128;
const FRAME_MAX = 4096;
const DYNAMIC_FRAME = 1024;

const require = createRequire(import.meta.url);
const fail = (msg) => {
  console.error(`fetch-model: ${msg}`);
  process.exit(1);
};

/** Validate an ONNX file against the lib/restore-model.js contract. */
async function validate(path) {
  const ortDir = dirname(require.resolve("onnxruntime-web/package.json"));
  const ort = await import(join(ortDir, "wasm", "ort.wasm.min.js").replace(/\\/g, "/"));
  ort.env.wasm.proxy = false; // no worker in Node
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = join(ortDir, "dist") + "/";
  const session = await ort.InferenceSession.create(path, { executionProviders: ["wasm"] });
  try {
    if (session.inputNames.length !== 1 || session.outputNames.length !== 1) {
      throw new Error(`expected 1 input and 1 output, got ${session.inputNames.length}/${session.outputNames.length}`);
    }
    const meta = session.inputMetadata[0];
    const outMeta = session.outputMetadata[0];
    if (meta?.type !== "float32") throw new Error(`input type is ${meta?.type}, expected float32`);
    if (outMeta?.type !== "float32") throw new Error(`output type is ${outMeta?.type}, expected float32`);
    const dims = meta?.shape;
    if (!dims?.length || dims.length > 3) throw new Error(`input rank ${dims?.length} not in 1..3`);
    if (dims.slice(0, -1).some((d) => d !== 1)) throw new Error("input is not a mono raw waveform ([T], [1,T] or [1,1,T])");
    const last = dims[dims.length - 1];
    const frameSize = typeof last === "number" ? last : DYNAMIC_FRAME;
    if (!Number.isInteger(frameSize) || frameSize < FRAME_MIN || frameSize > FRAME_MAX) {
      throw new Error(`frame size ${frameSize} outside ${FRAME_MIN}..${FRAME_MAX}`);
    }
    // Smoke test: run one frame and check the output is a finite float32 waveform.
    const shape = [...dims.slice(0, -1), frameSize];
    const input = new ort.Tensor("float32", new Float32Array(frameSize), shape);
    const result = await session.run({ [session.inputNames[0]]: input });
    const out = result[session.outputNames[0]]?.data;
    if (!(out instanceof Float32Array) || out.length !== frameSize || !Array.prototype.every.call(out, Number.isFinite)) {
      throw new Error("output is not a finite float32 waveform of the same frame size");
    }
    return { frameSize, dynamic: typeof last !== "number" };
  } finally {
    try { await session.release(); } catch {}
  }
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  mkdirSync(dirname(TARGET), { recursive: true });

  if (existsSync(TARGET)) {
    try {
      const info = await validate(TARGET);
      console.log(`fetch-model: valid model already in place (${MODEL_NAME}, frame ${info.frameSize}${info.dynamic ? ", dynamic" : ""}); skipping download`);
      return;
    } catch (e) {
      console.log(`fetch-model: existing model invalid (${String(e?.message ?? e)}); re-downloading`);
    }
  }

  let buf;
  try {
    buf = await download(MODEL_URL);
  } catch (e) {
    fail(`download failed: ${String(e?.message ?? e)} (source: ${MODEL_URL})`);
  }
  if (!buf || buf.length < 1000) fail(`downloaded file is too small (${buf?.length ?? 0} bytes) to be a model`);

  const tmp = join(mkdtempSync(join(tmpdir(), "pharos-model-")), "denoise.onnx");
  writeFileSync(tmp, buf);
  try {
    const info = await validate(tmp);
    writeFileSync(TARGET, buf);
    console.log(`fetch-model: installed ${MODEL_NAME} (${buf.length} bytes, frame ${info.frameSize}${info.dynamic ? ", dynamic" : ""}) to public/models/denoise.onnx [${MODEL_LICENSE}]`);
  } catch (e) {
    fail(`validation failed for ${MODEL_NAME}: ${String(e?.message ?? e)} — model NOT installed`);
  } finally {
    rmSync(dirname(tmp), { recursive: true, force: true });
  }
}

main().catch((e) => fail(String(e?.message ?? e)));
