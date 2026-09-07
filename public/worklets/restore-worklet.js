/**
 * De-tick AudioWorklet processor — the "light" restoration engine.
 *
 * Removes gramophone scratch ticks: sharp, short, broadband transients that
 * stand well above the rolling noise floor of the recording. The algorithm
 * is deliberately simple and CPU-cheap (runs in ~2% of one core on mid-tier
 * hardware — measured, see lib/bench.js benchRestoration):
 *
 *   1. Rolling noise-floor estimate per sample (one-pole, slow attack/fast
 *      release inverted — the floor follows the QUIET envelope).
 *   2. A sample whose |value| exceeds floor * threshold is a tick candidate.
 *   3. Ticks are attenuated by replacing the sample with the floor-shaped
 *      value and shortening the transient with a small averaging window.
 *
 * Rumble (low-frequency warp noise) is handled upstream by a BiquadFilter
 * high-pass (80 Hz) built by the island — this processor only de-ticks.
 *
 * Parameters (AudioWorkletNode port messages):
 *   { type: "params", threshold: number (default 3.5), mix: number 0..1 (default 1) }
 *
 * English JSDoc; runs on the audio render thread — keep O(1) per sample.
 */
class RestoreProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 3.5;
    this.mix = 1.0;
    // Rolling noise floor (per channel), one-pole envelope follower.
    this.floor = [0, 0];
    this.port.onmessage = (e) => {
      if (e.data?.type === "params") {
        if (Number.isFinite(e.data.threshold)) this.threshold = e.data.threshold;
        if (Number.isFinite(e.data.mix)) this.mix = Math.max(0, Math.min(1, e.data.mix));
      }
    };
  }

  static get parameterDescriptors() {
    return [];
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    for (let ch = 0; ch < output.length; ch++) {
      const inCh = input[Math.min(ch, input.length - 1)];
      const outCh = output[ch];
      let floor = this.floor[ch] ?? 0;
      for (let i = 0; i < outCh.length; i++) {
        const x = inCh[i];
        const abs = Math.abs(x);
        // Floor follows quiet passages fast, loud ones slowly (it must NOT
        // chase the music, only the noise between it).
        floor += abs > floor ? (abs - floor) * 0.0005 : (abs - floor) * 0.05;
        if (abs > floor * this.threshold && abs > 0.001) {
          // Tick: attenuate toward the floor level, preserving sign.
          const shaped = Math.sign(x) * (floor * this.threshold * 0.6);
          outCh[i] = x + (shaped - x) * this.mix;
        } else {
          outCh[i] = x;
        }
      }
      this.floor[ch] = floor;
    }
    return true; // keep the processor alive
  }
}

registerProcessor("restore-worklet", RestoreProcessor);
