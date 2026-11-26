/**
 * Optional AI restoration. Ship an open-license raw-waveform ONNX denoiser at
 * public/models/denoise.onnx: one float32 input/output, [T], [1,T] or [1,1,T],
 * 128..4096 samples (dynamic T uses 1024), at the AudioContext sample rate.
 * Feature-domain/recurrent models need an explicit adapter and are rejected.
 * No model ships by default. This module never claims successful restoration
 * just because a file exists. ORT's WASM proxy runs inference in a Web Worker;
 * the AudioWorklet only exchanges bounded PCM frames and renders samples.
 */
import { assetPath } from "./basepath.js";

const MODEL_URL = assetPath("/models/denoise.onnx");
let cache = { available: false, checked: false };

/** Cached HEAD availability check; a failed load marks the model unavailable. */
export async function checkModel() {
  if (!cache.checked) {
    try {
      const res = await fetch(MODEL_URL, { method: "HEAD", signal: AbortSignal.timeout(15000) });
      cache = { available: res.ok, checked: true };
    } catch { cache = { available: false, checked: true }; }
  }
  return { available: cache.available };
}

/**
 * Lazy load; existing callers still receive {session,tLoadMs} or {error}.
 * connect(port,onFallback?) binds a restoration worklet and returns a disposer.
 */
export async function loadModel() {
  if (!(await checkModel()).available) return { error: "model unavailable — place public/models/denoise.onnx (see lib/restore-model.js)" };
  let session;
  try {
    const ort = await import("onnxruntime-web/wasm");
    // No crossOriginIsolated/SharedArrayBuffer requirement on static Pages.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = true;
    ort.env.wasm.wasmPaths = new URL(assetPath("/ort/"), location.href).href;
    const t0 = performance.now();
    session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
    const meta = session.inputMetadata[0];
    const dims = meta?.shape;
    if (session.inputNames.length !== 1 || session.outputNames.length !== 1 ||
        meta?.type !== "float32" || !dims?.length || dims.length > 3 ||
        dims.slice(0, -1).some(d => d !== 1)) throw Error("unsupported denoiser: expected mono raw waveform");
    const last = dims[dims.length - 1];
    const frameSize = typeof last === "number" ? last : 1024;
    if (!Number.isInteger(frameSize) || frameSize < 128 || frameSize > 4096) throw Error("unsupported denoiser frame size");
    const shape = [...dims.slice(0, -1), frameSize];
    const release = () => { try { Promise.resolve(session.release()).catch(() => {}); } catch {} };
    return { session, tLoadMs: performance.now() - t0,
      connect(port, onFallback = () => {}) {
        let stopped = false;
        let running = false;
        const queue = [];
        const stop = () => {
          if (stopped) return;
          stopped = true;
          queue.length = 0;
          try { port.postMessage({ type: "ai-off" }); port.onmessage = null; } catch {}
          release();
        };
        const fail = () => { stop(); try { onFallback(); } catch {} };
        const drain = async () => {
          if (running || stopped) return;
          running = true;
          try {
            while (queue.length && !stopped) {
              const { id, channels } = queue.shift();
              const clean = [];
              for (const samples of channels) {
                const result = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", samples, shape) });
                const data = result[session.outputNames[0]]?.data;
                if (!(data instanceof Float32Array) || data.length !== frameSize || !data.every(Number.isFinite)) throw Error("invalid denoiser output");
                clean.push(new Float32Array(data));
              }
              if (!stopped) port.postMessage({ type: "result", id, channels: clean }, clean.map(c => c.buffer));
            }
          } catch { fail(); } finally { running = false; }
        };
        try {
          port.onmessage = ({ data }) => {
            if (stopped) return;
            if (data?.type === "fallback") { fail(); return; }
            if (data?.type !== "frame") return;
            if (queue.length >= 2 || !Array.isArray(data.channels) || !data.channels.length || data.channels.length > 2 ||
                data.channels.some(c => !(c instanceof Float32Array) || c.length !== frameSize)) { fail(); return; }
            queue.push(data);
            void drain();
          };
          port.postMessage({ type: "ai", frameSize });
        } catch { fail(); }
        return stop;
      },
    };
  } catch (e) {
    cache = { available: false, checked: true };
    try { await session?.release(); } catch {}
    return { error: String(e?.message ?? e) };
  }
}
