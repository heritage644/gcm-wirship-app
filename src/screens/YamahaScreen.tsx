/** Browser performance screen for the procedural preset bank and progression engine. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { YamahaEngine, type YamahaPresetId } from '../audio/dsp/YamahaEngine';
import { SequencerEngine } from '../audio/SequencerEngine';
import { YamahaPresetGrid } from '../components/Presets/YamahaPresetGrid';
import { Panel, SectionLabel } from '../components/ui/Primitives';
import { MUSICAL_KEYS, type MusicalKey } from '../types/audio';
import { beatsPerBar, type ProgressionStep, type TimeSignature } from '../types/sequencer';
import { MONO, TOUCH, colors, radius, spacing, typography } from '../theme';

const INITIAL_STEPS: ProgressionStep[] = [
  { id: 'step-1', targetKey: 'C', durationInBeats: 4, crossfadeDurationSeconds: 2 },
  { id: 'step-2', targetKey: 'F', durationInBeats: 4, crossfadeDurationSeconds: 2 },
  { id: 'step-3', targetKey: 'G', durationInBeats: 4, crossfadeDurationSeconds: 2 },
  { id: 'step-4', targetKey: 'A', durationInBeats: 4, crossfadeDurationSeconds: 2 },
];

const TIME_SIGNATURES: readonly TimeSignature[] = ['4/4', '3/4', '6/8'];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function YamahaScreen() {
  const audio = useMemo(() => new YamahaEngine(), []);
  const sequencer = useMemo(() => new SequencerEngine(audio), [audio]);
  const sequenceState = useSyncExternalStore(
    sequencer.subscribe,
    sequencer.getSnapshot,
    sequencer.getSnapshot,
  );

  const [presetId, setPresetId] = useState<YamahaPresetId>('anadayz-pad');
  const [selectedKey, setSelectedKey] = useState<MusicalKey>('C');
  const [padActive, setPadActive] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.72);
  const [bpm, setBpm] = useState(72);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>('4/4');
  const [steps, setSteps] = useState<ProgressionStep[]>(INITIAL_STEPS);
  const [loop, setLoop] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      sequencer.dispose();
      audio.dispose();
    },
    [audio, sequencer],
  );

  const reportError = useCallback((cause: unknown) => {
    setError(errorText(cause));
  }, []);

  const handlePreset = useCallback(
    (nextPreset: YamahaPresetId) => {
      try {
        if (sequencer.state !== 'stopped') sequencer.stop();
        audio.setPreset(nextPreset, 0.65);
        setPresetId(nextPreset);
        setError(null);
      } catch (cause) {
        reportError(cause);
      }
    },
    [audio, reportError, sequencer],
  );

  const handleKey = useCallback(
    async (key: MusicalKey) => {
      try {
        if (sequencer.state !== 'stopped') sequencer.stop();
        if (audio.activeKey === null) {
          await audio.playKey(key, { fadeSeconds: 0.7 });
        } else {
          audio.scheduleKeyChange(key, audio.currentTime + 0.025, 0.7);
        }
        setSelectedKey(key);
        setPadActive(true);
        setError(null);
      } catch (cause) {
        reportError(cause);
      }
    },
    [audio, reportError, sequencer],
  );

  const handleStopAll = useCallback(() => {
    sequencer.stop();
    audio.stop(0.35);
    setPadActive(false);
  }, [audio, sequencer]);

  const handleVolume = useCallback(
    (delta: number) => {
      setMasterVolume((current) => {
        const next = Math.max(0, Math.min(1, Math.round((current + delta) * 100) / 100));
        audio.setMasterVolume(next);
        return next;
      });
    },
    [audio],
  );

  const handleBpm = useCallback(
    (delta: number) => {
      setBpm((current) => {
        const next = Math.max(40, Math.min(240, current + delta));
        audio.setBpm(next);
        sequencer.setBpm(next);
        return next;
      });
    },
    [audio, sequencer],
  );

  const handleSignature = useCallback((signature: TimeSignature) => {
    setTimeSignature(signature);
  }, []);

  const updateStep = useCallback((id: string, patch: Partial<ProgressionStep>) => {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  }, []);

  const addStep = useCallback(() => {
    setSteps((current) => [
      ...current,
      {
        id: `step-${Date.now()}`,
        targetKey: selectedKey,
        durationInBeats: beatsPerBar(timeSignature),
        crossfadeDurationSeconds: 2,
      },
    ]);
  }, [selectedKey, timeSignature]);

  const removeStep = useCallback((id: string) => {
    setSteps((current) => (current.length <= 1 ? current : current.filter((step) => step.id !== id)));
  }, []);

  const handleSequence = useCallback(async () => {
    try {
      if (sequenceState.status === 'playing') {
        sequencer.pause();
        return;
      }
      if (sequenceState.status === 'paused') {
        await sequencer.resume();
        return;
      }

      await sequencer.play(
        {
          id: 'live-progression',
          songTitle: 'Live Progression',
          bpm,
          timeSignature,
          soundPresetId: presetId,
          steps: steps.map((step) => ({ ...step })),
        },
        { loop },
      );
      setSelectedKey(steps[0].targetKey);
      setPadActive(true);
      setError(null);
    } catch (cause) {
      reportError(cause);
    }
  }, [bpm, loop, presetId, reportError, sequenceState.status, sequencer, steps, timeSignature]);

  const displayKey = sequenceState.status !== 'stopped'
    ? sequenceState.currentKey ?? selectedKey
    : audio.activeKey ?? selectedKey;
  const sequenceButtonLabel = sequenceState.status === 'playing'
    ? 'PAUSE SEQUENCE'
    : sequenceState.status === 'paused'
      ? 'RESUME SEQUENCE'
      : 'PLAY SEQUENCE';

  if (!YamahaEngine.isSupported()) {
    return (
      <View style={styles.unsupported}>
        <Text style={styles.title}>WEB AUDIO NOT AVAILABLE</Text>
        <Text style={styles.body}>Open AuraPad in a modern desktop browser to use these presets.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>AURAPAD PRO · WEB AUDIO</Text>
          <Text style={styles.title}>YAMAHA-INSPIRED SOUND BANK</Text>
          <Text style={styles.body}>
            Fourteen original synth profiles, ready to audition and sequence. Tap a key to hear the
            selected sound.
          </Text>
        </View>
        <View style={[styles.statusBadge, padActive && styles.statusBadgeActive]}>
          <View style={[styles.statusDot, padActive && styles.statusDotActive]} />
          <Text style={[styles.statusText, padActive && styles.statusTextActive]}>
            {padActive ? `SOUNDING · ${displayKey}` : 'READY'}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Panel>
        <SectionLabel accessory={<Text style={styles.hint}>14 PROCEDURAL PROFILES</Text>}>
          SOUND PRESET
        </SectionLabel>
        <YamahaPresetGrid selectedPresetId={presetId} onSelect={handlePreset} />
      </Panel>

      <View style={styles.twoColumn}>
        <Panel style={styles.flexPanel}>
          <SectionLabel accessory={<Text style={styles.hint}>LOG CROSSFADE · 0.7s</Text>}>
            PLAY A KEY
          </SectionLabel>
          <View style={styles.keyGrid}>
            {MUSICAL_KEYS.map((key) => {
              const active = displayKey === key && padActive;
              return (
                <Pressable
                  key={key}
                  onPress={() => void handleKey(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${key} with ${presetId.replaceAll('-', ' ')}`}
                  style={({ pressed }) => [
                    styles.keyButton,
                    active && styles.keyButtonActive,
                    key.includes('#') && styles.sharpKey,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.keyText, active && styles.keyTextActive]}>{key}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>MASTER</Text>
            <Pressable style={styles.smallButton} onPress={() => handleVolume(-0.05)}>
              <Text style={styles.smallButtonText}>−</Text>
            </Pressable>
            <Text style={styles.valueText}>{Math.round(masterVolume * 100)}%</Text>
            <Pressable style={styles.smallButton} onPress={() => handleVolume(0.05)}>
              <Text style={styles.smallButtonText}>+</Text>
            </Pressable>
            <Pressable style={styles.stopButton} onPress={handleStopAll}>
              <Text style={styles.stopButtonText}>STOP ALL</Text>
            </Pressable>
          </View>
        </Panel>

        <Panel style={styles.flexPanel}>
          <SectionLabel accessory={<Text style={styles.hint}>40–240 BPM</Text>}>
            CLOCK & METER
          </SectionLabel>
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>TEMPO</Text>
            <Pressable style={styles.smallButton} onPress={() => handleBpm(-1)}>
              <Text style={styles.smallButtonText}>−</Text>
            </Pressable>
            <Text style={styles.bpmValue}>{bpm}</Text>
            <Pressable style={styles.smallButton} onPress={() => handleBpm(1)}>
              <Text style={styles.smallButtonText}>+</Text>
            </Pressable>
            <Text style={styles.controlLabel}>BPM</Text>
          </View>
          <View style={styles.signatureRow}>
            {TIME_SIGNATURES.map((signature) => (
              <Pressable
                key={signature}
                onPress={() => handleSignature(signature)}
                accessibilityRole="radio"
                accessibilityState={{ selected: signature === timeSignature }}
                style={[styles.signatureButton, signature === timeSignature && styles.signatureActive]}
              >
                <Text
                  style={[
                    styles.signatureText,
                    signature === timeSignature && styles.signatureTextActive,
                  ]}
                >
                  {signature}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.sequenceReadout}>
            <Text style={styles.readoutMain}>
              {sequenceState.status === 'stopped'
                ? 'SEQUENCER READY'
                : `STEP ${(sequenceState.currentStepIndex ?? 0) + 1} · BEAT ${sequenceState.beatNumber}/${sequenceState.beatsPerBar}`}
            </Text>
            <Text style={styles.readoutSub}>
              {sequenceState.status === 'stopped'
                ? 'Add steps, then start hands-free playback.'
                : `${sequenceState.currentKey ?? '—'} → ${sequenceState.nextKey ?? 'END'} · ${sequenceState.beatsRemainingInStep.toFixed(1)} beats remaining`}
            </Text>
            {sequenceState.status !== 'stopped' ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${sequenceState.stepProgress * 100}%` }]} />
              </View>
            ) : null}
          </View>
          <View style={styles.controlRow}>
            <Pressable style={styles.primaryButton} onPress={() => void handleSequence()}>
              <Text style={styles.primaryButtonText}>{sequenceButtonLabel}</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={() => setLoop((value) => !value)}>
              <Text style={[styles.smallButtonText, loop && styles.loopActive]}>{loop ? 'LOOP' : 'ONCE'}</Text>
            </Pressable>
          </View>
        </Panel>
      </View>

      <Panel>
        <SectionLabel
          accessory={
            <Pressable style={styles.addButton} onPress={addStep}>
              <Text style={styles.addButtonText}>+ ADD STEP</Text>
            </Pressable>
          }
        >
          PROGRESSION STEPS
        </SectionLabel>
        <View style={styles.stepsList}>
          {steps.map((step, index) => (
            <View key={step.id} style={styles.stepRow}>
              <View style={styles.stepIndex}>
                <Text style={styles.stepIndexText}>{String(index + 1).padStart(2, '0')}</Text>
              </View>
              <View style={styles.stepMain}>
                <Text style={styles.stepKey}>{step.targetKey}</Text>
                <Text style={styles.stepMeta}>
                  {step.durationInBeats} beats · fade {step.crossfadeDurationSeconds.toFixed(1)}s
                </Text>
                <View style={styles.stepKeyChoices}>
                  {MUSICAL_KEYS.map((key) => (
                    <Pressable
                      key={`${step.id}-${key}`}
                      onPress={() => updateStep(step.id, { targetKey: key })}
                      style={[
                        styles.stepKeyChoice,
                        step.targetKey === key && styles.stepKeyChoiceActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepKeyChoiceText,
                          step.targetKey === key && styles.stepKeyChoiceTextActive,
                        ]}
                      >
                        {key}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.stepControls}>
                <View style={styles.miniControl}>
                  <Text style={styles.miniLabel}>BEATS</Text>
                  <View style={styles.miniButtons}>
                    <Pressable
                      style={styles.miniButton}
                      onPress={() => updateStep(step.id, { durationInBeats: Math.max(1, step.durationInBeats - 1) })}
                    >
                      <Text style={styles.miniButtonText}>−</Text>
                    </Pressable>
                    <Text style={styles.miniValue}>{step.durationInBeats}</Text>
                    <Pressable
                      style={styles.miniButton}
                      onPress={() => updateStep(step.id, { durationInBeats: step.durationInBeats + 1 })}
                    >
                      <Text style={styles.miniButtonText}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.miniControl}>
                  <Text style={styles.miniLabel}>FADE</Text>
                  <View style={styles.miniButtons}>
                    <Pressable
                      style={styles.miniButton}
                      onPress={() => updateStep(step.id, { crossfadeDurationSeconds: Math.max(0, step.crossfadeDurationSeconds - 0.5) })}
                    >
                      <Text style={styles.miniButtonText}>−</Text>
                    </Pressable>
                    <Text style={styles.miniValue}>{step.crossfadeDurationSeconds.toFixed(1)}</Text>
                    <Pressable
                      style={styles.miniButton}
                      onPress={() => updateStep(step.id, { crossfadeDurationSeconds: step.crossfadeDurationSeconds + 0.5 })}
                    >
                      <Text style={styles.miniButtonText}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <Pressable
                  onPress={() => removeStep(step.id)}
                  disabled={steps.length <= 1 || sequenceState.status !== 'stopped'}
                  style={[
                    styles.removeButton,
                    (steps.length <= 1 || sequenceState.status !== 'stopped') && styles.disabled,
                  ]}
                >
                  <Text style={styles.removeButtonText}>REMOVE</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </Panel>

      <Text style={styles.disclaimer}>
        Original procedural synth approximations. No Yamaha factory samples are included. Audio
        starts only after a user action; browser support is required.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl, alignSelf: 'center', width: '100%', maxWidth: 1_160 },
  hero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, paddingVertical: spacing.sm },
  heroCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { ...typography.labelSmall, color: colors.accent },
  title: { ...typography.title, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  statusBadgeActive: { borderColor: colors.success },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },
  statusDotActive: { backgroundColor: colors.success },
  statusText: { ...typography.labelSmall, color: colors.textSecondary },
  statusTextActive: { color: colors.success },
  errorBox: { padding: spacing.md, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, backgroundColor: 'rgba(255, 77, 109, 0.08)' },
  errorText: { ...typography.body, color: colors.danger },
  hint: { ...typography.labelSmall, color: colors.textMuted },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  flexPanel: { flex: 1, flexBasis: 420, gap: spacing.md },
  keyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  keyButton: { flexBasis: '15%', flexGrow: 1, minWidth: 48, height: TOUCH.comfortable, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  keyButtonActive: { borderColor: colors.accent, backgroundColor: 'rgba(0, 229, 255, 0.12)' },
  sharpKey: { backgroundColor: colors.surface },
  keyText: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  keyTextActive: { color: colors.accent },
  controlRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  controlLabel: { ...typography.labelSmall, color: colors.textMuted },
  smallButton: { minWidth: TOUCH.min, minHeight: TOUCH.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  smallButtonText: { ...typography.labelSmall, color: colors.textPrimary },
  valueText: { ...MONO, color: colors.textPrimary, minWidth: 42, textAlign: 'center' },
  stopButton: { marginLeft: 'auto', minHeight: TOUCH.min, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger },
  stopButtonText: { ...typography.labelSmall, color: colors.danger },
  bpmValue: { ...MONO, minWidth: 52, textAlign: 'center', fontSize: 22, fontWeight: '800', color: colors.accent },
  signatureRow: { flexDirection: 'row', gap: spacing.sm },
  signatureButton: { flex: 1, minHeight: TOUCH.min, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  signatureActive: { borderColor: colors.accent, backgroundColor: 'rgba(0, 229, 255, 0.1)' },
  signatureText: { ...typography.label, color: colors.textSecondary },
  signatureTextActive: { color: colors.accent },
  sequenceReadout: { padding: spacing.md, gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  readoutMain: { ...typography.label, color: colors.success },
  readoutSub: { ...typography.labelSmall, color: colors.textSecondary },
  progressTrack: { height: 4, overflow: 'hidden', borderRadius: 2, backgroundColor: colors.border, marginTop: spacing.xs },
  progressFill: { height: '100%', backgroundColor: colors.success },
  primaryButton: { flex: 1, minHeight: TOUCH.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.accent },
  primaryButtonText: { ...typography.label, color: colors.textInverse },
  loopActive: { color: colors.success },
  addButton: { paddingHorizontal: spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.accent },
  addButtonText: { ...typography.labelSmall, color: colors.accent },
  stepsList: { gap: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  stepIndex: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.surfaceActive },
  stepIndexText: { ...MONO, color: colors.textMuted },
  stepMain: { flex: 1, minWidth: 150, gap: spacing.xs },
  stepKey: { fontSize: 22, fontWeight: '900', color: colors.textPrimary },
  stepMeta: { ...typography.labelSmall, color: colors.textMuted },
  stepKeyChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.xs },
  stepKeyChoice: { minWidth: 32, minHeight: 32, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  stepKeyChoiceActive: { borderColor: colors.accent, backgroundColor: 'rgba(0, 229, 255, 0.1)' },
  stepKeyChoiceText: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  stepKeyChoiceTextActive: { color: colors.accent },
  stepControls: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  miniControl: { gap: 3 },
  miniLabel: { ...typography.labelSmall, color: colors.textMuted },
  miniButtons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniButton: { width: 30, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.surfaceActive },
  miniButtonText: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  miniValue: { ...MONO, minWidth: 34, textAlign: 'center', fontSize: 11, color: colors.textPrimary },
  removeButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger },
  removeButtonText: { ...typography.labelSmall, color: colors.danger },
  disabled: { opacity: 0.35 },
  disclaimer: { ...typography.labelSmall, color: colors.textMuted, textAlign: 'center', lineHeight: 16 },
  pressed: { opacity: 0.6 },
  unsupported: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.background, gap: spacing.md },
});
