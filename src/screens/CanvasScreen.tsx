/**
 * CanvasScreen — full-bleed X/Y performance pad with a minimal status strip.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { XYControlCanvas } from '../components/PerformCanvas/XYControlCanvas';
import { hexWithAlpha } from '../components/ui/Primitives';
import type { AudioEngineApi } from '../hooks/useAudioEngine';
import { MONO, TOUCH, colors, radius, spacing, typography } from '../theme';
import { STEM_DESCRIPTORS } from '../types/audio';

export interface CanvasScreenProps {
  engine: AudioEngineApi;
}

export function CanvasScreen({ engine }: CanvasScreenProps) {
  const { state } = engine;
  // CENTRE is an external reset of a value the UI thread otherwise owns, so
  // it remounts the canvas rather than fighting the gesture with an effect.
  const [resetNonce, setResetNonce] = useState(0);

  const recentre = useCallback(() => {
    engine.setXY({ x: 0.5, y: 0.5 });
    engine.commitXY();
    setResetNonce((n) => n + 1);
  }, [engine]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.keyChip}>
          <Text style={styles.keyChipLabel}>KEY</Text>
          <Text style={styles.keyChipValue}>{state.currentKey ?? '—'}</Text>
        </View>

        {/* Live gain per stem — the canvas is modulating these in real time. */}
        <View style={styles.meters}>
          {STEM_DESCRIPTORS.map((descriptor) => (
            <View key={descriptor.id} style={styles.meter}>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    {
                      height: `${Math.round(state.outputGains[descriptor.id] * 100)}%`,
                      backgroundColor: descriptor.color,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.meterLabel, { color: descriptor.color }]}>
                {descriptor.label.charAt(0)}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={recentre}
          accessibilityRole="button"
          accessibilityLabel="Centre the performance canvas"
          style={({ pressed }) => [styles.centreButton, pressed && styles.pressed]}
        >
          <Text style={styles.centreText}>CENTRE</Text>
        </Pressable>
      </View>

      <View style={styles.canvasWrap}>
        <XYControlCanvas
          key={resetNonce}
          value={state.xy}
          engaged={state.xyEngaged}
          onChange={engine.setXY}
          onRelease={engine.releaseXY}
          onCommit={engine.commitXY}
          disabled={state.currentKey === null}
        />
      </View>

      {state.currentKey === null ? (
        <Text style={styles.warning}>Select a key on the PERFORM tab to arm the canvas.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  keyChip: {
    minWidth: 72,
    minHeight: TOUCH.min,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: hexWithAlpha(colors.accent, 0.5),
    backgroundColor: hexWithAlpha(colors.accent, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyChipLabel: {
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  keyChipValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.accent,
  },
  meters: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    height: TOUCH.min,
    alignItems: 'flex-end',
  },
  meter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  meterTrack: {
    width: '100%',
    height: 30,
    borderRadius: 3,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  meterFill: {
    width: '100%',
    opacity: 0.85,
  },
  meterLabel: {
    ...MONO,
    fontSize: 8,
    fontWeight: '800',
  },
  centreButton: {
    minHeight: TOUCH.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centreText: {
    ...typography.labelSmall,
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
  canvasWrap: {
    flex: 1,
  },
  warning: {
    ...typography.labelSmall,
    color: colors.warning,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
