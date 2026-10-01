/**
 * SetlistBuilder — setlist picker plus the song sequence editor.
 *
 * Tapping a row CUES that song: it applies the song's stem preset and
 * crossfades to its key using the song's own fade time. Editing is behind the
 * pencil, so a mis-tap during a service changes the sound rather than opening
 * a modal over the controls.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { MONO, TOUCH, colors, radius, spacing, typography } from '../../theme';
import type { Setlist, SongItem } from '../../types/audio';
import { Chip, Divider, EmptyState, IconButton, Panel, SectionLabel, hexWithAlpha } from '../ui/Primitives';

export interface SetlistBuilderProps {
  setlists: Setlist[];
  activeSetlist: Setlist | null;
  currentIndex: number;
  onSelectSetlist: (id: string) => void;
  onCreateSetlist: () => void;
  onRenameSetlist: (id: string, name: string) => void;
  onDeleteSetlist: (id: string) => void;
  onDuplicateSetlist: (id: string) => void;
  onAddSong: () => void;
  onEditSong: (song: SongItem) => void;
  onMoveSong: (songId: string, direction: -1 | 1) => void;
  onCueSong: (index: number) => void;
}

export function SetlistBuilder({
  setlists,
  activeSetlist,
  currentIndex,
  onSelectSetlist,
  onCreateSetlist,
  onRenameSetlist,
  onDeleteSetlist,
  onDuplicateSetlist,
  onAddSong,
  onEditSong,
  onMoveSong,
  onCueSong,
}: SetlistBuilderProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  const beginRename = () => {
    if (!activeSetlist) return;
    setDraftName(activeSetlist.name);
    setRenaming(true);
  };

  const commitRename = () => {
    if (activeSetlist) onRenameSetlist(activeSetlist.id, draftName);
    setRenaming(false);
  };

  return (
    <View style={styles.container}>
      <Panel>
        <SectionLabel>SETLISTS</SectionLabel>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.setlistRow}
        >
          {setlists.map((setlist) => (
            <Chip
              key={setlist.id}
              label={`${setlist.name}  ·  ${setlist.songs.length}`}
              selected={activeSetlist?.id === setlist.id}
              onPress={() => onSelectSetlist(setlist.id)}
              accessibilityLabel={`Setlist ${setlist.name}, ${setlist.songs.length} songs`}
            />
          ))}
          <IconButton
            glyph="+"
            onPress={onCreateSetlist}
            tint={colors.accent}
            accessibilityLabel="Create a new setlist"
          />
        </ScrollView>
      </Panel>

      {activeSetlist ? (
        <Panel style={styles.songsPanel}>
          <View style={styles.titleRow}>
            {renaming ? (
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                onBlur={commitRename}
                onSubmitEditing={commitRename}
                autoFocus
                style={styles.titleInput}
                accessibilityLabel="Setlist name"
                returnKeyType="done"
              />
            ) : (
              <Pressable onPress={beginRename} style={styles.titlePress} accessibilityRole="button">
                <Text style={styles.title} numberOfLines={1}>
                  {activeSetlist.name}
                </Text>
                <Text style={styles.titleHint}>tap to rename</Text>
              </Pressable>
            )}

            <View style={styles.titleActions}>
              <IconButton
                glyph="⧉"
                onPress={() => onDuplicateSetlist(activeSetlist.id)}
                accessibilityLabel="Duplicate setlist"
                tint={colors.textSecondary}
              />
              <IconButton
                glyph="×"
                onPress={() => onDeleteSetlist(activeSetlist.id)}
                accessibilityLabel="Delete setlist"
                tint={colors.danger}
              />
            </View>
          </View>

          <Divider style={styles.divider} />

          {activeSetlist.songs.length === 0 ? (
            <EmptyState
              title="No songs yet"
              body="Add your first song to build the sequence. Each entry stores a key, a fade time, and a stem balance."
            />
          ) : (
            <View style={styles.songList}>
              {activeSetlist.songs.map((song, index) => (
                <SongRow
                  key={song.id}
                  song={song}
                  index={index}
                  isCurrent={index === currentIndex}
                  isNext={index === currentIndex + 1}
                  isFirst={index === 0}
                  isLast={index === activeSetlist.songs.length - 1}
                  onCue={() => onCueSong(index)}
                  onEdit={() => onEditSong(song)}
                  onMove={(direction) => onMoveSong(song.id, direction)}
                />
              ))}
            </View>
          )}

          <Pressable
            onPress={onAddSong}
            accessibilityRole="button"
            accessibilityLabel="Add a song to this setlist"
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <Text style={styles.addButtonText}>+  ADD SONG</Text>
          </Pressable>
        </Panel>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

interface SongRowProps {
  song: SongItem;
  index: number;
  isCurrent: boolean;
  isNext: boolean;
  isFirst: boolean;
  isLast: boolean;
  onCue: () => void;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
}

function SongRow({
  song,
  index,
  isCurrent,
  isNext,
  isFirst,
  isLast,
  onCue,
  onEdit,
  onMove,
}: SongRowProps) {
  return (
    <View
      style={[
        styles.row,
        isCurrent && { borderColor: colors.accent, backgroundColor: hexWithAlpha(colors.accent, 0.1) },
        isNext && { borderColor: hexWithAlpha(colors.success, 0.45) },
      ]}
    >
      <Pressable
        onPress={onCue}
        style={styles.rowMain}
        accessibilityRole="button"
        accessibilityLabel={`Cue ${song.title} in the key of ${song.targetKey}`}
      >
        <View style={[styles.keyBadge, isCurrent && { borderColor: colors.accent }]}>
          <Text style={[styles.keyBadgeText, isCurrent && { color: colors.accent }]}>
            {song.targetKey}
          </Text>
        </View>

        <View style={styles.rowText}>
          <Text style={styles.songTitle} numberOfLines={1}>
            {index + 1}. {song.title}
          </Text>
          <Text style={styles.songMeta} numberOfLines={1}>
            {song.fadeDurationSeconds}s fade
            {song.tempoInfo ? `  ·  ${song.tempoInfo}` : ''}
            {isCurrent ? '  ·  LIVE' : isNext ? '  ·  NEXT' : ''}
          </Text>
        </View>
      </Pressable>

      <View style={styles.rowActions}>
        <IconButton
          glyph="↑"
          onPress={() => onMove(-1)}
          disabled={isFirst}
          size={38}
          accessibilityLabel={`Move ${song.title} up`}
          tint={colors.textSecondary}
        />
        <IconButton
          glyph="↓"
          onPress={() => onMove(1)}
          disabled={isLast}
          size={38}
          accessibilityLabel={`Move ${song.title} down`}
          tint={colors.textSecondary}
        />
        <IconButton
          glyph="✎"
          onPress={onEdit}
          size={38}
          accessibilityLabel={`Edit ${song.title}`}
          tint={colors.accent}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  setlistRow: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  songsPanel: {
    gap: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titlePress: {
    flex: 1,
    minHeight: TOUCH.min,
    justifyContent: 'center',
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  titleHint: {
    ...typography.labelSmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  titleInput: {
    flex: 1,
    minHeight: TOUCH.min,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  titleActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  divider: {
    marginVertical: spacing.lg,
  },
  songList: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingRight: spacing.sm,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    minHeight: TOUCH.comfortable,
  },
  keyBadge: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBadgeText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  songTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  songMeta: {
    ...MONO,
    fontSize: 10,
    color: colors.textMuted,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 4,
  },
  addButton: {
    marginTop: spacing.lg,
    minHeight: TOUCH.comfortable,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
});
