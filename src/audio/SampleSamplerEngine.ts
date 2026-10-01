/**
 * AudioBuffer-based multisample pad engine for web.
 *
 * The engine never creates or synthesizes audio. It loads recorded WAV files,
 * maps each note to the nearest recorded root, and uses playbackRate to transpose
 * that sample. Every enabled layer gets its own voice and level control.
 */

import {
  PAD_PRESETS,
  isAmbientBedId,
  isPadPresetId,
  type AmbientBedId,
  type PadPresetId,
  type SampleLayerConfig,
  type SampleSourceId,
} from '../config/padPresets';
import type { MusicalKey } from '../types/audio';

export type SampleAssetModule = number | string | { uri: string };

export interface SampleAssetResolver {
  getPadSamples: (presetId: PadPresetId) => Readonly<Record<string, SampleAssetModule>>;
  getAmbientBed: (bedId: AmbientBedId) => SampleAssetModule | null;
}

export type SampleBufferLoader = (
  module: SampleAssetModule,
  context: AudioContext,
) => Promise<AudioBuffer>;

export type SampleLoadStatus = 'ready' | 'partial' | 'missing' | 'error';

export interface SampleLoadReport {
  sourceId: SampleSourceId;
  status: SampleLoadStatus;
  /** Recorded root notes decoded and ready to play (or `loop.wav` for a bed). */
  loaded: string[];
  /** Recommended anchors that are absent or failed to decode. */
  missing: string[];
  errors: string[];
}

export interface ScheduledSampleChange {
  cancel(): void;
}

export interface SampleSamplerEngineOptions {
  assets: SampleAssetResolver;
  context?: AudioContext;
  contextFactory?: () => AudioContext;
  loadBuffer?: SampleBufferLoader;
  initialMasterVolume?: number;
  initialOctave?: number;
}

interface SampleVoice {
  layerId: string;
  sourceId: SampleSourceId;
  midi: number | null;
  source: AudioBufferSourceNode;
  gain: GainNode;
  gainTarget: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  ended: boolean;
}

const KEY_SEMITONES: Record<MusicalKey, number> = {
  C: 0,
  'C#': 1,
  D: 2,
  'D#': 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  'G#': 8,
  A: 9,
  'A#': 10,
  B: 11,
};

const NOTE_SEMITONES: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const clampFade = (seconds: number): number =>
  Number.isFinite(seconds) ? Math.max(0, Math.min(30, seconds)) : 0;
const loadKey = (sourceId: SampleSourceId, root: string): string => `${sourceId}:${root}`;

export function noteToMidi(note: string): number | null {
  const match = note.trim().match(/^([A-G](?:#|b)?)(-?\d+)$/i);
  if (!match) return null;
  const name = match[1].toUpperCase();
  const semitone = NOTE_SEMITONES[name];
  if (semitone === undefined) return null;
  const octave = Number(match[2]);
  return 12 * (octave + 1) + semitone;
}

function keyToMidi(key: MusicalKey, octave: number): number {
  return 12 * (octave + 1) + KEY_SEMITONES[key];
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof globalThis === 'undefined') return null;
  const browserGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  return browserGlobal.AudioContext ?? browserGlobal.webkitAudioContext ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Web Audio multisample player. `prepare()`/`playKey()` must be called from a
 * user gesture the first time so browsers can resume the AudioContext.
 */
export class SampleSamplerEngine {
  private context: AudioContext | null;
  private readonly ownsContext: boolean;
  private readonly options: SampleSamplerEngineOptions;
  private masterGain: GainNode | null = null;
  private graphReady = false;
  private disposed = false;
  private masterVolume: number;
  private octave: number;
  private layers: SampleLayerConfig[] = [];
  private activeKey: MusicalKey | null = null;
  private currentVoices = new Map<string, SampleVoice>();
  private voices = new Set<SampleVoice>();
  private buffers = new Map<string, AudioBuffer>();
  private bufferLoads = new Map<string, Promise<AudioBuffer>>();
  private reports = new Map<SampleSourceId, SampleLoadReport>();

  constructor(options: SampleSamplerEngineOptions) {
    this.options = options;
    this.context = options.context ?? null;
    this.ownsContext = options.context === undefined;
    this.masterVolume = clamp01(options.initialMasterVolume ?? 0.72);
    this.octave = Math.max(2, Math.min(6, Math.round(options.initialOctave ?? 4)));
  }

  static isSupported(): boolean {
    return getAudioContextConstructor() !== null;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get currentKey(): MusicalKey | null {
    return this.activeKey;
  }

  get currentOctave(): number {
    return this.octave;
  }

  get masterVolumeValue(): number {
    return this.masterVolume;
  }

  get activeLayerCount(): number {
    return this.currentVoices.size;
  }

  getLoadReport(sourceId: SampleSourceId): SampleLoadReport | null {
    const report = this.reports.get(sourceId);
    return report ? { ...report, loaded: [...report.loaded], missing: [...report.missing], errors: [...report.errors] } : null;
  }

  /** Load every enabled layer and return per-source loading/error states. */
  async loadLayers(layers: readonly SampleLayerConfig[] = this.layers): Promise<SampleLoadReport[]> {
    this.assertAlive();
    const sourceIds = [...new Set(layers.filter((layer) => layer.enabled).map((layer) => layer.sourceId))];
    return Promise.all(sourceIds.map((sourceId) => this.loadSource(sourceId)));
  }

  /** Update the layer rack, load changed sources, then crossfade the active key. */
  async setLayers(
    layers: readonly SampleLayerConfig[],
    fadeSeconds = 0.32,
  ): Promise<SampleLoadReport[]> {
    this.assertAlive();
    this.layers = layers.map((layer) => ({
      ...layer,
      enabled: Boolean(layer.enabled),
      volume: clamp01(layer.volume),
    }));
    const reports = await this.loadLayers(this.layers);
    if (this.activeKey !== null) {
      this.scheduleKeyChange(this.activeKey, this.currentTime + 0.025, fadeSeconds);
    }
    return reports;
  }

  /** Unlock audio and warm all enabled WAVs for the progression scheduler. */
  async prepare(): Promise<void> {
    this.assertAlive();
    await this.initialize();
    const reports = await this.loadLayers(this.layers);
    this.assertPlayable(reports);
  }

  async initialize(): Promise<void> {
    this.assertAlive();
    const context = this.getOrCreateContext();
    this.ensureGraph(context);
    if (context.state === 'suspended') await context.resume();
  }

  /** Start or retarget all enabled sample layers on a musical key. */
  async playKey(key: MusicalKey, fadeSeconds = 0.7): Promise<ScheduledSampleChange> {
    this.assertAlive();
    await this.initialize();
    const reports = await this.loadLayers(this.layers);
    this.assertPlayable(reports);
    return this.scheduleKeyChange(key, this.currentTime + 0.025, fadeSeconds);
  }

  /**
   * Web Audio transport adapter for SequencerEngine. Note names are played in
   * the selected octave; each pad layer uses its nearest available root sample.
   */
  scheduleKeyChange(key: MusicalKey, atTime: number, fadeSeconds: number): ScheduledSampleChange {
    this.assertAlive();
    const context = this.getOrCreateContext();
    this.ensureGraph(context);

    const when = Math.max(
      Number.isFinite(atTime) ? atTime : context.currentTime,
      context.currentTime + 0.012,
    );
    const fade = clampFade(fadeSeconds);
    const midi = keyToMidi(key, this.octave);
    const beforeKey = this.activeKey;
    const beforeVoices = this.currentVoices;
    const nextVoices = new Map<string, SampleVoice>();
    const createdVoices: SampleVoice[] = [];
    const reusedVoices: { voice: SampleVoice; priorTarget: number }[] = [];
    const outgoingVoices: { voice: SampleVoice; priorTarget: number }[] = [];

    for (const layer of this.layers) {
      if (!layer.enabled) continue;
      const oldVoice = beforeVoices.get(layer.id);
      const isBed = isAmbientBedId(layer.sourceId);
      const nextMidi = isBed ? null : midi;

      if (oldVoice && oldVoice.sourceId === layer.sourceId && (isBed || oldVoice.midi === nextMidi)) {
        const priorTarget = oldVoice.gainTarget;
        const nextTarget = layer.volume;
        this.rampGain(oldVoice.gain.gain, priorTarget, nextTarget, when, fade);
        oldVoice.gainTarget = nextTarget;
        nextVoices.set(layer.id, oldVoice);
        reusedVoices.push({ voice: oldVoice, priorTarget });
        continue;
      }

      let sample: { buffer: AudioBuffer; root: string } | null;
      if (isAmbientBedId(layer.sourceId)) {
        sample = this.getLoadedBuffer(layer.sourceId, 'loop.wav');
      } else {
        sample = this.findNearestPadBuffer(layer.sourceId, midi);
      }
      if (!sample) continue;

      const voice = this.createVoice(layer, sample.buffer, sample.root, nextMidi, when, fade);
      nextVoices.set(layer.id, voice);
      createdVoices.push(voice);
    }

    for (const [layerId, voice] of beforeVoices) {
      if (nextVoices.get(layerId) === voice) continue;
      outgoingVoices.push({ voice, priorTarget: voice.gainTarget });
      this.fadeAndRelease(voice, when, fade);
    }

    this.currentVoices = nextVoices;
    this.activeKey = key;

    let cancelled = false;
    return {
      cancel: () => {
        if (cancelled || context.currentTime >= when) return;
        cancelled = true;

        for (const voice of createdVoices) this.stopVoice(voice, context.currentTime + 0.001);
        for (const { voice, priorTarget } of [...reusedVoices, ...outgoingVoices]) {
          this.restoreVoice(voice, priorTarget, context.currentTime);
        }

        if (this.currentVoices === nextVoices) {
          this.currentVoices = beforeVoices;
          this.activeKey = beforeKey;
        }
      },
    };
  }

  /** A volume adjustment changes only the requested layer, not its sample pitch. */
  setLayerVolume(layerId: string, value: number): void {
    const volume = clamp01(value);
    this.layers = this.layers.map((layer) =>
      layer.id === layerId ? { ...layer, volume } : layer,
    );
    const voice = this.currentVoices.get(layerId);
    if (!voice || !this.context) return;
    const nextTarget = volume;
    this.rampGain(voice.gain.gain, voice.gainTarget, nextTarget, this.context.currentTime, 0.035);
    voice.gainTarget = nextTarget;
  }

  /** Change the manual-key register; the next key press uses this octave. */
  setOctave(octave: number): void {
    if (!Number.isFinite(octave)) return;
    this.octave = Math.max(2, Math.min(6, Math.round(octave)));
  }

  setMasterVolume(value: number): void {
    this.masterVolume = clamp01(value);
    if (!this.masterGain || !this.context) return;
    this.rampGain(
      this.masterGain.gain,
      this.masterGain.gain.value,
      this.masterVolume,
      this.context.currentTime,
      0.035,
    );
  }

  /** Stop all currently sounding layers with a short release. */
  stop(fadeSeconds = 0.25): void {
    if (!this.context) {
      this.currentVoices.clear();
      this.activeKey = null;
      return;
    }
    const when = this.context.currentTime + 0.012;
    for (const voice of this.currentVoices.values()) this.fadeAndRelease(voice, when, clampFade(fadeSeconds));
    this.currentVoices = new Map();
    this.activeKey = null;
  }

  /** Immediately dispose all audio nodes and release owned browser resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const voice of this.voices) this.stopVoice(voice, this.context?.currentTime ?? 0);
    this.voices.clear();
    this.currentVoices.clear();
    this.buffers.clear();
    this.bufferLoads.clear();
    this.reports.clear();
    this.masterGain?.disconnect();
    this.masterGain = null;
    this.graphReady = false;
    this.activeKey = null;
    if (this.ownsContext && this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => undefined);
    }
    this.context = null;
  }

  private async loadSource(sourceId: SampleSourceId): Promise<SampleLoadReport> {
    const cachedReport = this.reports.get(sourceId);
    if (cachedReport) return this.cloneReport(cachedReport);

    let loaded: string[] = [];
    let missing: string[] = [];
    const errors: string[] = [];
    const context = this.getOrCreateContext();

    if (isPadPresetId(sourceId)) {
      const expected = [...PAD_PRESETS[sourceId].expectedAnchors];
      const modules = this.options.assets.getPadSamples(sourceId);
      const entries = Object.entries(modules).filter(([note]) => noteToMidi(note) !== null);
      const byNote = new Map(entries);

      missing = expected.filter((note) => !byNote.has(note));
      const results = await Promise.all(entries.map(async ([note, module]) => {
        try {
          await this.loadBuffer(loadKey(sourceId, note), module, context);
          return { note, error: null };
        } catch (error) {
          return { note, error: errorMessage(error) };
        }
      }));

      for (const result of results) {
        if (result.error) {
          errors.push(`${result.note}.wav: ${result.error}`);
          missing.push(result.note);
        } else {
          loaded.push(result.note);
        }
      }

      missing = [...new Set(missing)];
    } else {
      const module = this.options.assets.getAmbientBed(sourceId);
      if (!module) {
        missing = ['loop.wav'];
      } else {
        try {
          await this.loadBuffer(loadKey(sourceId, 'loop.wav'), module, context);
          loaded = ['loop.wav'];
        } catch (error) {
          missing = ['loop.wav'];
          errors.push(`loop.wav: ${errorMessage(error)}`);
        }
      }
    }

    const status: SampleLoadStatus = loaded.length === 0
      ? errors.length > 0 ? 'error' : 'missing'
      : missing.length > 0 || errors.length > 0 ? 'partial' : 'ready';
    const report: SampleLoadReport = { sourceId, status, loaded, missing, errors };
    this.reports.set(sourceId, report);
    return this.cloneReport(report);
  }

  private async loadBuffer(
    key: string,
    module: SampleAssetModule,
    context: AudioContext,
  ): Promise<AudioBuffer> {
    const cached = this.buffers.get(key);
    if (cached) return cached;
    const existingLoad = this.bufferLoads.get(key);
    if (existingLoad) return existingLoad;

    const loader = this.options.loadBuffer;
    if (!loader) throw new Error('No WAV sample loader was configured.');
    const pending = loader(module, context)
      .then((buffer) => {
        this.buffers.set(key, buffer);
        return buffer;
      })
      .finally(() => this.bufferLoads.delete(key));
    this.bufferLoads.set(key, pending);
    return pending;
  }

  private getLoadedBuffer(sourceId: SampleSourceId, root: string): { buffer: AudioBuffer; root: string } | null {
    const buffer = this.buffers.get(loadKey(sourceId, root));
    return buffer ? { buffer, root } : null;
  }

  private findNearestPadBuffer(
    sourceId: PadPresetId,
    targetMidi: number,
  ): { buffer: AudioBuffer; root: string; rootMidi: number } | null {
    let nearest: { buffer: AudioBuffer; root: string; rootMidi: number; distance: number } | null = null;
    const report = this.reports.get(sourceId);
    if (!report) return null;

    for (const root of report.loaded) {
      const rootMidi = noteToMidi(root);
      const buffer = this.buffers.get(loadKey(sourceId, root));
      if (rootMidi === null || !buffer) continue;
      const distance = Math.abs(targetMidi - rootMidi);
      if (!nearest || distance < nearest.distance) nearest = { buffer, root, rootMidi, distance };
    }

    return nearest ? { buffer: nearest.buffer, root: nearest.root, rootMidi: nearest.rootMidi } : null;
  }

  private createVoice(
    layer: SampleLayerConfig,
    buffer: AudioBuffer,
    root: string,
    midi: number | null,
    when: number,
    fadeSeconds: number,
  ): SampleVoice {
    const context = this.getOrCreateContext();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;

    if (midi !== null) {
      const rootMidi = noteToMidi(root);
      if (rootMidi === null) throw new Error(`Invalid sample root note: ${root}`);
      source.playbackRate.setValueAtTime(Math.pow(2, (midi - rootMidi) / 12), when);
    } else {
      source.playbackRate.setValueAtTime(1, when);
    }

    const target = layer.volume;
    gain.gain.setValueAtTime(0, when);
    if (fadeSeconds > 0) gain.gain.linearRampToValueAtTime(target, when + fadeSeconds);
    else gain.gain.setValueAtTime(target, when);
    source.connect(gain);
    gain.connect(this.masterGain!);

    const voice: SampleVoice = {
      layerId: layer.id,
      sourceId: layer.sourceId,
      midi,
      source,
      gain,
      gainTarget: target,
      releaseTimer: null,
      ended: false,
    };
    source.onended = () => this.cleanupVoice(voice);
    source.start(when);
    this.voices.add(voice);
    return voice;
  }

  private fadeAndRelease(voice: SampleVoice, when: number, fadeSeconds: number): void {
    if (voice.ended) return;
    this.rampGain(voice.gain.gain, voice.gainTarget, 0, when, fadeSeconds);
    if (voice.releaseTimer !== null) clearTimeout(voice.releaseTimer);
    const now = this.context?.currentTime ?? when;
    const releaseMs = Math.max(0, (when + fadeSeconds - now) * 1_000) + 80;
    voice.releaseTimer = setTimeout(() => this.stopVoice(voice), releaseMs);
  }

  private restoreVoice(voice: SampleVoice, target: number, when: number): void {
    if (voice.ended) return;
    if (voice.releaseTimer !== null) clearTimeout(voice.releaseTimer);
    voice.releaseTimer = null;
    this.rampGain(voice.gain.gain, voice.gain.gain.value, target, when, 0.025);
    voice.gainTarget = target;
  }

  private stopVoice(voice: SampleVoice, when?: number): void {
    if (voice.releaseTimer !== null) clearTimeout(voice.releaseTimer);
    voice.releaseTimer = null;
    if (voice.ended) return;
    try {
      voice.source.stop(when);
    } catch {
      this.cleanupVoice(voice);
    }
  }

  private cleanupVoice(voice: SampleVoice): void {
    if (voice.ended) return;
    voice.ended = true;
    if (voice.releaseTimer !== null) clearTimeout(voice.releaseTimer);
    voice.releaseTimer = null;
    try {
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      // Nodes may already have been disconnected during disposal.
    }
    this.voices.delete(voice);
    if (this.currentVoices.get(voice.layerId) === voice) this.currentVoices.delete(voice.layerId);
  }

  private rampGain(
    parameter: AudioParam,
    from: number,
    to: number,
    when: number,
    fadeSeconds: number,
  ): void {
    parameter.cancelScheduledValues(when);
    parameter.setValueAtTime(from, when);
    if (fadeSeconds > 0) parameter.linearRampToValueAtTime(to, when + fadeSeconds);
    else parameter.setValueAtTime(to, when);
  }

  private ensureGraph(context: AudioContext): void {
    if (this.graphReady) return;
    this.masterGain = context.createGain();
    this.masterGain.gain.setValueAtTime(this.masterVolume, context.currentTime);
    this.masterGain.connect(context.destination);
    this.graphReady = true;
  }

  private getOrCreateContext(): AudioContext {
    this.assertAlive();
    if (this.context) return this.context;
    const contextFactory = this.options.contextFactory ?? (() => {
      const AudioContextConstructor = getAudioContextConstructor();
      if (!AudioContextConstructor) throw new Error('Web Audio is not supported in this browser.');
      return new AudioContextConstructor();
    });
    this.context = contextFactory();
    return this.context;
  }

  private assertPlayable(reports: readonly SampleLoadReport[]): void {
    const hasPlayableLayer = reports.some((report) => report.loaded.length > 0);
    if (!hasPlayableLayer) {
      throw new Error('No recorded WAV samples are ready. Add WAV files to the sample folders shown below.');
    }
  }

  private cloneReport(report: SampleLoadReport): SampleLoadReport {
    return { ...report, loaded: [...report.loaded], missing: [...report.missing], errors: [...report.errors] };
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('SampleSamplerEngine has been disposed.');
  }
}
