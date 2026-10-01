/**
 * AuraPad — pure gain math.
 *
 * Deliberately free of any React Native / Expo import so it can be unit-tested
 * in plain Node (see scripts/test-fades.mjs) and reasoned about in isolation.
 * Everything here is a pure function: same input, same output, no state.
 */

import type { FadeCurve, StemId, XYGains, XYPosition } from '../types/audio';

/** Floor of the fade range. Below this we treat the signal as silent. */
export const SILENCE_DB = -60;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Decibels → linear amplitude. -60dB ≈ 0.001, 0dB = 1. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Linear amplitude → decibels, floored at SILENCE_DB so log(0) never bites. */
export function gainToDb(gain: number): number {
  if (gain <= 0) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(gain));
}

/**
 * Gain of the INCOMING side of a crossfade at normalised time t (0 → 1).
 *
 * `logarithmic` is the default and the one the spec asks for: the gain is
 * linear in *decibels*, which is how hearing works, so the swell sounds even
 * from start to finish. A linear amplitude ramp, by contrast, appears to leap
 * to near-full-loudness in the first third and then crawl.
 *
 * Endpoints are pinned exactly to 0 and 1 so a fade always truly finishes.
 */
export function fadeInGain(t: number, curve: FadeCurve = 'logarithmic'): number {
  const x = clamp01(t);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  switch (curve) {
    case 'linear':
      return x;
    case 'equalPower':
      return Math.sin((x * Math.PI) / 2);
    case 'logarithmic':
    default:
      // Sweep from the silence floor up to 0dB, linearly in dB.
      return dbToGain(SILENCE_DB * (1 - x));
  }
}

/**
 * Gain of the OUTGOING side of a crossfade at normalised time t (0 → 1).
 * Mirrors fadeInGain so the pair is symmetric.
 */
export function fadeOutGain(t: number, curve: FadeCurve = 'logarithmic'): number {
  const x = clamp01(t);
  if (x <= 0) return 1;
  if (x >= 1) return 0;
  switch (curve) {
    case 'linear':
      return 1 - x;
    case 'equalPower':
      return Math.cos((x * Math.PI) / 2);
    case 'logarithmic':
    default:
      return dbToGain(SILENCE_DB * x);
  }
}

/**
 * Combined power through the crossover, as a fraction of a single source at
 * unity. Useful for tests and for reasoning about whether a curve dips.
 * equalPower holds this at 1.0 throughout; linear sags to ~0.707 at the middle.
 */
export function crossfadePower(t: number, curve: FadeCurve = 'logarithmic'): number {
  const a = fadeInGain(t, curve);
  const b = fadeOutGain(t, curve);
  return Math.sqrt(a * a + b * b);
}

// ---------------------------------------------------------------------------
// X/Y performance canvas → per-stem gain multipliers
// ---------------------------------------------------------------------------

/**
 * Translate a finger position on the performance canvas into a multiplier for
 * each stem. These multiply on top of the mixer faders, so 1.0 means "leave
 * the fader alone".
 *
 * X — simulated low-pass filter cutoff.
 *     Left (0)  = warm / dark : shimmer almost gone, body pushed slightly up.
 *     Right (1) = bright/open : shimmer wide open, body eased back so the top
 *                 end has room and the mix does not turn to mud.
 *     Real low-pass filtering is not available through a stock player API, so
 *     brightness is produced by rebalancing a dark stem against a bright one —
 *     which is how the effect reads to a listener anyway.
 *
 * Y — weight / density.
 *     Down (0) = soft / minimal : sub and texture pulled right back.
 *     Up   (1) = full / heavy   : sub and texture at full, body filled out.
 *
 * The exponents shape the *feel* of the travel. Sub uses >1 so the bottom end
 * stays controlled until you commit; texture uses <1 so the ambience creeps in
 * early and the move never sounds like a hard switch.
 */
export function computeXYGains(xy: XYPosition): XYGains {
  const x = clamp01(xy.x);
  const y = clamp01(xy.y);

  // --- X axis: brightness -------------------------------------------------
  const shimmerBrightness = 0.04 + 0.96 * Math.pow(x, 1.6);
  const baseDarkness = 1 - 0.25 * x; // opening up trims the body a little

  // --- Y axis: weight -----------------------------------------------------
  const subWeight = 0.08 + 0.92 * Math.pow(y, 1.3);
  const textureWeight = 0.1 + 0.9 * Math.pow(y, 0.75);
  const baseWeight = 0.55 + 0.45 * y;
  const shimmerWeight = 0.6 + 0.4 * y;

  return {
    base: clamp01(baseDarkness * baseWeight),
    shimmer: clamp01(shimmerBrightness * shimmerWeight),
    sub: clamp01(subWeight),
    texture: clamp01(textureWeight),
  };
}

/** Neutral multipliers — used when the canvas is disengaged. */
export const UNITY_XY_GAINS: XYGains = {
  base: 1,
  shimmer: 1,
  sub: 1,
  texture: 1,
};

/**
 * Final volume for one player.
 *
 *   master × fader × mute × canvas × fade
 *
 * Kept as a single function so the gain graph is defined in exactly one place
 * and the service can never drift from what the meters display.
 */
export function resolveChannelGain(params: {
  master: number;
  fader: number;
  muted: boolean;
  xyGain: number;
  fadeGain: number;
}): number {
  const { master, fader, muted, xyGain, fadeGain } = params;
  if (muted) return 0;
  return clamp01(clamp01(master) * clamp01(fader) * clamp01(xyGain) * clamp01(fadeGain));
}

/** Ordered stem list used when iterating the gain graph. */
export const GAIN_GRAPH_ORDER: readonly StemId[] = ['base', 'shimmer', 'sub', 'texture'];
