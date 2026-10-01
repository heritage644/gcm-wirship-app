#!/usr/bin/env node
/**
 * AuraPad — synthetic pad-loop generator.
 * ---------------------------------------------------------------------------
 * Renders a complete, royalty-free placeholder sample library so the app has
 * real audio to play the moment you clone the repo:
 *
 *   src/assets/audio/pads/<key>/base.wav      12 keys  (warm sustain core)
 *   src/assets/audio/pads/<key>/shimmer.wav   12 keys  (high-octave sparkle)
 *   src/assets/audio/pads/<key>/sub.wav       12 keys  (20-80Hz sub drone)
 *   src/assets/audio/textures/<name>.wav       3 beds  (vinyl / rain / room)
 *   src/assets/audio/index.ts                 static require() registry
 *
 * SEAMLESS LOOPING is the whole ballgame here. Two techniques are used:
 *
 *  1. Tonal stems (base/shimmer/sub) — every partial and every LFO frequency is
 *     quantised onto the loop's harmonic grid (integer multiples of
 *     1 / loopSeconds). A waveform built only from exact harmonics of the loop
 *     period is mathematically periodic at that period, so sample N-1 flows
 *     into sample 0 with zero discontinuity: no click, no gap, no DC step.
 *     Max detune from quantisation is 1/(2*loopSeconds) Hz — well under a cent
 *     at pad frequencies, so it is inaudible.
 *
 *  2. Noise textures — true noise cannot be harmonic-quantised, so we render
 *     loopSeconds + tail, then wrap-crossfade the tail back over the head with
 *     an equal-power curve. The result is continuous across the boundary.
 *
 * Usage:  node scripts/generate-audio.mjs [--quick]
 *         --quick  renders only C/E/G (fast smoke-test render)
 */

import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AUDIO_DIR = join(ROOT, 'src', 'assets', 'audio');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Filesystem-safe slug for a key name ('C#' -> 'Cs'). */
const slug = (key) => key.replace('#', 's');

/** Equal-tempered frequency of <key> in the given octave. A4 = 440Hz. */
function noteFrequency(key, octave) {
  const semitone = KEYS.indexOf(key); // C = 0
  // MIDI note number: C4 = 60.
  const midi = 12 * (octave + 1) + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const LOOP_SECONDS = 6;

const STEM_RENDER = {
  // Full-band content needs the higher rate; the sub drone genuinely does not.
  base: { sampleRate: 22050, peak: 0.72 },
  shimmer: { sampleRate: 22050, peak: 0.5 },
  sub: { sampleRate: 8000, peak: 0.85 },
  texture: { sampleRate: 22050, peak: 0.42 },
};

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — identical output on every machine/run.
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-key seed so a given key always renders byte-identically. */
const keySeed = (key, salt) => {
  let h = salt;
  for (const ch of key) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h;
};

// ---------------------------------------------------------------------------
// Harmonic-grid quantisation — the key to click-free loops
// ---------------------------------------------------------------------------

/**
 * Snap `freq` to the nearest integer number of cycles per loop so the partial
 * closes exactly on the loop boundary. Never returns 0 cycles.
 */
function quantise(freq, loopSeconds) {
  const cycles = Math.max(1, Math.round(freq * loopSeconds));
  return cycles / loopSeconds;
}

/** Same, but allows 0 (used for LFOs that may legitimately be static). */
function quantiseLfo(freq, loopSeconds) {
  const cycles = Math.max(1, Math.round(freq * loopSeconds));
  return cycles / loopSeconds;
}

// ---------------------------------------------------------------------------
// WAV encoding (16-bit PCM, mono)
// ---------------------------------------------------------------------------

function encodeWav(samples, sampleRate) {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataBytes = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < numSamples; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetric 16-bit range: -32768..32767
    const value = clamped < 0 ? clamped * 32768 : clamped * 32767;
    buffer.writeInt16LE(Math.round(value), 44 + i * bytesPerSample);
  }
  return buffer;
}

/** Peak-normalise in place, then apply a tiny safety ceiling. */
function normalise(samples, peak) {
  let max = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i]);
    if (abs > max) max = abs;
  }
  if (max < 1e-9) return samples;
  const gain = peak / max;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  return samples;
}

/** Remove any DC offset — a DC step at the loop point is an audible click. */
function removeDc(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i];
  const mean = sum / samples.length;
  for (let i = 0; i < samples.length; i += 1) samples[i] -= mean;
  return samples;
}

// ---------------------------------------------------------------------------
// Stem synthesis
// ---------------------------------------------------------------------------

/**
 * BASE PAD — warm sustain core.
 * Detuned saw-ish stack over root/fifth/octave with slow harmonic breathing.
 */
function renderBase(key) {
  const { sampleRate } = STEM_RENDER.base;
  const n = Math.round(sampleRate * LOOP_SECONDS);
  const out = new Float64Array(n);
  const rng = makeRng(keySeed(key, 0x9e3779b9));

  const root = noteFrequency(key, 3); // low-mid body
  // Root, fifth, octave, octave+fifth — a classic open worship-pad voicing.
  const voicing = [1, 1.5, 2, 3, 4];
  // Gentle detune pairs give the chorus/ensemble width of a real pad.
  const detuneCents = [-7, 0, 7];

  for (let v = 0; v < voicing.length; v += 1) {
    const voiceFreq = root * voicing[v];
    const voiceGain = 1 / (1 + v * 0.85);

    for (const cents of detuneCents) {
      const detuned = voiceFreq * Math.pow(2, cents / 1200);

      // Build a band-limited saw: harmonics with 1/h rolloff, hard-capped
      // below Nyquist so nothing aliases.
      const maxHarmonic = Math.min(14, Math.floor(sampleRate / 2 / detuned) - 1);
      for (let h = 1; h <= maxHarmonic; h += 1) {
        const f = quantise(detuned * h, LOOP_SECONDS);
        if (f >= sampleRate / 2) continue;

        const phase = rng() * Math.PI * 2;
        const harmonicGain = (voiceGain / Math.pow(h, 1.35)) * 0.4;

        // Slow amplitude breathing, also quantised so it loops cleanly.
        const lfoRate = quantiseLfo(0.08 + rng() * 0.22, LOOP_SECONDS);
        const lfoPhase = rng() * Math.PI * 2;
        const lfoDepth = 0.18 + rng() * 0.22;

        const w = 2 * Math.PI * f;
        const wl = 2 * Math.PI * lfoRate;
        for (let i = 0; i < n; i += 1) {
          const t = i / sampleRate;
          const amp = 1 - lfoDepth + lfoDepth * (0.5 + 0.5 * Math.sin(wl * t + lfoPhase));
          out[i] += Math.sin(w * t + phase) * harmonicGain * amp;
        }
      }
    }
  }

  // One-pole lowpass to round off the top end into "warm".
  onePoleLowpass(out, sampleRate, 2600);
  return normalise(removeDc(out), STEM_RENDER.base.peak);
}

/**
 * SHIMMER — high-octave sparkle and ambient motion.
 * Bell-like partials two/three octaves up with tremolo + slow stereo-ish drift.
 */
function renderShimmer(key) {
  const { sampleRate } = STEM_RENDER.shimmer;
  const n = Math.round(sampleRate * LOOP_SECONDS);
  const out = new Float64Array(n);
  const rng = makeRng(keySeed(key, 0x85ebca6b));

  const root = noteFrequency(key, 5); // two octaves above the pad body
  // Root, fifth, octave, maj-ninth, two octaves — airy and consonant.
  const voicing = [1, 1.5, 2, 2.25, 3, 4, 6];

  for (let v = 0; v < voicing.length; v += 1) {
    const f0 = root * voicing[v];
    if (f0 >= sampleRate / 2) continue;

    const partials = 3;
    for (let p = 1; p <= partials; p += 1) {
      const f = quantise(f0 * p, LOOP_SECONDS);
      if (f >= sampleRate / 2 * 0.92) continue;

      const phase = rng() * Math.PI * 2;
      const gain = (0.55 / (1 + v * 0.7)) / Math.pow(p, 1.9);

      // Fast-ish tremolo gives the "shimmer" motion.
      const lfoRate = quantiseLfo(0.35 + rng() * 1.5, LOOP_SECONDS);
      const lfoPhase = rng() * Math.PI * 2;
      const lfoDepth = 0.45 + rng() * 0.4;

      const w = 2 * Math.PI * f;
      const wl = 2 * Math.PI * lfoRate;
      for (let i = 0; i < n; i += 1) {
        const t = i / sampleRate;
        const amp = 1 - lfoDepth + lfoDepth * (0.5 + 0.5 * Math.sin(wl * t + lfoPhase));
        out[i] += Math.sin(w * t + phase) * gain * amp;
      }
    }
  }

  // Highpass away any mud so shimmer sits above the base pad.
  onePoleHighpass(out, sampleRate, 700);
  return normalise(removeDc(out), STEM_RENDER.shimmer.peak);
}

/**
 * SUB-BASS — 20Hz..80Hz drone profile.
 * Near-sine fundamental with a whisper of 2nd harmonic for speaker translation
 * (tiny phone speakers cannot reproduce 40Hz; the harmonic implies the pitch).
 */
function renderSub(key) {
  const { sampleRate } = STEM_RENDER.sub;
  const n = Math.round(sampleRate * LOOP_SECONDS);
  const out = new Float64Array(n);
  const rng = makeRng(keySeed(key, 0xc2b2ae35));

  // Pick the octave that lands the fundamental inside the 20-80Hz window.
  let fundamental = noteFrequency(key, 1); // C1 = 32.7Hz
  while (fundamental > 80) fundamental /= 2;
  while (fundamental < 20) fundamental *= 2;

  const partials = [
    { mult: 1, gain: 1.0 },
    { mult: 2, gain: 0.16 },
    { mult: 3, gain: 0.05 },
  ];

  for (const { mult, gain } of partials) {
    const f = quantise(fundamental * mult, LOOP_SECONDS);
    const phase = rng() * Math.PI * 2;
    const lfoRate = quantiseLfo(0.1 + rng() * 0.12, LOOP_SECONDS);
    const lfoPhase = rng() * Math.PI * 2;
    const lfoDepth = 0.1;

    const w = 2 * Math.PI * f;
    const wl = 2 * Math.PI * lfoRate;
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      const amp = 1 - lfoDepth + lfoDepth * (0.5 + 0.5 * Math.sin(wl * t + lfoPhase));
      out[i] += Math.sin(w * t + phase) * gain * amp;
    }
  }

  onePoleLowpass(out, sampleRate, 220);
  return normalise(removeDc(out), STEM_RENDER.sub.peak);
}

/**
 * TEXTURE beds — key-independent ambience.
 * Noise cannot be harmonic-quantised, so these are wrap-crossfaded instead.
 */
function renderTexture(name) {
  const { sampleRate } = STEM_RENDER.texture;
  const loopLen = Math.round(sampleRate * LOOP_SECONDS);
  const tail = Math.round(sampleRate * 1.0); // 1s wrap-crossfade region
  const n = loopLen + tail;
  const raw = new Float64Array(n);
  const rng = makeRng(keySeed(name, 0x27d4eb2f));

  if (name === 'vinyl') {
    // Soft pink-ish floor plus sparse crackle transients.
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < n; i += 1) {
      const white = rng() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      raw[i] = (b0 + b1 + white * 0.1848) * 0.16;
    }
    // Crackle: short decaying impulses at random positions.
    const crackles = Math.round(LOOP_SECONDS * 26);
    for (let c = 0; c < crackles; c += 1) {
      const at = Math.floor(rng() * n);
      const amp = (0.25 + rng() * 0.75) * 0.55;
      const len = Math.max(4, Math.round(sampleRate * (0.0008 + rng() * 0.004)));
      for (let i = 0; i < len && at + i < n; i += 1) {
        const env = Math.exp((-6 * i) / len);
        raw[at + i] += (rng() * 2 - 1) * amp * env;
      }
    }
  } else if (name === 'rain') {
    // Dense high-frequency droplets over a filtered hiss bed.
    for (let i = 0; i < n; i += 1) raw[i] = (rng() * 2 - 1) * 0.3;
    onePoleHighpass(raw, sampleRate, 900);
    const drops = Math.round(LOOP_SECONDS * 900);
    for (let d = 0; d < drops; d += 1) {
      const at = Math.floor(rng() * n);
      const amp = (0.15 + rng() * 0.5) * 0.18;
      const len = Math.max(6, Math.round(sampleRate * (0.001 + rng() * 0.006)));
      for (let i = 0; i < len && at + i < n; i += 1) {
        const env = Math.exp((-5 * i) / len);
        raw[at + i] += (rng() * 2 - 1) * amp * env;
      }
    }
    onePoleLowpass(raw, sampleRate, 7000);
  } else {
    // 'room' — warm brown-noise room tone, very dark and steady.
    let last = 0;
    for (let i = 0; i < n; i += 1) {
      const white = rng() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      raw[i] = last * 3.5;
    }
    onePoleLowpass(raw, sampleRate, 1400);
    onePoleHighpass(raw, sampleRate, 45);
  }

  // Wrap-crossfade: blend the tail back over the head with equal power so the
  // end of the loop already *is* the beginning.
  const out = new Float64Array(loopLen);
  out.set(raw.subarray(0, loopLen));
  for (let i = 0; i < tail; i += 1) {
    const x = i / tail; // 0 -> 1
    const fadeIn = Math.sin((x * Math.PI) / 2);
    const fadeOut = Math.cos((x * Math.PI) / 2);
    out[i] = raw[i] * fadeIn + raw[loopLen + i] * fadeOut;
  }

  return normalise(removeDc(out), STEM_RENDER.texture.peak);
}

// ---------------------------------------------------------------------------
// Minimal one-pole filters (applied in place)
// ---------------------------------------------------------------------------

/*
 * Both filters run a "circular warm-up" lap before the real pass.
 *
 * A causal IIR filter started from a cold state produces a start-up transient,
 * which means that even a perfectly periodic input comes out NON-periodic —
 * and a non-periodic buffer clicks at the loop point. Running one full lap
 * over the buffer purely to settle the filter state leaves the filter in its
 * periodic steady state, so the real pass that follows is periodic too.
 * One lap is many thousands of time constants at these cutoffs, so the state
 * is fully converged.
 */

function onePoleLowpass(buf, sampleRate, cutoffHz) {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = dt / (rc + dt);
  const n = buf.length;
  // Two passes = 12dB/oct, gentler and more "analogue" than a single pass.
  for (let pass = 0; pass < 2; pass += 1) {
    let y = buf[0];
    for (let i = 0; i < n; i += 1) y += alpha * (buf[i] - y); // warm-up lap
    for (let i = 0; i < n; i += 1) {
      y += alpha * (buf[i] - y);
      buf[i] = y;
    }
  }
  return buf;
}

function onePoleHighpass(buf, sampleRate, cutoffHz) {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = rc / (rc + dt);
  const n = buf.length;
  let prevIn = buf[n - 1]; // the sample that circularly precedes buf[0]
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    const x = buf[i];
    y = alpha * (y + x - prevIn);
    prevIn = x;
  }
  for (let i = 0; i < n; i += 1) {
    const x = buf[i];
    y = alpha * (y + x - prevIn);
    prevIn = x;
    buf[i] = y;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Registry emitter — Metro needs *static* require() calls, so we write them out
// ---------------------------------------------------------------------------

function writeRegistry(keys, textures) {
  const lines = [];
  lines.push('/**');
  lines.push(' * AUTO-GENERATED by scripts/generate-audio.mjs — do not edit by hand.');
  lines.push(' * Run `npm run generate:audio` to regenerate.');
  lines.push(' *');
  lines.push(' * Metro only understands *static* require() calls, so the whole sample');
  lines.push(' * library has to be spelled out literally rather than built from a template.');
  lines.push(' */');
  lines.push('');
  lines.push("import type { MusicalKey, PitchedStem, TextureId } from '../../types/audio';");
  lines.push('');
  lines.push('export type AudioModule = number;');
  lines.push('');
  lines.push('export const PAD_LIBRARY: Record<MusicalKey, Record<PitchedStem, AudioModule>> = {');
  for (const key of keys) {
    const d = slug(key);
    lines.push(`  '${key}': {`);
    lines.push(`    base: require('./pads/${d}/base.wav'),`);
    lines.push(`    shimmer: require('./pads/${d}/shimmer.wav'),`);
    lines.push(`    sub: require('./pads/${d}/sub.wav'),`);
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  lines.push('export const TEXTURE_LIBRARY: Record<TextureId, AudioModule> = {');
  for (const t of textures) {
    lines.push(`  ${t}: require('./textures/${t}.wav'),`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Length of every generated loop, in seconds. */');
  lines.push(`export const LOOP_LENGTH_SECONDS = ${LOOP_SECONDS};`);
  lines.push('');
  writeFileSync(join(AUDIO_DIR, 'index.ts'), lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const quick = process.argv.includes('--quick');
  const keys = quick ? ['C', 'E', 'G'] : KEYS;
  const textures = ['vinyl', 'rain', 'room'];

  if (existsSync(join(AUDIO_DIR, 'pads'))) {
    rmSync(join(AUDIO_DIR, 'pads'), { recursive: true, force: true });
  }
  mkdirSync(join(AUDIO_DIR, 'textures'), { recursive: true });

  let totalBytes = 0;
  const t0 = Date.now();

  for (const key of keys) {
    const dir = join(AUDIO_DIR, 'pads', slug(key));
    mkdirSync(dir, { recursive: true });

    const jobs = [
      ['base', renderBase(key), STEM_RENDER.base.sampleRate],
      ['shimmer', renderShimmer(key), STEM_RENDER.shimmer.sampleRate],
      ['sub', renderSub(key), STEM_RENDER.sub.sampleRate],
    ];

    for (const [name, samples, rate] of jobs) {
      const wav = encodeWav(samples, rate);
      writeFileSync(join(dir, `${name}.wav`), wav);
      totalBytes += wav.length;
    }
    process.stdout.write(`  rendered ${key.padEnd(2)} \u2713\n`);
  }

  for (const name of textures) {
    const wav = encodeWav(renderTexture(name), STEM_RENDER.texture.sampleRate);
    writeFileSync(join(AUDIO_DIR, 'textures', `${name}.wav`), wav);
    totalBytes += wav.length;
    process.stdout.write(`  rendered texture:${name} \u2713\n`);
  }

  writeRegistry(keys, textures);

  const mb = (totalBytes / 1024 / 1024).toFixed(2);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(
    `\nAuraPad sample library ready: ${keys.length * 3 + textures.length} files, ${mb} MB, ${secs}s\n`,
  );
  if (quick) process.stdout.write('(--quick: only C/E/G rendered)\n');
}

main();
