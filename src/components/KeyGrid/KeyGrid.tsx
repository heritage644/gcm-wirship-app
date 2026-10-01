/**
 * KeyGrid — the 12-key selector, C through B.
 *
 * Laid out 4 × 3 so every pad clears 48dp comfortably even on a small phone,
 * and so the sharps line up in recognisable columns rather than scattering.
 *
 * Three visual states matter during a service:
 *   ACTIVE    the key you are hearing (filled, neon border)
 *   INCOMING  the key being faded to right now (pulsing, dashed feel)
 *   LOADED    resident in the player cache — this key will switch instantly
 */

import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { MONO, TOUCH, colors, radius, spacing } from '../../theme';
import { MUSICAL_KEYS, type MusicalKey } from '../../types/audio';
import { hexWithAlpha } from '../ui/Primitives';

export interface KeyGridProps {
  currentKey: MusicalKey | null;
  incomingKey: MusicalKey | null;
  loadedKeys: MusicalKey[];
  droneLockedKey: MusicalKey | null;
  onSelect: (key: MusicalKey) => void;
}

export function KeyGrid({
  currentKey,
  incomingKey,
  loadedKeys,
  droneLockedKey,
  onSelect,
}: KeyGridProps) {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {MUSICAL_KEYS.map((key) => (
        <KeyButton
          key={key}
          musicalKey={key}
          active={currentKey === key && incomingKey === null}
          incoming={incomingKey === key}
          outgoing={currentKey === key && incomingKey !== null && incomingKey !== key}
          loaded={loadedKeys.includes(key)}
          droneLocked={droneLockedKey === key && currentKey !== key}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

interface KeyButtonProps {
  musicalKey: MusicalKey;
  active: boolean;
  incoming: boolean;
  outgoing: boolean;
  loaded: boolean;
  droneLocked: boolean;
  onSelect: (key: MusicalKey) => void;
}

const KeyButton = memo(function KeyButton({
  musicalKey,
  active,
  incoming,
  outgoing,
  loaded,
  droneLocked,
  onSelect,
}: KeyButtonProps) {
  const pulse = useSharedValue(0);

  // A slow breathe on the incoming pad reads as "this is arriving" from the
  // other side of a dark stage. Runs on the UI thread, so a crossfade never
  // costs the JS thread anything to animate.
  useEffect(() => {
    if (incoming) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 200 });
    }
    return () => cancelAnimation(pulse);
  }, [incoming, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + pulse.value * 0.75,
  }));

  const isSharp = musicalKey.includes('#');
  const tint = incoming ? colors.success : active ? colors.accent : colors.textSecondary;

  return (
    <Pressable
      onPress={() => onSelect(musicalKey)}
      accessibilityRole="radio"
      accessibilityState={{ selected: active || incoming }}
      accessibilityLabel={`Key of ${musicalKey}${active ? ', currently playing' : ''}${
        incoming ? ', fading in' : ''
      }`}
      style={({ pressed }) => [
        styles.keyButton,
        isSharp && styles.keyButtonSharp,
        loaded && styles.keyButtonLoaded,
        outgoing && styles.keyButtonOutgoing,
        active && { borderColor: colors.accent, backgroundColor: hexWithAlpha(colors.accent, 0.16) },
        incoming && {
          borderColor: colors.success,
          backgroundColor: hexWithAlpha(colors.success, 0.14),
        },
        pressed && styles.pressed,
      ]}
    >
      {incoming ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: hexWithAlpha(colors.success, 0.22) },
            pulseStyle,
          ]}
        />
      ) : null}

      <Text style={[styles.keyLabel, { color: active || incoming ? tint : colors.textPrimary }]}>
        {musicalKey}
      </Text>

      <View style={styles.badgeRow}>
        {droneLocked ? (
          <Text style={[styles.badge, { color: colors.warning }]}>DRONE</Text>
        ) : incoming ? (
          <Text style={[styles.badge, { color: colors.success }]}>IN</Text>
        ) : active ? (
          <Text style={[styles.badge, { color: colors.accent }]}>LIVE</Text>
        ) : loaded ? (
          <View style={styles.loadedDot} />
        ) : (
          <View style={styles.badgeSpacer} />
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  keyButton: {
    // 4 across with 8dp gaps; the 23% basis keeps a safety margin on narrow
    // devices so a pad never wraps to a lonely fifth column.
    flexBasis: '23%',
    flexGrow: 1,
    minHeight: TOUCH.large,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingVertical: spacing.sm,
  },
  keyButtonSharp: {
    backgroundColor: colors.surface,
  },
  keyButtonLoaded: {
    borderColor: colors.borderBright,
  },
  keyButtonOutgoing: {
    borderColor: hexWithAlpha(colors.accent, 0.45),
  },
  pressed: {
    opacity: 0.6,
  },
  keyLabel: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.textPrimary,
  },
  badgeRow: {
    height: 12,
    justifyContent: 'center',
  },
  badge: {
    ...MONO,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  badgeSpacer: {
    height: 4,
  },
  loadedDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderBright,
  },
});
