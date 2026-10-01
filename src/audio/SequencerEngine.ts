/**
 * Audio-clock progression scheduler.
 *
 * JavaScript timers are used only as a short-lookahead pump. Every key change
 * and metronome click is submitted with an absolute AudioContext time, so the
 * sound itself is scheduled on the Web Audio clock rather than at the mercy
 * of setInterval jitter.
 */

import { MUSICAL_KEYS } from '../types/audio';
import type { FadeCurve, MusicalKey } from '../types/audio';
import {
  beatsPerBar,
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  type ProgressionStep,
  type SongProgression,
  type TimeSignature,
} from '../types/sequencer';

export interface ScheduledAudioEvent {
  /** Cancel only if the event has not started yet. */
  cancel(): void;
}

/** Minimal audio-target contract implemented by SampleSamplerEngine and easy to fake in tests. */
export interface SequencerAudioTarget {
  readonly currentTime: number;
  prepare?: () => Promise<void>;
  setBpm?: (bpm: number) => void;
  setFadeCurve?: (curve: FadeCurve) => void;
  setPreset?: (presetId: string, fadeSeconds?: number) => ScheduledAudioEvent | void | null;
  scheduleKeyChange: (
    key: MusicalKey,
    atTime: number,
    fadeSeconds: number,
  ) => ScheduledAudioEvent | void;
  scheduleMetronomeClick?: (atTime: number, accented: boolean) => ScheduledAudioEvent | void;
}

export type SequencerStatus = 'stopped' | 'playing' | 'paused';

export interface SequencerSnapshot {
  status: SequencerStatus;
  songTitle: string | null;
  bpm: number;
  timeSignature: TimeSignature;
  beatsPerBar: number;
  loop: boolean;
  currentStepIndex: number | null;
  nextStepIndex: number | null;
  currentKey: MusicalKey | null;
  nextKey: MusicalKey | null;
  /** 1-indexed beat in the current bar, or 0 before playback starts. */
  beatNumber: number;
  /** 1-indexed measure number, or 0 before playback starts. */
  measureNumber: number;
  /** Position within the current beat, in the range 0..1. */
  beatProgress: number;
  /** Position within the current step, in the range 0..1. */
  stepProgress: number;
  elapsedBeats: number;
  beatsRemainingInStep: number;
  beatCountdownSeconds: number;
  secondsUntilNextStep: number | null;
  totalBeats: number;
  /** Monotonically changes once per beat; useful for a UI pulse animation. */
  beatPulse: number;
  error: string | null;
}

export interface SequencerEngineOptions {
  /** How far ahead Web Audio events are submitted. Defaults to 180ms. */
  lookAheadSeconds?: number;
  /** JavaScript pump interval. Audio timing does not depend on this interval. */
  tickIntervalMs?: number;
  /** Optional error hook for host UI/logging. */
  onError?: (error: unknown) => void;
}

export interface PlayOptions {
  loop?: boolean;
}

interface StepPosition {
  index: number;
  startBeat: number;
  endBeat: number;
  cycle: number;
  complete: boolean;
}

interface PendingEvent {
  atTime: number;
  event: ScheduledAudioEvent | void;
}

const DEFAULT_LOOKAHEAD_SECONDS = 0.18;
const DEFAULT_TICK_INTERVAL_MS = 25;
const START_LEAD_SECONDS = 0.035;
const LATE_EVENT_TOLERANCE_SECONDS = 0.045;
const MIN_AUDIO_LEAD_SECONDS = 0.02;
const SNAPSHOT_NOTIFY_INTERVAL_MS = 33;
const POSITION_EPSILON = 1e-7;

function clampBpm(bpm: number): number {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

function totalBeats(steps: readonly ProgressionStep[]): number {
  return steps.reduce((sum, step) => sum + step.durationInBeats, 0);
}

function validateProgression(progression: SongProgression): SongProgression {
  if (!progression || !Array.isArray(progression.steps) || progression.steps.length === 0) {
    throw new Error('A progression needs at least one step.');
  }
  if (!Number.isFinite(progression.bpm)) {
    throw new Error('Progression BPM must be a finite number.');
  }
  if (!['4/4', '3/4', '6/8'].includes(progression.timeSignature)) {
    throw new Error(`Unsupported time signature: ${String(progression.timeSignature)}`);
  }

  const steps = progression.steps.map((step, index) => {
    if (!step || typeof step.id !== 'string' || step.id.length === 0) {
      throw new Error(`Progression step ${index + 1} needs an id.`);
    }
    if (!MUSICAL_KEYS.includes(step.targetKey)) {
      throw new Error(`Progression step ${index + 1} has an invalid musical key.`);
    }
    if (!Number.isFinite(step.durationInBeats) || step.durationInBeats <= 0) {
      throw new Error(`Progression step ${index + 1} must have a positive beat duration.`);
    }
    if (
      !Number.isFinite(step.crossfadeDurationSeconds) ||
      step.crossfadeDurationSeconds < 0
    ) {
      throw new Error(`Progression step ${index + 1} has an invalid crossfade duration.`);
    }
    return {
      ...step,
      durationInBeats: Math.min(1_024, step.durationInBeats),
      crossfadeDurationSeconds: Math.min(30, step.crossfadeDurationSeconds),
    };
  });

  return {
    ...progression,
    bpm: clampBpm(progression.bpm),
    steps,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Drives a progression against an audio target. The class is independent of
 * React; its stable `getSnapshot`/`subscribe` pair can be bound with
 * useSyncExternalStore in a UI hook.
 */
export class SequencerEngine {
  private progression: SongProgression | null = null;
  private status: SequencerStatus = 'stopped';
  private loop = false;
  private startAt = 0;
  private pausedElapsedBeats = 0;
  private pausedBeforeStart = false;
  private completed = false;
  private nextStepIndex = 0;
  private nextStepBeat = 0;
  private nextClickBeat = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingEvents: PendingEvent[] = [];
  private listeners = new Set<() => void>();
  private snapshot: SequencerSnapshot | null = null;
  private lastNotifyAt = 0;
  private lastError: string | null = null;
  private disposed = false;
  private readonly lookAheadSeconds: number;
  private readonly tickIntervalMs: number;
  private readonly audio: SequencerAudioTarget;
  private readonly options: SequencerEngineOptions;

  constructor(audio: SequencerAudioTarget, options: SequencerEngineOptions = {}) {
    this.audio = audio;
    this.options = options;
    this.lookAheadSeconds = Math.max(0.05, options.lookAheadSeconds ?? DEFAULT_LOOKAHEAD_SECONDS);
    this.tickIntervalMs = Math.max(10, options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SequencerSnapshot => {
    if (!this.snapshot) this.snapshot = this.buildSnapshot();
    return this.snapshot;
  };

  getProgression(): SongProgression | null {
    return this.progression
      ? { ...this.progression, steps: this.progression.steps.map((step) => ({ ...step })) }
      : null;
  }

  setProgression(progression: SongProgression): void {
    this.assertAlive();
    this.stop(false);
    this.progression = validateProgression(progression);
    this.audio.setFadeCurve?.('logarithmic');
    this.audio.setPreset?.(this.progression.soundPresetId, 0.7);
    this.audio.setBpm?.(this.progression.bpm);
    this.pausedElapsedBeats = 0;
    this.completed = false;
    this.lastError = null;
    this.publish(true);
  }

  /** Start from the first step, optionally looping the entire progression. */
  async play(progression?: SongProgression, options: PlayOptions = {}): Promise<void> {
    this.assertAlive();
    if (progression) this.setProgression(progression);
    if (!this.progression) throw new Error('Set a progression before starting playback.');

    this.stop(false);
    await this.audio.prepare?.();
    this.assertAlive();
    const now = this.readAudioTime();
    this.status = 'playing';
    this.loop = options.loop ?? false;
    this.pausedElapsedBeats = 0;
    this.completed = false;
    this.pausedBeforeStart = true;
    this.startAt = now + Math.min(START_LEAD_SECONDS, this.lookAheadSeconds / 2);
    this.lastError = null;
    this.resetScheduleCursor();
    this.startTimer();
    this.tick();
  }

  /** Pause sequence automation without stopping the currently sounding pad. */
  pause(): void {
    if (this.status !== 'playing') return;
    const now = this.readAudioTime();
    this.pausedBeforeStart = now < this.startAt;
    this.pausedElapsedBeats = this.pausedBeforeStart ? 0 : this.elapsedBeatsAt(now);
    this.cancelFutureEvents(now);
    this.stopTimer();
    this.status = 'paused';
    this.publish(true);
  }

  /** Resume from the paused beat position; the current pad is left untouched. */
  async resume(): Promise<void> {
    this.assertAlive();
    if (this.status !== 'paused' || !this.progression) return;
    await this.audio.prepare?.();
    this.assertAlive();

    const now = this.readAudioTime();
    this.status = 'playing';
    if (this.pausedBeforeStart) {
      this.startAt = now + Math.min(START_LEAD_SECONDS, this.lookAheadSeconds / 2);
      this.resetScheduleCursor();
    } else {
      const secondsPerBeat = 60 / this.progression.bpm;
      this.startAt = now - this.pausedElapsedBeats * secondsPerBeat;
      this.configureCursorAfterElapsed(this.pausedElapsedBeats);
    }
    this.startTimer();
    this.tick();
  }

  async toggle(progression?: SongProgression, options: PlayOptions = {}): Promise<void> {
    if (this.status === 'playing') this.pause();
    else if (this.status === 'paused' && !progression) await this.resume();
    else await this.play(progression, options);
  }

  /** Stop only the sequencer; the active pad is not muted or released. */
  stop(notify = true): void {
    this.cancelFutureEvents(this.readAudioTime());
    this.stopTimer();
    this.status = 'stopped';
    this.loop = false;
    this.pausedElapsedBeats = 0;
    this.pausedBeforeStart = false;
    this.completed = false;
    this.resetScheduleCursor();
    if (notify) this.publish(true);
    else this.snapshot = null;
  }

  /** Update tempo live while retaining the current position in the song. */
  setBpm(value: number): void {
    this.assertAlive();
    if (!Number.isFinite(value)) return;
    const bpm = clampBpm(value);
    if (!this.progression || bpm === this.progression.bpm) return;

    const wasPlaying = this.status === 'playing';
    const now = this.readAudioTime();
    const beforeStart = wasPlaying && now < this.startAt;
    const elapsed = wasPlaying
      ? (beforeStart ? 0 : this.elapsedBeatsAt(now))
      : this.status === 'paused'
        ? this.pausedElapsedBeats
        : 0;

    if (wasPlaying) this.cancelFutureEvents(now);
    this.progression = { ...this.progression, bpm };
    this.audio.setBpm?.(bpm);

    if (wasPlaying) {
      if (beforeStart) {
        this.startAt = now + Math.min(START_LEAD_SECONDS, this.lookAheadSeconds / 2);
        this.resetScheduleCursor();
      } else {
        this.startAt = now - elapsed * (60 / bpm);
        this.configureCursorAfterElapsed(elapsed);
      }
      this.tick();
    } else {
      this.snapshot = null;
      this.publish(true);
    }
  }

  /** Update BPM and the motion-preset LFOs from a single shared control. */
  get bpm(): number {
    return this.progression?.bpm ?? DEFAULT_BPM;
  }

  get state(): SequencerStatus {
    return this.status;
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop(false);
    this.disposed = true;
    this.listeners.clear();
    this.snapshot = null;
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private resetScheduleCursor(): void {
    this.nextStepIndex = 0;
    this.nextStepBeat = 0;
    this.nextClickBeat = 0;
  }

  private configureCursorAfterElapsed(elapsed: number): void {
    const progression = this.progression;
    if (!progression) {
      this.resetScheduleCursor();
      return;
    }

    const position = this.locateStep(elapsed);
    if (!position || position.complete) {
      this.nextStepIndex = progression.steps.length;
      this.nextStepBeat = totalBeats(progression.steps);
      this.nextClickBeat = Math.ceil(elapsed - POSITION_EPSILON);
      return;
    }

    if (position.index + 1 < progression.steps.length) {
      this.nextStepIndex = position.index + 1;
    } else if (this.loop) {
      this.nextStepIndex = 0;
    } else {
      this.nextStepIndex = progression.steps.length;
    }
    this.nextStepBeat = position.endBeat;
    this.nextClickBeat = Math.floor(elapsed + POSITION_EPSILON) + 1;
  }

  private tick(): void {
    if (this.disposed || this.status !== 'playing' || !this.progression) return;
    try {
      const now = this.readAudioTime();
      this.removeElapsedEvents(now);
      this.scheduleAhead(now);

      const elapsed = this.elapsedBeatsAt(now);
      const total = totalBeats(this.progression.steps);
      if (!this.loop && elapsed >= total) {
        this.status = 'stopped';
        this.completed = true;
        this.stopTimer();
        this.cancelFutureEvents(now);
        this.publish(true);
        return;
      }
      this.publish(false);
    } catch (error) {
      this.fail(error);
    }
  }

  private scheduleAhead(now: number): void {
    const progression = this.progression;
    if (!progression) return;

    const horizon = now + this.lookAheadSeconds;
    const secondsPerBeat = 60 / progression.bpm;
    const total = totalBeats(progression.steps);
    let scheduledSteps = 0;

    while (this.nextStepIndex < progression.steps.length || this.loop) {
      if (scheduledSteps >= 256) {
        this.recoverFromLateSchedule(now);
        break;
      }
      let atTime = this.startAt + this.nextStepBeat * secondsPerBeat;
      if (atTime > horizon) break;

      if (atTime < now - LATE_EVENT_TOLERANCE_SECONDS) {
        this.recoverFromLateSchedule(now);
        return;
      }
      if (atTime < now + MIN_AUDIO_LEAD_SECONDS) {
        const shift = now + MIN_AUDIO_LEAD_SECONDS - atTime;
        this.startAt += shift;
        atTime += shift;
      }

      const step = progression.steps[this.nextStepIndex];
      this.trackEvent(
        atTime,
        this.audio.scheduleKeyChange(step.targetKey, atTime, step.crossfadeDurationSeconds),
      );
      this.nextStepBeat += step.durationInBeats;
      if (this.nextStepIndex + 1 < progression.steps.length) {
        this.nextStepIndex += 1;
      } else if (this.loop) {
        this.nextStepIndex = 0;
      } else {
        this.nextStepIndex = progression.steps.length;
      }
      scheduledSteps += 1;
    }

    let scheduledClicks = 0;
    while (this.nextClickBeat < total || this.loop) {
      if (scheduledClicks >= 512) {
        // A very short loop cannot flood the graph after a stalled JS thread.
        this.nextClickBeat = Math.max(this.nextClickBeat, Math.floor(this.elapsedBeatsAt(now)) + 1);
        break;
      }
      const clickAt = this.startAt + this.nextClickBeat * secondsPerBeat;
      if (clickAt > horizon) break;
      if (clickAt < now - LATE_EVENT_TOLERANCE_SECONDS) {
        this.nextClickBeat = Math.floor(this.elapsedBeatsAt(now)) + 1;
        continue;
      }
      const safeClickAt = Math.max(clickAt, now + MIN_AUDIO_LEAD_SECONDS);
      const barBeat = Math.round(this.nextClickBeat) % beatsPerBar(progression.timeSignature);
      const accented = barBeat === 0;
      const event = this.audio.scheduleMetronomeClick?.(safeClickAt, accented);
      if (event) this.trackEvent(safeClickAt, event);
      this.nextClickBeat += 1;
    }
  }

  /** Skip missed boundaries after a long main-thread stall rather than firing a burst. */
  private recoverFromLateSchedule(now: number): void {
    const progression = this.progression;
    if (!progression) return;
    const elapsed = Math.max(0, this.elapsedBeatsAt(now));
    const position = this.locateStep(elapsed);
    if (!position || position.complete) return;

    const safeStart = now + MIN_AUDIO_LEAD_SECONDS;
    const secondsPerBeat = 60 / progression.bpm;
    this.startAt = safeStart - position.startBeat * secondsPerBeat;
    this.nextStepIndex = position.index;
    this.nextStepBeat = position.startBeat;
    this.nextClickBeat = Math.ceil(position.startBeat - POSITION_EPSILON);
  }

  private locateStep(elapsedBeats: number): StepPosition | null {
    const progression = this.progression;
    if (!progression || progression.steps.length === 0 || elapsedBeats < 0) return null;
    const steps = progression.steps;
    const loopBeats = totalBeats(steps);
    const cycle = this.loop ? Math.floor(elapsedBeats / loopBeats) : 0;
    const beatInCycle = this.loop ? elapsedBeats - cycle * loopBeats : elapsedBeats;

    if (!this.loop && beatInCycle >= loopBeats) {
      const lastIndex = steps.length - 1;
      const lastStart = steps.slice(0, lastIndex).reduce((sum, step) => sum + step.durationInBeats, 0);
      return {
        index: lastIndex,
        startBeat: lastStart,
        endBeat: loopBeats,
        cycle: 0,
        complete: true,
      };
    }

    let cursor = 0;
    for (let index = 0; index < steps.length; index += 1) {
      const end = cursor + steps[index].durationInBeats;
      if (beatInCycle < end || index === steps.length - 1) {
        return {
          index,
          startBeat: cycle * loopBeats + cursor,
          endBeat: cycle * loopBeats + end,
          cycle,
          complete: false,
        };
      }
      cursor = end;
    }
    return null;
  }

  private elapsedBeatsAt(now: number): number {
    if (!this.progression) return 0;
    if (this.status === 'paused') return this.pausedElapsedBeats;
    if (this.status !== 'playing') return 0;
    return Math.max(0, (now - this.startAt) * this.progression.bpm / 60);
  }

  private buildSnapshot(): SequencerSnapshot {
    const progression = this.progression;
    const bpm = progression?.bpm ?? DEFAULT_BPM;
    const signature = progression?.timeSignature ?? '4/4';
    const barBeats = beatsPerBar(signature);
    const steps = progression?.steps ?? [];
    const total = totalBeats(steps);
    const now = this.readAudioTime();
    const elapsed = this.completed
      ? total
      : this.status === 'paused'
        ? this.pausedElapsedBeats
        : this.status === 'playing'
          ? this.elapsedBeatsAt(now)
          : 0;
    const hasStarted = this.completed || (this.status === 'paused'
      ? !this.pausedBeforeStart
      : this.status === 'playing' && now >= this.startAt);
    const position = hasStarted ? this.locateStep(elapsed) : null;
    const currentStep = position ? steps[position.index] : null;
    let nextIndex: number | null = null;

    if (steps.length > 0) {
      if (!position) {
        nextIndex = 0;
      } else if (position.complete && !this.loop) {
        nextIndex = null;
      } else if (position.index + 1 < steps.length) {
        nextIndex = position.index + 1;
      } else if (this.loop) {
        nextIndex = 0;
      }
    }

    const beatProgress = hasStarted ? elapsed - Math.floor(elapsed) : 0;
    const stepProgress = currentStep && position
      ? Math.max(0, Math.min(1, (elapsed - position.startBeat) / currentStep.durationInBeats))
      : 0;
    const beatsRemaining = currentStep && position
      ? Math.max(0, position.endBeat - elapsed)
      : 0;
    const secondsUntilNextStep = currentStep && position
      ? beatsRemaining * 60 / bpm
      : hasStarted && nextIndex !== null
        ? 0
        : null;

    return {
      status: this.status,
      songTitle: progression?.songTitle ?? null,
      bpm,
      timeSignature: signature,
      beatsPerBar: barBeats,
      loop: this.loop,
      currentStepIndex: position?.index ?? null,
      nextStepIndex: nextIndex,
      currentKey: currentStep?.targetKey ?? null,
      nextKey: nextIndex === null ? null : steps[nextIndex]?.targetKey ?? null,
      beatNumber: hasStarted ? Math.floor(elapsed) % barBeats + 1 : 0,
      measureNumber: hasStarted ? Math.floor(elapsed / barBeats) + 1 : 0,
      beatProgress,
      stepProgress,
      elapsedBeats: elapsed,
      beatsRemainingInStep: beatsRemaining,
      beatCountdownSeconds: hasStarted ? (1 - beatProgress) * 60 / bpm : 0,
      secondsUntilNextStep,
      totalBeats: total,
      beatPulse: hasStarted ? Math.floor(elapsed) : -1,
      error: this.lastError,
    };
  }

  private trackEvent(atTime: number, event: ScheduledAudioEvent | void): void {
    this.pendingEvents.push({ atTime, event });
  }

  private removeElapsedEvents(now: number): void {
    this.pendingEvents = this.pendingEvents.filter((pending) => pending.atTime > now);
  }

  private cancelFutureEvents(now: number): void {
    // Cancel newest transitions first. The audio target restores the preceding
    // voice when a pending transition is cancelled, so reverse order preserves
    // the last key that was already sounding.
    for (let index = this.pendingEvents.length - 1; index >= 0; index -= 1) {
      const pending = this.pendingEvents[index];
      if (pending.atTime <= now) continue;
      try {
        pending.event?.cancel();
      } catch {
        /* A native event may have started while cancellation was requested. */
      }
    }
    this.pendingEvents = this.pendingEvents.filter((pending) => pending.atTime <= now);
  }

  private readAudioTime(): number {
    const now = this.audio.currentTime;
    if (!Number.isFinite(now) || now < 0) {
      throw new Error('Sequencer audio target returned an invalid clock value.');
    }
    return now;
  }

  private fail(error: unknown): void {
    this.lastError = errorMessage(error);
    try {
      this.options.onError?.(error);
    } catch {
      /* A host logging callback must not keep the transport running. */
    }
    this.stopTimer();
    const now = Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    this.cancelFutureEvents(now);
    this.status = 'stopped';
    this.publish(true);
  }

  private publish(force: boolean): void {
    this.snapshot = null;
    const now = Date.now();
    if (!force && now - this.lastNotifyAt < SNAPSHOT_NOTIFY_INTERVAL_MS) return;
    this.lastNotifyAt = now;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* One subscriber must not block the sequencer or other listeners. */
      }
    }
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('SequencerEngine has been disposed.');
  }
}
