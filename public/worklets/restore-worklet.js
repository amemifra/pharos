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
    this.ai = null;
    this.port.onmessage = (e) => {
      const data = e.data;
      if (data?.type === "ai" && Number.isInteger(data.frameSize) && data.frameSize >= 128 && data.frameSize <= 4096) {
        this.ai = { size: data.frameSize, offset: 0, id: 0, frames: new Map(), capture: null };
      } else if (data?.type === "ai-off") {
        this.ai = null;
      } else if (data?.type === "result" && this.ai) {
        const frame = this.ai.frames.get(data.id);
        if (frame && data.channels?.length === frame.raw.length && data.channels.every(c => c instanceof Float32Array && c.length === this.ai.size && c.every(Number.isFinite))) frame.clean = data.channels;
      }
      if (e.data?.type === "params") {
        if (Number.isFinite(e.data.threshold)) this.threshold = e.data.threshold;
        if (Number.isFinite(e.data.mix)) this.mix = Math.max(0, Math.min(1, e.data.mix));
      }
    };
  }

  fallback() {
    this.ai = null;
    this.port.postMessage({ type: "fallback" });
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
    // Fixed three-frame latency while AI is active. At most three complete
    // frames may be outstanding. A missed deadline/overflow drops AI entirely:
    // late replies cannot replace newer audio, and the original light DSP above
    // keeps running throughout. No promises, waits, or inference on this thread.
    const ai = this.ai;
    if (ai) {
      for (let i = 0; i < output[0].length && this.ai; i++) {
        if (!ai.capture) ai.capture = {
          raw: input.slice(0, 2).map(() => new Float32Array(ai.size)),
          light: output.map(() => new Float32Array(ai.size)),
        };
        const due = ai.id >= 3 ? ai.frames.get(ai.id - 3) : null;
        if (ai.id >= 3 && !due?.clean) { this.fallback(); break; }
        for (let ch = 0; ch < ai.capture.raw.length; ch++) ai.capture.raw[ch][ai.offset] = input[ch][i];
        for (let ch = 0; ch < output.length; ch++) {
          ai.capture.light[ch][ai.offset] = output[ch][i];
          output[ch][i] = due ? due.clean[Math.min(ch, due.clean.length - 1)][ai.offset] : 0;
        }
        if (++ai.offset === ai.size) {
          if (due) ai.frames.delete(ai.id - 3);
          if (ai.frames.size >= 3) { this.fallback(); break; }
          const frame = ai.capture;
          ai.frames.set(ai.id, frame);
          // Copies let the bounded slots retain their fallback samples.
          const channels = frame.raw.map(c => new Float32Array(c));
          this.port.postMessage({ type: "frame", id: ai.id, channels }, channels.map(c => c.buffer));
          ai.id++;
          ai.offset = 0;
          ai.capture = null;
        }
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor("restore-worklet", RestoreProcessor);
