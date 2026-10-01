#!/usr/bin/env node
/**
 * AuraPad — integration tests for the AudioService state machine.
 *
 * AudioService is the riskiest code in the app: it schedules overlapping
 * crossfades, juggles a two-slot deck per channel, evicts native players under
 * an LRU, and computes the gain that actually reaches the speakers. None of
 * that is exercised by a typecheck.
 *
 * Rather than mock at the service boundary (which would test nothing), this
 * runs the REAL AudioService and substitutes only the two things Node cannot
 * provide: the `expo-audio` native module and the Metro-bundled .wav registry.
 * Node's module.registerHooks() intercepts those two specifiers; everything
 * else — the scheduler, the fade curves, the deck logic — is the shipping code.
 *
 * The stub AudioPlayer records every volume write, so the assertions below are
 * made against the actual numbers the engine would have sent to the hardware.
 *
 * Usage: node scripts/test-engine.mjs
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'src');

// ---------------------------------------------------------------------------
// Stubs, injected by specifier
// ---------------------------------------------------------------------------

const MUSICAL_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PITCHED = ['base', 'shimmer', 'sub'];

/** Every player the engine has ever created, in creation order. */
const createdPlayers = [];

const EXPO_AUDIO_STUB = `
export const __players = [];
let nextId = 0;

class StubAudioPlayer {
  constructor(source) {
    this.id = 'p' + (nextId++);
    this.source = source;
    this.volume = 1;
    this.loop = false;
    this.playing = false;
    this.paused = true;
    this.muted = false;
    this.isLoaded = true;
    this.currentTime = 0;
    this.duration = 6;
    this.removed = false;
    this.seeks = [];
    this.volumeWrites = [];
    __players.push(this);
  }
  play() { if (this.removed) throw new Error('played a removed player'); this.playing = true; this.paused = false; }
  pause() { this.playing = false; this.paused = true; }
  remove() { this.removed = true; this.playing = false; }
  async seekTo(seconds) { this.seeks.push(seconds); this.currentTime = seconds; }
  replace(source) { this.source = source; }
  setPlaybackRate() {}
}

export function createAudioPlayer(source) {
  const p = new StubAudioPlayer(source);
  // Track volume writes so tests can assert on the real gain graph output.
  let v = 1;
  Object.defineProperty(p, 'volume', {
    get: () => v,
    set: (next) => { v = next; p.volumeWrites.push(next); },
    enumerable: true,
  });
  p.volume = 0;
  return p;
}
export async function setAudioModeAsync() {}
export async function setIsAudioActiveAsync() {}
`;

const keyObj = (fn) =>
  MUSICAL_KEYS.map((k) => `  ${JSON.stringify(k)}: { ${PITCHED.map((s) => `${s}: ${JSON.stringify(fn(k, s))}`).join(', ')} }`).join(
    ',\n',
  );

const ASSET_STUB = `
export const PAD_LIBRARY = {
${keyObj((k, s) => `${k}|${s}`)}
};
export const TEXTURE_LIBRARY = { vinyl: 'tex|vinyl', rain: 'tex|rain', room: 'tex|room' };
export const LOOP_LENGTH_SECONDS = 6;
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-audio') {
      return { url: 'aurapad-stub:expo-audio', shortCircuit: true };
    }
    if (/(^|\/)\.\.\/assets\/audio$/.test(specifier) || specifier.endsWith('/assets/audio')) {
      return { url: 'aurapad-stub:assets', shortCircuit: true };
    }
    // The app uses bundler-style extensionless imports ('../types/audio').
    // Node's ESM resolver requires an explicit extension, so add it back.
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, format: 'module-typescript', shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'aurapad-stub:expo-audio') {
      return { format: 'module', source: EXPO_AUDIO_STUB, shortCircuit: true };
    }
    if (url === 'aurapad-stub:assets') {
      return { format: 'module', source: ASSET_STUB, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { AudioService } = await import(pathToFileURL(resolve(SRC, 'services/AudioService.ts')).href);
const expoAudio = await import('expo-audio');
createdPlayers.push(...expoAudio.__players);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const service = new AudioService();
  try {
    await fn(service);
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  \u2717 ${name}`);
    console.error(`      ${String(error.message).split('\n').slice(0, 3).join(' | ')}`);
  } finally {
    try {
      service.dispose();
    } catch {
      /* ignore */
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const livePlayers = () => expoAudio.__players.filter((p) => !p.removed);
const playersFor = (key) =>
  expoAudio.__players.filter((p) => !p.removed && String(p.source).startsWith(`${key}|`));
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('\nAudioService — transport\n');

await test('start() loads all four channels and begins playing', async (s) => {
  await s.start('C');
  const snap = s.getSnapshot();
  assert.equal(snap.currentKey, 'C');
  assert.equal(snap.isPlaying, true);
  // 3 pitched stems for C + 1 texture bed.
  assert.equal(playersFor('C').length, 3, 'expected base/shimmer/sub for C');
  const texture = livePlayers().filter((p) => String(p.source).startsWith('tex|'));
  assert.equal(texture.length, 1, 'expected exactly one texture bed');
  for (const p of [...playersFor('C'), ...texture]) {
    assert.equal(p.loop, true, 'every pad player must loop');
    assert.equal(p.playing, true, 'every pad player must be rolling');
  }
});

await test('pause() stops every player; play() restarts them', async (s) => {
  await s.start('C');
  s.pause();
  assert.ok(livePlayers().every((p) => !p.playing), 'pause must stop all players');
  assert.equal(s.getSnapshot().isPlaying, false);
  s.play();
  assert.equal(s.getSnapshot().isPlaying, true);
  assert.ok(playersFor('C').some((p) => p.playing), 'play must restart the active deck');
});

console.log('\nAudioService — crossfade\n');

await test('switching key opens a transition and lands on the target', async (s) => {
  await s.start('C');
  await s.setKey('G', { fadeSeconds: 0.4 });

  let snap = s.getSnapshot();
  assert.equal(snap.transition.active, true, 'transition should be in flight');
  assert.equal(snap.transition.fromKey, 'C');
  assert.equal(snap.transition.toKey, 'G');
  assert.equal(snap.currentKey, 'G');

  // Mid-fade both keys must be audible simultaneously — that is the point.
  await sleep(200);
  assert.ok(playersFor('C').some((p) => p.volume > 0), 'outgoing key should still sound');
  assert.ok(playersFor('G').some((p) => p.volume > 0), 'incoming key should already sound');

  await sleep(400);
  snap = s.getSnapshot();
  assert.equal(snap.transition.active, false, 'transition should have finished');
  assert.ok(near(snap.transition.progress, 1), 'progress should land on 1');
});

await test('outgoing players are paused and released once the fade completes', async (s) => {
  await s.start('C');
  const before = playersFor('C');
  await s.setKey('G', { fadeSeconds: 0.3 });
  await sleep(500);
  for (const p of before) {
    assert.ok(!p.playing, 'faded-out players must stop burning CPU');
    assert.ok(near(p.volume, 0), `faded-out player left at volume ${p.volume}`);
  }
});

await test('incoming loop is phase-aligned to the outgoing playhead', async (s) => {
  await s.start('C');
  // Pretend the pad has been running for a while.
  for (const p of playersFor('C')) p.currentTime = 2.5;
  await s.setKey('A', { fadeSeconds: 0.3 });
  const incoming = playersFor('A');
  assert.ok(incoming.length > 0);
  assert.ok(
    incoming.some((p) => p.seeks.length > 0 && near(p.seeks[0], 2.5, 1e-9)),
    'incoming deck should seek to the outgoing playhead',
  );
  await sleep(400);
});

await test('a key change mid-fade retargets instead of stacking fades', async (s) => {
  await s.start('C');
  await s.setKey('G', { fadeSeconds: 2 });
  await sleep(120);
  await s.setKey('E', { fadeSeconds: 0.3 });
  assert.equal(s.getSnapshot().transition.toKey, 'E');
  await sleep(500);
  const snap = s.getSnapshot();
  assert.equal(snap.currentKey, 'E');
  assert.equal(snap.transition.active, false);
  assert.ok(playersFor('E').some((p) => p.volume > 0), 'final key must be audible');
});

await test('fade honours the requested duration', async (s) => {
  await s.start('C');
  const t0 = Date.now();
  await s.setKey('D', { fadeSeconds: 0.5 });
  while (s.getSnapshot().transition.active && Date.now() - t0 < 3000) await sleep(20);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 450, `fade finished too early: ${elapsed}ms`);
  assert.ok(elapsed < 1200, `fade overran: ${elapsed}ms`);
});

console.log('\nAudioService — drone lock\n');

await test('drone lock holds the sub on its key while base and shimmer move', async (s) => {
  await s.start('C');
  s.setDroneLock(true);
  assert.equal(s.getSnapshot().droneLockedKey, 'C');

  await s.setKey('G', { fadeSeconds: 0.3 });
  await sleep(500);

  const subC = expoAudio.__players.filter((p) => !p.removed && p.source === 'C|sub');
  assert.equal(subC.length, 1, 'the C sub must still be resident');
  assert.ok(subC[0].playing, 'the C sub must still be playing');
  assert.ok(subC[0].volume > 0, 'the C sub must still be audible');

  const baseC = expoAudio.__players.filter((p) => !p.removed && p.source === 'C|base');
  assert.ok(
    baseC.length === 0 || !baseC[0].playing,
    'the C base should have faded away',
  );
  assert.ok(
    expoAudio.__players.some((p) => p.source === 'G|base' && p.playing && p.volume > 0),
    'the G base should be live',
  );
});

await test('releasing drone lock walks the sub back to the current key', async (s) => {
  await s.start('C');
  s.setDroneLock(true);
  await s.setKey('G', { fadeSeconds: 0.2 });
  await sleep(350);

  s.setFadeDuration(0.3);
  s.setDroneLock(false);
  await sleep(600);

  assert.ok(
    expoAudio.__players.some((p) => p.source === 'G|sub' && p.playing && p.volume > 0),
    'the sub should have rejoined G',
  );
  assert.equal(s.getSnapshot().droneLock, false);
});

console.log('\nAudioService — gain graph\n');

await test('player volume equals master × fader × canvas', async (s) => {
  await s.start('C');
  s.setMasterVolume(0.5);
  s.setStemVolume('base', 0.4);
  s.releaseXY();
  await sleep(50);
  const base = expoAudio.__players.find((p) => p.source === 'C|base' && !p.removed);
  assert.ok(near(base.volume, 0.5 * 0.4, 1e-6), `expected 0.2, got ${base.volume}`);
});

await test('mute forces the channel to silence regardless of the fader', async (s) => {
  await s.start('C');
  s.setMasterVolume(1);
  s.setStemVolume('shimmer', 1);
  s.setStemMuted('shimmer', true);
  const shimmer = expoAudio.__players.find((p) => p.source === 'C|shimmer' && !p.removed);
  assert.equal(shimmer.volume, 0);
  s.setStemMuted('shimmer', false);
  assert.ok(shimmer.volume > 0, 'unmuting must restore the level');
});

await test('the X/Y canvas scales stem gain without touching the faders', async (s) => {
  await s.start('C');
  s.setMasterVolume(1);
  s.setStemVolume('shimmer', 1);

  s.setXY({ x: 0, y: 0.5 }); // fully dark
  const shimmer = expoAudio.__players.find((p) => p.source === 'C|shimmer' && !p.removed);
  const dark = shimmer.volume;

  s.setXY({ x: 1, y: 0.5 }); // fully bright
  const bright = shimmer.volume;

  assert.ok(dark < 0.05, `dark corner should mute shimmer, got ${dark}`);
  assert.ok(bright > 0.7, `bright corner should open shimmer, got ${bright}`);
  // The fader itself must be untouched — the canvas is a modifier, not a mover.
  assert.equal(s.getSnapshot().mixer.shimmer.volume, 1);
});

await test('setXY does not wake React; commitXY does', async (s) => {
  await s.start('C');
  let notifications = 0;
  const unsubscribe = s.subscribe(() => {
    notifications += 1;
  });
  for (let i = 0; i <= 50; i += 1) s.setXY({ x: i / 50, y: 0.5 });
  assert.equal(notifications, 0, 'a 50-step drag must not re-render React once');
  s.commitXY();
  assert.equal(notifications, 1, 'releasing the gesture should notify exactly once');
  unsubscribe();
});

await test('setMix applies a whole preset and bumps mixGeneration', async (s) => {
  await s.start('C');
  const before = s.getSnapshot().mixGeneration;
  s.setMix({ baseVolume: 0.1, shimmerVolume: 0.2, subBassVolume: 0.3, textureVolume: 0.4 });
  const snap = s.getSnapshot();
  assert.ok(near(snap.mixer.base.volume, 0.1));
  assert.ok(near(snap.mixer.shimmer.volume, 0.2));
  assert.ok(near(snap.mixer.sub.volume, 0.3));
  assert.ok(near(snap.mixer.texture.volume, 0.4));
  assert.equal(snap.mixGeneration, before + 1, 'preset recall must bump the generation');

  s.setStemVolume('base', 0.9);
  assert.equal(
    s.getSnapshot().mixGeneration,
    before + 1,
    'a single fader move must NOT bump the generation',
  );
});

console.log('\nAudioService — resources\n');

await test('the player cache evicts old keys under its LRU budget', async (s) => {
  s.setMaxResidentKeys(2);
  await s.start('C');
  for (const key of ['D', 'E', 'F', 'G']) {
    await s.setKey(key, { fadeSeconds: 0.05 });
    await sleep(120);
  }
  await sleep(200);
  const resident = new Set(
    livePlayers()
      .map((p) => String(p.source).split('|')[0])
      .filter((k) => k !== 'tex'),
  );
  assert.ok(resident.size <= 3, `LRU let ${resident.size} keys stay resident: ${[...resident]}`);
  assert.ok(resident.has('G'), 'the live key must never be evicted');
});

await test('preloadKey warms a key without making it audible', async (s) => {
  await s.start('C');
  s.preloadKey('F#');
  const warmed = playersFor('F#');
  assert.equal(warmed.length, 3, 'preload should create all three pitched players');
  for (const p of warmed) assert.equal(p.volume, 0, 'a preloaded key must be silent');
  assert.equal(s.getSnapshot().currentKey, 'C', 'preload must not change the key');
});

await test('the drone-locked key is pinned against eviction', async (s) => {
  s.setMaxResidentKeys(2);
  await s.start('C');
  s.setDroneLock(true);
  for (const key of ['D', 'E', 'F']) {
    await s.setKey(key, { fadeSeconds: 0.05 });
    await sleep(120);
  }
  await sleep(200);
  assert.ok(
    expoAudio.__players.some((p) => p.source === 'C|sub' && !p.removed),
    'the drone-locked sub was evicted',
  );
});

await test('dispose() releases every native player', async (s) => {
  await s.start('C');
  await s.setKey('G', { fadeSeconds: 0.1 });
  await sleep(200);
  const live = livePlayers().length;
  assert.ok(live > 0);
  s.dispose();
  assert.equal(livePlayers().length, 0, 'dispose must remove every player');
});

await test('stopAll() cancels fades and silences everything', async (s) => {
  await s.start('C');
  await s.setKey('G', { fadeSeconds: 2 });
  await sleep(100);
  s.stopAll();
  const snap = s.getSnapshot();
  assert.equal(snap.transition.active, false);
  assert.equal(snap.isPlaying, false);
  assert.ok(livePlayers().every((p) => !p.playing), 'nothing should still be rolling');
});

console.log('\nAudioService — texture bed\n');

await test('the texture bed keeps rolling across a key change', async (s) => {
  await s.start('C');
  const bed = livePlayers().find((p) => String(p.source).startsWith('tex|'));
  assert.ok(bed, 'expected a texture bed');
  await s.setKey('G', { fadeSeconds: 0.2 });
  await sleep(350);
  assert.ok(bed.playing, 'the ambience bed must not restart on a key change');
  assert.ok(!bed.removed);
});

await test('switching texture crossfades to the new bed', async (s) => {
  await s.start('C');
  s.setTexture('rain');
  await sleep(50);
  assert.ok(
    livePlayers().some((p) => p.source === 'tex|rain'),
    'the rain bed should have been created',
  );
  await sleep(1800);
  assert.equal(s.getSnapshot().texture, 'rain');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
