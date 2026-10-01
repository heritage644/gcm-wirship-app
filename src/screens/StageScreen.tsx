/**
 * StageScreen — wires Stage Mode to the engine and the setlist playhead.
 *
 * The NEXT SONG button is the whole point: one tap advances the playhead,
 * applies that song's stem preset, crossfades to its key at its own fade
 * time, and warms the song after it so the next tap is instant too.
 */

import { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { StageMode } from '../components/Setlist/StageMode';
import type { AudioEngineApi } from '../hooks/useAudioEngine';
import type { SetlistsApi } from '../hooks/useSetlists';
import { tapCommit, tapRejected } from '../services/haptics';
import { colors, spacing, typography } from '../theme';

export interface StageScreenProps {
  engine: AudioEngineApi;
  setlists: SetlistsApi;
  onExit: () => void;
}

export function StageScreen({ engine, setlists, onExit }: StageScreenProps) {
  const songs = setlists.activeSetlist?.songs ?? [];
  const { currentIndex, currentSong, nextSong } = setlists;

  // Keep the upcoming key warm in the player cache the whole time we are on
  // this screen, so NEXT SONG never waits on a decoder.
  useEffect(() => {
    engine.preloadKey(nextSong?.targetKey);
  }, [engine, nextSong?.targetKey]);

  const handleNext = useCallback(() => {
    const song = setlists.advance();
    if (song) {
      tapCommit();
      engine.applySong(song);
    } else {
      tapRejected(); // end of set — tell the hand, not the eye
    }
  }, [engine, setlists]);

  const handlePrevious = useCallback(() => {
    const song = setlists.rewind();
    if (song) {
      tapCommit();
      engine.applySong(song);
    }
  }, [engine, setlists]);

  if (songs.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>NO SONGS IN THIS SET</Text>
        <Text style={styles.emptyBody}>
          Build a setlist on the SETLIST tab, then come back here for the hands-free view.
        </Text>
        <Text style={styles.exitLink} onPress={onExit} accessibilityRole="button">
          ← BACK
        </Text>
      </View>
    );
  }

  const position =
    currentIndex < 0
      ? `READY · ${songs.length} songs`
      : `${currentIndex + 1} / ${songs.length}`;

  return (
    <StageMode
      state={engine.state}
      currentSong={currentSong}
      nextSong={nextSong}
      setlistName={setlists.activeSetlist?.name ?? null}
      position={position}
      onNext={handleNext}
      onPrevious={handlePrevious}
      onTogglePlay={engine.togglePlay}
      onToggleDroneLock={engine.toggleDroneLock}
      onExit={onExit}
      canGoNext={nextSong !== null}
      canGoPrevious={currentIndex > 0}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.title,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  exitLink: {
    ...typography.label,
    color: colors.accent,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
});
