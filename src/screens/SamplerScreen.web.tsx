/** Web performance screen for recorded-WAV pad layers and progression playback. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SampleSamplerEngine, type SampleLoadReport } from '../audio/SampleSamplerEngine';
import { SequencerEngine } from '../audio/SequencerEngine';
import { loadMetroSampleBuffer, metroSampleAssets } from '../audio/metroSampleAudio';
import { Panel, SectionLabel } from '../components/ui/Primitives';
import {
  DEFAULT_SAMPLE_LAYERS,
  getSampleSource,
  PAD_PRESETS,
  SAMPLE_SOURCES,
  type SampleLayerConfig,
  type SampleSourceId,
} from '../config/padPresets';
import { MUSICAL_KEYS, type MusicalKey } from '../types/audio';
import { beatsPerBar, type ProgressionStep, type TimeSignature } from '../types/sequencer';
import { MONO, TOUCH, colors, radius, spacing, typography } from '../theme';

const INITIAL_STEPS: ProgressionStep[] = [
  { id: 'step-1', targetKey: 'C', durationInBeats: 4, crossfadeDurationSeconds: 1.5 },
  { id: 'step-2', targetKey: 'F', durationInBeats: 4, crossfadeDurationSeconds: 1.5 },
  { id: 'step-3', targetKey: 'G', durationInBeats: 4, crossfadeDurationSeconds: 1.5 },
  { id: 'step-4', targetKey: 'A', durationInBeats: 4, crossfadeDurationSeconds: 1.5 },
];

const OCTAVES = [2, 3, 4, 5, 6] as const;
const TIME_SIGNATURES: readonly TimeSignature[] = ['4/4', '3/4', '6/8'];
const MAX_LAYERS = 8;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportLabel(
  sourceId: SampleSourceId,
  report: SampleLoadReport | undefined,
  loading: boolean,
): string {
  if (loading) return 'LOADING WAV SAMPLES…';
  if (!report) return 'NOT LOADED';
  if (report.status === 'ready') return `${report.loaded.length} SAMPLE${report.loaded.length === 1 ? '' : 'S'} READY`;
  if (report.status === 'partial') {
    const decodeErrors = report.errors.length > 0 ? ` · ${report.errors.join(' · ')}` : '';
    return `PARTIAL · ${report.loaded.length} READY · MISSING ${report.missing.join(', ')}${decodeErrors}`;
  }
  if (report.status === 'error') return `DECODE ERROR · ${report.errors.join(' · ')}`;
  return isPadSource(sourceId)
    ? `MISSING · ADD ${PAD_PRESETS[sourceId].expectedAnchors.map((anchor) => `${anchor}.WAV`).join(', ')}`
    : 'MISSING · ADD LOOP.WAV';
}

function isPadSource(sourceId: SampleSourceId): sourceId is keyof typeof PAD_PRESETS {
  return sourceId in PAD_PRESETS;
}

export function SamplerScreen() {
  const audio = useMemo(
    () => new SampleSamplerEngine({ assets: metroSampleAssets, loadBuffer: loadMetroSampleBuffer }),
    [],
  );
  const sequencer = useMemo(() => new SequencerEngine(audio), [audio]);
  const sequenceState = useSyncExternalStore(
    sequencer.subscribe,
    sequencer.getSnapshot,
    sequencer.getSnapshot,
  );

  const [layers, setLayers] = useState<SampleLayerConfig[]>(() =>
    DEFAULT_SAMPLE_LAYERS.map((layer) => ({ ...layer })),
  );
  const [reports, setReports] = useState<Partial<Record<SampleSourceId, SampleLoadReport>>>({});
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<MusicalKey>('C');
  const [octave, setOctave] = useState(4);
  const [masterVolume, setMasterVolume] = useState(0.72);
  const [bpm, setBpm] = useState(72);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>('4/4');
  const [steps, setSteps] = useState<ProgressionStep[]>(INITIAL_STEPS);
  const [loop, setLoop] = useState(true);
  const [sounding, setSounding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      sequencer.dispose();
      audio.dispose();
    },
    [audio, sequencer],
  );

  useEffect(() => {
    if (!SampleSamplerEngine.isSupported()) return;
    let active = true;
    audio.setLayers(layers)
      .then((nextReports) => {
        if (!active) return;
        setReports((current) => ({
          ...current,
          ...Object.fromEntries(nextReports.map((report) => [report.sourceId, report])),
        }));
        setSounding(audio.activeLayerCount > 0);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [audio, layers]);

  const updateLayer = useCallback((id: string, patch: Partial<SampleLayerConfig>) => {
    setLoading(true);
    setLayers((current) => current.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  }, []);

  const cycleSource = useCallback((layerId: string, direction: -1 | 1) => {
    setLoading(true);
    setLayers((current) => current.map((layer) => {
      if (layer.id !== layerId) return layer;
      const index = SAMPLE_SOURCES.findIndex((source) => source.id === layer.sourceId);
      const nextIndex = (index + direction + SAMPLE_SOURCES.length) % SAMPLE_SOURCES.length;
      return { ...layer, sourceId: SAMPLE_SOURCES[nextIndex].id };
    }));
  }, []);

  const addLayer = useCallback((sourceId: SampleSourceId) => {
    setLoading(true);
    setLayers((current) => {
      if (current.length >= MAX_LAYERS) return current;
      return [
        ...current,
        {
          id: `layer-${Date.now()}-${current.length}`,
          sourceId,
          enabled: true,
          volume: sourceId in PAD_PRESETS ? 0.5 : 0.25,
        },
      ];
    });
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLoading(true);
    setLayers((current) => current.length <= 1 ? current : current.filter((layer) => layer.id !== id));
  }, []);

  const handleLayerVolume = useCallback((layer: SampleLayerConfig, delta: number) => {
    const next = Math.max(0, Math.min(1, Math.round((layer.volume + delta) * 100) / 100));
    audio.setLayerVolume(layer.id, next);
    updateLayer(layer.id, { volume: next });
  }, [audio, updateLayer]);

  const handleMasterVolume = useCallback((delta: number) => {
    setMasterVolume((current) => {
      const next = Math.max(0, Math.min(1, Math.round((current + delta) * 100) / 100));
      audio.setMasterVolume(next);
      return next;
    });
  }, [audio]);

  const handleKey = useCallback(async (key: MusicalKey) => {
    try {
      setError(null);
      audio.setOctave(octave);
      await audio.playKey(key, 0.7);
      setSelectedKey(key);
      setSounding(true);
    } catch (cause) {
      setSounding(false);
      setError(errorText(cause));
    }
  }, [audio, octave]);

  const stopAll = useCallback(() => {
    sequencer.stop();
    audio.stop(0.3);
    setSounding(false);
  }, [audio, sequencer]);

  const handleBpm = useCallback((delta: number) => {
    setBpm((current) => {
      const next = Math.max(40, Math.min(240, current + delta));
      sequencer.setBpm(next);
      return next;
    });
  }, [sequencer]);

  const updateStep = useCallback((id: string, patch: Partial<ProgressionStep>) => {
    setSteps((current) => current.map((step) => step.id === id ? { ...step, ...patch } : step));
  }, []);

  const addStep = useCallback(() => {
    setSteps((current) => [
      ...current,
      {
        id: `step-${Date.now()}`,
        targetKey: selectedKey,
        durationInBeats: beatsPerBar(timeSignature),
        crossfadeDurationSeconds: 1.5,
      },
    ]);
  }, [selectedKey, timeSignature]);

  const removeStep = useCallback((id: string) => {
    setSteps((current) => current.length <= 1 ? current : current.filter((step) => step.id !== id));
  }, []);

  const playSequence = useCallback(async () => {
    try {
      setError(null);
      audio.setOctave(octave);
      if (sequenceState.status === 'playing') {
        sequencer.pause();
        return;
      }
      if (sequenceState.status === 'paused') {
        await sequencer.resume();
        return;
      }
      await sequencer.play({
        id: 'recorded-sample-progression',
        songTitle: 'Sample Layer Progression',
        bpm,
        timeSignature,
        soundPresetId: 'sample-layer-rack',
        steps: steps.map((step) => ({ ...step })),
      }, { loop });
      setSounding(true);
    } catch (cause) {
      setSounding(false);
      setError(errorText(cause));
    }
  }, [audio, bpm, loop, octave, sequenceState.status, sequencer, steps, timeSignature]);

  const displayKey = sequenceState.status !== 'stopped'
    ? sequenceState.currentKey ?? selectedKey
    : selectedKey;
  const sequenceLabel = sequenceState.status === 'playing'
    ? 'PAUSE SEQUENCE'
    : sequenceState.status === 'paused'
      ? 'RESUME SEQUENCE'
      : 'PLAY SEQUENCE';
  const loadedSourceCount = Object.values(reports).filter((report) => report && report.loaded.length > 0).length;

  if (!SampleSamplerEngine.isSupported()) {
    return (
      <View style={styles.unsupported}>
        <Text style={styles.title}>WEB AUDIO NOT AVAILABLE</Text>
        <Text style={styles.body}>Open AuraPad in a modern browser to audition recorded WAV samples.</Text>
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
          <Text style={styles.eyebrow}>AURAPAD · RECORDED WAV SAMPLER</Text>
          <Text style={styles.title}>BUILD YOUR PAD LAYERS</Text>
          <Text style={styles.body}>
            Layer recorded Warm Pad, Shimmer Pad, Sub Drone, and ambience samples. Choose an octave,
            audition a key, and sequence a progression.
          </Text>
        </View>
        <View style={[styles.statusBadge, sounding && styles.statusBadgeActive]}>
          <View style={[styles.statusDot, sounding && styles.statusDotActive]} />
          <Text style={[styles.statusText, sounding && styles.statusTextActive]}>
            {sounding ? `SOUNDING · ${displayKey}${octave}` : loadedSourceCount > 0 ? 'SAMPLES READY' : 'AWAITING WAV FILES'}
          </Text>
        </View>
      </View>

      <View style={styles.noticeBox}>
        <Text style={styles.noticeTitle}>RECORDED SAMPLES ONLY</Text>
        <Text style={styles.noticeText}>
          No recorded pad WAVs are bundled yet. Add royalty-cleared files to the folders shown in each
          layer status below; missing anchors are reported here rather than synthesized.
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Panel>
        <SectionLabel
          accessory={
            <View style={styles.addActions}>
              <Pressable
                style={[styles.addButton, layers.length >= MAX_LAYERS && styles.disabled]}
                disabled={layers.length >= MAX_LAYERS}
                onPress={() => addLayer('warm-pad')}
              >
                <Text style={styles.addButtonText}>+ PAD LAYER</Text>
              </Pressable>
              <Pressable
                style={[styles.addButton, layers.length >= MAX_LAYERS && styles.disabled]}
                disabled={layers.length >= MAX_LAYERS}
                onPress={() => addLayer('room-bed')}
              >
                <Text style={styles.addButtonText}>+ AMBIENCE</Text>
              </Pressable>
            </View>
          }
        >
          SAMPLE LAYER RACK
        </SectionLabel>
        <View style={styles.layersList}>
          {layers.map((layer, index) => {
            const source = getSampleSource(layer.sourceId);
            const report = reports[layer.sourceId];
            return (
              <View key={layer.id} style={[styles.layerCard, !layer.enabled && styles.layerDisabled]}>
                <View style={styles.layerHeader}>
                  <View style={styles.layerNameBlock}>
                    <Text style={styles.layerIndex}>LAYER {String(index + 1).padStart(2, '0')}</Text>
                    <Text style={styles.layerName}>{source.name}</Text>
                    <Text style={styles.layerDescription}>{source.description}</Text>
                    <Text style={styles.sampleFolder}>
                      src/assets/audio/{source.kind === 'pad' ? 'pads' : 'beds'}/{source.id}/
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => updateLayer(layer.id, { enabled: !layer.enabled })}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: layer.enabled }}
                    accessibilityLabel={`${layer.enabled ? 'Disable' : 'Enable'} ${source.name} layer`}
                    style={[styles.toggleButton, layer.enabled && styles.toggleButtonActive]}
                  >
                    <Text style={[styles.toggleText, layer.enabled && styles.toggleTextActive]}>
                      {layer.enabled ? 'ON' : 'OFF'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.sourcePicker}>
                  <Pressable style={styles.cycleButton} onPress={() => cycleSource(layer.id, -1)}>
                    <Text style={styles.cycleText}>‹</Text>
                  </Pressable>
                  <View style={styles.sourceChoices}>
                    {SAMPLE_SOURCES.map((option) => (
                      <Pressable
                        key={`${layer.id}-${option.id}`}
                        onPress={() => updateLayer(layer.id, { sourceId: option.id })}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: option.id === layer.sourceId }}
                        style={[styles.sourceChoice, option.id === layer.sourceId && styles.sourceChoiceActive]}
                      >
                        <Text style={[styles.sourceChoiceText, option.id === layer.sourceId && styles.sourceChoiceTextActive]}>
                          {option.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable style={styles.cycleButton} onPress={() => cycleSource(layer.id, 1)}>
                    <Text style={styles.cycleText}>›</Text>
                  </Pressable>
                </View>
                <View style={styles.layerFooter}>
                  <Text style={[
                    styles.sampleStatus,
                    report?.status === 'ready' && styles.sampleStatusReady,
                    (report?.status === 'missing' || report?.status === 'error') && styles.sampleStatusError,
                  ]}>
                    {reportLabel(layer.sourceId, report, loading && layer.enabled)}
                  </Text>
                  <View style={styles.layerVolume}>
                    <Text style={styles.volumeLabel}>LEVEL</Text>
                    <Pressable
                      style={styles.smallButton}
                      onPress={() => handleLayerVolume(layer, -0.05)}
                      accessibilityLabel={`Lower ${source.name} level`}
                    >
                      <Text style={styles.smallButtonText}>−</Text>
                    </Pressable>
                    <Text style={styles.volumeValue}>{Math.round(layer.volume * 100)}%</Text>
                    <Pressable
                      style={styles.smallButton}
                      onPress={() => handleLayerVolume(layer, 0.05)}
                      accessibilityLabel={`Raise ${source.name} level`}
                    >
                      <Text style={styles.smallButtonText}>+</Text>
                    </Pressable>
                    <Pressable
                      disabled={layers.length <= 1}
                      onPress={() => removeLayer(layer.id)}
                      style={[styles.removeButton, layers.length <= 1 && styles.disabled]}
                    >
                      <Text style={styles.removeButtonText}>REMOVE</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </Panel>

      <View style={styles.twoColumn}>
        <Panel style={styles.flexPanel}>
          <SectionLabel accessory={<Text style={styles.hint}>SAMPLED ROOTS: C2 · C4 · C6</Text>}>
            PLAY A NOTE
          </SectionLabel>
          <View style={styles.octaveRow}>
            <Text style={styles.controlLabel}>OCTAVE</Text>
            {OCTAVES.map((value) => (
              <Pressable
                key={value}
                onPress={() => {
                  setOctave(value);
                  audio.setOctave(value);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: value === octave }}
                style={[styles.octaveButton, value === octave && styles.octaveActive]}
              >
                <Text style={[styles.octaveText, value === octave && styles.octaveTextActive]}>{value}</Text>
              </Pressable>
            ))}
            <Text style={styles.noteReadout}>{selectedKey}{octave}</Text>
          </View>
          <View style={styles.keyGrid}>
            {MUSICAL_KEYS.map((key) => {
              const active = displayKey === key && sounding;
              return (
                <Pressable
                  key={key}
                  onPress={() => void handleKey(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${key}${octave} through enabled sample layers`}
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
            <Pressable style={styles.smallButton} onPress={() => handleMasterVolume(-0.05)}>
              <Text style={styles.smallButtonText}>−</Text>
            </Pressable>
            <Text style={styles.valueText}>{Math.round(masterVolume * 100)}%</Text>
            <Pressable style={styles.smallButton} onPress={() => handleMasterVolume(0.05)}>
              <Text style={styles.smallButtonText}>+</Text>
            </Pressable>
            <Pressable style={styles.stopButton} onPress={stopAll}>
              <Text style={styles.stopButtonText}>STOP ALL</Text>
            </Pressable>
          </View>
        </Panel>

        <Panel style={styles.flexPanel}>
          <SectionLabel accessory={<Text style={styles.hint}>40–240 BPM</Text>}>
            PROGRESSION CLOCK
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
                onPress={() => setTimeSignature(signature)}
                accessibilityRole="radio"
                accessibilityState={{ selected: signature === timeSignature }}
                style={[styles.signatureButton, signature === timeSignature && styles.signatureActive]}
              >
                <Text style={[styles.signatureText, signature === timeSignature && styles.signatureTextActive]}>
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
                ? 'Starts after enabled WAV layers are loaded.'
                : `${sequenceState.currentKey ?? '—'} → ${sequenceState.nextKey ?? 'END'} · ${sequenceState.beatsRemainingInStep.toFixed(1)} beats remaining`}
            </Text>
            {sequenceState.status !== 'stopped' ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${sequenceState.stepProgress * 100}%` }]} />
              </View>
            ) : null}
          </View>
          <View style={styles.controlRow}>
            <Pressable style={styles.primaryButton} onPress={() => void playSequence()}>
              <Text style={styles.primaryButtonText}>{sequenceLabel}</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={() => setLoop((current) => !current)}>
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
                <Text style={styles.stepKey}>{step.targetKey}{octave}</Text>
                <Text style={styles.stepMeta}>{step.durationInBeats} beats · fade {step.crossfadeDurationSeconds.toFixed(1)}s</Text>
                <View style={styles.stepKeyChoices}>
                  {MUSICAL_KEYS.map((key) => (
                    <Pressable
                      key={`${step.id}-${key}`}
                      onPress={() => updateStep(step.id, { targetKey: key })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: step.targetKey === key }}
                      style={[styles.stepKeyChoice, step.targetKey === key && styles.stepKeyChoiceActive]}
                    >
                      <Text style={[styles.stepKeyChoiceText, step.targetKey === key && styles.stepKeyChoiceTextActive]}>
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
                <Pressable
                  style={styles.removeButton}
                  disabled={steps.length <= 1}
                  onPress={() => removeStep(step.id)}
                >
                  <Text style={styles.removeButtonText}>REMOVE STEP</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </Panel>

      <Text style={styles.disclaimer}>
        Pitch is shifted from the nearest recorded WAV root. Add clean, loop-ready files; no
        procedural oscillator or generated sample fallback is used.
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
  noticeBox: { padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, backgroundColor: 'rgba(255, 183, 77, 0.07)' },
  noticeTitle: { ...typography.labelSmall, color: colors.warning },
  noticeText: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
  errorBox: { padding: spacing.md, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, backgroundColor: 'rgba(255, 77, 109, 0.08)' },
  errorText: { ...typography.body, color: colors.danger },
  addActions: { flexDirection: 'row', gap: spacing.xs },
  addButton: { paddingHorizontal: spacing.sm, minHeight: 36, justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.accent },
  addButtonText: { ...typography.labelSmall, color: colors.accent },
  layersList: { gap: spacing.sm },
  layerCard: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  layerDisabled: { opacity: 0.55 },
  layerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  layerNameBlock: { flex: 1, gap: 3 },
  layerIndex: { ...typography.labelSmall, color: colors.accent },
  layerName: { ...typography.body, color: colors.textPrimary, fontWeight: '800' },
  layerDescription: { ...typography.labelSmall, color: colors.textMuted },
  sampleFolder: { ...typography.labelSmall, color: colors.accent },
  toggleButton: { minWidth: 54, minHeight: TOUCH.min, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill },
  toggleButtonActive: { borderColor: colors.success, backgroundColor: 'rgba(57, 230, 168, 0.08)' },
  toggleText: { ...typography.labelSmall, color: colors.textMuted },
  toggleTextActive: { color: colors.success },
  sourcePicker: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cycleButton: { width: 34, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.surfaceActive },
  cycleText: { fontSize: 24, color: colors.textPrimary, lineHeight: 28 },
  sourceChoices: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  sourceChoice: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  sourceChoiceActive: { borderColor: colors.accent, backgroundColor: 'rgba(0, 229, 255, 0.08)' },
  sourceChoiceText: { ...typography.labelSmall, color: colors.textMuted },
  sourceChoiceTextActive: { color: colors.accent },
  layerFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sampleStatus: { ...typography.labelSmall, color: colors.textMuted, flex: 1, minWidth: 220 },
  sampleStatusReady: { color: colors.success },
  sampleStatusError: { color: colors.danger },
  layerVolume: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  volumeLabel: { ...typography.labelSmall, color: colors.textMuted },
  smallButton: { minWidth: TOUCH.min, minHeight: TOUCH.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  smallButtonText: { ...typography.labelSmall, color: colors.textPrimary },
  volumeValue: { ...MONO, color: colors.textPrimary, minWidth: 42, textAlign: 'center' },
  removeButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.danger },
  removeButtonText: { ...typography.labelSmall, color: colors.danger },
  disabled: { opacity: 0.35 },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  flexPanel: { flex: 1, flexBasis: 420, gap: spacing.md },
  hint: { ...typography.labelSmall, color: colors.textMuted },
  octaveRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  octaveButton: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  octaveActive: { borderColor: colors.accent, backgroundColor: 'rgba(0, 229, 255, 0.1)' },
  octaveText: { ...typography.labelSmall, color: colors.textMuted },
  octaveTextActive: { color: colors.accent },
  noteReadout: { ...MONO, color: colors.accent, marginLeft: 'auto' },
  controlLabel: { ...typography.labelSmall, color: colors.textMuted },
  keyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  keyButton: { flexBasis: '15%', flexGrow: 1, minWidth: 48, height: TOUCH.comfortable, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  keyButtonActive: { borderColor: colors.accent, backgroundColor: 'rgba(0, 229, 255, 0.12)' },
  sharpKey: { backgroundColor: colors.surface },
  keyText: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  keyTextActive: { color: colors.accent },
  controlRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
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
  stepsList: { gap: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  stepIndex: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.surfaceActive },
  stepIndexText: { ...MONO, color: colors.textMuted },
  stepMain: { flex: 1, minWidth: 180, gap: spacing.xs },
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
  disclaimer: { ...typography.labelSmall, color: colors.textMuted, textAlign: 'center', lineHeight: 16 },
  pressed: { opacity: 0.6 },
  unsupported: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.background, gap: spacing.md },
});
