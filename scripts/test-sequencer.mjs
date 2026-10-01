#!/usr/bin/env node
/** Node-level tests for the audio-clock progression scheduler. */

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

const { SequencerEngine } = await import(pathToFileURL(resolve(SRC, 'audio/SequencerEngine.ts')).href);

class FakeAudioTarget {
  startedAt = performance.now();
  keyChanges = [];
  clicks = [];
  selectedPreset = null;
  fadeCurve = null;
  bpm = 0;

  get currentTime() {
    return (performance.now() - this.startedAt) / 1_000;
  }

  async prepare() {}
  setPreset(presetId) { this.selectedPreset = presetId; }
  setBpm(bpm) { this.bpm = bpm; }
  setFadeCurve(curve) { this.fadeCurve = curve; }

  scheduleKeyChange(key, atTime, fadeSeconds) {
    const call = { key, atTime, fadeSeconds, cancelled: false };
    this.keyChanges.push(call);
    return { cancel: () => { call.cancelled = true; } };
  }

  scheduleMetronomeClick(atTime, accented) {
    const call = { atTime, accented, cancelled: false };
    this.clicks.push(call);
    return { cancel: () => { call.cancelled = true; } };
  }
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const progression = {
  id: 'test-song',
  songTitle: 'Test Song',
  bpm: 120,
  timeSignature: '4/4',
  soundPresetId: 'sample-layer-rack',
  steps: [
    { id: 'one', targetKey: 'C', durationInBeats: 1, crossfadeDurationSeconds: 0.1 },
    { id: 'four', targetKey: 'F', durationInBeats: 1, crossfadeDurationSeconds: 0.2 },
    { id: 'five', targetKey: 'G', durationInBeats: 1, crossfadeDurationSeconds: 0.3 },
  ],
};

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

console.log('\nSequencer clock\n');

await test('schedules steps and beat clicks against the audio clock', async () => {
  const audio = new FakeAudioTarget();
  const engine = new SequencerEngine(audio, { tickIntervalMs: 10, lookAheadSeconds: 0.16 });
  await engine.play(progression);

  assert.equal(audio.selectedPreset, progression.soundPresetId);
  assert.equal(audio.fadeCurve, 'logarithmic');
  assert.equal(audio.bpm, progression.bpm);
  assert.equal(audio.keyChanges[0].key, 'C');
  assert.equal(audio.keyChanges[0].fadeSeconds, 0.1);
  assert.ok(audio.clicks.some((click) => click.accented), 'beat one should be accented');

  await sleep(620);
  const fChange = audio.keyChanges.find((change) => change.key === 'F');
  assert.ok(fChange, 'second step should be scheduled');
  assert.ok(
    Math.abs(fChange.atTime - audio.keyChanges[0].atTime - 0.5) < 0.015,
    'one beat at 120 BPM should be exactly half a second on the audio clock',
  );
  assert.equal(engine.getSnapshot().currentStepIndex, 1);
  assert.equal(engine.getSnapshot().currentKey, 'F');
  engine.dispose();
});

await test('pause cancels future events and resume keeps the current key step', async () => {
  const audio = new FakeAudioTarget();
  const engine = new SequencerEngine(audio, { tickIntervalMs: 10, lookAheadSeconds: 0.16 });
  await engine.play(progression);
  await sleep(900);
  engine.pause();

  const queuedG = audio.keyChanges.find((change) => change.key === 'G');
  assert.ok(queuedG, 'third step should have entered the lookahead queue');
  assert.equal(queuedG.cancelled, true, 'pause should cancel a not-yet-started step');
  assert.equal(engine.getSnapshot().status, 'paused');
  assert.equal(engine.getSnapshot().currentKey, 'F');

  await engine.resume();
  await sleep(480);
  assert.ok(audio.keyChanges.some((change) => change.key === 'G' && !change.cancelled));
  engine.dispose();
});

await test('loop wraps to step one and tempo changes retime pending boundaries', async () => {
  const loopAudio = new FakeAudioTarget();
  const loopEngine = new SequencerEngine(loopAudio, { tickIntervalMs: 10, lookAheadSeconds: 0.16 });
  await loopEngine.play({ ...progression, bpm: 240 }, { loop: true });
  await sleep(900);
  assert.ok(loopAudio.keyChanges.filter((change) => change.key === 'C').length >= 2);
  assert.equal(loopEngine.getSnapshot().loop, true);
  loopEngine.dispose();

  const tempoAudio = new FakeAudioTarget();
  const tempoEngine = new SequencerEngine(tempoAudio, { tickIntervalMs: 10, lookAheadSeconds: 0.18 });
  await tempoEngine.play(progression);
  await sleep(400);
  const oldBoundary = tempoAudio.keyChanges.find((change) => change.key === 'F');
  assert.ok(oldBoundary, 'the upcoming boundary should be in the lookahead queue');
  tempoEngine.setBpm(60);
  await sleep(120);
  const retimedBoundary = tempoAudio.keyChanges.filter((change) => change.key === 'F').at(-1);
  assert.equal(oldBoundary.cancelled, true);
  assert.notEqual(retimedBoundary, oldBoundary);
  assert.ok(retimedBoundary.atTime > tempoAudio.currentTime);
  assert.equal(tempoEngine.bpm, 60);
  tempoEngine.dispose();
});

await test('6/8 exposes six clock pulses per bar and tempo stays within 40–240 BPM', async () => {
  const audio = new FakeAudioTarget();
  const engine = new SequencerEngine(audio);
  engine.setProgression({ ...progression, timeSignature: '6/8', bpm: 300 });
  assert.equal(engine.getSnapshot().beatsPerBar, 6);
  assert.equal(engine.bpm, 240);
  engine.setBpm(20);
  assert.equal(engine.bpm, 40);
  engine.dispose();
});

await test('invalid zero-length progression steps are rejected', () => {
  const engine = new SequencerEngine(new FakeAudioTarget());
  assert.throws(
    () => engine.setProgression({
      ...progression,
      steps: [{ ...progression.steps[0], durationInBeats: 0 }],
    }),
    /positive beat duration/,
  );
  engine.dispose();
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
