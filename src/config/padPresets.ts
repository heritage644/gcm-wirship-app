/** Sample-based pad and ambience catalog. Audio files are supplied by the project owner. */

export const PAD_SAMPLE_ANCHORS = ['C2', 'C4', 'C6'] as const;
export type PadSampleAnchor = (typeof PAD_SAMPLE_ANCHORS)[number];

export const PAD_PRESETS = {
  'warm-pad': {
    id: 'warm-pad',
    name: 'Warm Pad',
    description: 'Yamaha-style analog warmth with a slow, wide swell.',
    folder: 'warm-pad',
    expectedAnchors: PAD_SAMPLE_ANCHORS,
  },
  'shimmer-pad': {
    id: 'shimmer-pad',
    name: 'Shimmer Pad',
    description: 'Bright upper harmonics and a soft ambient sparkle.',
    folder: 'shimmer-pad',
    expectedAnchors: PAD_SAMPLE_ANCHORS,
  },
  'sub-bass': {
    id: 'sub-bass',
    name: 'Sub Drone',
    description: 'A steady low-frequency foundation beneath the other layers.',
    folder: 'sub-bass',
    expectedAnchors: PAD_SAMPLE_ANCHORS,
  },
} as const;

export type PadPresetId = keyof typeof PAD_PRESETS;

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
}[] = [
  ...Object.values(PAD_PRESETS).map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    kind: 'pad' as const,
  })),
  ...Object.values(AMBIENT_BEDS).map((bed) => ({
    id: bed.id,
    name: bed.name,
    description: bed.description,
    kind: 'bed' as const,
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
