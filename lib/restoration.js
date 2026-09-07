/**
 * Gramophone-noise restoration policy.
 *
 * Old recordings (78rpm, early vinyl — George Blood collections and friends)
 * carry surface noise: low-frequency rumble from the turntable and broadband
 * "ticks" from dust and scratches. This module manages the user's restoration
 * preference, following the same policy pattern as lib/formatpolicy.js.
 *
 * Modes and their honest contract:
 *   "off"   (default) — the audio is untouched, bit-for-bit what the source serves.
 *   "light" — pure Web Audio DSP, zero network, zero model: an 80 Hz high-pass
 *             removes turntable rumble; an AudioWorklet de-ticker attenuates
 *             sharp scratch transients against a rolling noise floor.
 *   "ai"    — neural noise suppression (WASM model via lib/restore-model.js).
 *             Heavier: first use downloads/loads the model; if the model is
 *             not wired, the UI shows "requires model setup" (no fake success).
 *
 * Persistence: localStorage key "pf.restoration" (legacy pf.* namespace kept
 * across the rename — documented in lib/catalogstore.js).
 */

const KEY = "pf.restoration";

/** Valid modes — the single source of truth for the UI selector. */
export const MODES = ["off", "light", "ai"];

/**
 * Read the active restoration policy.
 * @returns {{mode: "off"|"light"|"ai"}} Defaults to off when unset/invalid.
 */
export function loadPolicy() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (raw && MODES.includes(raw.mode)) return { mode: raw.mode };
  } catch {}
  return { mode: "off" };
}

/**
 * Persist the restoration policy and notify listeners (the player island
 * applies the change live — see lib/restoration-apply integration).
 * @param {{mode: "off"|"light"|"ai"}} policy
 */
export function savePolicy(policy) {
  try { localStorage.setItem(KEY, JSON.stringify(policy)); } catch {}
  // Same-tab notification (storage events only fire cross-tab).
  try { window.dispatchEvent(new CustomEvent("pharos:restoration", { detail: policy })); } catch {}
}

/**
 * User-facing label for a mode — honest by design ("AI restored" is never
 * claimed without a real model; lib/restore-model.js reports availability).
 * @param {"off"|"light"|"ai"} mode
 * @returns {string}
 */
export function label(mode) {
  switch (mode) {
    case "light": return "Light — removes rumble and clicks";
    case "ai": return "AI — neural noise suppression (heavier; downloads model on first use)";
    default: return "Off — original audio";
  }
}
