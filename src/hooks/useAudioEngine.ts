/**
 * useAudioEngine — React binding for the AudioService singleton.
 *
 * The service is the source of truth; this hook only mirrors it into React via
 * useSyncExternalStore and hands back stable callbacks. Two consequences worth
 * knowing:
 *
 *  - Every screen that calls this hook sees the same engine. Changing a fader
 *    in the mixer is instantly visible in Stage Mode, with no context plumbing.
 *  - setXY() intentionally does NOT re-render. The performance canvas calls it
 *    at pointer rate and drives its own visuals on the UI thread, so React
 *    stays out of the 120Hz path entirely.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { audioService, type SetKeyOptions } from '../services/AudioService';
import type {
  EngineSnapshot,
  FadeCurve,
  MusicalKey,
  SongItem,
  StemId,
  StemMix,
  TextureId,
  XYPosition,
} from '../types/audio';

export interface AudioEngineApi {
  state: EngineSnapshot;

  // transport
  start: (key: MusicalKey, options?: SetKeyOptions) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stopAll: () => void;

  // key / transition
  selectKey: (key: MusicalKey, options?: SetKeyOptions) => void;
  preloadKey: (key: MusicalKey | null | undefined) => void;

  // mixer
  setMasterVolume: (value: number) => void;
  setStemVolume: (stem: StemId, value: number) => void;
  toggleStemMuted: (stem: StemId) => void;
  setMix: (mix: StemMix) => void;
  setTexture: (texture: TextureId) => void;
  setFadeDuration: (seconds: number) => void;
  setFadeCurve: (curve: FadeCurve) => void;
  setDroneLock: (enabled: boolean) => void;
  toggleDroneLock: () => void;

  // performance canvas
  setXY: (position: XYPosition) => void;
  releaseXY: () => void;
  commitXY: () => void;

  // setlist integration
  applySong: (song: SongItem) => void;
}

function reportEngineError(error: unknown): void {
  // Surfaced in the dev console; in production the pad simply stays where it
  // is rather than crashing the screen the band is looking at.
  console.warn('[AuraPad] audio engine error:', error);
}

export function useAudioEngine(): AudioEngineApi {
  const state = useSyncExternalStore(
    audioService.subscribe,
    audioService.getSnapshot,
    audioService.getSnapshot, // server snapshot — same object, no SSR divergence
  );

  useEffect(() => {
    audioService.initialize().catch(reportEngineError);
  }, []);

  // Every async entry point is caught: a failure to load one key must never
  // take down the whole app mid-service.
  const start = useCallback((key: MusicalKey, options?: SetKeyOptions) => {
    audioService.start(key, options).catch(reportEngineError);
  }, []);

  const selectKey = useCallback((key: MusicalKey, options?: SetKeyOptions) => {
    audioService.setKey(key, options).catch(reportEngineError);
  }, []);

  const preloadKey = useCallback((key: MusicalKey | null | undefined) => {
    audioService.preloadKey(key);
  }, []);

  const play = useCallback(() => audioService.play(), []);
  const pause = useCallback(() => audioService.pause(), []);
  const togglePlay = useCallback(() => audioService.togglePlay(), []);
  const stopAll = useCallback(() => audioService.stopAll(), []);

  const setMasterVolume = useCallback((value: number) => audioService.setMasterVolume(value), []);
  const setStemVolume = useCallback(
    (stem: StemId, value: number) => audioService.setStemVolume(stem, value),
    [],
  );
  const toggleStemMuted = useCallback((stem: StemId) => audioService.toggleStemMuted(stem), []);
  const setMix = useCallback((mix: StemMix) => audioService.setMix(mix), []);
  const setTexture = useCallback((texture: TextureId) => audioService.setTexture(texture), []);
  const setFadeDuration = useCallback((seconds: number) => audioService.setFadeDuration(seconds), []);
  const setFadeCurve = useCallback((curve: FadeCurve) => audioService.setFadeCurve(curve), []);
  const setDroneLock = useCallback((enabled: boolean) => audioService.setDroneLock(enabled), []);

  const toggleDroneLock = useCallback(() => {
    audioService.setDroneLock(!audioService.getSnapshot().droneLock);
  }, []);

  const setXY = useCallback((position: XYPosition) => audioService.setXY(position, true), []);
  const releaseXY = useCallback(() => audioService.releaseXY(), []);
  const commitXY = useCallback(() => audioService.commitXY(), []);

  /**
   * Fire a song from a setlist: its stem preset lands first so the incoming
   * key arrives already balanced, then the crossfade runs at the song's own
   * fade time.
   */
  const applySong = useCallback((song: SongItem) => {
    audioService.setMix(song.stemMix);
    audioService
      .setKey(song.targetKey, { fadeSeconds: song.fadeDurationSeconds })
      .catch(reportEngineError);
  }, []);

  return useMemo<AudioEngineApi>(
    () => ({
      state,
      start,
      play,
      pause,
      togglePlay,
      stopAll,
      selectKey,
      preloadKey,
      setMasterVolume,
      setStemVolume,
      toggleStemMuted,
      setMix,
      setTexture,
      setFadeDuration,
      setFadeCurve,
      setDroneLock,
      toggleDroneLock,
      setXY,
      releaseXY,
      commitXY,
      applySong,
    }),
    [
      state,
      start,
      play,
      pause,
      togglePlay,
      stopAll,
      selectKey,
      preloadKey,
      setMasterVolume,
      setStemVolume,
      toggleStemMuted,
      setMix,
      setTexture,
      setFadeDuration,
      setFadeCurve,
      setDroneLock,
      toggleDroneLock,
      setXY,
      releaseXY,
      commitXY,
      applySong,
    ],
  );
}
