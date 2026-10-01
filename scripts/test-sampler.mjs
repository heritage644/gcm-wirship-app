#!/usr/bin/env node
/** Tests the public-sample Web Audio player using a fake graph and buffer loader. */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'src');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, format: 'module-typescript', shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const [{ SampleSamplerEngine, noteToMidi }, { DEFAULT_SAMPLE_LAYERS, getPadSampleUrls, PAD_PRESETS }] = await Promise.all([
  import(pathToFileURL(resolve(SRC, 'audio/SampleSamplerEngine.ts')).href),
  import(pathToFileURL(resolve(SRC, 'config/padPresets.ts')).href),
]);

class FakeAudioParam {
  value = 0;
  events = [];
  setValueAtTime(value, atTime) { this.value = value; this.events.push(['set', value, atTime]); }
  linearRampToValueAtTime(value, atTime) { this.value = value; this.events.push(['ramp', value, atTime]); }
  cancelScheduledValues(atTime) { this.events.push(['cancel', atTime]); }
}

class FakeAudioNode {
  connections = [];
  connect(destination) { this.connections.push(destination); return destination; }
  disconnect() { this.connections = []; }
}

class FakeBufferSource extends FakeAudioNode {
  buffer = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended = null;
  startTimes = [];
  stopTimes = [];
  playbackRate = new FakeAudioParam();
  start(atTime) { this.startTimes.push(atTime); }
  stop(atTime) { this.stopTimes.push(atTime); }
}

class FakeAudioContext {
  currentTime = 10;
  state = 'suspended';
  destination = new FakeAudioNode();
  sources = [];
  gains = [];
  createGain() {
    const node = new FakeAudioNode();
    node.gain = new FakeAudioParam();
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

function makeAssets(available = {}) {
  return {
    getPadSamples: (presetId) => available[presetId] ?? {},
    getAmbientBed: (bedId) => available[bedId]?.['loop.wav'] ?? null,
  };
}

const fakeLoader = async (module, context) => ({
  duration: 4,
  sampleRate: 48_000,
  module,
  context,
});
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
let passed = 0;
let failed = 0;

async function test(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`      ${String(error.message).split('\n').slice(0, 3).join(' | ')}`);
  }
}

console.log('\nPublic sample sampler\n');

await test('catalog defines the requested pads and public C2/C4/C6 sample URLs', () => {
  assert.deepEqual(Object.keys(PAD_PRESETS), ['warm-pad', 'shimmer-pad', 'sub-bass']);
  assert.deepEqual(PAD_PRESETS['warm-pad'].expectedAnchors, ['C2', 'C4', 'C6']);
  assert.deepEqual(getPadSampleUrls('warm-pad'), {
    C2: 'https://tonejs.github.io/audio/salamander/C2.mp3',
    C4: 'https://tonejs.github.io/audio/salamander/C4.mp3',
    C6: 'https://tonejs.github.io/audio/salamander/C6.mp3',
  });
  assert.deepEqual(getPadSampleUrls('shimmer-pad'), {
    C2: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/pad_2_warm-mp3/C2.mp3',
    C4: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/pad_2_warm-mp3/C4.mp3',
    C6: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/pad_2_warm-mp3/C6.mp3',
  });
  assert.deepEqual(getPadSampleUrls('sub-bass'), {
    C2: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_bass_1-mp3/C2.mp3',
    C4: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_bass_1-mp3/C4.mp3',
    C6: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_bass_1-mp3/C6.mp3',
  });
  assert.equal(DEFAULT_SAMPLE_LAYERS.length, 3);
  assert.equal(noteToMidi('C2'), 36);
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('C#4'), 61);
  assert.equal(noteToMidi('Db4'), 61);
  assert.equal(noteToMidi('not-a-note'), null);
});

await test('missing roots are reported and available roots remain usable', async () => {
  const context = new FakeAudioContext();
  const engine = new SampleSamplerEngine({
    context,
    assets: makeAssets({ 'warm-pad': { C2: 'warm-C2', C4: 'warm-C4' } }),
    loadBuffer: fakeLoader,
  });
  const reports = await engine.setLayers([
    { id: 'warm', sourceId: 'warm-pad', enabled: true, volume: 0.7 },
  ]);
  assert.equal(reports[0].status, 'partial');
  assert.deepEqual(reports[0].loaded, ['C2', 'C4']);
  assert.deepEqual(reports[0].missing, ['C6']);
  await engine.playKey('G');
  assert.equal(context.state, 'running', 'the first key play resumes a suspended AudioContext');
  assert.equal(context.sources.length, 1);
  assert.ok(Math.abs(context.sources[0].playbackRate.value - 2 ** (7 / 12)) < 1e-8);
  engine.dispose();
  assert.equal(context.state, 'running', 'an injected AudioContext remains host-owned');
});

await test('simultaneous pad and ambience layers use only supplied sample buffers', async () => {
  const context = new FakeAudioContext();
  const engine = new SampleSamplerEngine({
    context,
    assets: makeAssets({
      'warm-pad': { C4: 'warm-C4' },
      'shimmer-pad': { C4: 'shine-C4' },
      'room-bed': { 'loop.wav': 'room-loop' },
    }),
    loadBuffer: fakeLoader,
  });
  const layers = [
    { id: 'warm', sourceId: 'warm-pad', enabled: true, volume: 0.7 },
    { id: 'sparkle', sourceId: 'shimmer-pad', enabled: true, volume: 0.3 },
    { id: 'room', sourceId: 'room-bed', enabled: true, volume: 0.15 },
  ];
  await engine.setLayers(layers);
  await engine.playKey('C');
  assert.equal(context.sources.length, 3);
  assert.ok(context.sources.every((source) => source.loop));
  assert.equal(engine.currentKey, 'C');

  const roomVoiceSource = context.sources[2];
  await engine.playKey('G');
  assert.equal(context.sources.length, 5, 'two pitched layers change, bed stays on its loop');
  assert.equal(engine.currentKey, 'G');
  assert.equal(context.sources.includes(roomVoiceSource), true);
  engine.dispose();
});

await test('master gain and per-layer gain stay independent', async () => {
  const context = new FakeAudioContext();
  const engine = new SampleSamplerEngine({
    context,
    assets: makeAssets({ 'warm-pad': { C4: 'warm-C4' } }),
    loadBuffer: fakeLoader,
  });
  await engine.setLayers([{ id: 'warm', sourceId: 'warm-pad', enabled: true, volume: 0.4 }]);
  await engine.playKey('C', 0);
  const [masterGain, layerGain] = context.gains;
  assert.equal(masterGain.gain.value, 0.72);
  assert.equal(layerGain.gain.value, 0.4);

  engine.setMasterVolume(0.5);
  assert.equal(masterGain.gain.value, 0.5);
  assert.equal(layerGain.gain.value, 0.4, 'master gain does not get multiplied into the layer fader');
  engine.setLayerVolume('warm', 0.25);
  assert.equal(layerGain.gain.value, 0.25);
  engine.dispose();
});

await test('preset/layer changes crossfade new sources and retire old voices', async () => {
  const context = new FakeAudioContext();
  const engine = new SampleSamplerEngine({
    context,
    assets: makeAssets({
      'warm-pad': { C4: 'warm-C4' },
      'sub-bass': { C4: 'sub-C4' },
    }),
    loadBuffer: fakeLoader,
  });
  await engine.setLayers([{ id: 'main', sourceId: 'warm-pad', enabled: true, volume: 0.6 }]);
  await engine.playKey('C');
  const firstSource = context.sources[0];

  await engine.setLayers([{ id: 'main', sourceId: 'sub-bass', enabled: true, volume: 0.5 }]);
  assert.equal(context.sources.length, 2);
  assert.ok(firstSource.stopTimes.length === 0, 'release is scheduled after its fade');
  assert.ok(context.gains.some((gain) => gain.gain.events.some((event) => event[0] === 'ramp' && event[1] === 0)));
  engine.dispose();
  await sleep(1);
});

await test('unavailable samples produce a clear error instead of synthesized fallback audio', async () => {
  const context = new FakeAudioContext();
  const engine = new SampleSamplerEngine({
    context,
    assets: makeAssets(),
    loadBuffer: fakeLoader,
  });
  await engine.setLayers([{ id: 'warm', sourceId: 'warm-pad', enabled: true, volume: 1 }]);
  await assert.rejects(engine.playKey('C'), /No samples could be loaded/);
  assert.equal(context.sources.length, 0);
  engine.dispose();
});

await test('disposing an owned context stops voices and closes the browser graph', async () => {
  const context = new FakeAudioContext();
  const engine = new SampleSamplerEngine({
    contextFactory: () => context,
    assets: makeAssets({ 'warm-pad': { C4: 'warm-C4' } }),
    loadBuffer: fakeLoader,
  });
  await engine.setLayers([{ id: 'warm', sourceId: 'warm-pad', enabled: true, volume: 1 }]);
  await engine.playKey('C');
  const voice = context.sources[0];
  engine.dispose();
  assert.deepEqual(voice.stopTimes, [context.currentTime]);
  assert.equal(context.state, 'closed');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
