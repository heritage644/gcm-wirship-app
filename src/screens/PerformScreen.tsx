/**
 * PerformScreen — the main live dashboard.
 * Transport → key grid → crossfade status → 4-channel mixer.
 */

import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { MixerPanel } from '../components/AudioControls/MixerPanel';
import { TransportBar } from '../components/AudioControls/TransportBar';
import { KeyGrid } from '../components/KeyGrid/KeyGrid';
import { TransitionStatusBar } from '../components/KeyGrid/TransitionStatusBar';
import { Panel, SectionLabel } from '../components/ui/Primitives';
import type { AudioEngineApi } from '../hooks/useAudioEngine';
import { colors, spacing, typography } from '../theme';
import type { MusicalKey } from '../types/audio';

export interface PerformScreenProps {
  engine: AudioEngineApi;
}

export function PerformScreen({ engine }: PerformScreenProps) {
  const { state } = engine;

  const handleSelectKey = useCallback(
    (key: MusicalKey) => {
      // First key press doubles as "start the engine".
      if (state.currentKey === null) engine.start(key);
      else engine.selectKey(key);
    },
    [engine, state.currentKey],
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <TransportBar
        state={state}
        onTogglePlay={engine.togglePlay}
        onToggleDroneLock={engine.toggleDroneLock}
        onFadeDuration={engine.setFadeDuration}
      />

      <Panel>
        <SectionLabel
          accessory={
            <Text style={styles.hint}>
              {state.loadedKeys.length} key{state.loadedKeys.length === 1 ? '' : 's'} resident
            </Text>
          }
        >
          KEY SELECT
        </SectionLabel>

        <KeyGrid
          currentKey={state.currentKey}
          incomingKey={state.transition.active ? state.transition.toKey : null}
          loadedKeys={state.loadedKeys}
          droneLockedKey={state.droneLock ? state.droneLockedKey : null}
          onSelect={handleSelectKey}
        />

        <View style={styles.statusWrap}>
          <TransitionStatusBar
            transition={state.transition}
            currentKey={state.currentKey}
            isPlaying={state.isPlaying}
            droneLockedKey={state.droneLock ? state.droneLockedKey : null}
          />
        </View>
      </Panel>

      <MixerPanel
        state={state}
        onStemVolume={engine.setStemVolume}
        onToggleMute={engine.toggleStemMuted}
        onMasterVolume={engine.setMasterVolume}
        onTexture={engine.setTexture}
      />

      {state.xyEngaged ? (
        <Text style={styles.canvasNote}>
          Performance canvas is engaged — stem output is being shaped by the X/Y pad.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hint: {
    ...typography.labelSmall,
    color: colors.textMuted,
  },
  statusWrap: {
    marginTop: spacing.lg,
  },
  canvasNote: {
    ...typography.labelSmall,
    color: colors.success,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
});
