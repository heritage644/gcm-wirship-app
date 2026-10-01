/**
 * StemChannelStrip — one vertical channel on the 4-stem mixer.
 *
 * Shows the fader, a mute button, and a readout of where the signal actually
 * lands after master / mute / canvas / crossfade have all been applied. That
 * second number matters live: with Drone Lock on or the canvas pulled down,
 * the fader position alone will not tell you what the room is hearing.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MONO, TOUCH, colors, radius, spacing, typography } from '../../theme';
import type { StemDescriptor } from '../../types/audio';
import { hexWithAlpha } from '../ui/Primitives';
import { Fader } from './Fader';

export interface StemChannelStripProps {
  descriptor: StemDescriptor;
  volume: number;
  muted: boolean;
  /** Post-everything output gain, 0–1. */
  outputGain: number;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  /** True while this stem is being held on an older key by Drone Lock. */
  droneLocked?: boolean;
}

function StemChannelStripImpl({
  descriptor,
  volume,
  muted,
  outputGain,
  onVolumeChange,
  onToggleMute,
  droneLocked = false,
}: StemChannelStripProps) {
  const tint = descriptor.color;

  return (
    <View style={styles.strip}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
          {descriptor.label}
        </Text>
        {droneLocked ? (
          <View style={[styles.lockBadge, { borderColor: colors.warning }]}>
            <Text style={styles.lockBadgeText}>LOCK</Text>
          </View>
        ) : null}
      </View>

      <Fader
        value={volume}
        onChange={onVolumeChange}
        tint={tint}
        meter={outputGain}
        disabled={muted}
        accessibilityLabel={`${descriptor.label} volume`}
        style={styles.fader}
      />

      <Text style={[styles.value, muted && styles.valueMuted]}>
        {muted ? '—' : Math.round(volume * 100)}
      </Text>

      <Pressable
        onPress={onToggleMute}
        accessibilityRole="switch"
        accessibilityState={{ checked: muted }}
        accessibilityLabel={`${muted ? 'Unmute' : 'Mute'} ${descriptor.label}`}
        hitSlop={4}
        style={({ pressed }) => [
          styles.mute,
          muted && { backgroundColor: hexWithAlpha(colors.danger, 0.2), borderColor: colors.danger },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.muteText, muted && { color: colors.danger }]}>
          {muted ? 'MUTED' : 'MUTE'}
        </Text>
      </Pressable>
    </View>
  );
}

/** Memoised: a crossfade re-renders the mixer ~15×/s and most strips are idle. */
export const StemChannelStrip = memo(StemChannelStripImpl);

const styles = StyleSheet.create({
  strip: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  header: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.labelSmall,
    textAlign: 'center',
  },
  lockBadge: {
    marginTop: 2,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  lockBadgeText: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.warning,
  },
  fader: {
    flex: 1,
    minHeight: 150,
  },
  value: {
    ...MONO,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  valueMuted: {
    color: colors.textMuted,
  },
  mute: {
    minHeight: TOUCH.min,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  pressed: {
    opacity: 0.6,
  },
  muteText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.textSecondary,
  },
});
