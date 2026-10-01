/**
 * AuraPad — core domain models.
 *
 * The four interfaces required by the spec (MusicalKey, StemMix, SongItem,
 * Setlist) are reproduced verbatim; everything below them is the supporting
 * vocabulary the engine needs.
 */

// ---------------------------------------------------------------------------
// Spec models (do not change shape — the rest of the app grounds on these)
// ---------------------------------------------------------------------------

export type MusicalKey = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export interface StemMix {
  baseVolume: number; // 0.0 to 1.0
  shimmerVolume: number; // 0.0 to 1.0
  subBassVolume: number; // 0.0 to 1.0
  textureVolume: number; // 0.0 to 1.0
}

export interface SongItem {
  id: string;
  title: string;
  targetKey: MusicalKey;
  fadeDurationSeconds: number;
  stemMix: StemMix;
  /** Optional performance note, e.g. "84 BPM · 6/8". Free text, display only. */
  tempoInfo?: string;
}

export interface Setlist {
  id: string;
  name: string;
  songs: SongItem[];
}

// ---------------------------------------------------------------------------
// Stems
// ---------------------------------------------------------------------------

/** Stems that exist once per musical key and are crossfaded on key change. */
export type PitchedStem = 'base' | 'shimmer' | 'sub';

/** Every stem channel on the mixer, including the key-independent texture bed. */
export type StemId = PitchedStem | 'texture';

export const PITCHED_STEMS: readonly PitchedStem[] = ['base', 'shimmer', 'sub'] as const;
export const STEM_IDS: readonly StemId[] = ['base', 'shimmer', 'sub', 'texture'] as const;

/** The three ambience beds. Texture is unpitched, so it is shared across keys. */
export type TextureId = 'vinyl' | 'rain' | 'room';
export const TEXTURE_IDS: readonly TextureId[] = ['vinyl', 'rain', 'room'] as const;

export interface StemDescriptor {
  id: StemId;
  /** Short label for the mixer strip. */
  label: string;
  /** One-line description shown under the fader. */
  description: string;
  /** Neon accent used by the UI for this channel. */
  color: string;
  /** Key into StemMix, so UI code can round-trip a preset generically. */
  mixKey: keyof StemMix;
}

export const STEM_DESCRIPTORS: readonly StemDescriptor[] = [
  {
    id: 'base',
    label: 'BASE PAD',
    description: 'Warm sustain core',
    color: '#4DA3FF',
    mixKey: 'baseVolume',
  },
  {
    id: 'shimmer',
    label: 'SHIMMER',
    description: 'High-octave sparkle',
    color: '#9D7BFF',
    mixKey: 'shimmerVolume',
  },
  {
    id: 'sub',
    label: 'SUB-BASS',
    description: '20–80 Hz drone',
    color: '#FF7A59',
    mixKey: 'subBassVolume',
  },
  {
    id: 'texture',
    label: 'TEXTURE',
    description: 'Ambient noise bed',
    color: '#39E6A8',
    mixKey: 'textureVolume',
  },
] as const;

/** Maps a mixer channel to its field in a StemMix preset. */
export const STEM_TO_MIX_KEY: Record<StemId, keyof StemMix> = {
  base: 'baseVolume',
  shimmer: 'shimmerVolume',
  sub: 'subBassVolume',
  texture: 'textureVolume',
};

export const MUSICAL_KEYS: readonly MusicalKey[] = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

// ---------------------------------------------------------------------------
// Fades
// ---------------------------------------------------------------------------

/** The configurable crossfade durations required by the spec. */
export const FADE_DURATION_OPTIONS: readonly number[] = [3, 5, 8];

/**
 * Shape of the gain ramp used when crossfading between keys.
 *  - `logarithmic`  gain is linear in decibels (the default; matches how the
 *                   ear perceives a fade, and is what hardware pad players do)
 *  - `equalPower`   sin/cos pair, holds constant total power through the
 *                   crossover — best when the two sources are uncorrelated
 *  - `linear`       raw amplitude ramp; dips ~3dB in the middle
 */
export type FadeCurve = 'logarithmic' | 'equalPower' | 'linear';

/** A crossfade in flight, surfaced to the UI for the status bar. */
export interface TransitionState {
  active: boolean;
  fromKey: MusicalKey | null;
  toKey: MusicalKey | null;
  /** 0 → 1 across the whole crossfade. */
  progress: number;
  durationSeconds: number;
}

// ---------------------------------------------------------------------------
// X/Y performance canvas
// ---------------------------------------------------------------------------

/**
 * Normalised finger position on the performance canvas.
 *  x: 0 = warm/dark (filter closed)   → 1 = bright/open (shimmer up)
 *  y: 0 = soft/minimal                → 1 = full/heavy (sub + texture up)
 */
export interface XYPosition {
  x: number;
  y: number;
}

/** Per-stem multipliers produced by the X/Y canvas, applied on top of the mix. */
export type XYGains = Record<StemId, number>;

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------

export interface MixerChannelState {
  volume: number;
  muted: boolean;
}

export type MixerState = Record<StemId, MixerChannelState>;

export interface EngineSnapshot {
  isPlaying: boolean;
  isReady: boolean;
  /** Keys currently loaded into memory, newest last. */
  loadedKeys: MusicalKey[];
  currentKey: MusicalKey | null;
  /** Key the sub-bass is pinned to while Drone Lock is engaged. */
  droneLockedKey: MusicalKey | null;
  masterVolume: number;
  mixer: MixerState;
  /**
   * Bumped only when a whole mix is applied from outside (a setlist preset),
   * never by an individual fader move. UI faders use it as a React `key` so
   * they remount — and therefore re-seed — on preset recall only.
   */
  mixGeneration: number;
  transition: TransitionState;
  droneLock: boolean;
  texture: TextureId;
  fadeDurationSeconds: number;
  fadeCurve: FadeCurve;
  xy: XYPosition;
  /** True while the performance canvas is overriding the faders. */
  xyEngaged: boolean;
  /** Live post-everything gain per channel, for the meter bridge. */
  outputGains: XYGains;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_STEM_MIX: StemMix = {
  baseVolume: 0.85,
  shimmerVolume: 0.55,
  subBassVolume: 0.7,
  textureVolume: 0.3,
};

/** Centre of the canvas — neutral, no colouration. */
export const DEFAULT_XY: XYPosition = { x: 0.5, y: 0.5 };

export const DEFAULT_MIXER: MixerState = {
  base: { volume: DEFAULT_STEM_MIX.baseVolume, muted: false },
  shimmer: { volume: DEFAULT_STEM_MIX.shimmerVolume, muted: false },
  sub: { volume: DEFAULT_STEM_MIX.subBassVolume, muted: false },
  texture: { volume: DEFAULT_STEM_MIX.textureVolume, muted: false },
};

export function mixToMixerState(mix: StemMix, previous?: MixerState): MixerState {
  return {
    base: { volume: mix.baseVolume, muted: previous?.base.muted ?? false },
    shimmer: { volume: mix.shimmerVolume, muted: previous?.shimmer.muted ?? false },
    sub: { volume: mix.subBassVolume, muted: previous?.sub.muted ?? false },
    texture: { volume: mix.textureVolume, muted: previous?.texture.muted ?? false },
  };
}

export function mixerStateToMix(mixer: MixerState): StemMix {
  return {
    baseVolume: mixer.base.volume,
    shimmerVolume: mixer.shimmer.volume,
    subBassVolume: mixer.sub.volume,
    textureVolume: mixer.texture.volume,
  };
}
