/**
 * AuraPad procedural workstation-inspired pad engine.
 *
 * This is an original Web Audio synthesis layer, not Yamaha firmware, a ROM
 * dump, or a set of Yamaha factory samples. The fourteen profiles below are
 * designed to evoke the requested patch families using oscillators, filters,
 * modulation, delay, and convolution reverb. Optional WAV samples can be
 * supplied by the host; if a sample is not loaded the synth voice is used.
 *
 * AudioContext creation is lazy so importing this module is safe during SSR,
 * Expo native startup, and tests. Call `initialize()` from a user gesture
 * before starting playback in a browser.
 */

import { MUSICAL_KEYS } from '../../types/audio';
import type { FadeCurve, MusicalKey, XYPosition } from '../../types/audio';
import { fadeInGain, fadeOutGain } from '../../services/fades';
import { ReverbEngine } from './ReverbEngine';

export type YamahaPresetId =
  | 'anadayz-pad'
  | 'wax-and-wane'
  | 'ocean-pad'
  | 'an-x-pad'
  | 'an-x-sine-pad'
  | 'analog-pad'
  | 'bell-pad'
  | 'morphing-pad'
  | 'motion-pad'
  | 'solo-1st-violin-af1'
  | 'solo-viola-af1'
  | 'solo-cello-af1'
  | 'strings-and-brass'
  | 'universal-comp';

export type YamahaPresetCategory =
  | 'Atmospheric & Analog Pads'
  | 'Motion & Bell Pads'
  | 'Orchestral Strings & Layered Brass'
  | 'Harmonic Comps';

export interface OscillatorLayer {
  waveform: 'sine' | 'triangle' | 'sawtooth' | 'square';
  /** Octave displacement from the selected key's C3-based root note. */
  octave: number;
  detuneCents: number;
  gain: number;
  /** A short, bell-like pluck layered over the sustained pad. */
  transient?: boolean;
}

export interface YamahaPresetDefinition {
  id: YamahaPresetId;
  name: string;
  category: YamahaPresetCategory;
  description: string;
  layers: readonly OscillatorLayer[];
  filter: {
    type: 'lowpass' | 'bandpass';
    cutoffHz: number;
    resonance: number;
    stages: 1 | 2;
  };
  envelope: {
    attackSeconds: number;
    releaseSeconds: number;
    sustain: number;
  };
  lfo: {
    rateHz: number;
    /** If set, rate follows this many sequencer beats per cycle. */
    syncEveryBeats: number | null;
    filterDepthHz: number;
    vibratoCents: number;
  };
  chorus: {
    wet: number;
    rateHz: number;
    depthSeconds: number;
  };
  delay: {
    wet: number;
    timeSeconds: number;
    feedback: number;
  };
  reverbWet: number;
}

interface PresetTuning {
  filter?: Partial<YamahaPresetDefinition['filter']>;
  envelope?: Partial<YamahaPresetDefinition['envelope']>;
  lfo?: Partial<YamahaPresetDefinition['lfo']>;
  chorus?: Partial<YamahaPresetDefinition['chorus']>;
  delay?: Partial<YamahaPresetDefinition['delay']>;
  reverbWet?: number;
}

function definePreset(
  id: YamahaPresetId,
  name: string,
  category: YamahaPresetCategory,
  description: string,
  layers: readonly OscillatorLayer[],
  tuning: PresetTuning = {},
): YamahaPresetDefinition {
  return {
    id,
    name,
    category,
    description,
    layers,
    filter: {
      type: 'lowpass',
      cutoffHz: 1_600,
      resonance: 0.55,
      stages: 1,
      ...tuning.filter,
    },
    envelope: {
      attackSeconds: 0.8,
      releaseSeconds: 2.2,
      sustain: 0.72,
      ...tuning.envelope,
    },
    lfo: {
      rateHz: 0.18,
      syncEveryBeats: null,
      filterDepthHz: 0,
      vibratoCents: 0,
      ...tuning.lfo,
    },
    chorus: {
      wet: 0,
      rateHz: 0.22,
      depthSeconds: 0.003,
      ...tuning.chorus,
    },
    delay: {
      wet: 0,
      timeSeconds: 0.32,
      feedback: 0.18,
      ...tuning.delay,
    },
    reverbWet: tuning.reverbWet ?? 0.28,
  };
}

const ATMOSPHERIC: YamahaPresetCategory = 'Atmospheric & Analog Pads';
const MOTION: YamahaPresetCategory = 'Motion & Bell Pads';
const ORCHESTRAL: YamahaPresetCategory = 'Orchestral Strings & Layered Brass';
const COMPS: YamahaPresetCategory = 'Harmonic Comps';

/** Fourteen original synthesis profiles, grouped by the requested engine families. */
export const YAMAHA_PRESETS: Record<YamahaPresetId, YamahaPresetDefinition> = {
  'anadayz-pad': definePreset(
    'anadayz-pad',
    'Anadayz Pad',
    ATMOSPHERIC,
    'Warm, wide analog-style sustain with gentle detuning and a slow chorus.',
    [
      { waveform: 'sawtooth', octave: 0, detuneCents: -7, gain: 0.18 },
      { waveform: 'sawtooth', octave: 0, detuneCents: 7, gain: 0.18 },
      { waveform: 'triangle', octave: 1, detuneCents: 0, gain: 0.08 },
    ],
    {
      filter: { cutoffHz: 1_850, resonance: 0.42 },
      envelope: { attackSeconds: 1.1, releaseSeconds: 2.8, sustain: 0.68 },
      chorus: { wet: 0.32, rateHz: 0.19, depthSeconds: 0.005 },
      reverbWet: 0.34,
    },
  ),
  'wax-and-wane': definePreset(
    'wax-and-wane',
    'Wax And Wane',
    ATMOSPHERIC,
    'A breathing low-pass pad with a filter sweep that cycles every eight beats.',
    [
      { waveform: 'sawtooth', octave: 0, detuneCents: -5, gain: 0.2 },
      { waveform: 'triangle', octave: 0, detuneCents: 5, gain: 0.16 },
    ],
    {
      filter: { cutoffHz: 1_250, resonance: 0.72, stages: 2 },
      envelope: { attackSeconds: 1.4, releaseSeconds: 2.4, sustain: 0.7 },
      lfo: { syncEveryBeats: 8, filterDepthHz: 650 },
      chorus: { wet: 0.18 },
      reverbWet: 0.36,
    },
  ),
  'ocean-pad': definePreset(
    'ocean-pad',
    'Ocean Pad',
    ATMOSPHERIC,
    'Deep sine foundation, airy upper partials, and a long diffuse tail.',
    [
      { waveform: 'sine', octave: -1, detuneCents: 0, gain: 0.36 },
      { waveform: 'triangle', octave: 0, detuneCents: -3, gain: 0.13 },
      { waveform: 'sine', octave: 2, detuneCents: 4, gain: 0.035 },
    ],
    {
      filter: { cutoffHz: 2_650, resonance: 0.28 },
      envelope: { attackSeconds: 2.2, releaseSeconds: 3.4, sustain: 0.76 },
      lfo: { rateHz: 0.12, filterDepthHz: 180 },
      delay: { wet: 0.16, timeSeconds: 0.42, feedback: 0.22 },
      reverbWet: 0.47,
    },
  ),
  'an-x-pad': definePreset(
    'an-x-pad',
    'AN-X Pad',
    ATMOSPHERIC,
    'A dense dual-oscillator analog voice with a weighty low-mid center.',
    [
      { waveform: 'sawtooth', octave: 0, detuneCents: -9, gain: 0.21 },
      { waveform: 'sawtooth', octave: 0, detuneCents: 9, gain: 0.2 },
      { waveform: 'sine', octave: -1, detuneCents: 0, gain: 0.12 },
    ],
    {
      filter: { cutoffHz: 930, resonance: 0.7, stages: 2 },
      envelope: { attackSeconds: 0.72, releaseSeconds: 2.5, sustain: 0.76 },
      chorus: { wet: 0.2, depthSeconds: 0.004 },
      reverbWet: 0.26,
    },
  ),
  'an-x-sine-pad': definePreset(
    'an-x-sine-pad',
    'AN-X Sine Pad',
    ATMOSPHERIC,
    'Minimal, rounded sine sustain for intimate piano and vocal moments.',
    [
      { waveform: 'sine', octave: -1, detuneCents: 0, gain: 0.38 },
      { waveform: 'sine', octave: 0, detuneCents: 0, gain: 0.12 },
    ],
    {
      filter: { cutoffHz: 2_100, resonance: 0.08 },
      envelope: { attackSeconds: 1.6, releaseSeconds: 3.1, sustain: 0.68 },
      reverbWet: 0.32,
    },
  ),
  'analog-pad': definePreset(
    'analog-pad',
    'Analog Pad',
    ATMOSPHERIC,
    'Vintage saw-and-triangle stack through a two-stage 24 dB-style low-pass.',
    [
      { waveform: 'sawtooth', octave: 0, detuneCents: -6, gain: 0.18 },
      { waveform: 'triangle', octave: 0, detuneCents: 6, gain: 0.18 },
      { waveform: 'sawtooth', octave: 1, detuneCents: 0, gain: 0.045 },
    ],
    {
      filter: { cutoffHz: 1_050, resonance: 0.56, stages: 2 },
      envelope: { attackSeconds: 0.95, releaseSeconds: 2.6, sustain: 0.72 },
      chorus: { wet: 0.14 },
      reverbWet: 0.29,
    },
  ),
  'bell-pad': definePreset(
    'bell-pad',
    'Bell Pad',
    MOTION,
    'A soft upper-octave bell transient floating over a slow warm pad.',
    [
      { waveform: 'triangle', octave: 0, detuneCents: -4, gain: 0.18 },
      { waveform: 'sawtooth', octave: 0, detuneCents: 4, gain: 0.12 },
      { waveform: 'sine', octave: 2, detuneCents: 0, gain: 0.075, transient: true },
    ],
    {
      filter: { cutoffHz: 2_500, resonance: 0.2 },
      envelope: { attackSeconds: 1.05, releaseSeconds: 2.5, sustain: 0.68 },
      chorus: { wet: 0.13 },
      delay: { wet: 0.13, timeSeconds: 0.38, feedback: 0.16 },
      reverbWet: 0.42,
    },
  ),
  'morphing-pad': definePreset(
    'morphing-pad',
    'Morphing Pad',
    MOTION,
    'A slow timbral drift between dark saw harmonics and a bright upper layer.',
    [
      { waveform: 'sawtooth', octave: 0, detuneCents: -5, gain: 0.17 },
      { waveform: 'triangle', octave: 1, detuneCents: 5, gain: 0.1 },
      { waveform: 'sine', octave: 2, detuneCents: 0, gain: 0.035 },
    ],
    {
      filter: { cutoffHz: 1_400, resonance: 0.58, stages: 2 },
      envelope: { attackSeconds: 1.7, releaseSeconds: 2.8, sustain: 0.7 },
      lfo: { rateHz: 0.11, filterDepthHz: 520 },
      chorus: { wet: 0.22, rateHz: 0.14, depthSeconds: 0.004 },
      reverbWet: 0.38,
    },
  ),
  'motion-pad': definePreset(
    'motion-pad',
    'Motion Pad',
    MOTION,
    'A rhythmic filter motion locked to the sequencer BPM.',
    [
      { waveform: 'sawtooth', octave: 0, detuneCents: -4, gain: 0.17 },
      { waveform: 'square', octave: 1, detuneCents: 4, gain: 0.045 },
    ],
    {
      filter: { cutoffHz: 1_500, resonance: 0.78, stages: 2 },
      envelope: { attackSeconds: 0.82, releaseSeconds: 2.1, sustain: 0.68 },
      lfo: { syncEveryBeats: 2, filterDepthHz: 720 },
      chorus: { wet: 0.17 },
      reverbWet: 0.31,
    },
  ),
  'solo-1st-violin-af1': definePreset(
    'solo-1st-violin-af1',
    'Solo 1stViolin AF1',
    ORCHESTRAL,
    'A singing, expression-shaped violin-like synth with a restrained vibrato tail.',
    [
      { waveform: 'sawtooth', octave: 0, detuneCents: -3, gain: 0.13 },
      { waveform: 'triangle', octave: 0, detuneCents: 3, gain: 0.12 },
      { waveform: 'sine', octave: 1, detuneCents: 0, gain: 0.025 },
    ],
    {
      filter: { type: 'bandpass', cutoffHz: 1_650, resonance: 0.45 },
      envelope: { attackSeconds: 1.2, releaseSeconds: 2.5, sustain: 0.68 },
      lfo: { rateHz: 5.1, vibratoCents: 5 },
      chorus: { wet: 0.12, rateHz: 0.16 },
      reverbWet: 0.32,
    },
  ),
  'solo-viola-af1': definePreset(
    'solo-viola-af1',
    'Solo Viola AF1',
    ORCHESTRAL,
    'A warm midrange bowed-string approximation with a soft, rounded body.',
    [
      { waveform: 'triangle', octave: -1, detuneCents: -2, gain: 0.22 },
      { waveform: 'sawtooth', octave: 0, detuneCents: 2, gain: 0.075 },
    ],
    {
      filter: { type: 'bandpass', cutoffHz: 520, resonance: 0.38 },
      envelope: { attackSeconds: 1.45, releaseSeconds: 2.7, sustain: 0.72 },
      lfo: { rateHz: 4.7, vibratoCents: 3.5 },
      reverbWet: 0.3,
    },
  ),
  'solo-cello-af1': definePreset(
    'solo-cello-af1',
    'Solo Cello AF1',
    ORCHESTRAL,
    'A low, mellow cello-like drone with a slow bow swell and controlled top end.',
    [
      { waveform: 'sawtooth', octave: -1, detuneCents: -2, gain: 0.16 },
      { waveform: 'sine', octave: -1, detuneCents: 0, gain: 0.23 },
      { waveform: 'triangle', octave: 0, detuneCents: 2, gain: 0.045 },
    ],
    {
      filter: { cutoffHz: 720, resonance: 0.25, stages: 2 },
      envelope: { attackSeconds: 1.7, releaseSeconds: 3.2, sustain: 0.74 },
      lfo: { rateHz: 4.4, vibratoCents: 2.2 },
      reverbWet: 0.27,
    },
  ),
  'strings-and-brass': definePreset(
    'strings-and-brass',
    'Strings & Brass',
    ORCHESTRAL,
    'A broad orchestral-style stack with brass-like upper harmonics for climaxes.',
    [
      { waveform: 'sawtooth', octave: -1, detuneCents: -8, gain: 0.15 },
      { waveform: 'sawtooth', octave: 0, detuneCents: 8, gain: 0.15 },
      { waveform: 'square', octave: 0, detuneCents: 0, gain: 0.045 },
      { waveform: 'triangle', octave: 1, detuneCents: 0, gain: 0.045 },
    ],
    {
      filter: { cutoffHz: 1_950, resonance: 0.48, stages: 2 },
      envelope: { attackSeconds: 0.62, releaseSeconds: 2.6, sustain: 0.75 },
      chorus: { wet: 0.24, depthSeconds: 0.004 },
      delay: { wet: 0.08, timeSeconds: 0.29, feedback: 0.15 },
      reverbWet: 0.4,
    },
  ),
  'universal-comp': definePreset(
    'universal-comp',
    'Universal Comp',
    COMPS,
    'A focused, pulsing harmonic layer that sits beneath a live piano or guitar.',
    [
      { waveform: 'triangle', octave: 0, detuneCents: -2, gain: 0.16 },
      { waveform: 'sawtooth', octave: 0, detuneCents: 2, gain: 0.08 },
      { waveform: 'sine', octave: 1, detuneCents: 0, gain: 0.022 },
    ],
    {
      filter: { cutoffHz: 1_150, resonance: 0.58, stages: 2 },
      envelope: { attackSeconds: 0.24, releaseSeconds: 1.25, sustain: 0.64 },
      lfo: { syncEveryBeats: 1, filterDepthHz: 260 },
      chorus: { wet: 0.08, rateHz: 0.18, depthSeconds: 0.002 },
      reverbWet: 0.2,
    },
  ),
};

export const YAMAHA_PRESET_IDS = Object.keys(YAMAHA_PRESETS) as YamahaPresetId[];
export const YAMAHA_PRESET_LIST = Object.values(YAMAHA_PRESETS);

export function isYamahaPresetId(value: string): value is YamahaPresetId {
  return Object.prototype.hasOwnProperty.call(YAMAHA_PRESETS, value);
}

export interface ScheduledAudioChange {
  /** Cancel only if the transition has not begun yet. */
  cancel(): void;
}

export type WavSampleLoader = (url: string, context: AudioContext) => Promise<AudioBuffer>;
export type WavSampleManifest = Partial<
  Record<YamahaPresetId, Partial<Record<MusicalKey, string>>>
>;

export interface YamahaEngineOptions {
  /** Injected context for embedding or tests. The engine will not close it. */
  context?: AudioContext;
  /** Optional lazy context constructor, useful for browser prefixes and tests. */
  contextFactory?: () => AudioContext;
  /** Optional externally hosted, royalty-cleared WAV files. */
  sampleManifest?: WavSampleManifest;
  sampleLoader?: WavSampleLoader;
  initialPresetId?: YamahaPresetId;
  initialBpm?: number;
  masterVolume?: number;
  fadeCurve?: FadeCurve;
}

interface GainPlan {
  startAt: number;
  endAt: number;
  from: number;
  to: number;
  shape: 'in' | 'out';
  curve: FadeCurve;
  /** Progress already elapsed if an in-flight automation was re-anchored. */
  progressStart?: number;
}

interface SyncedLfo {
  oscillator: OscillatorNode;
  everyBeats: number;
}

interface SynthVoice {
  key: MusicalKey;
  presetId: YamahaPresetId;
  gate: GainNode;
  expression: GainNode;
  sources: AudioScheduledSourceNode[];
  endedSources: Set<AudioScheduledSourceNode>;
  nodes: AudioNode[];
  filters: BiquadFilterNode[];
  syncedLfos: SyncedLfo[];
  profile: YamahaPresetDefinition;
  filterCutoffHz: number;
  gainPlan: GainPlan;
  scheduledStopAt: number | null;
  disposed: boolean;
}

const MIN_SCHEDULE_AHEAD_SECONDS = 0.012;
const FADE_CURVE_SAMPLES = 64;
const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const clampBpm = (value: number): number =>
  Number.isFinite(value) ? Math.max(40, Math.min(240, value)) : 72;
const sampleCacheKey = (presetId: YamahaPresetId, key: MusicalKey): string => `${presetId}:${key}`;

function getLfoRate(profile: YamahaPresetDefinition, bpm: number): number {
  return profile.lfo.syncEveryBeats
    ? bpm / 60 / profile.lfo.syncEveryBeats
    : profile.lfo.rateHz;
}

function keyFrequency(key: MusicalKey): number {
  const semitone = MUSICAL_KEYS.indexOf(key);
  // C3 is a useful low pad root; the selected key changes pitch class only.
  return 130.8128 * Math.pow(2, semitone / 12);
}

function createFadeCurve(plan: GainPlan): Float32Array {
  const values = new Float32Array(FADE_CURVE_SAMPLES);
  const fromProgress = plan.progressStart ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    const localProgress = i / (values.length - 1);
    const progress = fromProgress + (1 - fromProgress) * localProgress;
    if (plan.shape === 'in') {
      values[i] = plan.from + (plan.to - plan.from) * fadeInGain(progress, plan.curve);
    } else {
      values[i] = plan.to + (plan.from - plan.to) * fadeOutGain(progress, plan.curve);
    }
  }
  return values;
}

function gainAtPlan(plan: GainPlan, time: number): number {
  const fromProgress = plan.progressStart ?? 0;
  if (time <= plan.startAt) {
    const eased = plan.shape === 'in'
      ? fadeInGain(fromProgress, plan.curve)
      : fadeOutGain(fromProgress, plan.curve);
    return plan.shape === 'in'
      ? plan.from + (plan.to - plan.from) * eased
      : plan.to + (plan.from - plan.to) * eased;
  }
  if (time >= plan.endAt || plan.endAt <= plan.startAt) return plan.to;
  const localProgress = (time - plan.startAt) / (plan.endAt - plan.startAt);
  const progress = fromProgress + (1 - fromProgress) * localProgress;
  if (plan.shape === 'in') {
    return plan.from + (plan.to - plan.from) * fadeInGain(progress, plan.curve);
  }
  return plan.to + (plan.from - plan.to) * fadeOutGain(progress, plan.curve);
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const browserGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  return browserGlobal.AudioContext ?? browserGlobal.webkitAudioContext ?? null;
}

async function fetchWavSample(url: string, context: AudioContext): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load audio sample (${response.status}): ${url}`);
  const data = await response.arrayBuffer();
  return context.decodeAudioData(data.slice(0));
}

/**
 * Web Audio synth and key-transition target used by the progression sequencer.
 * Call `initialize()` in a click/tap handler before using scheduled playback.
 */
export class YamahaEngine {
  private context: AudioContext | null;
  private readonly ownsContext: boolean;
  private masterGain: GainNode | null = null;
  private reverb: ReverbEngine | null = null;
  private graphReady = false;
  private disposed = false;
  private masterVolume: number;
  private selectedPresetId: YamahaPresetId;
  private bpm: number;
  private fadeCurve: FadeCurve;
  private xy: XYPosition = { x: 0.5, y: 0.5 };
  private currentVoice: SynthVoice | null = null;
  private currentKey: MusicalKey | null = null;
  private activeVoices = new Set<SynthVoice>();
  private sampleBuffers = new Map<string, AudioBuffer>();
  private sampleLoads = new Map<string, Promise<AudioBuffer>>();
  private readonly options: YamahaEngineOptions;

  constructor(options: YamahaEngineOptions = {}) {
    this.options = options;
    this.context = options.context ?? null;
    this.ownsContext = options.context === undefined;
    this.selectedPresetId = options.initialPresetId ?? 'anadayz-pad';
    this.bpm = clampBpm(options.initialBpm ?? 72);
    this.masterVolume = clamp01(options.masterVolume ?? 0.72);
    this.fadeCurve = options.fadeCurve ?? 'logarithmic';
  }

  static isSupported(): boolean {
    return getAudioContextConstructor() !== null;
  }

  /** Audio-time clock in seconds; zero until the context has been created. */
  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get activeKey(): MusicalKey | null {
    return this.currentKey;
  }

  get presetId(): YamahaPresetId {
    return this.selectedPresetId;
  }

  get tempoBpm(): number {
    return this.bpm;
  }

  /** Satisfies the sequencer's optional prepare hook and unlocks browser audio. */
  async initialize(): Promise<void> {
    const context = this.getOrCreateContext();
    if (context.state === 'suspended') await context.resume();
  }

  async prepare(): Promise<void> {
    await this.initialize();
  }

  /** Start or retarget the selected key after audio has been unlocked. */
  async playKey(
    key: MusicalKey,
    options: { fadeSeconds?: number; atTime?: number } = {},
  ): Promise<ScheduledAudioChange> {
    await this.initialize();
    const context = this.getOrCreateContext();
    return this.scheduleKeyChange(
      key,
      options.atTime ?? context.currentTime + MIN_SCHEDULE_AHEAD_SECONDS,
      options.fadeSeconds ?? 0.8,
    );
  }

  /**
   * Schedule a key transition against AudioContext.currentTime. The sequencer
   * calls this ahead of the beat; Web Audio performs the gain ramps on time,
   * independently of JavaScript timer jitter.
   */
  scheduleKeyChange(
    key: MusicalKey,
    atTime: number,
    fadeSeconds: number,
    presetId: YamahaPresetId = this.selectedPresetId,
  ): ScheduledAudioChange {
    const context = this.getOrCreateContext();
    if (this.disposed) throw new Error('YamahaEngine has been disposed');

    const safeTime = Math.max(
      Number.isFinite(atTime) ? atTime : context.currentTime,
      context.currentTime + MIN_SCHEDULE_AHEAD_SECONDS,
    );
    const duration = Math.max(0, Math.min(30, Number.isFinite(fadeSeconds) ? fadeSeconds : 0));
    const previous = this.currentVoice;

    if (previous && !previous.disposed && previous.key === key && previous.presetId === presetId) {
      return { cancel() {} };
    }

    const profile = YAMAHA_PRESETS[presetId];
    if (!profile) throw new Error(`Unknown sound preset: ${presetId}`);

    const previousPlan = previous?.gainPlan ?? null;
    const previousStopAt = previous?.scheduledStopAt ?? null;
    const incoming = this.createVoice(key, presetId, safeTime);
    const incomingPlan: GainPlan = {
      startAt: safeTime,
      endAt: safeTime + duration,
      from: 0,
      to: 1,
      shape: 'in',
      curve: this.fadeCurve,
    };
    this.applyGainPlan(incoming, incomingPlan);

    if (previous && !previous.disposed) {
      const outgoingStart = Math.max(0, gainAtPlan(previous.gainPlan, safeTime));
      const outgoingPlan: GainPlan = {
        startAt: safeTime,
        endAt: safeTime + duration,
        from: outgoingStart,
        to: 0,
        shape: 'out',
        curve: this.fadeCurve,
      };
      this.applyGainPlan(previous, outgoingPlan);
      this.setVoiceStopAt(previous, safeTime + duration + 0.035);
    }

    this.currentVoice = incoming;
    this.currentKey = key;
    this.selectedPresetId = presetId;
    this.reverb?.setMix(profile.reverbWet, 1 - profile.reverbWet);

    let cancelled = false;
    return {
      cancel: () => {
        if (cancelled || context.currentTime >= safeTime) return;
        cancelled = true;
        this.cancelVoice(incoming);
        if (previous && !previous.disposed && previousPlan) {
          this.restoreGainPlan(previous, previousPlan, safeTime);
          this.restoreVoiceStop(previous, previousStopAt, context.currentTime);
        }
        if (this.currentVoice === incoming) {
          this.currentVoice = previous && !previous.disposed ? previous : null;
          this.currentKey = this.currentVoice?.key ?? null;
          if (this.currentVoice) this.selectedPresetId = this.currentVoice.presetId;
        }
      },
    };
  }

  /** Change the patch; an active note is re-voiced with a short crossfade. */
  setPreset(presetId: string, fadeSeconds = 0.7): ScheduledAudioChange | null {
    if (!isYamahaPresetId(presetId)) throw new Error(`Unknown sound preset: ${presetId}`);
    if (this.selectedPresetId === presetId) return null;
    this.selectedPresetId = presetId;
    const profile = YAMAHA_PRESETS[presetId];
    this.reverb?.setMix(profile.reverbWet, 1 - profile.reverbWet);
    if (!this.currentKey || !this.context) return null;
    return this.scheduleKeyChange(
      this.currentKey,
      this.context.currentTime + MIN_SCHEDULE_AHEAD_SECONDS,
      fadeSeconds,
      presetId,
    );
  }

  setMasterVolume(value: number, rampSeconds = 0.025): void {
    this.masterVolume = clamp01(value);
    if (!this.masterGain || !this.context) return;
    this.masterGain.gain.setTargetAtTime(
      this.masterVolume,
      this.context.currentTime,
      Math.max(0.005, Number.isFinite(rampSeconds) ? rampSeconds : 0.025),
    );
  }

  /** Select a fade curve; progression playback selects logarithmic explicitly. */
  setFadeCurve(curve: FadeCurve): void {
    this.fadeCurve = curve;
  }

  /** Keep BPM-synced motion LFOs aligned with the progression clock. */
  setBpm(value: number): void {
    this.bpm = clampBpm(value);
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.activeVoices) {
      for (const lfo of voice.syncedLfos) {
        lfo.oscillator.frequency.setTargetAtTime(this.bpm / 60 / lfo.everyBeats, now, 0.025);
      }
    }
  }

  /** X brightens the filter; Y changes the overall performance-pad weight. */
  setXY(position: XYPosition): void {
    this.xy = { x: clamp01(position.x), y: clamp01(position.y) };
    if (!this.context) return;
    const now = this.context.currentTime;
    const brightness = 0.38 + this.xy.x * 2.35;
    const weight = 0.45 + this.xy.y * 0.55;

    for (const voice of this.activeVoices) {
      for (const filter of voice.filters) {
        const cutoff = Math.max(80, Math.min(15_000, voice.filterCutoffHz * brightness));
        filter.frequency.setTargetAtTime(cutoff, now, 0.035);
      }
      // Keep the XY macro independent from the transition gate automation.
      voice.expression.gain.setTargetAtTime(weight, now, 0.035);
    }
  }

  /** Load and cache a WAV for one exact preset/key pair. Synth remains fallback. */
  async loadSample(presetId: YamahaPresetId, key: MusicalKey, url: string): Promise<AudioBuffer> {
    const cacheKey = sampleCacheKey(presetId, key);
    const existing = this.sampleBuffers.get(cacheKey);
    if (existing) return existing;
    const inFlight = this.sampleLoads.get(cacheKey);
    if (inFlight) return inFlight;

    const context = this.getOrCreateContext();
    const loader = this.options.sampleLoader ?? fetchWavSample;
    const request = loader(url, context)
      .then((buffer) => {
        this.sampleBuffers.set(cacheKey, buffer);
        this.sampleLoads.delete(cacheKey);
        return buffer;
      })
      .catch((error: unknown) => {
        this.sampleLoads.delete(cacheKey);
        throw error;
      });
    this.sampleLoads.set(cacheKey, request);
    return request;
  }

  /** Preload any manifest entries; failed files leave the procedural voice available. */
  async preloadSamples(
    presetIds: readonly YamahaPresetId[] = YAMAHA_PRESET_IDS,
    keys: readonly MusicalKey[] = MUSICAL_KEYS,
  ): Promise<{ loaded: number; failed: number }> {
    const manifest = this.options.sampleManifest ?? {};
    const jobs: Promise<AudioBuffer>[] = [];
    for (const presetId of presetIds) {
      for (const key of keys) {
        const url = manifest[presetId]?.[key];
        if (url) jobs.push(this.loadSample(presetId, key, url));
      }
    }

    const results = await Promise.allSettled(jobs);
    return {
      loaded: results.filter((result) => result.status === 'fulfilled').length,
      failed: results.filter((result) => result.status === 'rejected').length,
    };
  }

  /** Fade out the currently selected pad without closing the shared context. */
  stop(fadeSeconds?: number): ScheduledAudioChange | null {
    const context = this.context;
    const voice = this.currentVoice;
    if (!context || !voice || voice.disposed) return null;

    const atTime = context.currentTime + MIN_SCHEDULE_AHEAD_SECONDS;
    const requestedFade = fadeSeconds ?? voice.profile.envelope.releaseSeconds;
    const duration = Math.max(0, Math.min(30, Number.isFinite(requestedFade) ? requestedFade : 0.45));
    const previousPlan = voice.gainPlan;
    const previousStopAt = voice.scheduledStopAt;
    const plan: GainPlan = {
      startAt: atTime,
      endAt: atTime + duration,
      from: gainAtPlan(voice.gainPlan, atTime),
      to: 0,
      shape: 'out',
      curve: this.fadeCurve,
    };
    this.applyGainPlan(voice, plan);
    this.setVoiceStopAt(voice, atTime + duration + 0.035);
    this.currentVoice = null;
    this.currentKey = null;

    return {
      cancel: () => {
        if (context.currentTime >= atTime || voice.disposed || this.currentVoice !== null) return;
        this.restoreGainPlan(voice, previousPlan, atTime);
        this.restoreVoiceStop(voice, previousStopAt, context.currentTime);
        this.currentVoice = voice;
        this.currentKey = voice.key;
      },
    };
  }

  /** Audio-clock metronome transient; called ahead of a beat by SequencerEngine. */
  scheduleMetronomeClick(atTime: number, accented: boolean): ScheduledAudioChange {
    const context = this.getOrCreateContext();
    if (!this.masterGain) throw new Error('YamahaEngine audio graph is not ready');

    const startAt = Math.max(atTime, context.currentTime + MIN_SCHEDULE_AHEAD_SECONDS);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(accented ? 1_320 : 880, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(accented ? 0.13 : 0.075, startAt + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.052);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.06);

    let cancelled = false;
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };

    return {
      cancel: () => {
        if (cancelled || context.currentTime >= startAt) return;
        cancelled = true;
        try {
          oscillator.stop(context.currentTime + 0.001);
        } catch {
          /* already stopped */
        }
      },
    };
  }

  /** Close the engine's graph and its owned AudioContext. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of [...this.activeVoices]) this.cancelVoice(voice);
    this.activeVoices.clear();
    this.currentVoice = null;
    this.currentKey = null;
    this.reverb?.dispose();
    this.masterGain?.disconnect();
    this.reverb = null;
    this.masterGain = null;
    this.graphReady = false;
    this.sampleBuffers.clear();
    this.sampleLoads.clear();

    const context = this.context;
    this.context = null;
    if (context && this.ownsContext && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private getOrCreateContext(): AudioContext {
    if (this.disposed) throw new Error('YamahaEngine has been disposed');
    if (!this.context) {
      const Constructor = getAudioContextConstructor();
      const created = this.options.contextFactory?.() ?? (Constructor ? new Constructor() : null);
      if (!created) {
        throw new Error('Web Audio is unavailable; use a browser with AudioContext support.');
      }
      this.context = created;
    }
    this.ensureGraph(this.context);
    return this.context;
  }

  private ensureGraph(context: AudioContext): void {
    if (this.graphReady) return;
    this.masterGain = context.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.reverb = new ReverbEngine(context, { wet: 0.28, dry: 0.72, decaySeconds: 2.8 });
    this.reverb.output.connect(this.masterGain);
    this.masterGain.connect(context.destination);
    this.graphReady = true;
  }

  private createVoice(key: MusicalKey, presetId: YamahaPresetId, startAt: number): SynthVoice {
    const context = this.getOrCreateContext();
    const profile = YAMAHA_PRESETS[presetId];
    const gate = context.createGain();
    const expression = context.createGain();
    expression.gain.setValueAtTime(0.45 + this.xy.y * 0.55, startAt);
    const input = context.createGain();
    const filters: BiquadFilterNode[] = [];
    const nodes: AudioNode[] = [gate, expression, input];
    const sources: AudioScheduledSourceNode[] = [];
    const syncedLfos: SyncedLfo[] = [];
    const sample = this.sampleBuffers.get(sampleCacheKey(presetId, key));

    let upstream: AudioNode = input;
    for (let stage = 0; stage < profile.filter.stages; stage += 1) {
      const filter = context.createBiquadFilter();
      filter.type = profile.filter.type;
      filter.frequency.setValueAtTime(profile.filter.cutoffHz, startAt);
      filter.Q.setValueAtTime(profile.filter.resonance, startAt);
      upstream.connect(filter);
      upstream = filter;
      filters.push(filter);
      nodes.push(filter);
    }

    if (sample) {
      const source = context.createBufferSource();
      source.buffer = sample;
      source.loop = true;
      source.connect(input);
      source.start(startAt);
      sources.push(source);
      nodes.push(source);
    } else {
      const rootFrequency = keyFrequency(key);
      for (let index = 0; index < profile.layers.length; index += 1) {
        const layer = profile.layers[index];
        const oscillator = context.createOscillator();
        const layerGain = context.createGain();
        oscillator.type = layer.waveform;
        oscillator.frequency.setValueAtTime(rootFrequency * Math.pow(2, layer.octave), startAt);
        oscillator.detune.setValueAtTime(layer.detuneCents, startAt);
        layerGain.gain.setValueAtTime(layer.gain, startAt);

        const panner = context.createStereoPanner();
        const side = index % 2 === 0 ? -1 : 1;
        panner.pan.setValueAtTime(side * Math.min(0.7, 0.14 + this.xy.x * 0.22), startAt);
        oscillator.connect(layerGain);
        layerGain.connect(panner);
        panner.connect(input);

        oscillator.start(startAt);
        sources.push(oscillator);
        nodes.push(oscillator, layerGain, panner);

        if (layer.transient) {
          layerGain.gain.setValueAtTime(0.0001, startAt);
          layerGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, layer.gain), startAt + 0.008);
          layerGain.gain.exponentialRampToValueAtTime(
            Math.max(0.0001, layer.gain * 0.14),
            startAt + 0.16,
          );
          layerGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.25);
        }
      }
    }

    const ampEnvelope = context.createGain();
    ampEnvelope.gain.setValueAtTime(0.0001, startAt);
    ampEnvelope.gain.linearRampToValueAtTime(
      profile.envelope.sustain,
      startAt + Math.max(0.015, profile.envelope.attackSeconds),
    );
    upstream.connect(ampEnvelope);
    nodes.push(ampEnvelope);

    const delayWet = Math.max(profile.chorus.wet, profile.delay.wet);
    if (delayWet > 0) {
      const dryGain = context.createGain();
      const delay = context.createDelay(1.5);
      const delayGain = context.createGain();
      const feedback = context.createGain();
      const delayTime = profile.chorus.wet > 0
        ? Math.min(0.085, Math.max(0.012, profile.chorus.depthSeconds * 5 + 0.012))
        : profile.delay.timeSeconds;
      delay.delayTime.setValueAtTime(delayTime, startAt);
      dryGain.gain.setValueAtTime(Math.sqrt(Math.max(0.05, 1 - delayWet * 0.55)), startAt);
      delayGain.gain.setValueAtTime(Math.min(0.45, delayWet * 0.72), startAt);
      feedback.gain.setValueAtTime(Math.max(0, Math.min(0.42, profile.delay.feedback)), startAt);
      ampEnvelope.connect(dryGain);
      dryGain.connect(gate);
      ampEnvelope.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(gate);
      delay.connect(feedback);
      feedback.connect(delay);
      nodes.push(dryGain, delay, delayGain, feedback);

      if (profile.chorus.wet > 0) {
        const chorusLfo = context.createOscillator();
        const chorusDepth = context.createGain();
        chorusLfo.frequency.setValueAtTime(profile.chorus.rateHz, startAt);
        chorusDepth.gain.setValueAtTime(profile.chorus.depthSeconds, startAt);
        chorusLfo.connect(chorusDepth);
        chorusDepth.connect(delay.delayTime);
        chorusLfo.start(startAt);
        sources.push(chorusLfo);
        nodes.push(chorusLfo, chorusDepth);
      }
    } else {
      ampEnvelope.connect(gate);
    }

    gate.connect(expression);
    expression.connect(this.reverb!.input);
    const lfoRate = getLfoRate(profile, this.bpm);
    if (profile.lfo.filterDepthHz > 0) {
      const filterLfo = context.createOscillator();
      const filterDepth = context.createGain();
      filterLfo.frequency.setValueAtTime(lfoRate, startAt);
      filterDepth.gain.setValueAtTime(profile.lfo.filterDepthHz, startAt);
      filterLfo.connect(filterDepth);
      filterDepth.connect(filters[filters.length - 1].frequency);
      filterLfo.start(startAt);
      sources.push(filterLfo);
      nodes.push(filterLfo, filterDepth);
      if (profile.lfo.syncEveryBeats) {
        syncedLfos.push({ oscillator: filterLfo, everyBeats: profile.lfo.syncEveryBeats });
      }
    }

    if (profile.lfo.vibratoCents > 0 && sources.length > 0) {
      const vibrato = context.createOscillator();
      const vibratoDepth = context.createGain();
      vibrato.frequency.setValueAtTime(profile.lfo.rateHz, startAt);
      vibratoDepth.gain.setValueAtTime(profile.lfo.vibratoCents, startAt);
      vibrato.connect(vibratoDepth);
      for (const source of sources) {
        if ('detune' in source) {
          const detune = (source as OscillatorNode | AudioBufferSourceNode).detune;
          vibratoDepth.connect(detune);
        }
      }
      vibrato.start(startAt);
      sources.push(vibrato);
      nodes.push(vibrato, vibratoDepth);
    }

    const initialPlan: GainPlan = {
      startAt,
      endAt: startAt,
      from: 0,
      to: 0,
      shape: 'in',
      curve: this.fadeCurve,
    };
    gate.gain.setValueAtTime(0, startAt);

    const voice: SynthVoice = {
      key,
      presetId,
      gate,
      expression,
      sources,
      endedSources: new Set<AudioScheduledSourceNode>(),
      nodes,
      filters,
      syncedLfos,
      profile,
      filterCutoffHz: profile.filter.cutoffHz,
      gainPlan: initialPlan,
      scheduledStopAt: null,
      disposed: false,
    };
    for (const source of sources) {
      source.onended = () => {
        voice.endedSources.add(source);
        if (voice.endedSources.size >= voice.sources.length) this.disposeVoice(voice);
      };
    }
    this.activeVoices.add(voice);
    return voice;
  }

  private applyGainPlan(voice: SynthVoice, plan: GainPlan): void {
    const param = voice.gate.gain;
    param.cancelScheduledValues(plan.startAt);
    if (plan.endAt <= plan.startAt || plan.from === plan.to) {
      param.setValueAtTime(plan.to, plan.startAt);
    } else {
      param.setValueCurveAtTime(createFadeCurve(plan), plan.startAt, plan.endAt - plan.startAt);
    }
    voice.gainPlan = plan;
  }

  private restoreGainPlan(voice: SynthVoice, plan: GainPlan, atTime: number): void {
    const param = voice.gate.gain;
    param.cancelScheduledValues(atTime);
    if (plan.endAt <= atTime || plan.endAt <= plan.startAt) {
      param.setValueAtTime(gainAtPlan(plan, atTime), atTime);
      voice.gainPlan = {
        ...plan,
        startAt: atTime,
        endAt: atTime,
        from: gainAtPlan(plan, atTime),
        to: gainAtPlan(plan, atTime),
      };
      return;
    }

    const localProgress = Math.max(
      0,
      Math.min(1, (atTime - plan.startAt) / (plan.endAt - plan.startAt)),
    );
    const previousProgress = plan.progressStart ?? 0;
    const progress = previousProgress + (1 - previousProgress) * localProgress;
    const remainingPlan: GainPlan = { ...plan, startAt: atTime, progressStart: progress };
    param.setValueCurveAtTime(createFadeCurve(remainingPlan), atTime, plan.endAt - atTime);
    voice.gainPlan = remainingPlan;
  }

  private setVoiceStopAt(voice: SynthVoice, stopAt: number): void {
    if (voice.disposed) return;
    voice.scheduledStopAt = stopAt;
    for (const source of voice.sources) {
      try {
        // Per Web Audio, a later stop() call replaces an earlier scheduled stop.
        source.stop(stopAt);
      } catch {
        /* source may already have ended */
      }
    }
    if (voice.sources.length === 0) this.disposeVoice(voice);
  }

  private restoreVoiceStop(
    voice: SynthVoice,
    previousStopAt: number | null,
    now: number,
  ): void {
    // When the superseding transition is cancelled, extend an originally
    // sustaining voice or restore its earlier release deadline.
    this.setVoiceStopAt(voice, previousStopAt ?? now + 86_400);
  }

  private cancelVoice(voice: SynthVoice): void {
    if (voice.disposed) return;
    const context = this.context;
    const stopAt = context ? context.currentTime + 0.001 : 0;
    for (const source of voice.sources) {
      try {
        source.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    this.disposeVoice(voice);
  }

  private disposeVoice(voice: SynthVoice): void {
    if (voice.disposed) return;
    voice.disposed = true;
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        /* native node already disconnected */
      }
    }
    this.activeVoices.delete(voice);
    if (this.currentVoice === voice) {
      this.currentVoice = null;
      this.currentKey = null;
    }
  }
}
