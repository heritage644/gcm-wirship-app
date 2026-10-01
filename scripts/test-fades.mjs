#!/usr/bin/env node
/**
 * AuraPad — unit tests for the gain math in src/services/fades.ts.
 *
 * That module is deliberately free of React Native / Expo imports, so Node can
 * load the TypeScript directly via its built-in type stripping. No jest, no
 * babel, no transform step.
 *
 * Usage: node scripts/test-fades.mjs
 */

import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modulePath = resolve(__dirname, '..', 'src', 'services', 'fades.ts');

const {
  clamp01,
  dbToGain,
  gainToDb,
  fadeInGain,
  fadeOutGain,
  crossfadePower,
  computeXYGains,
  resolveChannelGain,
  SILENCE_DB,
} = await import(pathToFileURL(modulePath).href);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  \u2717 ${name}`);
    console.error(`      ${error.message.split('\n')[0]}`);
  }
}

const CURVES = ['logarithmic', 'equalPower', 'linear'];
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

console.log('\nfades.ts\n');

test('clamp01 bounds and rejects NaN', () => {
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(0.42), 0.42);
  assert.equal(clamp01(9), 1);
  assert.equal(clamp01(Number.NaN), 0);
});

test('dB <-> gain round-trips', () => {
  assert.ok(near(dbToGain(0), 1, 1e-12));
  assert.ok(near(dbToGain(-6), 0.5011872336272722, 1e-12));
  assert.ok(near(gainToDb(1), 0, 1e-12));
  assert.equal(gainToDb(0), SILENCE_DB);
  for (const db of [-48, -24, -12, -3, 0]) {
    assert.ok(near(gainToDb(dbToGain(db)), db, 1e-9));
  }
});

test('every curve pins its endpoints exactly', () => {
  for (const curve of CURVES) {
    assert.equal(fadeInGain(0, curve), 0, `${curve} fade-in must start at silence`);
    assert.equal(fadeInGain(1, curve), 1, `${curve} fade-in must reach unity`);
    assert.equal(fadeOutGain(0, curve), 1, `${curve} fade-out must start at unity`);
    assert.equal(fadeOutGain(1, curve), 0, `${curve} fade-out must reach silence`);
  }
});

test('curves are monotonic across the whole sweep', () => {
  for (const curve of CURVES) {
    let prevIn = -Infinity;
    let prevOut = Infinity;
    for (let i = 0; i <= 500; i += 1) {
      const t = i / 500;
      const gIn = fadeInGain(t, curve);
      const gOut = fadeOutGain(t, curve);
      assert.ok(gIn >= prevIn - 1e-12, `${curve} fade-in dipped at t=${t}`);
      assert.ok(gOut <= prevOut + 1e-12, `${curve} fade-out rose at t=${t}`);
      prevIn = gIn;
      prevOut = gOut;
    }
  }
});

test('curves stay inside [0,1] and never return NaN', () => {
  for (const curve of CURVES) {
    for (let i = -10; i <= 110; i += 1) {
      const t = i / 100;
      for (const g of [fadeInGain(t, curve), fadeOutGain(t, curve)]) {
        assert.ok(Number.isFinite(g), `${curve} produced non-finite at t=${t}`);
        assert.ok(g >= 0 && g <= 1, `${curve} out of range at t=${t}: ${g}`);
      }
    }
  }
});

test('fade-in and fade-out are mirror images', () => {
  for (const curve of CURVES) {
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      assert.ok(
        near(fadeInGain(t, curve), fadeOutGain(1 - t, curve), 1e-12),
        `${curve} is not symmetric at t=${t}`,
      );
    }
  }
});

test('logarithmic fade is linear in decibels (the point of it)', () => {
  // Equal steps in t must give equal steps in dB.
  const dbs = [];
  for (let i = 1; i <= 9; i += 1) dbs.push(gainToDb(fadeInGain(i / 10, 'logarithmic')));
  for (let i = 1; i < dbs.length; i += 1) {
    const step = dbs[i] - dbs[i - 1];
    assert.ok(near(step, 6, 1e-6), `dB step was ${step}, expected 6dB per 0.1`);
  }
});

test('logarithmic midpoint sits at -30dB, linear at -6dB', () => {
  assert.ok(near(gainToDb(fadeInGain(0.5, 'logarithmic')), -30, 1e-9));
  assert.ok(near(gainToDb(fadeInGain(0.5, 'linear')), -6.020599913279624, 1e-9));
});

test('equalPower holds constant power through the crossover', () => {
  for (let i = 0; i <= 100; i += 1) {
    const p = crossfadePower(i / 100, 'equalPower');
    assert.ok(near(p, 1, 1e-12), `power was ${p} at t=${i / 100}`);
  }
});

test('linear crossfade sags ~3dB mid-way (documents why it is not default)', () => {
  const p = crossfadePower(0.5, 'linear');
  assert.ok(near(p, Math.SQRT1_2, 1e-12));
  assert.ok(near(gainToDb(p), -3.010299956639812, 1e-9));
});

console.log('\ncomputeXYGains\n');

test('canvas corners produce the documented voicings', () => {
  const bottomLeft = computeXYGains({ x: 0, y: 0 }); // warm + minimal
  const topRight = computeXYGains({ x: 1, y: 1 }); // bright + heavy

  assert.ok(bottomLeft.shimmer < 0.05, 'dark corner should kill shimmer');
  assert.ok(bottomLeft.sub < 0.12, 'minimal corner should pull the sub back');
  assert.ok(topRight.shimmer > 0.95, 'bright corner should open shimmer up');
  assert.ok(topRight.sub > 0.95, 'heavy corner should push the sub');
  assert.ok(topRight.texture > 0.95, 'heavy corner should push the texture');
});

test('X raises shimmer monotonically; Y raises sub and texture monotonically', () => {
  let prevShimmer = -1;
  for (let i = 0; i <= 100; i += 1) {
    const g = computeXYGains({ x: i / 100, y: 0.5 });
    assert.ok(g.shimmer >= prevShimmer - 1e-12, `shimmer dipped at x=${i / 100}`);
    prevShimmer = g.shimmer;
  }
  let prevSub = -1;
  let prevTexture = -1;
  for (let i = 0; i <= 100; i += 1) {
    const g = computeXYGains({ x: 0.5, y: i / 100 });
    assert.ok(g.sub >= prevSub - 1e-12, `sub dipped at y=${i / 100}`);
    assert.ok(g.texture >= prevTexture - 1e-12, `texture dipped at y=${i / 100}`);
    prevSub = g.sub;
    prevTexture = g.texture;
  }
});

test('dragging right trims the body (the simulated filter opening)', () => {
  const dark = computeXYGains({ x: 0, y: 0.5 });
  const bright = computeXYGains({ x: 1, y: 0.5 });
  assert.ok(bright.base < dark.base, 'opening up should ease the body back');
});

test('all canvas gains stay in [0,1] over the whole surface', () => {
  for (let i = 0; i <= 20; i += 1) {
    for (let j = 0; j <= 20; j += 1) {
      const g = computeXYGains({ x: i / 20, y: j / 20 });
      for (const [stem, value] of Object.entries(g)) {
        assert.ok(Number.isFinite(value), `${stem} non-finite at ${i / 20},${j / 20}`);
        assert.ok(value >= 0 && value <= 1, `${stem} out of range: ${value}`);
      }
    }
  }
});

test('out-of-range canvas input is clamped, not propagated', () => {
  const low = computeXYGains({ x: -5, y: -5 });
  const high = computeXYGains({ x: 5, y: 5 });
  assert.deepEqual(low, computeXYGains({ x: 0, y: 0 }));
  assert.deepEqual(high, computeXYGains({ x: 1, y: 1 }));
});

console.log('\nresolveChannelGain\n');

test('gain graph multiplies through', () => {
  const g = resolveChannelGain({ master: 0.5, fader: 0.5, muted: false, xyGain: 0.5, fadeGain: 0.5 });
  assert.ok(near(g, 0.0625, 1e-12));
});

test('mute wins over everything', () => {
  const g = resolveChannelGain({ master: 1, fader: 1, muted: true, xyGain: 1, fadeGain: 1 });
  assert.equal(g, 0);
});

test('result is always a legal player volume', () => {
  const g = resolveChannelGain({ master: 9, fader: 9, muted: false, xyGain: 9, fadeGain: 9 });
  assert.equal(g, 1);
  const n = resolveChannelGain({ master: -1, fader: 1, muted: false, xyGain: 1, fadeGain: 1 });
  assert.equal(n, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
