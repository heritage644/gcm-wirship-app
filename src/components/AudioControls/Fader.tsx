/**
 * Fader — gesture-driven slider used for every stem and for master volume.
 *
 * Built on Reanimated rather than a stock slider for three reasons:
 *  1. The fill and thumb are animated entirely on the UI thread, so the
 *     control keeps up at 120Hz even while the audio engine is mid-crossfade.
 *  2. Stage use demands a tall, fat vertical fader, which stock sliders do
 *     not give you.
 *  3. Dragging is RELATIVE, not absolute — touching a fader never makes the
 *     level jump to your finger. Mid-service, an accidental brush should do
 *     almost nothing.
 *
 * JS is only woken when the value actually moves by a meaningful amount, so a
 * slow drag does not spam the audio engine with sub-perceptual updates.
 */

import { useCallback } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius } from '../../theme';
import { hexWithAlpha } from '../ui/Primitives';

/** Smallest change worth telling the audio engine about (~0.1 dB at unity). */
const EPSILON = 0.004;

export interface FaderProps {
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  orientation?: 'vertical' | 'horizontal';
  tint?: string;
  /** Live post-fader output level, 0–1, drawn as a ghost meter behind the fill. */
  meter?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
}

export function Fader({
  value,
  onChange,
  onCommit,
  orientation = 'vertical',
  tint = colors.accent,
  meter,
  disabled = false,
  style,
  accessibilityLabel,
}: FaderProps) {
  const isVertical = orientation === 'vertical';

  // `value` seeds the shared value and is then owned by the UI thread. There
  // is deliberately NO effect syncing the prop back in on every render: the
  // fader is the authority while you are touching it, and a sync would fight
  // the gesture.
  //
  // External recall (a setlist preset landing, CAPTURE LIVE MIX) is handled by
  // remounting with a different `key` — React's prescribed way to reset state
  // when the identity of the value changes. See MixerPanel's mixGeneration.
  const position = useSharedValue(value);
  const trackSize = useSharedValue(1);
  const dragStart = useSharedValue(0);
  const dragging = useSharedValue(0);

  const emit = useCallback(
    (next: number) => {
      onChange(next);
    },
    [onChange],
  );

  const commit = useCallback(() => {
    onCommit?.();
  }, [onCommit]);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    // minDistance(0) makes the fader respond the instant the finger moves.
    .minDistance(0)
    .onBegin(() => {
      dragStart.value = position.value;
      dragging.value = withTiming(1, { duration: 90 });
    })
    .onUpdate((event) => {
      const size = trackSize.value || 1;
      // Vertical faders go up for louder, so invert translationY.
      const delta = isVertical ? -event.translationY / size : event.translationX / size;
      const raw = dragStart.value + delta;
      const next = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      if (Math.abs(next - position.value) >= EPSILON) {
        position.value = next;
        runOnJS(emit)(next);
      }
    })
    .onFinalize(() => {
      dragging.value = withTiming(0, { duration: 160 });
      // Push the exact final value so the UI and engine cannot drift apart.
      runOnJS(emit)(position.value);
      runOnJS(commit)();
    });

  const fillStyle = useAnimatedStyle(() => {
    const pct = `${Math.max(0, Math.min(1, position.value)) * 100}%` as const;
    return isVertical ? { height: pct } : { width: pct };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const pct = `${Math.max(0, Math.min(1, position.value)) * 100}%` as const;
    const grow = 1 + dragging.value * 0.12;
    return isVertical
      ? { bottom: pct, transform: [{ translateY: THUMB / 2 }, { scaleX: grow }] }
      : { left: pct, transform: [{ translateX: -THUMB / 2 }, { scaleY: grow }] };
  });

  const glowStyle = useAnimatedStyle(() => ({
    opacity: dragging.value * 0.9,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[isVertical ? styles.vertical : styles.horizontal, disabled && styles.disabled, style]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          trackSize.value = isVertical ? height : width;
        }}
      >
        {/* Ghost meter: where the signal actually ends up after master, mute,
            canvas and crossfade — which is often NOT where the fader sits. */}
        {meter !== undefined ? (
          <View
            pointerEvents="none"
            style={[
              styles.meter,
              isVertical
                ? { height: `${Math.max(0, Math.min(1, meter)) * 100}%`, width: '100%' }
                : { width: `${Math.max(0, Math.min(1, meter)) * 100}%`, height: '100%' },
              { backgroundColor: hexWithAlpha(tint, 0.16) },
            ]}
          />
        ) : null}

        <Animated.View
          pointerEvents="none"
          style={[
            styles.fill,
            isVertical ? { width: '100%' } : { height: '100%' },
            { backgroundColor: hexWithAlpha(tint, 0.42) },
            fillStyle,
          ]}
        />

        <Animated.View
          pointerEvents="none"
          style={[styles.glow, { backgroundColor: hexWithAlpha(tint, 0.1) }, glowStyle]}
        />

        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            isVertical ? styles.thumbVertical : styles.thumbHorizontal,
            { backgroundColor: tint, shadowColor: tint },
            thumbStyle,
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const THUMB = 6;

const styles = StyleSheet.create({
  vertical: {
    width: 52, // comfortably past the 48dp minimum
    flex: 1,
    minHeight: 140,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  horizontal: {
    height: TOUCH_HEIGHT(),
    width: '100%',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  meter: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
  fill: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
  glow: {
    ...StyleSheet.absoluteFill,
  },
  thumb: {
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  thumbVertical: {
    left: 0,
    right: 0,
    height: THUMB,
    borderRadius: THUMB / 2,
  },
  thumbHorizontal: {
    top: 0,
    bottom: 0,
    width: THUMB,
    borderRadius: THUMB / 2,
  },
});

function TOUCH_HEIGHT() {
  return 48;
}
