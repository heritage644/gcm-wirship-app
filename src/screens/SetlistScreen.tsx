/**
 * SetlistScreen — build and cue setlists.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SetlistBuilder } from '../components/Setlist/SetlistBuilder';
import { SongEditor } from '../components/Setlist/SongEditor';
import type { AudioEngineApi } from '../hooks/useAudioEngine';
import type { SetlistsApi } from '../hooks/useSetlists';
import { colors, spacing, typography } from '../theme';
import { mixerStateToMix, type SongItem, type StemMix } from '../types/audio';

export interface SetlistScreenProps {
  engine: AudioEngineApi;
  setlists: SetlistsApi;
}

export function SetlistScreen({ engine, setlists }: SetlistScreenProps) {
  const [editing, setEditing] = useState<SongItem | null>(null);
  const activeId = setlists.activeSetlist?.id ?? null;

  const handleCue = useCallback(
    (index: number) => {
      const song = setlists.activeSetlist?.songs[index];
      if (!song) return;
      setlists.cueIndex(index);
      engine.applySong(song);
      // Warm the following song so its transition starts the instant it is hit.
      engine.preloadKey(setlists.activeSetlist?.songs[index + 1]?.targetKey);
    },
    [engine, setlists],
  );

  const handleAddSong = useCallback(() => {
    if (!activeId) return;
    const created = setlists.addSong(activeId);
    setEditing(created);
  }, [activeId, setlists]);

  const handleSave = useCallback(
    (patch: Partial<SongItem>) => {
      if (!activeId || !editing) return;
      setlists.updateSong(activeId, editing.id, patch);
    },
    [activeId, editing, setlists],
  );

  const handleDelete = useCallback(() => {
    if (!activeId || !editing) return;
    setlists.deleteSong(activeId, editing.id);
    setEditing(null);
  }, [activeId, editing, setlists]);

  const captureLiveMix = useCallback(
    (): StemMix => mixerStateToMix(engine.state.mixer),
    [engine.state.mixer],
  );

  if (!setlists.hydrated) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>LOADING SETLISTS…</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SetlistBuilder
          setlists={setlists.setlists}
          activeSetlist={setlists.activeSetlist}
          currentIndex={setlists.currentIndex}
          onSelectSetlist={setlists.selectSetlist}
          onCreateSetlist={() => setlists.createSetlist()}
          onRenameSetlist={setlists.renameSetlist}
          onDeleteSetlist={setlists.deleteSetlist}
          onDuplicateSetlist={setlists.duplicateSetlist}
          onAddSong={handleAddSong}
          onEditSong={setEditing}
          onMoveSong={(songId, direction) => {
            if (activeId) setlists.moveSong(activeId, songId, direction);
          }}
          onCueSong={handleCue}
        />

        <Text style={styles.footnote}>
          Tap a song to cue it — the stem preset lands first, then the pad crossfades to its key
          over that song&apos;s own fade time. Saved automatically to this device.
        </Text>
      </ScrollView>

      <SongEditor
        song={editing}
        onSave={handleSave}
        onDelete={handleDelete}
        onClose={() => setEditing(null)}
        onCaptureLiveMix={captureLiveMix}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  footnote: {
    ...typography.labelSmall,
    color: colors.textMuted,
    lineHeight: 16,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.label,
    color: colors.textMuted,
  },
});
