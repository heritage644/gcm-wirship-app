/**
 * TransitionStatusBar — the "what is the engine doing right now" readout.
 *
 * Sits directly under the key grid and answers, at a glance:
 *   where am I · where am I going · how far through · how long is left
 *
 * The progress bar is animated with Reanimated so it keeps moving smoothly
 * between the throttled (~15Hz) state updates the engine pushes to React —
 * the bar interpolates on the UI thread instead of stepping.
 */

import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MONO, colors, radius, spacing, typography } from '../../theme';
import type { MusicalKey, TransitionState } from '../../types/audio';
import { hexWithAlpha } from '../ui/Primitives';

export interface TransitionStatusBarProps {
  transition: TransitionState;
  currentKey: MusicalKey | null;
  isPlaying: boolean;
  droneLockedKey: MusicalKey | null;
}

export function TransitionStatusBar({
  transition,
  currentKey,
  isPlaying,
  droneLockedKey,
}: TransitionStatusBarProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!transition.active) {
      progress.value = withTiming(transition.progress >= 1 ? 1 : 0, { duration: 180 });
      return;
    }
    // Interpolate toward the reported progress at roughly the rate updates
    // arrive, so the bar glides rather than ratchets.
    progress.value = withTiming(transition.progress, {
      duration: 120,
      easing: Easing.linear,
    });
  }, [transition.active, transition.progress, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, progress.value)) * 100}%`,
  }));

  const remaining = transition.active
    ? Math.max(0, transition.durationSeconds * (1 - transition.progress))
    : 0;

  const statusText = transition.active
    ? `${transition.fromKey ?? '—'}  →  ${transition.toKey ?? '—'}`
    : currentKey
      ? `HOLDING  ${currentKey}`
      : 'NO KEY SELECTED';

  const subText = transition.active
    ? `crossfading · ${remaining.toFixed(1)}s remaining`
    : isPlaying
      ? droneLockedKey && droneLockedKey !== currentKey
        ? `playing · sub droning on ${droneLockedKey}`
        : 'playing'
      : currentKey
        ? 'paused'
        : 'tap a key to begin';

  return (
    <View
      style={[styles.container, transition.active && styles.containerActive]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${statusText}. ${subText}`}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(transition.progress * 100),
      }}
    >
      <View style={styles.row}>
        <Text
          style={[styles.status, transition.active && { color: colors.success }]}
          numberOfLines={1}
        >
          {statusText}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {subText}
        </Text>
      </View>

      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: transition.active ? colors.success : hexWithAlpha(colors.accent, 0.5),
            },
            fillStyle,
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  containerActive: {
    borderColor: hexWithAlpha(colors.success, 0.5),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  status: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  sub: {
    ...MONO,
    fontSize: 10,
    color: colors.textMuted,
    flexShrink: 1,
    textAlign: 'right',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceActive,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});
