/**
 * StageMode — the hands-free view.
 *
 * Everything on this screen is sized to be read and hit from a music stand in
 * a dark room, by someone who is also holding an instrument:
 *
 *  - The current key is rendered enormous, because that is the one fact you
 *    glance down for.
 *  - NEXT SONG is a full-width slab that fires the whole transition — preset,
 *    key, fade time — in a single tap. It is the only thing you should ever
 *    need to hit mid-service.
 *  - The screen is kept awake while this tab is open.
 *  - During a crossfade the slab becomes a live progress bar, so you can see
 *    the fade land instead of guessing.
 */

import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MONO, TOUCH, colors, radius, spacing, typography } from '../../theme';
import type { EngineSnapshot, SongItem } from '../../types/audio';
import { hexWithAlpha } from '../ui/Primitives';

const KEEP_AWAKE_TAG = 'aurapad-stage';

export interface StageModeProps {
  state: EngineSnapshot;
  currentSong: SongItem | null;
  nextSong: SongItem | null;
  setlistName: string | null;
  position: string;
  onNext: () => void;
  onPrevious: () => void;
  onTogglePlay: () => void;
  onToggleDroneLock: () => void;
  onExit: () => void;
  canGoNext: boolean;
  canGoPrevious: boolean;
}

export function StageMode({
  state,
  currentSong,
  nextSong,
  setlistName,
  position,
  onNext,
  onPrevious,
  onTogglePlay,
  onToggleDroneLock,
  onExit,
  canGoNext,
  canGoPrevious,
}: StageModeProps) {
  const { currentKey, transition, isPlaying, droneLock, droneLockedKey } = state;

  // Nobody wants the screen dimming halfway through a set. Wake-lock is a
  // best-effort request — on web it needs a secure context and a prior user
  // gesture, and it is perfectly normal for it to be refused — so failures are
  // swallowed rather than allowed to surface as unhandled rejections.
  useEffect(() => {
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, []);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(transition.active ? transition.progress : 0, {
      duration: transition.active ? 120 : 220,
      easing: Easing.linear,
    });
  }, [transition.active, transition.progress, progress]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, progress.value)) * 100}%`,
  }));

  const displayKey = transition.active ? (transition.toKey ?? currentKey) : currentKey;

  return (
    <View style={styles.container}>
      {/* --- header ------------------------------------------------------ */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.setName} numberOfLines={1}>
            {setlistName ?? 'NO SETLIST'}
          </Text>
          <Text style={styles.position}>{position}</Text>
        </View>
        <Pressable
          onPress={onExit}
          accessibilityRole="button"
          accessibilityLabel="Exit stage mode"
          hitSlop={12}
          style={({ pressed }) => [styles.exit, pressed && styles.pressed]}
        >
          <Text style={styles.exitText}>EXIT</Text>
        </Pressable>
      </View>

      {/* --- the big number ---------------------------------------------- */}
      <View style={styles.keyBlock}>
        <Text style={styles.keyCaption}>
          {transition.active ? 'MOVING TO' : 'CURRENT KEY'}
        </Text>
        <Text
          style={[styles.keyDisplay, transition.active && { color: colors.success }]}
          accessibilityLabel={`Current key ${displayKey ?? 'none'}`}
          adjustsFontSizeToFit
          numberOfLines={1}
        >
          {displayKey ?? '—'}
        </Text>

        <Text style={styles.nowTitle} numberOfLines={1}>
          {currentSong?.title ?? 'Not cued'}
        </Text>
        {currentSong?.tempoInfo ? (
          <Text style={styles.nowMeta}>{currentSong.tempoInfo}</Text>
        ) : null}

        {droneLock ? (
          <View style={styles.droneTag}>
            <Text style={styles.droneTagText}>
              DRONE LOCK · SUB ON {droneLockedKey ?? '—'}
            </Text>
          </View>
        ) : null}
      </View>

      {/* --- up next ------------------------------------------------------ */}
      <View style={styles.nextBlock}>
        <Text style={styles.nextCaption}>NEXT</Text>
        {nextSong ? (
          <>
            <View style={styles.nextRow}>
              <View style={styles.nextKeyBadge}>
                <Text style={styles.nextKeyText}>{nextSong.targetKey}</Text>
              </View>
              <Text style={styles.nextTitle} numberOfLines={1}>
                {nextSong.title}
              </Text>
            </View>
            <Text style={styles.nextMeta}>
              {nextSong.fadeDurationSeconds}s fade
              {nextSong.tempoInfo ? `  ·  ${nextSong.tempoInfo}` : ''}
            </Text>
          </>
        ) : (
          <Text style={styles.nextEmpty}>End of set</Text>
        )}
      </View>

      {/* --- the one button that matters ---------------------------------- */}
      <Pressable
        onPress={onNext}
        disabled={!canGoNext}
        accessibilityRole="button"
        accessibilityLabel={
          nextSong
            ? `Next song: ${nextSong.title} in ${nextSong.targetKey}`
            : 'No next song'
        }
        accessibilityState={{ disabled: !canGoNext }}
        style={({ pressed }) => [
          styles.nextButton,
          !canGoNext && styles.nextButtonDisabled,
          pressed && canGoNext && styles.nextButtonPressed,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.nextProgress, progressStyle]}
        />
        <Text style={[styles.nextButtonText, !canGoNext && { color: colors.textMuted }]}>
          {transition.active ? 'CROSSFADING…' : 'NEXT SONG'}
        </Text>
        {nextSong && !transition.active ? (
          <Text style={styles.nextButtonSub}>
            → {nextSong.targetKey}  ·  {nextSong.fadeDurationSeconds}s
          </Text>
        ) : null}
      </Pressable>

      {/* --- secondary row ------------------------------------------------ */}
      <View style={styles.secondaryRow}>
        <Pressable
          onPress={onPrevious}
          disabled={!canGoPrevious}
          accessibilityRole="button"
          accessibilityLabel="Previous song"
          style={({ pressed }) => [
            styles.secondary,
            !canGoPrevious && styles.disabled,
            pressed && canGoPrevious && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryText}>◀ PREV</Text>
        </Pressable>

        <Pressable
          onPress={onTogglePlay}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          style={({ pressed }) => [
            styles.secondary,
            isPlaying && { borderColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.secondaryText, isPlaying && { color: colors.accent }]}>
            {isPlaying ? '❚❚ PAUSE' : '▶ PLAY'}
          </Text>
        </Pressable>

        <Pressable
          onPress={onToggleDroneLock}
          accessibilityRole="switch"
          accessibilityState={{ checked: droneLock }}
          accessibilityLabel="Toggle drone lock"
          style={({ pressed }) => [
            styles.secondary,
            droneLock && {
              borderColor: colors.warning,
              backgroundColor: hexWithAlpha(colors.warning, 0.12),
            },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.secondaryText, droneLock && { color: colors.warning }]}>
            DRONE
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  setName: {
    ...typography.label,
    color: colors.textSecondary,
  },
  position: {
    ...MONO,
    fontSize: 11,
    color: colors.textMuted,
  },
  exit: {
    minHeight: TOUCH.min,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exitText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  keyBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  keyCaption: {
    ...typography.label,
    color: colors.textMuted,
  },
  keyDisplay: {
    fontSize: 150,
    lineHeight: 170,
    fontWeight: '800',
    letterSpacing: -6,
    color: colors.accent,
  },
  nowTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  nowMeta: {
    ...MONO,
    fontSize: 12,
    color: colors.textMuted,
  },
  droneTag: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: hexWithAlpha(colors.warning, 0.1),
  },
  droneTagText: {
    ...typography.labelSmall,
    color: colors.warning,
  },
  nextBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  nextCaption: {
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  nextKeyBadge: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: hexWithAlpha(colors.success, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextKeyText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.success,
  },
  nextTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  nextMeta: {
    ...MONO,
    fontSize: 11,
    color: colors.textMuted,
  },
  nextEmpty: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textMuted,
    paddingVertical: spacing.sm,
  },
  nextButton: {
    minHeight: 108,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    gap: spacing.xs,
  },
  nextButtonPressed: {
    opacity: 0.8,
  },
  nextButtonDisabled: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nextProgress: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: hexWithAlpha('#FFFFFF', 0.25),
  },
  nextButtonText: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 1,
    color: colors.textInverse,
  },
  nextButtonSub: {
    ...MONO,
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(0,0,0,0.65)',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondary: {
    flex: 1,
    minHeight: TOUCH.comfortable,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  disabled: {
    opacity: 0.3,
  },
  pressed: {
    opacity: 0.6,
  },
});
