import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const modelSource = readFileSync(new URL('../lib/restore-model.js', import.meta.url), 'utf8');
async function loader({ present = true, broken = false } = {}) {
  const ort = { env: { wasm: {} }, Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } },
    InferenceSession: { create: async () => {
      if (broken) throw Error('invalid model');
      return { inputNames: ['audio'], outputNames: ['clean'],
        inputMetadata: [{ type: 'float32', shape: [1, 1024] }],
        async run({ audio }) { return { clean: { data: Float32Array.from(audio.data, x => x / 2) } }; },
        async release() {} };
    } } };
  const context = vm.createContext({ console, Float32Array, performance, setTimeout, clearTimeout, AbortSignal,
    fetch: async () => ({ ok: present }), URL, location: { href: 'https://example.test/pharos/player/' } });
  const module = new vm.SourceTextModule(modelSource, { context, importModuleDynamically: async () => ortModule });
  const ortModule = new vm.SyntheticModule(Object.keys(ort), function () { for (const [k,v] of Object.entries(ort)) this.setExport(k,v); }, { context });
  await ortModule.link(() => {}); await ortModule.evaluate();
  await module.link(() => { const m = new vm.SyntheticModule(['assetPath'], function () { this.setExport('assetPath', p => '/pharos' + p); }, { context }); return m; });
  await module.evaluate();
  return { api: module.namespace, ort };
}
function processor() {
  let Processor;
  vm.runInNewContext(readFileSync(new URL('../public/worklets/restore-worklet.js', import.meta.url), 'utf8'), {
    Float32Array, Map, Number, Math,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: m => this.messages.push(m) }; this.messages = []; } },
    registerProcessor: (_, p) => { Processor = p; },
  });
  return new Processor();
}
function render(p, value = 0.2) {
  const out = [new Float32Array(128)];
  p.process([[new Float32Array(128).fill(value)]], [out]);
  return out[0];
}

test('missing and corrupt models remain non-throwing and unavailable', async () => {
  for (const options of [{ present: false }, { broken: true }]) {
    const { api } = await loader(options);
    assert.equal(typeof (await api.loadModel()).error, 'string');
    assert.equal((await api.checkModel()).available, false);
  }
});
test('loader keeps zero-argument API and bridges actual model output to a worklet', async () => {
  const { api, ort } = await loader();
  assert.equal(api.checkModel.length, 0); assert.equal(api.loadModel.length, 0);
  const model = await api.loadModel();
  assert.ok(model.session); assert.equal(ort.env.wasm.proxy, true);
  const sent = [];
  const port = { postMessage: m => sent.push(m) };
  const stop = model.connect(port);
  await port.onmessage({ data: { type: 'frame', id: 0, channels: [new Float32Array(1024).fill(0.4)] } });
  await new Promise(r => setTimeout(r, 0));
  const result = sent.find(m => m.type === 'result');
  assert.ok(result); assert.equal(result.channels[0][0], new Float32Array([0.2])[0]);
  stop();
});
test('worklet uses denoised frames at bounded latency and ignores stale replies after overflow', () => {
  const p = processor();
  p.port.onmessage({ data: { type: 'ai', frameSize: 1024 } });
  for (let i=0; i<8; i++) render(p);
  assert.equal(p.messages[0]?.type, 'frame');
  p.port.onmessage({ data: { type: 'result', id: 0, channels: [new Float32Array(1024).fill(0.03125)] } });
  for (let i=0; i<16; i++) render(p);
  assert.equal(render(p)[0], 0.03125);
  const stalled = processor();
  stalled.port.onmessage({ data: { type: 'ai', frameSize: 1024 } });
  for (let i=0; i<40; i++) render(stalled);
  assert.ok(stalled.messages.some(m => m.type === 'fallback'));
  assert.ok(stalled.messages.filter(m => m.type === 'frame').length <= 3);
  const light = processor();
  for (let i=0; i<40; i++) render(light);
  assert.deepEqual(render(stalled), render(light));
});
