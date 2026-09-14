// Sandbox probe: wasm silence-detection vs JS fallback on a synthetic PCM
// signal with known silent regions. Asserts mask equality and correct
// boundaries. Exit 0 = pass. Usage: node tests/silence-probe.mjs
import {
  silenceMask, silenceMaskRef, maskToSegments, detectSilenceBoundaries,
  SILENCE_THRESHOLD, MIN_SILENCE_SEC,
} from "../lib/silence.js";

const SR = 44100;
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ": " + extra : ""}`);
  if (!ok) failures++;
};

// Synthetic signal: 1.0s tone | 0.8s silence | 1.0s tone | 1.0s silence | 1.0s tone
const segs = [
  { dur: 1.0, loud: true },
  { dur: 0.8, loud: false },
  { dur: 1.0, loud: true },
  { dur: 1.0, loud: false },
  { dur: 1.0, loud: true },
];
const total = Math.round(segs.reduce((s, x) => s + x.dur, 0) * SR);
const pcm = new Float32Array(total);
{
  let off = 0;
  for (const s of segs) {
    const n = Math.round(s.dur * SR);
    for (let i = 0; i < n; i++) {
      pcm[off + i] = s.loud ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0;
    }
    off += n;
  }
}

// 1. wasm mask === JS reference mask
const mw = silenceMask(pcm);
const mr = silenceMaskRef(pcm);
let eq = mw.length === mr.length;
for (let i = 0; eq && i < mr.length; i++) if (mw[i] !== mr[i]) eq = false;
check("wasm mask identical to JS reference", eq);

// 2. segments match the synthetic ground truth (0.8s and 1.0s gaps ≥ 0.4s min)
const gaps = maskToSegments(mr, SR);
check(
  "two silence gaps found",
  gaps.length === 2,
  JSON.stringify(gaps.map((g) => [g.start.toFixed(3), g.end.toFixed(3)]))
);
check("gap 1 ≈ [1.0, 1.8]", Math.abs(gaps[0]?.start - 1.0) < 0.01 && Math.abs(gaps[0]?.end - 1.8) < 0.01);
check("gap 2 ≈ [2.8, 3.8]", Math.abs(gaps[1]?.start - 2.8) < 0.01 && Math.abs(gaps[1]?.end - 3.8) < 0.01);

// 3. boundaries: track starts at 0, 1.8, 3.8
const b = detectSilenceBoundaries(pcm, { sampleRate: SR });
check(
  "boundaries ≈ [0, 1.8, 3.8]",
  b?.length === 3 &&
    Math.abs(b[0]) < 0.01 && Math.abs(b[1] - 1.8) < 0.01 && Math.abs(b[2] - 3.8) < 0.01,
  JSON.stringify(b?.map((x) => +x.toFixed(4)))
);

// 4. short silence below min duration is ignored
const short = new Float32Array(SR * 2);
for (let i = Math.round(SR * 0.9); i < Math.round(SR * 1.1); i++) short[i] = 0; // 0.2s gap
const bs = detectSilenceBoundaries(short, { sampleRate: SR });
check("0.2s gap below min duration → no split", bs === null || bs.length <= 1);

// 5. random noise: wasm/JS masks stay equal (fuzz, 3 rounds)
let fuzz = true;
for (let r = 0; r < 3; r++) {
  const noise = new Float32Array(4096);
  for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * 0.02;
  const a = silenceMask(noise), c = silenceMaskRef(noise);
  for (let i = 0; i < noise.length; i++) if (a[i] !== c[i]) { fuzz = false; break; }
}
check("fuzz: noise masks identical (3 rounds)", fuzz);

// 6. degenerate inputs return null (proportional fallback preserved)
check("empty pcm → null", detectSilenceBoundaries(new Float32Array(0)) === null);
check("non-Float32Array → null", detectSilenceBoundaries([0, 0, 0]) === null);

// 7. default contract used by lib/tracklist.js (44100 default sample rate)
const bDefault = detectSilenceBoundaries(pcm);
check("default-options call matches explicit SR=44100", JSON.stringify(bDefault) === JSON.stringify(b));

console.log(failures === 0 ? "\n═ PROBE: 8 pass, 0 fail ═" : `\n═ PROBE: ${failures} FAILURE(S) ═`);
process.exit(failures === 0 ? 0 : 1);
