/**
 * XYControlCanvas — the full-screen performance touch pad.
 *
 * X : simulated low-pass cutoff / shimmer balance   left = warm, right = bright
 * Y : sub-bass weight + ambience mix                down = minimal, up = heavy
 *
 * THE 120Hz CONTRACT
 * ------------------
 * The visuals never touch the React tree. Finger position lives in a shared
 * value, the puck and crosshairs are driven by useAnimatedStyle, and all of it
 * runs on the UI thread — so the pad keeps up with the display even while the
 * audio engine is mid-crossfade and the JS thread is busy.
 *
 * Audio is a JS-thread API, so gain updates have to cross over via runOnJS.
 * Two things keep that from becoming the bottleneck:
 *
 *   1. A movement gate — JS is only woken when the position has actually moved
 *      by a perceptible amount (0.5% of the surface). A finger resting still
 *      sends nothing at all.
 *   2. audioService.setXY() deliberately does not notify React. It writes the
 *      new volumes straight to the players and stale-marks the snapshot. So a
 *      drag causes zero re-renders, no matter how fast you move.
 *
 * The numeric readouts update on release rather than continuously, which is
 * both cheaper and more readable — a value flickering at 120Hz is unreadable.
 */

import { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MONO, colors, radius, spacing, typography } from '../../theme';
import type { XYPosition } from '../../types/audio';
import { hexWithAlpha } from '../ui/Primitives';

/** Movement below this (fraction of the surface) is not worth waking JS for. */
const MOVE_EPSILON = 0.005;
const PUCK = 86;

export interface XYControlCanvasProps {
  value: XYPosition;
  onChange: (position: XYPosition) => void;
  onRelease: () => void;
  onCommit: () => void;
  /** Lets go of the canvas and returns every stem to its fader position. */
  engaged: boolean;
  disabled?: boolean;
}

function XYControlCanvasImpl({
  value,
  onChange,
  onRelease,
  onCommit,
  engaged,
  disabled = false,
}: XYControlCanvasProps) {
  const x = useSharedValue(value.x);
  const y = useSharedValue(value.y);
  const width = useSharedValue(1);
  const height = useSharedValue(1);
  const active = useSharedValue(0);
  const lastSentX = useSharedValue(value.x);
  const lastSentY = useSharedValue(value.y);

  // `value` seeds the puck position and is then owned by the UI thread — no
  // effect syncs the prop back in, because that would fight the finger that is
  // currently dragging. External resets (the CENTRE button) remount the canvas
  // with a new `key`, which is React's prescribed way to reset state.

  const emit = useCallback(
    (nx: number, ny: number) => {
      onChange({ x: nx, y: ny });
    },
    [onChange],
  );

  const commit = useCallback(() => onCommit(), [onCommit]);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    // Absolute positioning: the puck jumps to wherever you put your finger,
    // which is what a performance pad should do (unlike a mixer fader).
    .onBegin((event) => {
      active.value = withTiming(1, { duration: 120 });
      const nx = clampW(event.x / (width.value || 1));
      const ny = clampW(1 - event.y / (height.value || 1));
      x.value = nx;
      y.value = ny;
      lastSentX.value = nx;
      lastSentY.value = ny;
      runOnJS(emit)(nx, ny);
    })
    .onUpdate((event) => {
      const nx = clampW(event.x / (width.value || 1));
      const ny = clampW(1 - event.y / (height.value || 1));
      x.value = nx;
      y.value = ny;
      // Gate: only cross to JS when the move is actually audible.
      if (
        Math.abs(nx - lastSentX.value) >= MOVE_EPSILON ||
        Math.abs(ny - lastSentY.value) >= MOVE_EPSILON
      ) {
        lastSentX.value = nx;
        lastSentY.value = ny;
        runOnJS(emit)(nx, ny);
      }
    })
    .onFinalize(() => {
      active.value = withTiming(0, { duration: 260 });
      runOnJS(emit)(x.value, y.value); // land on the exact final position
      runOnJS(commit)(); // now it is worth one re-render
    });

  const puckStyle = useAnimatedStyle(() => ({
    left: `${x.value * 100}%`,
    bottom: `${y.value * 100}%`,
    transform: [
      { translateX: -PUCK / 2 },
      { translateY: PUCK / 2 },
      { scale: 1 + active.value * 0.08 },
    ],
    opacity: 0.55 + active.value * 0.45,
  }));

  const crosshairVertical = useAnimatedStyle(() => ({
    left: `${x.value * 100}%`,
    opacity: 0.12 + active.value * 0.3,
  }));

  const crosshairHorizontal = useAnimatedStyle(() => ({
    bottom: `${y.value * 100}%`,
    opacity: 0.12 + active.value * 0.3,
  }));

  // Warmth → brightness wash follows X; weight glow follows Y.
  const brightWash = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, 1], [0, 0.22]),
  }));
  const weightWash = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, 1], [0, 0.2]),
  }));

  return (
    <View style={styles.wrapper}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.canvas, disabled && styles.disabled]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Performance canvas. Horizontal controls brightness, vertical controls weight."
          accessibilityHint="Drag to shape the pad in real time"
          onLayout={(event) => {
            width.value = event.nativeEvent.layout.width;
            height.value = event.nativeEvent.layout.height;
          }}
        >
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.washBright, brightWash]}
          />
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.washWeight, weightWash]}
          />

          <GridLines />

          <Animated.View
            pointerEvents="none"
            style={[styles.crosshairV, crosshairVertical]}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.crosshairH, crosshairHorizontal]}
          />

          <Animated.View pointerEvents="none" style={[styles.puck, puckStyle]}>
            <View style={styles.puckInner} />
          </Animated.View>

          {/* Axis legends, positioned at the extremes they describe. */}
          <Text style={[styles.axisLabel, styles.axisLeft]}>WARM</Text>
          <Text style={[styles.axisLabel, styles.axisRight]}>BRIGHT</Text>
          <Text style={[styles.axisLabel, styles.axisTop]}>FULL</Text>
          <Text style={[styles.axisLabel, styles.axisBottom]}>MINIMAL</Text>

          {!engaged ? (
            <View pointerEvents="none" style={styles.idleHint}>
              <Text style={styles.idleHintText}>TOUCH TO ENGAGE</Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>

      <View style={styles.readouts}>
        <Readout label="X · CUTOFF" value={`${Math.round(value.x * 100)}%`} tint={colors.shimmer} />
        <Readout label="Y · WEIGHT" value={`${Math.round(value.y * 100)}%`} tint={colors.sub} />
        <Readout
          label="CANVAS"
          value={engaged ? 'ENGAGED' : 'BYPASS'}
          tint={engaged ? colors.success : colors.textMuted}
        />
      </View>

      {engaged ? (
        <Text style={styles.releaseHint} onPress={onRelease} accessibilityRole="button">
          TAP TO RELEASE CANVAS → stems return to fader positions
        </Text>
      ) : null}
    </View>
  );
}

export const XYControlCanvas = memo(XYControlCanvasImpl);

function Readout({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={styles.readout}>
      <Text style={styles.readoutLabel}>{label}</Text>
      <Text style={[styles.readoutValue, { color: tint }]}>{value}</Text>
    </View>
  );
}

/** Static 4×4 reference grid. Rendered once; never re-renders. */
const GridLines = memo(function GridLines() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[0.25, 0.5, 0.75].map((p) => (
        <View key={`v${p}`} style={[styles.gridLineV, { left: `${p * 100}%` }]} />
      ))}
      {[0.25, 0.5, 0.75].map((p) => (
        <View key={`h${p}`} style={[styles.gridLineH, { top: `${p * 100}%` }]} />
      ))}
    </View>
  );
});

/** Worklet-safe clamp — must be inline-able into the gesture handlers. */
function clampW(value: number): number {
  'worklet';
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    gap: spacing.md,
  },
  canvas: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.4,
  },
  washBright: {
    backgroundColor: colors.shimmer,
  },
  washWeight: {
    backgroundColor: colors.sub,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  crosshairV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.accent,
  },
  crosshairH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.accent,
  },
  puck: {
    position: 'absolute',
    width: PUCK,
    height: PUCK,
    borderRadius: PUCK / 2,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: hexWithAlpha(colors.accent, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.8,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  puckInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  axisLabel: {
    position: 'absolute',
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  axisLeft: { left: spacing.md, top: '50%' },
  axisRight: { right: spacing.md, top: '50%' },
  axisTop: { top: spacing.md, alignSelf: 'center' },
  axisBottom: { bottom: spacing.md, alignSelf: 'center' },
  idleHint: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleHintText: {
    ...typography.label,
    color: colors.textMuted,
  },
  readouts: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  readout: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 4,
  },
  readoutLabel: {
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  readoutValue: {
    ...MONO,
    fontSize: 16,
    fontWeight: '800',
  },
  releaseHint: {
    ...typography.labelSmall,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
