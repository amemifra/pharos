/**
 * Format policy — quality ranking, user choice, and bandwidth-adaptive auto.
 *
 * FORMAT_RANK (objective, from bit-depth/bitrate reality of the same
 * recording served by archive.org):
 *   24BIT FLAC (24-bit/96kHz vinyl rips)  rank 7 — archival fidelity
 *   FLAC (16-bit lossless)                rank 6 — lossless, ~2-4x MP3 bytes
 *   M4A / AAC 256                         rank 5 — transparent lossy, ~1.5x
 *   VBR MP3 (~220kbps average)            rank 4 — default archive.org derivative
 *   MP3 128                               rank 3
 *   OGG                                   rank 2
 *
 * Decision table (mode "auto", from navigator.connection):
 *   effectiveType      downlink (Mbps)   → chosen rank ceiling     example
 *   slow-2g / 2g       any               → 3  (MP3 128)            0.05-0.25 Mbps: FLAC side rips (50-200MB) are unusable
 *   3g                 < 1.0             → 4  (VBR MP3)            ~0.7 Mbps: VBR MP3 buffers fine, FLAC stalls
 *   3g / 4g            1.0 – 4.9         → 5  (M4A/AAC)            ~2 Mbps: AAC streams, FLAC borderline on mobile radios
 *   4g / wifi          ≥ 5.0             → 7  (best available)     ≥ 5 Mbps: FLAC starts in seconds
 *
 * Runtime feedback: the player island reports stalls; two consecutive stalls
 * over 2s downgrade the ceiling by one rank for the session (persisted in
 * localStorage under "pf.formatpolicy"), recovery +60s without stalls.
 */

/** Objective quality ranking — higher wins. Keys normalized to lowercase. */
export const FORMAT_RANK = {
  "24bit flac": 7,
  "flac": 6,
  "m4a": 5,
  "aac": 5,
  "vbr mp3": 4,
  "mp3": 3,
  "ogg": 2,
  "wav": 6,
};

const LS_KEY = "pf.formatpolicy";

/** @returns {{mode: string, ceiling: number, manual: string|null}} */
export function loadPolicy() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? "null");
    if (saved) return { mode: saved.mode ?? "auto", ceiling: saved.ceiling ?? 7, manual: saved.manual ?? null };
  } catch {}
  return { mode: "best", ceiling: 7, manual: null };
}

export function savePolicy(policy) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(policy)); } catch {}
}

/** Rank of a format label, 0 when unknown (never preferred). */
export function rankOf(format) {
  return FORMAT_RANK[String(format ?? "").toLowerCase()] ?? 0;
}

/** Connection-derived ceiling (server/browser independent, objective). */
function connectionCeiling() {
  try {
    const c = navigator.connection;
    if (!c) return 7;
    const t = c.effectiveType;
    if (t === "slow-2g" || t === "2g") return 3;
    if (t === "3g") return (c.downlink ?? 1) < 1.0 ? 4 : (c.downlink ?? 1) < 5 ? 5 : 7;
    return (c.downlink ?? 10) >= 5 ? 7 : 5;
  } catch { return 7; }
}

/**
 * Choose the variant to play from a track's variants.
 * @param {{format: string, url: string}[]} variants
 * @param {{mode: string, ceiling: number, manual: string|null}} [policy]
 * @returns {{format: string, url: string}|null} Chosen variant, or null.
 */
export function chooseVariant(variants, policy = loadPolicy()) {
  if (!variants?.length) return null;
  if (policy.mode === "manual" && policy.manual) {
    const manual = variants.find((v) => rankOf(v.format) === rankOf(policy.manual));
    if (manual) return manual;
  }
  const ceiling = policy.mode === "auto" ? Math.min(policy.ceiling, connectionCeiling()) : 7;
  return [...variants].sort((a, b) => rankOf(b.format) - rankOf(a.format))
    .find((v) => rankOf(v.format) <= ceiling) ?? variants[0];
}

/** Downgrade the auto ceiling one rank after repeated stalls. */
export function reportStall() {
  const policy = loadPolicy();
  if (policy.mode !== "auto") return;
  policy.ceiling = Math.max(3, policy.ceiling - 1);
  savePolicy(policy);
}
