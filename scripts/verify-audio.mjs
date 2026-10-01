#!/usr/bin/env node
/**
 * AuraPad — legacy native-loop integrity check.
 *
 * Verifies the pre-existing Expo Audio compatibility loops. New recorded
 * multisamples are not generated here and are managed in their pad folders.
 * The test: when a legacy loop restarts, the jump from the final sample back to the first sample must
 * look like an ordinary sample-to-sample step. If it is much larger than the
 * loop's own largest internal step, the waveform has a discontinuity there and
 * you will hear a click on every repeat.
 *
 * We measure two things per file:
 *   wrapStep  |s[0] - s[n-1]|              the step across the loop point
 *   maxStep   max |s[i] - s[i-1]|          the largest step inside the loop
 *
 * PASS when wrapStep <= maxStep (ratio <= 1.0): the seam is indistinguishable
 * from normal waveform motion.
 *
 * Exit code 1 if anything fails, so this can gate CI.
 *
 * Usage: node scripts/verify-audio.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = resolve(__dirname, '..', 'src', 'assets', 'audio');

const RATIO_LIMIT = 1.0;
const LEGACY_KEYS = new Set(['A', 'As', 'B', 'C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs']);

function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path}: not a RIFF file`);
  const sampleRate = buf.readUInt32LE(24);
  const channels = buf.readUInt16LE(22);
  const bits = buf.readUInt16LE(34);
  const count = (buf.length - 44) / 2;
  const samples = new Float64Array(count);
  for (let i = 0; i < count; i += 1) samples[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return { sampleRate, channels, bits, samples };
}

function analyse(path) {
  const { sampleRate, channels, bits, samples } = readWav(path);
  const n = samples.length;

  let maxStep = 0;
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    energy += samples[i] * samples[i];
    if (i > 0) {
      const d = Math.abs(samples[i] - samples[i - 1]);
      if (d > maxStep) maxStep = d;
    }
  }
  const rms = Math.sqrt(energy / n);
  const wrapStep = Math.abs(samples[0] - samples[n - 1]);
  const ratio = maxStep > 0 ? wrapStep / maxStep : 0;

  // A DC offset also thumps on loop; keep it negligible.
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += samples[i];
  mean /= n;

  return {
    sampleRate,
    channels,
    bits,
    seconds: n / sampleRate,
    peak,
    rms,
    wrapStep,
    maxStep,
    ratio,
    dc: Math.abs(mean),
  };
}

function collectFiles() {
  const files = [];
  const padsDir = join(AUDIO_DIR, 'pads');
  if (existsSync(padsDir)) {
    for (const keyDir of readdirSync(padsDir).sort()) {
      if (!LEGACY_KEYS.has(keyDir)) continue;
      for (const f of readdirSync(join(padsDir, keyDir)).sort()) {
        if (f.endsWith('.wav')) files.push([`${keyDir}/${f.replace('.wav', '')}`, join(padsDir, keyDir, f)]);
      }
    }
  }
  const texDir = join(AUDIO_DIR, 'textures');
  if (existsSync(texDir)) {
    for (const f of readdirSync(texDir).sort()) {
      if (f.endsWith('.wav')) files.push([`texture/${f.replace('.wav', '')}`, join(texDir, f)]);
    }
  }
  return files;
}

function main() {
  const files = collectFiles();
  if (files.length === 0) {
    console.error('No legacy native-loop WAVs found to verify.');
    process.exit(1);
  }

  console.log(`AuraPad loop integrity — ${files.length} files, pass threshold wrap/max <= ${RATIO_LIMIT}\n`);
  console.log(
    `${'file'.padEnd(18)}${'rate'.padEnd(8)}${'len'.padEnd(7)}${'peak'.padEnd(7)}${'rms'.padEnd(8)}` +
      `${'wrapStep'.padEnd(11)}${'maxStep'.padEnd(11)}${'wrap/max'.padEnd(10)}result`,
  );
  console.log('-'.repeat(92));

  const failures = [];
  let worst = { ratio: 0, name: '' };

  for (const [name, path] of files) {
    const r = analyse(path);
    const ok = r.ratio <= RATIO_LIMIT && r.dc < 0.005 && r.peak <= 1.0;
    if (!ok) failures.push({ name, ...r });
    if (r.ratio > worst.ratio) worst = { ratio: r.ratio, name };

    console.log(
      name.padEnd(18) +
        `${r.sampleRate}`.padEnd(8) +
        `${r.seconds.toFixed(2)}s`.padEnd(7) +
        r.peak.toFixed(3).padEnd(7) +
        r.rms.toFixed(4).padEnd(8) +
        r.wrapStep.toExponential(2).padEnd(11) +
        r.maxStep.toExponential(2).padEnd(11) +
        r.ratio.toFixed(4).padEnd(10) +
        (ok ? 'PASS' : 'FAIL'),
    );
  }

  console.log('-'.repeat(92));
  console.log(`worst seam: ${worst.name} at ratio ${worst.ratio.toFixed(4)}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} file(s) would click on loop:`);
    for (const f of failures) console.error(`  ${f.name}  ratio=${f.ratio.toFixed(3)} dc=${f.dc.toFixed(5)}`);
    process.exit(1);
  }
  console.log('\nAll loops seamless.');
}

main();
