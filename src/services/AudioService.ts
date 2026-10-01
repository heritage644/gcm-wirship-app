/**
 * AuraPad — AudioService
 * ===========================================================================
 * The single owner of every native audio player in the app.
 *
 * ARCHITECTURE
 * ------------
 * Four mixer channels run simultaneously and in sync:
 *
 *   base | shimmer | sub     pitched — one loop per musical key
 *   texture                  unpitched ambience bed, shared across all keys
 *
 * Each channel is a two-slot crossfader (A/B), exactly like the two decks on a
 * DJ mixer. One slot holds the key you can hear; when you select a new key the
 * incoming loop is loaded into the idle slot at zero gain, started, and the two
 * slots are ramped past each other. Nothing is ever stopped abruptly, so a key
 * change never produces a gap or a click.
 *
 * Giving every channel its own crossfader (rather than crossfading whole
 * "decks") is what makes DRONE LOCK fall out for free: locking the sub simply
 * means "do not run a fade job on the sub channel", and it carries on holding
 * the old key underneath while base and shimmer move.
 *
 * GAIN GRAPH
 * ----------
 *   player.volume = master × fader × mute × canvasXY × fadeGain
 *
 * resolveChannelGain() in ./fades.ts is the only place that formula lives, so
 * the meters in the UI cannot disagree with what is actually being sent to the
 * players.
 *
 * SCHEDULING
 * ----------
 * One shared ~24ms ticker drives every in-flight fade. Elapsed time comes from
 * Date.now() rather than from counting ticks, so a fade lasts the requested
 * number of seconds even if the JS thread stalls — it just takes a bigger step
 * to catch up, which is inaudible on a pad.
 *
 * RESOURCE MANAGEMENT
 * -------------------
 * Native players are expensive, so loaded keys are kept in a small LRU cache
 * (default 3 keys ≈ 9 players + 2 texture players). Keys that are audible,
 * mid-fade, drone-locked or explicitly preloaded are pinned and never evicted.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { PAD_LIBRARY, TEXTURE_LIBRARY } from '../assets/audio';
import {
  DEFAULT_MIXER,
  DEFAULT_XY,
  PITCHED_STEMS,
  STEM_IDS,
  STEM_TO_MIX_KEY,
  type EngineSnapshot,
  type FadeCurve,
  type MixerState,
  type MusicalKey,
  type PitchedStem,
  type StemId,
  type StemMix,
  type TextureId,
  type TransitionState,
  type XYGains,
  type XYPosition,
} from '../types/audio';
import {
  UNITY_XY_GAINS,
  clamp01,
  computeXYGains,
  fadeInGain,
  fadeOutGain,
  resolveChannelGain,
} from './fades';

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

type SlotIndex = 0 | 1;

interface ChannelSlot {
  player: AudioPlayer | null;
  /** Musical key for pitched channels, texture id for the texture channel. */
  sourceId: string | null;
  /** 0 → 1 crossfade position of this slot. */
  fadeGain: number;
}

interface Channel {
  id: StemId;
  slots: [ChannelSlot, ChannelSlot];
  active: SlotIndex;
}

interface FadeJob {
  channelId: StemId;
  from: SlotIndex;
  to: SlotIndex;
  startedAt: number;
  durationMs: number;
  curve: FadeCurve;
  /** Marks this job as part of a user-visible key transition. */
  isKeyTransition: boolean;
}

export interface SetKeyOptions {
  /** Override the configured crossfade length for this transition only. */
  fadeSeconds?: number;
  /** Skip the fade entirely (used on first start). */
  immediate?: boolean;
}

const TICK_MS = 24;
/** Throttle for pushing in-flight fade progress to React. */
const PROGRESS_NOTIFY_MS = 66;
const DEFAULT_MAX_RESIDENT_KEYS = 3;

const emptySlot = (): ChannelSlot => ({ player: null, sourceId: null, fadeGain: 0 });

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AudioService {
  // --- transport & mix state ---
  private masterVolume = 0.85;
  private mixer: MixerState = structuredCloneish(DEFAULT_MIXER);
  /** Incremented by setMix() only — see EngineSnapshot.mixGeneration. */
  private mixGeneration = 0;
  private xy: XYPosition = { ...DEFAULT_XY };
  private xyEngaged = false;
  private xyGains: XYGains = { ...UNITY_XY_GAINS };

  private currentKey: MusicalKey | null = null;
  private droneLock = false;
  private droneLockedKey: MusicalKey | null = null;
  private texture: TextureId = 'room';

  private fadeDurationSeconds = 5;
  private fadeCurve: FadeCurve = 'logarithmic';

  private playing = false;
  private initialised = false;

  // --- channels & scheduling ---
  private channels: Record<StemId, Channel>;
  private fadeJobs: FadeJob[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  private transition: TransitionState = {
    active: false,
    fromKey: null,
    toKey: null,
    progress: 0,
    durationSeconds: 0,
  };

  // --- player cache (LRU over keys) ---
  private playerCache = new Map<string, AudioPlayer>();
  private keyRecency: MusicalKey[] = [];
  private pinnedKeys = new Set<MusicalKey>();
  private maxResidentKeys = DEFAULT_MAX_RESIDENT_KEYS;

  // --- subscriptions ---
  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot | null = null;
  private lastProgressNotify = 0;

  constructor() {
    this.channels = STEM_IDS.reduce((acc, id) => {
      acc[id] = { id, slots: [emptySlot(), emptySlot()], active: 0 };
      return acc;
    }, {} as Record<StemId, Channel>);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async initialize(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    try {
      await setAudioModeAsync({
        playsInSilentMode: true, // a worship pad must survive the ringer switch
        shouldPlayInBackground: true,
        interruptionMode: 'mixWithOthers',
        shouldRouteThroughEarpiece: false,
      });
    } catch {
      // Audio mode is best-effort; playback still works without it (e.g. web).
    }
    this.invalidate();
  }

  /** Tear everything down. Safe to call twice. */
  dispose(): void {
    this.stopTicker();
    this.fadeJobs = [];
    for (const id of STEM_IDS) {
      const channel = this.channels[id];
      channel.slots = [emptySlot(), emptySlot()];
      channel.active = 0;
    }
    for (const player of this.playerCache.values()) {
      try {
        player.pause();
        player.remove();
      } catch {
        /* already gone */
      }
    }
    this.playerCache.clear();
    this.keyRecency = [];
    this.pinnedKeys.clear();
    this.playing = false;
    this.currentKey = null;
    this.initialised = false;
    this.invalidate();
  }

  // =========================================================================
  // Subscription (feeds useSyncExternalStore)
  // =========================================================================

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EngineSnapshot => {
    if (!this.snapshot) this.snapshot = this.buildSnapshot();
    return this.snapshot;
  };

  private buildSnapshot(): EngineSnapshot {
    return {
      isPlaying: this.playing,
      isReady: this.initialised,
      loadedKeys: [...this.keyRecency],
      currentKey: this.currentKey,
      droneLockedKey: this.droneLock ? this.droneLockedKey : null,
      masterVolume: this.masterVolume,
      mixer: structuredCloneish(this.mixer),
      mixGeneration: this.mixGeneration,
      transition: { ...this.transition },
      droneLock: this.droneLock,
      texture: this.texture,
      fadeDurationSeconds: this.fadeDurationSeconds,
      fadeCurve: this.fadeCurve,
      xy: { ...this.xy },
      xyEngaged: this.xyEngaged,
      outputGains: this.currentOutputGains(),
    };
  }

  /** Mark state dirty and wake subscribers. */
  private invalidate(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }

  /** Dirty-mark for high-frequency fade progress, rate-limited for React. */
  private invalidateThrottled(): void {
    const now = Date.now();
    if (now - this.lastProgressNotify < PROGRESS_NOTIFY_MS) {
      this.snapshot = null; // keep data fresh for anyone who reads it
      return;
    }
    this.lastProgressNotify = now;
    this.invalidate();
  }

  /** Post-everything gain per channel, for the meter bridge. */
  private currentOutputGains(): XYGains {
    const out = {} as XYGains;
    for (const id of STEM_IDS) {
      const channel = this.channels[id];
      const sum = channel.slots[0].fadeGain + channel.slots[1].fadeGain;
      out[id] = resolveChannelGain({
        master: this.masterVolume,
        fader: this.mixer[id].volume,
        muted: this.mixer[id].muted,
        xyGain: this.xyGains[id],
        fadeGain: clamp01(sum),
      });
    }
    return out;
  }

  // =========================================================================
  // Player cache
  // =========================================================================

  private cacheKeyFor(stem: StemId, sourceId: string): string {
    return `${stem}|${sourceId}`;
  }

  private acquirePitchedPlayer(stem: PitchedStem, key: MusicalKey): AudioPlayer {
    const cacheKey = this.cacheKeyFor(stem, key);
    const existing = this.playerCache.get(cacheKey);
    if (existing) {
      this.touchKey(key);
      return existing;
    }

    const source = PAD_LIBRARY[key][stem];
    const player = createAudioPlayer(source, { updateInterval: 1000 });
    player.loop = true; // seamless repeat; the loops are rendered click-free
    player.volume = 0;
    this.playerCache.set(cacheKey, player);
    this.touchKey(key);
    this.evictIfNeeded();
    return player;
  }

  private acquireTexturePlayer(texture: TextureId): AudioPlayer {
    const cacheKey = this.cacheKeyFor('texture', texture);
    const existing = this.playerCache.get(cacheKey);
    if (existing) return existing;

    const player = createAudioPlayer(TEXTURE_LIBRARY[texture], { updateInterval: 1000 });
    player.loop = true;
    player.volume = 0;
    this.playerCache.set(cacheKey, player);
    return player;
  }

  private touchKey(key: MusicalKey): void {
    const index = this.keyRecency.indexOf(key);
    if (index !== -1) this.keyRecency.splice(index, 1);
    this.keyRecency.push(key);
  }

  /** Keys that must stay resident: audible, mid-fade, drone-locked, pinned. */
  private protectedKeys(): Set<MusicalKey> {
    const keep = new Set<MusicalKey>(this.pinnedKeys);
    if (this.currentKey) keep.add(this.currentKey);
    if (this.droneLockedKey) keep.add(this.droneLockedKey);
    for (const stem of PITCHED_STEMS) {
      for (const slot of this.channels[stem].slots) {
        if (slot.sourceId && slot.fadeGain > 0) keep.add(slot.sourceId as MusicalKey);
      }
    }
    for (const job of this.fadeJobs) {
      const channel = this.channels[job.channelId];
      for (const slot of channel.slots) {
        if (slot.sourceId) keep.add(slot.sourceId as MusicalKey);
      }
    }
    return keep;
  }

  private evictIfNeeded(): void {
    const keep = this.protectedKeys();
    // Oldest first.
    for (let i = 0; i < this.keyRecency.length && this.keyRecency.length > this.maxResidentKeys; ) {
      const key = this.keyRecency[i];
      if (keep.has(key)) {
        i += 1;
        continue;
      }
      for (const stem of PITCHED_STEMS) {
        const cacheKey = this.cacheKeyFor(stem, key);
        const player = this.playerCache.get(cacheKey);
        if (player) {
          try {
            player.pause();
            player.remove();
          } catch {
            /* already released */
          }
          this.playerCache.delete(cacheKey);
        }
      }
      this.keyRecency.splice(i, 1);
    }
  }

  /**
   * Warm a key in the background so the next transition starts instantly.
   * The setlist calls this for the upcoming song.
   */
  preloadKey(key: MusicalKey | null | undefined): void {
    if (!key) return;
    this.pinnedKeys.clear();
    if (key === this.currentKey) return;

    // Preloading an already-warm key is a no-op from React's point of view.
    // In particular, don't notify useSyncExternalStore just because a screen
    // re-ran an effect with the same key.
    const hadAllPlayers = PITCHED_STEMS.every((stem) =>
      this.playerCache.has(this.cacheKeyFor(stem, key)),
    );
    const previousRecency = [...this.keyRecency];

    this.pinnedKeys.add(key);
    for (const stem of PITCHED_STEMS) this.acquirePitchedPlayer(stem, key);

    const recencyChanged =
      previousRecency.length !== this.keyRecency.length ||
      previousRecency.some((cachedKey, index) => cachedKey !== this.keyRecency[index]);
    if (!hadAllPlayers || recencyChanged) this.invalidate();
  }

  // =========================================================================
  // Transport
  // =========================================================================

  /**
   * Start (or restart) playback on the given key.
   * The first start is immediate; later calls crossfade.
   */
  async start(key: MusicalKey, options: SetKeyOptions = {}): Promise<void> {
    await this.initialize();
    this.playing = true;
    await this.setKey(key, { immediate: this.currentKey === null, ...options });
  }

  play(): void {
    if (!this.currentKey) return;
    this.playing = true;
    for (const id of STEM_IDS) {
      for (const slot of this.channels[id].slots) {
        if (slot.player && slot.fadeGain > 0) {
          try {
            slot.player.play();
          } catch {
            /* player released mid-flight */
          }
        }
      }
    }
    this.applyAllGains();
    this.ensureTicker();
    this.invalidate();
  }

  pause(): void {
    this.playing = false;
    for (const player of this.playerCache.values()) {
      try {
        player.pause();
      } catch {
        /* already gone */
      }
    }
    this.invalidate();
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Full stop: cancels fades, silences and pauses everything. */
  stopAll(): void {
    this.fadeJobs = [];
    this.transition = { active: false, fromKey: null, toKey: null, progress: 0, durationSeconds: 0 };
    for (const id of STEM_IDS) {
      for (const slot of this.channels[id].slots) slot.fadeGain = 0;
    }
    this.pause();
    this.stopTicker();
    this.invalidate();
  }

  // =========================================================================
  // Key switching / crossfade
  // =========================================================================

  async setKey(key: MusicalKey, options: SetKeyOptions = {}): Promise<void> {
    await this.initialize();

    const immediate = options.immediate ?? false;
    const seconds = Math.max(0, options.fadeSeconds ?? this.fadeDurationSeconds);
    const previousKey = this.currentKey;

    if (previousKey === key && !immediate) {
      // Already here — but if drone lock was holding an older key, re-join it.
      if (this.droneLock && this.droneLockedKey !== key) return;
      return;
    }

    this.currentKey = key;
    this.playing = true;
    if (!this.droneLock) this.droneLockedKey = key;

    // Texture is unpitched and simply continues underneath a key change.
    this.ensureTextureRunning();

    const movingStems: PitchedStem[] = this.droneLock
      ? PITCHED_STEMS.filter((s) => s !== 'sub')
      : [...PITCHED_STEMS];

    // Phase anchor: start incoming loops at the same position as the outgoing
    // ones so the slow LFO motion of the pad continues rather than restarting.
    const anchor = this.currentPlayheadSeconds();

    for (const stem of movingStems) {
      this.crossfadeChannel(stem, key, immediate ? 0 : seconds, true, anchor);
    }

    if (immediate || seconds === 0) {
      this.transition = {
        active: false,
        fromKey: previousKey,
        toKey: key,
        progress: 1,
        durationSeconds: 0,
      };
    } else {
      this.transition = {
        active: true,
        fromKey: previousKey,
        toKey: key,
        progress: 0,
        durationSeconds: seconds,
      };
    }

    this.pinnedKeys.delete(key);
    this.applyAllGains();
    this.ensureTicker();
    this.evictIfNeeded();
    this.invalidate();
  }

  /** Where the currently audible pad is in its loop, for phase alignment. */
  private currentPlayheadSeconds(): number {
    const channel = this.channels.base;
    const slot = channel.slots[channel.active];
    if (!slot.player) return 0;
    try {
      const t = slot.player.currentTime;
      return Number.isFinite(t) && t >= 0 ? t : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Load `sourceId` into the idle slot of a channel and ramp the two slots
   * past each other.
   */
  private crossfadeChannel(
    stem: StemId,
    sourceId: string,
    seconds: number,
    isKeyTransition: boolean,
    anchorSeconds = 0,
  ): void {
    const channel = this.channels[stem];
    const from = channel.active;
    const to: SlotIndex = from === 0 ? 1 : 0;

    const currentSlot = channel.slots[from];
    if (currentSlot.sourceId === sourceId && currentSlot.fadeGain > 0 && seconds > 0) {
      return; // already playing this source on the active slot
    }

    const player =
      stem === 'texture'
        ? this.acquireTexturePlayer(sourceId as TextureId)
        : this.acquirePitchedPlayer(stem as PitchedStem, sourceId as MusicalKey);

    // Drop any fade already running on this channel; the newest wins.
    this.fadeJobs = this.fadeJobs.filter((job) => job.channelId !== stem);

    const incoming = channel.slots[to];
    incoming.player = player;
    incoming.sourceId = sourceId;
    incoming.fadeGain = seconds > 0 ? 0 : 1;

    try {
      player.loop = true;
      player.volume = 0;
      if (anchorSeconds > 0 && Number.isFinite(player.duration) && player.duration > 0) {
        // Align the new loop to the old one's playhead. Fire-and-forget: if the
        // player is not ready yet the seek is skipped and the fade still works.
        void player.seekTo(anchorSeconds % player.duration).catch(() => undefined);
      }
      if (this.playing) player.play();
    } catch {
      /* player not ready; gains are applied on the next tick anyway */
    }

    channel.active = to;

    if (seconds > 0) {
      this.fadeJobs.push({
        channelId: stem,
        from,
        to,
        startedAt: Date.now(),
        durationMs: seconds * 1000,
        curve: this.fadeCurve,
        isKeyTransition,
      });
    } else {
      // Immediate switch: silence the old slot right away.
      const outgoing = channel.slots[from];
      outgoing.fadeGain = 0;
      this.releaseSlot(outgoing);
    }
  }

  private ensureTextureRunning(): void {
    const channel = this.channels.texture;
    const slot = channel.slots[channel.active];
    if (slot.sourceId === this.texture && slot.fadeGain > 0) {
      if (this.playing && slot.player) {
        try {
          slot.player.play();
        } catch {
          /* noop */
        }
      }
      return;
    }
    if (slot.sourceId === null) {
      // First run — bring the bed in instantly underneath everything else.
      const player = this.acquireTexturePlayer(this.texture);
      slot.player = player;
      slot.sourceId = this.texture;
      slot.fadeGain = 1;
      try {
        player.loop = true;
        player.volume = 0;
        if (this.playing) player.play();
      } catch {
        /* noop */
      }
    }
  }

  /** Pause a slot's player once it is fully faded out, so it stops burning CPU. */
  private releaseSlot(slot: ChannelSlot): void {
    if (!slot.player) return;
    try {
      slot.player.pause();
      slot.player.volume = 0;
    } catch {
      /* already released */
    }
    slot.player = null;
    slot.sourceId = null;
  }

  // =========================================================================
  // Drone lock
  // =========================================================================

  /**
   * When engaged, the sub-bass stops following key changes and holds whatever
   * key it was on — the classic "keep the low end droning through the
   * transition" trick. Disengaging walks it back to the current key.
   */
  setDroneLock(enabled: boolean): void {
    if (this.droneLock === enabled) return;
    this.droneLock = enabled;

    if (enabled) {
      this.droneLockedKey = this.currentKey;
    } else {
      this.droneLockedKey = this.currentKey;
      if (this.currentKey) {
        const subSlot = this.channels.sub.slots[this.channels.sub.active];
        if (subSlot.sourceId !== this.currentKey) {
          this.crossfadeChannel('sub', this.currentKey, this.fadeDurationSeconds, false);
          this.ensureTicker();
        }
      }
    }
    this.applyAllGains();
    this.invalidate();
  }

  // =========================================================================
  // Mixer
  // =========================================================================

  setMasterVolume(value: number): void {
    this.masterVolume = clamp01(value);
    this.applyAllGains();
    this.invalidate();
  }

  setStemVolume(stem: StemId, value: number): void {
    this.mixer[stem].volume = clamp01(value);
    this.applyChannelGain(stem);
    this.invalidate();
  }

  setStemMuted(stem: StemId, muted: boolean): void {
    this.mixer[stem].muted = muted;
    this.applyChannelGain(stem);
    this.invalidate();
  }

  toggleStemMuted(stem: StemId): void {
    this.setStemMuted(stem, !this.mixer[stem].muted);
  }

  /** Apply a whole preset (from a setlist song) at once. */
  setMix(mix: StemMix): void {
    for (const stem of STEM_IDS) {
      this.mixer[stem].volume = clamp01(mix[STEM_TO_MIX_KEY[stem]]);
    }
    // Tell the UI this was an external recall, so the faders re-seed.
    this.mixGeneration += 1;
    this.applyAllGains();
    this.invalidate();
  }

  setTexture(texture: TextureId): void {
    if (this.texture === texture) return;
    this.texture = texture;
    // Beds are uncorrelated noise, so equal-power keeps the level steady.
    const previousCurve = this.fadeCurve;
    this.fadeCurve = 'equalPower';
    this.crossfadeChannel('texture', texture, 1.5, false);
    this.fadeCurve = previousCurve;
    this.ensureTicker();
    this.applyAllGains();
    this.invalidate();
  }

  setFadeDuration(seconds: number): void {
    this.fadeDurationSeconds = Math.max(0, seconds);
    this.invalidate();
  }

  setFadeCurve(curve: FadeCurve): void {
    this.fadeCurve = curve;
    this.invalidate();
  }

  setMaxResidentKeys(count: number): void {
    this.maxResidentKeys = Math.max(2, Math.floor(count));
    this.evictIfNeeded();
  }

  // =========================================================================
  // X/Y performance canvas
  // =========================================================================

  /**
   * Called from the gesture handler at pointer rate. Deliberately cheap: it
   * writes player volumes directly and does NOT notify React, because
   * re-rendering at 120Hz would be the one thing guaranteed to drop frames.
   * The visual feedback is driven on the UI thread by Reanimated instead.
   */
  setXY(position: XYPosition, engaged = true): void {
    this.xy = { x: clamp01(position.x), y: clamp01(position.y) };
    this.xyEngaged = engaged;
    this.xyGains = engaged ? computeXYGains(this.xy) : { ...UNITY_XY_GAINS };
    this.applyAllGains();
    this.snapshot = null; // stale-mark without waking React
  }

  /** Release the canvas: stems return to their fader positions. */
  releaseXY(): void {
    this.xyEngaged = false;
    this.xyGains = { ...UNITY_XY_GAINS };
    this.applyAllGains();
    this.invalidate();
  }

  /** Push the latest canvas state into React — call on gesture end. */
  commitXY(): void {
    this.invalidate();
  }

  isXYEngaged(): boolean {
    return this.xyEngaged;
  }

  // =========================================================================
  // Gain application
  // =========================================================================

  private applyChannelGain(stem: StemId): void {
    const channel = this.channels[stem];
    const channelGain = resolveChannelGain({
      master: this.masterVolume,
      fader: this.mixer[stem].volume,
      muted: this.mixer[stem].muted,
      xyGain: this.xyGains[stem],
      fadeGain: 1,
    });

    for (const slot of channel.slots) {
      if (!slot.player) continue;
      try {
        slot.player.volume = clamp01(channelGain * slot.fadeGain);
      } catch {
        /* player released */
      }
    }
  }

  private applyAllGains(): void {
    for (const stem of STEM_IDS) this.applyChannelGain(stem);
  }

  // =========================================================================
  // Fade ticker
  // =========================================================================

  private ensureTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicker(): void {
    if (this.ticker === null) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }

  private tick(): void {
    if (this.fadeJobs.length === 0) {
      this.stopTicker();
      if (this.transition.active) {
        this.transition = { ...this.transition, active: false, progress: 1 };
        this.invalidate();
      }
      return;
    }

    const now = Date.now();
    const finished: FadeJob[] = [];
    let keyTransitionProgress: number | null = null;

    for (const job of this.fadeJobs) {
      const channel = this.channels[job.channelId];
      const t = job.durationMs <= 0 ? 1 : clamp01((now - job.startedAt) / job.durationMs);

      channel.slots[job.to].fadeGain = fadeInGain(t, job.curve);
      channel.slots[job.from].fadeGain = fadeOutGain(t, job.curve);
      this.applyChannelGain(job.channelId);

      if (job.isKeyTransition) {
        keyTransitionProgress = Math.max(keyTransitionProgress ?? 0, t);
      }
      if (t >= 1) finished.push(job);
    }

    if (finished.length > 0) {
      for (const job of finished) {
        const channel = this.channels[job.channelId];
        const outgoing = channel.slots[job.from];
        outgoing.fadeGain = 0;
        this.releaseSlot(outgoing); // free the deck we just faded away from
        channel.slots[job.to].fadeGain = 1;
      }
      this.fadeJobs = this.fadeJobs.filter((job) => !finished.includes(job));
      this.evictIfNeeded();
    }

    if (keyTransitionProgress !== null) {
      this.transition = {
        ...this.transition,
        progress: keyTransitionProgress,
        active: keyTransitionProgress < 1,
      };
      if (keyTransitionProgress >= 1) this.invalidate();
      else this.invalidateThrottled();
    } else if (finished.length > 0) {
      this.invalidate();
    }
  }
}

/** Tiny deep clone for the plain mixer object (structuredClone is not on RN). */
function structuredCloneish(mixer: MixerState): MixerState {
  return {
    base: { ...mixer.base },
    shimmer: { ...mixer.shimmer },
    sub: { ...mixer.sub },
    texture: { ...mixer.texture },
  };
}

/** App-wide singleton. One engine, one set of native players. */
export const audioService = new AudioService();
