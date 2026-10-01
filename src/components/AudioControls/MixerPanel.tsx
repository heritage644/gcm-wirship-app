/**
 * MixerPanel — the 4-channel stem mixer plus master and ambience selection.
 */

import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MONO, colors, spacing, typography } from '../../theme';
import {
  STEM_DESCRIPTORS,
  TEXTURE_IDS,
  type EngineSnapshot,
  type StemId,
  type TextureId,
} from '../../types/audio';
import { Chip, Panel, SectionLabel } from '../ui/Primitives';
import { Fader } from './Fader';
import { StemChannelStrip } from './StemChannelStrip';

const TEXTURE_LABELS: Record<TextureId, string> = {
  vinyl: 'VINYL',
  rain: 'RAIN',
  room: 'ROOM',
};

export interface MixerPanelProps {
  state: EngineSnapshot;
  onStemVolume: (stem: StemId, value: number) => void;
  onToggleMute: (stem: StemId) => void;
  onMasterVolume: (value: number) => void;
  onTexture: (texture: TextureId) => void;
}

export function MixerPanel({
  state,
  onStemVolume,
  onToggleMute,
  onMasterVolume,
  onTexture,
}: MixerPanelProps) {
  const { mixer, outputGains, masterVolume, droneLock, droneLockedKey, currentKey, mixGeneration } =
    state;

  // Stable per-stem callbacks so the memoised strips genuinely skip re-renders.
  const makeVolumeHandler = useCallback(
    (stem: StemId) => (value: number) => onStemVolume(stem, value),
    [onStemVolume],
  );
  const makeMuteHandler = useCallback(
    (stem: StemId) => () => onToggleMute(stem),
    [onToggleMute],
  );

  const subIsHeld = droneLock && droneLockedKey !== null && droneLockedKey !== currentKey;

  return (
    <Panel>
      <SectionLabel
        accessory={<Text style={styles.hint}>drag · 48dp targets</Text>}
      >
        STEM MIXER
      </SectionLabel>

      <View style={styles.strips}>
        {STEM_DESCRIPTORS.map((descriptor) => (
          <StemChannelStrip
            // Remount on preset recall so the fader re-seeds from the new
            // value; ordinary fader moves keep the same key and are untouched.
            key={`${descriptor.id}:${mixGeneration}`}
            descriptor={descriptor}
            volume={mixer[descriptor.id].volume}
            muted={mixer[descriptor.id].muted}
            outputGain={outputGains[descriptor.id]}
            onVolumeChange={makeVolumeHandler(descriptor.id)}
            onToggleMute={makeMuteHandler(descriptor.id)}
            droneLocked={descriptor.id === 'sub' && subIsHeld}
          />
        ))}
      </View>

      <View style={styles.masterBlock}>
        <View style={styles.masterHeader}>
          <Text style={styles.masterLabel}>MASTER</Text>
          <Text style={styles.masterValue}>{Math.round(masterVolume * 100)}</Text>
        </View>
        <Fader
          value={masterVolume}
          onChange={onMasterVolume}
          orientation="horizontal"
          tint={colors.accent}
          accessibilityLabel="Master volume"
        />
      </View>

      <View style={styles.textureBlock}>
        <SectionLabel style={styles.textureLabel}>AMBIENCE BED</SectionLabel>
        <View style={styles.textureRow}>
          {TEXTURE_IDS.map((id) => (
            <Chip
              key={id}
              label={TEXTURE_LABELS[id]}
              selected={state.texture === id}
              tint={colors.texture}
              onPress={() => onTexture(id)}
              style={styles.textureChip}
              accessibilityLabel={`${TEXTURE_LABELS[id]} ambience bed`}
            />
          ))}
        </View>
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  hint: {
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  strips: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: 268,
  },
  masterBlock: {
    marginTop: spacing.xl,
  },
  masterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  masterLabel: {
    ...typography.label,
    color: colors.accent,
  },
  masterValue: {
    ...MONO,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textureBlock: {
    marginTop: spacing.xl,
  },
  textureLabel: {
    marginBottom: spacing.sm,
  },
  textureRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  textureChip: {
    flex: 1,
  },
});
