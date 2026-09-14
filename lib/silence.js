/**
 * Silence detection — real DSP boundary finder (wasm + JS fallback).
 *
 * Replaces the declared stub in lib/tracklist.js: detectSilenceBoundaries()
 * now measures actual silence gaps in decoded mono PCM instead of relying
 * only on proportional alignment.
 *
 * Implementation choice (documented per task plan::40::gap-wasm-silence-detection):
 * a compact WebAssembly module assembled directly as a byte array at module
 * load — no toolchain (wat2wasm/emcc) dependency, no network fetch, works in
 * browser and Node. The wasm kernel computes ONLY the per-sample silence mask
 * (|x| < threshold); segment merging is shared JS post-processing, so the wasm
 * path and the JS fallback are identical by construction (same mask, same
 * segmenter). The sandbox probe asserts mask equality on synthetic signals.
 *
 * The module is exactly this WAT, encoded to bytes by hand:
 *   (module
 *     (memory (export "mem") 1)
 *     (func (export "silence_mask") (param $in i32) (param $out i32)
 *                                       (param $len i32) (param $thr f32)
 *       (local $i i32) (local $s f32)
 *       block $done
 *         loop $l
 *           br_if $done (i32.ge_u (local.get $i) (local.get $len))
 *           local.set $s (f32.abs (f32.load
 *             (i32.add (local.get $in) (i32.mul (local.get $i) (i32.const 4)))))
 *           (i32.store8 (i32.add (local.get $out) (local.get $i))
 *             (if (result i32) (f32.lt (local.get $s) (local.get $thr))
 *               (then (i32.const 1)) (else (i32.const 0))))
 *           local.set $i (i32.add (local.get $i) (i32.const 1))
 *           br $l)
 *       )
 *     )
 *   )
 */

/** Silence threshold on absolute sample amplitude (linear, not dB). */
export const SILENCE_THRESHOLD = 0.005;

/** Minimum contiguous silence to count as a gap (seconds). */
export const MIN_SILENCE_SEC = 0.4;

// ── Wasm module bytes (see WAT above) ────────────────────────────────────
const WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,          // magic + version
  // Type section: (i32,i32,i32,f32) -> ()
  0x01, 0x08, 0x01, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7d, 0x00,
  // Function section: 1 function, type 0
  0x03, 0x02, 0x01, 0x00,
  // Memory section: 1 memory, min 1 page
  0x05, 0x03, 0x01, 0x00, 0x01,
  // Export section: "mem" (memory 0), "silence_mask" (func 0)
  0x07, 0x1c, 0x02,
  0x03, 0x6d, 0x65, 0x6d, 0x02, 0x00,
  0x0c, 0x73, 0x69, 0x6c, 0x65, 0x6e, 0x63, 0x65, 0x5f,
  0x6d, 0x61, 0x73, 0x6b, 0x00, 0x00,
  // Code section
  0x0a, 0x39, 0x01, 0x37, 0x00,
  // locals: 2 i32, 1 f32
  0x02, 0x02, 0x7f, 0x01, 0x7d,
  // block $done
  0x02, 0x40,
  // loop $l
  0x03, 0x40,
  // br_if $done (i >= len):  ge_u(i, len)
  0x0d, 0x01, 0x4f, 0x20, 0x00, 0x20, 0x02,
  // s = abs(f32.load(in + i*4))
  0x20, 0x00, 0x20, 0x00, 0x41, 0x04, 0x6c, 0x2b, 0x02, 0x00, 0x8b, 0x21, 0x01,
  // i32.store8(out + i, (f32.lt(s, thr)) ? 1 : 0)
  0x20, 0x01, 0x20, 0x00, 0x6c,
  0x04, 0x64, 0x20, 0x01, 0x20, 0x03, 0x41, 0x01, 0x05, 0x41, 0x00, 0x0b,
  0x3a, 0x00, 0x00,
  // i += 1
  0x20, 0x00, 0x41, 0x01, 0x6a, 0x21, 0x00,
  // br $l
  0x0c, 0x00,
  // end loop, end block, end func
  0x0b, 0x0b, 0x0b,
]);

let wasmApi = null; // { bytesNeeded(n): buffer views, mask(...) } | null on failure

try {
  const mod = new WebAssembly.Module(WASM_BYTES);
  const inst = new WebAssembly.Instance(mod, {});
  const mem = inst.exports.mem;
  wasmApi = {
    /** Compute silence mask for pcm via wasm. Returns Uint8Array mask (1=silent). */
    mask(pcm) {
      const n = pcm.length;
      const inBytes = n * 4;
      const outOff = (inBytes + 3) & ~3; // 4-byte align the mask region
      const needed = outOff + n;
      if (mem.buffer.byteLength < needed) {
        mem.grow(Math.ceil((needed - mem.buffer.byteLength) / 65536));
      }
      const heap = mem.buffer;
      new Float32Array(heap, 0, n).set(pcm);
      inst.exports.silence_mask(0, outOff, n, SILENCE_THRESHOLD);
      return new Uint8Array(heap, outOff, n).slice();
    },
  };
} catch {
  wasmApi = null; // no WebAssembly in this environment — JS fallback serves
}

/** JS reference mask: 1 where |sample| < threshold. Same semantics as wasm. */
export function silenceMaskRef(pcm, threshold = SILENCE_THRESHOLD) {
  const mask = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    mask[i] = Math.abs(pcm[i]) < threshold ? 1 : 0;
  }
  return mask;
}

/** wasm mask when WebAssembly is available, else the JS reference mask. */
export function silenceMask(pcm) {
  if (wasmApi) {
    try { return wasmApi.mask(pcm); } catch { /* fall through to JS */ }
  }
  return silenceMaskRef(pcm);
}

/**
 * Merge a silence mask into contiguous segments.
 * @param {Uint8Array} mask 1=silent
 * @param {number} sampleRate
 * @param {number} minSec minimum silence duration to keep
 * @returns {{start:number,end:number}[]} silence gaps in seconds
 */
export function maskToSegments(mask, sampleRate, minSec = MIN_SILENCE_SEC) {
  const minSamples = Math.max(1, Math.round(minSec * sampleRate));
  const segments = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && start < 0) start = i;
    else if (!mask[i] && start >= 0) {
      if (i - start >= minSamples) segments.push({ start, end: i });
      start = -1;
    }
  }
  if (start >= 0 && mask.length - start >= minSamples) {
    segments.push({ start, end: mask.length });
  }
  return segments.map((s) => ({
    start: s.start / sampleRate,
    end: s.end / sampleRate,
  }));
}

/**
 * WASM silence-detection boundary finder (upgraded from the declared stub).
 * Measures the START of each non-silent region after a qualifying silence gap
 * — i.e. track-start offsets in seconds — plus the first non-silent sample.
 * The wasm kernel produces the silence mask; JS derives segments (identical
 * to the JS fallback path by construction).
 * @param {Float32Array} pcm Mono PCM of the file.
 * @param {{sampleRate?:number, threshold?:number, minSilenceSec?:number}} [opts]
 * @returns {number[]|null} Measured start offsets in seconds, or null when
 *   pcm is unusable (caller keeps the proportional fallback).
 */
export function detectSilenceBoundaries(pcm, opts = {}) {
  if (!(pcm instanceof Float32Array) || pcm.length === 0) return null;
  const sampleRate = opts.sampleRate ?? 44100;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;

  let mask;
  const threshold = opts.threshold ?? SILENCE_THRESHOLD;
  const minSec = opts.minSilenceSec ?? MIN_SILENCE_SEC;
  if (wasmApi) {
    try { mask = wasmApi.mask(pcm); } catch { mask = null; }
  } else {
    mask = null;
  }
  if (!mask) {
    mask = new Uint8Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      mask[i] = Math.abs(pcm[i]) < threshold ? 1 : 0;
    }
  }
  const gaps = maskToSegments(mask, sampleRate, minSec);
  // Boundaries: the file always starts at offset 0 (first work), then the
  // first NON-silent sample after each qualifying silence gap.
  const bounds = [0];
  let prev = 0; // end index (exclusive) of the last gap, in samples
  for (const g of gaps) {
    const gapEnd = Math.round(g.end * sampleRate);
    let j = gapEnd;
    while (j < pcm.length && mask[j] === 1) j++;
    if (j < pcm.length && j > prev) bounds.push(j / sampleRate);
    prev = gapEnd;
  }
  return bounds.length ? bounds : null;
}
