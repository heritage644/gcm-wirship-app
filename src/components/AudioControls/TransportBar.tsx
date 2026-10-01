/**
 * TransportBar — play/stop, Drone Lock, and crossfade length.
 *
 * These are the three things a worship leader reaches for between songs, so
 * they get oversized targets and live at the top of the perform screen.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MONO, TOUCH, colors, radius, spacing, typography } from '../../theme';
import { FADE_DURATION_OPTIONS, type EngineSnapshot } from '../../types/audio';
import { Chip, hexWithAlpha } from '../ui/Primitives';

export interface TransportBarProps {
  state: EngineSnapshot;
  onTogglePlay: () => void;
  onToggleDroneLock: () => void;
  onFadeDuration: (seconds: number) => void;
}

export function TransportBar({
  state,
  onTogglePlay,
  onToggleDroneLock,
  onFadeDuration,
}: TransportBarProps) {
  const { isPlaying, currentKey, droneLock, droneLockedKey, fadeDurationSeconds } = state;
  const canPlay = currentKey !== null;
  const holdingOldKey = droneLock && droneLockedKey !== null && droneLockedKey !== currentKey;

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Pressable
          onPress={onTogglePlay}
          disabled={!canPlay}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause pad' : 'Play pad'}
          accessibilityState={{ disabled: !canPlay }}
          style={({ pressed }) => [
            styles.playButton,
            isPlaying && styles.playButtonActive,
            !canPlay && styles.disabled,
            pressed && canPlay && styles.pressed,
          ]}
        >
          <Text style={[styles.playGlyph, isPlaying && styles.playGlyphActive]}>
            {isPlaying ? '❚❚' : '▶'}
          </Text>
        </Pressable>

        <Pressable
          onPress={onToggleDroneLock}
          accessibilityRole="switch"
          accessibilityState={{ checked: droneLock }}
          accessibilityLabel="Drone lock: hold the sub-bass on its current key through key changes"
          style={({ pressed }) => [
            styles.droneButton,
            droneLock && {
              borderColor: colors.warning,
              backgroundColor: hexWithAlpha(colors.warning, 0.14),
            },
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.droneTextBlock}>
            <Text style={[styles.droneLabel, droneLock && { color: colors.warning }]}>
              DRONE LOCK
            </Text>
            <Text style={styles.droneSub} numberOfLines={1}>
              {droneLock
                ? holdingOldKey
                  ? `sub held on ${droneLockedKey}`
                  : `armed · sub on ${droneLockedKey ?? '—'}`
                : 'sub follows key'}
            </Text>
          </View>
          <View
            style={[
              styles.droneDot,
              { backgroundColor: droneLock ? colors.warning : colors.borderBright },
            ]}
          />
        </Pressable>
      </View>

      <View style={styles.fadeRow}>
        <Text style={styles.fadeLabel}>CROSSFADE</Text>
        <View style={styles.fadeChips}>
          {FADE_DURATION_OPTIONS.map((seconds) => (
            <Chip
              key={seconds}
              label={`${seconds}s`}
              selected={fadeDurationSeconds === seconds}
              onPress={() => onFadeDuration(seconds)}
              style={styles.fadeChip}
              accessibilityLabel={`${seconds} second crossfade`}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  playButton: {
    width: TOUCH.large,
    height: TOUCH.large,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playButtonActive: {
    borderColor: colors.accent,
    backgroundColor: hexWithAlpha(colors.accent, 0.14),
  },
  playGlyph: {
    fontSize: 22,
    color: colors.textSecondary,
  },
  playGlyphActive: {
    color: colors.accent,
  },
  droneButton: {
    flex: 1,
    minHeight: TOUCH.large,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  droneTextBlock: {
    flex: 1,
    gap: 3,
  },
  droneLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  droneSub: {
    ...MONO,
    fontSize: 10,
    color: colors.textMuted,
  },
  droneDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  fadeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  fadeLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  fadeChips: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fadeChip: {
    flex: 1,
  },
  disabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.6,
  },
});
