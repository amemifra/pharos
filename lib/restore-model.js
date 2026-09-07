/**
 * AI denoise model loader — the "ai" restoration path.
 *
 * CONTRACT (honest by design): this module reports {available:false} until a
 * real denoising model file exists at public/models/denoise.onnx. The UI must
 * never claim "AI restored" without an actual wired model.
 *
 * TO WIRE A MODEL (documented procedure):
 *   1. Pick an open-license audio-denoise model compiled to ONNX. Proven
 *      candidates: RNNoise (BSD, ~85 KB, 22 kHz mono, designed for realtime)
 *      or DeepFilterNet-small (MIT/Apache, larger, better quality).
 *      RNNoise ONNX ports exist in community repos — verify the export
 *      signature (input: [1, T, 42] Bark features, or use the raw-waveform
 *      variant) before committing.
 *   2. Place it at public/models/denoise.onnx (RNNoise: ~85 KB; DFN-small: ~2-6 MB).
 *   3. npm i onnxruntime-web (pin the version) — NOT installed by default:
 *      the dependency is only needed when a model actually ships, keeping the
 *      bundle lean for the default "light" path.
 *   4. The inference runs inside an AudioWorklet-adjacent flow: ORT.wasm with
 *      wasmPaths pointing to the copied dist assets; windows of 20-60 ms.
 *
 * Adoption rule (lib/bench.js benchRestoration): AI is default-suggestible
 * only when realtime factor ≥ 1 on mid-tier hardware.
 */

import { assetPath } from "./basepath.js";

const MODEL_URL = assetPath("/models/denoise.onnx");

/** @type {{available: boolean, checked: boolean}} */
let cache = { available: false, checked: false };

/**
 * Check model availability (HEAD request, cached after the first check).
 * @returns {Promise<{available: boolean}>}
 */
export async function checkModel() {
  if (cache.checked) return { available: cache.available };
  try {
    const res = await fetch(MODEL_URL, { method: "HEAD" });
    cache = { available: res.ok, checked: true };
  } catch {
    cache = { available: false, checked: true };
  }
  return { available: cache.available };
}

/**
 * Load the inference session (lazy: called only when the user picks "ai"
 * AND the model exists). Measures load time for lib/bench.js.
 * @returns {Promise<{session: any, tLoadMs: number}|{error: string}>}
 */
export async function loadModel() {
  const { available } = await checkModel();
  if (!available) return { error: "model unavailable — place public/models/denoise.onnx (see lib/restore-model.js)" };
  try {
    const ort = await import("onnxruntime-web"); // lazy: bundle cost only when used
    const t0 = performance.now();
    const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
    return { session, tLoadMs: performance.now() - t0 };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}
