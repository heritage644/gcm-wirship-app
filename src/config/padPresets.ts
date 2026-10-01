/** Publicly hosted multisample pad sources plus optional local ambience beds. */

export const PAD_SAMPLE_ANCHORS = ['C2', 'C4', 'C6'] as const;
export type PadSampleAnchor = (typeof PAD_SAMPLE_ANCHORS)[number];

const STANDARD_NOTE_URLS = {
  C2: 'C2.mp3',
  C4: 'C4.mp3',
  C6: 'C6.mp3',
} as const;

export const PAD_PRESETS = {
  'warm-pad': {
    id: 'warm-pad',
    name: 'Warm Pad',
    description: 'Tone.js Salamander piano samples, mapped across the pad register.',
    baseUrl: 'https://tonejs.github.io/audio/salamander/',
    urls: STANDARD_NOTE_URLS,
    expectedAnchors: PAD_SAMPLE_ANCHORS,
  },
  // FluidR3 names this GM patch `pad_2_warm` (not `synth_pad_1_warm`).
  'shimmer-pad': {
    id: 'shimmer-pad',
    name: 'Shimmer Pad',
    description: 'FluidR3 GM Pad 2 Warm samples for a sustained, soft layer.',
    baseUrl: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/pad_2_warm-mp3/',
    urls: STANDARD_NOTE_URLS,
    expectedAnchors: PAD_SAMPLE_ANCHORS,
  },
  'sub-bass': {
    id: 'sub-bass',
    name: 'Sub Drone',
    description: 'FluidR3 GM Synth Bass 1 samples for a low foundation.',
    baseUrl: 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/synth_bass_1-mp3/',
    urls: STANDARD_NOTE_URLS,
    expectedAnchors: PAD_SAMPLE_ANCHORS,
  },
} as const;

export type PadPresetId = keyof typeof PAD_PRESETS;

export function getPadSampleUrls(presetId: PadPresetId): Record<string, string> {
  const preset = PAD_PRESETS[presetId];
  return Object.fromEntries(
    Object.entries(preset.urls).map(([note, filename]) => [note, `${preset.baseUrl}${filename}`]),
  );
}

export const AMBIENT_BEDS = {
  'room-bed': {
    id: 'room-bed',
    name: 'Warm Room',
    description: 'A soft, unpitched room-tone loop.',
    folder: 'room-bed',
    filename: 'loop.wav',
  },
  'rain-bed': {
    id: 'rain-bed',
    name: 'Rain',
    description: 'A gentle rain ambience loop.',
    folder: 'rain-bed',
    filename: 'loop.wav',
  },
  'vinyl-bed': {
    id: 'vinyl-bed',
    name: 'Vinyl',
    description: 'A quiet vinyl-texture loop.',
    folder: 'vinyl-bed',
    filename: 'loop.wav',
  },
} as const;

export type AmbientBedId = keyof typeof AMBIENT_BEDS;
export type SampleSourceId = PadPresetId | AmbientBedId;

export interface SampleLayerConfig {
  id: string;
  sourceId: SampleSourceId;
  enabled: boolean;
  volume: number;
}

export const SAMPLE_SOURCES: readonly {
  id: SampleSourceId;
  name: string;
  description: string;
  kind: 'pad' | 'bed';
  location: string;
}[] = [
  ...Object.values(PAD_PRESETS).map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    kind: 'pad' as const,
    location: preset.baseUrl,
  })),
  ...Object.values(AMBIENT_BEDS).map((bed) => ({
    id: bed.id,
    name: bed.name,
    description: bed.description,
    kind: 'bed' as const,
    location: `src/assets/audio/beds/${bed.folder}/`,
  })),
];

export const DEFAULT_SAMPLE_LAYERS: readonly SampleLayerConfig[] = [
  { id: 'layer-warm', sourceId: 'warm-pad', enabled: true, volume: 0.72 },
  { id: 'layer-shimmer', sourceId: 'shimmer-pad', enabled: true, volume: 0.38 },
  { id: 'layer-sub', sourceId: 'sub-bass', enabled: true, volume: 0.5 },
];

export function isPadPresetId(id: SampleSourceId): id is PadPresetId {
  return Object.prototype.hasOwnProperty.call(PAD_PRESETS, id);
}

export function isAmbientBedId(id: SampleSourceId): id is AmbientBedId {
  return Object.prototype.hasOwnProperty.call(AMBIENT_BEDS, id);
}

export function getSampleSource(id: SampleSourceId) {
  return SAMPLE_SOURCES.find((source) => source.id === id)!;
}
