/**
 * Track identification via acoustic fingerprinting — community standard.
 *
 * Pipeline: audio (MediaElement) → chromaprint WASM (fingerprint, same as
 * fpcalc) → AcoustID lookup (public service that cross-references fingerprints
 * with MusicBrainz) → canonical metadata { artist, title, MBID }.
 *
 * Why: archive.org's textual metadata sometimes isn't enough ("Track 3",
 * cryptic filenames, wrong attributions). The acoustic fingerprint is an
 * OBJECTIVE measure: the same recording identifies the same music, wherever
 * it was uploaded. AcoustID/MusicBrainz are the reference of the open music
 * community, not our opinion.
 *
 * Costs and low-end discipline:
 *  - the WASM module is downloaded ONLY when the user requests identification;
 *  - decoding: mono 11025 Hz from the central 120s window (like fpcalc):
 *    ~2.6 MB RAM;
 *  - every identification is cached locally (localStorage) and can be shared
 *    on OrbitDB (lib/collab.js): paid once, useful to the whole network.
 */

/** URL of the chromaprint WASM build (configurable; default jsDelivr). */
const CHROMAPRINT_WASM_URL = "https://cdn.jsdelivr.net/npm/chromaprint-wasm@1/chromaprint.wasm";
/** AcoustID requires a free application client key. */
const ACOUSTID_KEY = process?.env?.ACOUSTID_KEY ?? ""; // set via env/build

/** @type {any} */ let wasmModule = null;

/**
 * Loads (lazily, once) the fingerprint WASM decoder.
 * Contract: dynamic import → zero bytes in the initial bundle; the decision
 * to pay the cost belongs to the user's action, not page load.
 * @returns {Promise<any>} The chromaprint WASM module.
 */
async function loadWasm() {
  if (wasmModule) return wasmModule;
  wasmModule = await import(/* webpackIgnore: true */ CHROMAPRINT_WASM_URL.replace(/\.wasm$/, ".js"));
  return wasmModule;
}

/**
 * Computes the AcoustID fingerprint of an audio file.
 * Downloads only the central window (120s) via HTTP Range: on slow networks
 * this is the difference between feasible and not.
 * Contract: works with any Range-capable URL (archive.org files all are);
 * falls back to a full fetch when size is unknown; closes the AudioContext.
 * @param {string} audioUrl Streamable file URL.
 * @returns {Promise<{fingerprint: string, duration: number}>}
 */
export async function fingerprintTrack(audioUrl) {
  const chromaprint = await loadWasm();
  // 1) download the central window (Range request — archive.org files support ranges)
  const head = await fetch(audioUrl, { method: "HEAD" });
  const size = Number(head.headers.get("content-length") ?? 0);
  const WINDOW = 120; // central seconds
  // Rough bytes/sec estimate: 128kbps mp3 ≈ 16 KB/s (safe overestimate;
  // FLAC is denser — download from file start when size is unknown).
  const bytesPerSec = 24 * 1024;
  const start = size > bytesPerSec * 180 ? Math.floor((size - bytesPerSec * WINDOW) / 2) : 0;
  const end = Math.min(start + bytesPerSec * WINDOW, size - 1) || "";
  const res = await fetch(audioUrl, start || size ? { headers: { Range: `bytes=${start}-${end}` } } : {});
  const buf = new Uint8Array(await res.arrayBuffer());

  // 2) decode + chromaprint via WASM (same algorithm as fpcalc)
  const ctx = new AudioContext({ sampleRate: 11025 });
  const decoded = await ctx.decodeAudioData(buf.buffer);
  const mono = decoded.getChannelData(0);
  const { fingerprint, duration } = chromaprint.fingerprint(mono, decoded.sampleRate);
  ctx.close();
  return { fingerprint, duration: Math.round(duration) };
}

/**
 * Queries AcoustID and returns canonical metadata of the best match.
 * Contract: returns null (never throws) when the key is missing, the request
 * fails, or no recording matches; score is AcoustID's own confidence 0–1.
 * @param {{fingerprint: string, duration: number}} fp Fingerprint + duration.
 * @returns {Promise<{artist: string, title: string, mbid: string, score: number}|null>}
 */
export async function identify(fp) {
  if (!ACOUSTID_KEY) return null; // no key: disabled, the app stays functional
  const params = new URLSearchParams({
    client: ACOUSTID_KEY,
    duration: String(fp.duration),
    fingerprint: fp.fingerprint,
    meta: "recordings+releases+compress",
  });
  const res = await fetch("https://api.acoustid.org/v2/lookup", { method: "POST", body: params });
  if (!res.ok) return null;
  const json = await res.json();
  const best = json?.results?.[0];
  const rec = best?.recordings?.[0];
  if (!rec) return null;
  return {
    artist: rec.artists?.[0]?.name ?? rec.artist ?? "",
    title: rec.title ?? "",
    mbid: rec.id,
    score: best.score ?? 0,
  };
}

const cacheKey = (id) => `pf.fp.${id}`;

/**
 * Identifies a track with local cache (the fingerprint is deterministic:
 * same file → same answer → permanent cache).
 * Contract: cache-first, network only on miss; null results are NOT cached
 * (they may be transient network issues).
 * @param {string} trackId Cache key (e.g. "identifier/file.mp3").
 * @param {string} audioUrl Streamable file URL.
 * @returns {Promise<Object|null>} Canonical metadata or null.
 */
export async function identifyCached(trackId, audioUrl) {
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey(trackId)) ?? "null");
    if (hit) return hit;
  } catch {}
  const result = await identify(await fingerprintTrack(audioUrl));
  if (result) {
    try { localStorage.setItem(cacheKey(trackId), JSON.stringify(result)); } catch {}
  }
  return result;
}
