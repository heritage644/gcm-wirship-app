/**
 * Domain models for the programmable progression sequencer.
 *
 * MusicalKey is re-exported from the existing audio domain so the UI, sample
 * library, and sequencer all share exactly one key vocabulary.
 */

import type { MusicalKey } from './audio';

export type { MusicalKey } from './audio';

export type TimeSignature = '4/4' | '3/4' | '6/8';

export interface ProgressionStep {
  id: string;
  targetKey: MusicalKey;
  /** Number of sequencer beats to hold this key. */
  durationInBeats: number;
  /** Incoming logarithmic crossfade length, in seconds. */
  crossfadeDurationSeconds: number;
}

export interface SongProgression {
  id: string;
  songTitle: string;
  bpm: number;
  timeSignature: TimeSignature;
  /** Identifier for the selected sound preset or sample-layer rack. */
  soundPresetId: string;
  steps: ProgressionStep[];
}

export const MIN_BPM = 40;
export const MAX_BPM = 240;
export const DEFAULT_BPM = 72;
export const DEFAULT_TIME_SIGNATURE: TimeSignature = '4/4';

/**
 * The clock counts the notated beat unit: quarter notes in 4/4 and 3/4,
 * eighth notes in 6/8. Consequently a 6/8 bar contains six sequencer beats.
 */
export function beatsPerBar(signature: TimeSignature): number {
  switch (signature) {
    case '3/4':
      return 3;
    case '6/8':
      return 6;
    case '4/4':
    default:
      return 4;
  }
}
