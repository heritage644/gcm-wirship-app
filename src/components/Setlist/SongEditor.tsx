/**
 * SongEditor — modal sheet for a single setlist entry.
 *
 * Edits are staged locally and only committed on SAVE, so a half-typed title
 * or a mid-drag fader never reaches storage (or, worse, the live engine while
 * a service is running).
 */

import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MONO, TOUCH, colors, radius, spacing, typography } from '../../theme';
import {
  FADE_DURATION_OPTIONS,
  MUSICAL_KEYS,
  STEM_DESCRIPTORS,
  type MusicalKey,
  type SongItem,
  type StemMix,
} from '../../types/audio';
import { Fader } from '../AudioControls/Fader';
import { Chip, hexWithAlpha } from '../ui/Primitives';

export interface SongEditorProps {
  song: SongItem | null;
  onSave: (patch: Partial<SongItem>) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Pulls the current live mixer into this song's preset. */
  onCaptureLiveMix: () => StemMix;
}

export function SongEditor({ song, ...rest }: SongEditorProps) {
  if (!song) return null;
  // Keying on the song id remounts the form, which resets the staging buffer
  // from props. That is React's prescribed way to reset state when the
  // identity of the thing being edited changes — no setState-in-effect, and
  // no window in which the form shows the previous song's values.
  return <SongEditorForm key={song.id} song={song} {...rest} />;
}

type SongEditorFormProps = Omit<SongEditorProps, 'song'> & { song: SongItem };

function SongEditorForm({
  song,
  onSave,
  onDelete,
  onClose,
  onCaptureLiveMix,
}: SongEditorFormProps) {
  // Edits are staged here and only flushed on SAVE.
  const [title, setTitle] = useState(song.title);
  const [tempoInfo, setTempoInfo] = useState(song.tempoInfo ?? '');
  const [targetKey, setTargetKey] = useState<MusicalKey>(song.targetKey);
  const [fade, setFade] = useState(song.fadeDurationSeconds);
  const [mix, setMix] = useState<StemMix>(() => ({ ...song.stemMix }));
  // Bumped when the live mixer is captured, so the preset faders remount and
  // re-seed from the new values instead of staying where they were dragged.
  const [mixGeneration, setMixGeneration] = useState(0);

  const commit = () => {
    onSave({
      title: title.trim() || 'Untitled',
      tempoInfo: tempoInfo.trim(),
      targetKey,
      fadeDurationSeconds: fade,
      stemMix: mix,
    });
    onClose();
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />

            <ScrollView
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.heading}>EDIT SONG</Text>

              <Field label="TITLE">
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Song title"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  returnKeyType="done"
                  accessibilityLabel="Song title"
                />
              </Field>

              <Field label="TEMPO / TIME SIGNATURE (OPTIONAL)">
                <TextInput
                  value={tempoInfo}
                  onChangeText={setTempoInfo}
                  placeholder="e.g. 72 BPM · 4/4"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  returnKeyType="done"
                  accessibilityLabel="Tempo and time signature"
                />
              </Field>

              <Field label="TARGET KEY">
                <View style={styles.keyRow}>
                  {MUSICAL_KEYS.map((key) => (
                    <Pressable
                      key={key}
                      onPress={() => setTargetKey(key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: targetKey === key }}
                      accessibilityLabel={`Key of ${key}`}
                      style={({ pressed }) => [
                        styles.keyChip,
                        targetKey === key && {
                          borderColor: colors.accent,
                          backgroundColor: hexWithAlpha(colors.accent, 0.16),
                        },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.keyChipText,
                          targetKey === key && { color: colors.accent },
                        ]}
                      >
                        {key}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Field>

              <Field label="PAD FADE TIME">
                <View style={styles.fadeRow}>
                  {FADE_DURATION_OPTIONS.map((seconds) => (
                    <Chip
                      key={seconds}
                      label={`${seconds}s`}
                      selected={fade === seconds}
                      onPress={() => setFade(seconds)}
                      style={styles.flexChip}
                      accessibilityLabel={`${seconds} second fade`}
                    />
                  ))}
                </View>
              </Field>

              <Field
                label="PRESET STEM BALANCE"
                accessory={
                  <Pressable
                    onPress={() => {
                      setMix(onCaptureLiveMix());
                      setMixGeneration((n) => n + 1);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Capture the current live mixer into this preset"
                    hitSlop={8}
                  >
                    <Text style={styles.captureLink}>CAPTURE LIVE MIX</Text>
                  </Pressable>
                }
              >
                <View style={styles.mixRow}>
                  {STEM_DESCRIPTORS.map((descriptor) => (
                    <View key={descriptor.id} style={styles.mixStrip}>
                      <Text style={[styles.mixLabel, { color: descriptor.color }]}>
                        {descriptor.label}
                      </Text>
                      <Fader
                        key={mixGeneration}
                        value={mix[descriptor.mixKey]}
                        onChange={(value) =>
                          setMix((prev) => ({ ...prev, [descriptor.mixKey]: value }))
                        }
                        tint={descriptor.color}
                        accessibilityLabel={`${descriptor.label} preset level`}
                        style={styles.mixFader}
                      />
                      <Text style={styles.mixValue}>
                        {Math.round(mix[descriptor.mixKey] * 100)}
                      </Text>
                    </View>
                  ))}
                </View>
              </Field>

              <Pressable
                onPress={onDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete this song"
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
              >
                <Text style={styles.deleteText}>DELETE SONG</Text>
              </Pressable>
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <Text style={styles.actionText}>CANCEL</Text>
              </Pressable>
              <Pressable
                onPress={commit}
                accessibilityRole="button"
                accessibilityLabel="Save song"
                style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && styles.pressed]}
              >
                <Text style={[styles.actionText, styles.actionTextPrimary]}>SAVE</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Field({
  label,
  children,
  accessory,
}: {
  label: string;
  children: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {accessory}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    maxHeight: '94%',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: colors.borderBright,
    paddingTop: spacing.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderBright,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xl,
  },
  heading: {
    ...typography.label,
    color: colors.textSecondary,
  },
  field: {
    gap: spacing.sm,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 18,
  },
  fieldLabel: {
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  captureLink: {
    ...typography.labelSmall,
    color: colors.accent,
  },
  input: {
    minHeight: TOUCH.min,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.lg,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  keyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  keyChip: {
    width: TOUCH.min,
    height: TOUCH.min,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyChipText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  fadeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexChip: {
    flex: 1,
  },
  mixRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: 190,
  },
  mixStrip: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  mixLabel: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  mixFader: {
    flex: 1,
    minHeight: 120,
  },
  mixValue: {
    ...MONO,
    fontSize: 11,
    color: colors.textSecondary,
  },
  deleteButton: {
    minHeight: TOUCH.min,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: hexWithAlpha(colors.danger, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    ...typography.label,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  action: {
    flex: 1,
    minHeight: TOUCH.comfortable,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  actionTextPrimary: {
    color: colors.textInverse,
  },
  pressed: {
    opacity: 0.6,
  },
});
