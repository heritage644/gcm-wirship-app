import type { AmbientBedId, PadPresetId } from '../../config/padPresets';

export type AudioAssetModule = number | string | { uri: string };

type AssetContext = {
  keys(): string[];
  (key: string): AudioAssetModule;
};

// Metro's context modules discover WAVs added to these folders at build time.
// Each context is intentionally scoped so the retired per-key legacy loops are
// never accidentally picked up by the new multisample engine.
const PAD_CONTEXTS: Record<PadPresetId, AssetContext> = {
  'warm-pad': require.context('./pads/warm-pad', false, /\.wav$/i),
  'shimmer-pad': require.context('./pads/shimmer-pad', false, /\.wav$/i),
  'sub-bass': require.context('./pads/sub-bass', false, /\.wav$/i),
};

const BED_CONTEXTS: Record<AmbientBedId, AssetContext> = {
  'room-bed': require.context('./beds/room-bed', false, /\.wav$/i),
  'rain-bed': require.context('./beds/rain-bed', false, /\.wav$/i),
  'vinyl-bed': require.context('./beds/vinyl-bed', false, /\.wav$/i),
};

export function getPadSampleModules(presetId: PadPresetId): Record<string, AudioAssetModule> {
  const context = PAD_CONTEXTS[presetId];
  const modules: Record<string, AudioAssetModule> = {};

  for (const key of context.keys()) {
    const filename = key.replace(/^\.\//, '');
    const match = filename.match(/^([A-G](?:#|b)?-?\d+)\.wav$/i);
    if (!match) continue;

    try {
      modules[normalizeNoteName(match[1])] = context(key);
    } catch {
      // A file can be removed while Metro is rebuilding. Report it as missing.
    }
  }

  return modules;
}

export function getAmbientBedModule(bedId: AmbientBedId): AudioAssetModule | null {
  const context = BED_CONTEXTS[bedId];
  const key = context.keys().find((candidate) => candidate.toLowerCase() === './loop.wav');
  if (!key) return null;

  try {
    return context(key);
  } catch {
    return null;
  }
}

function normalizeNoteName(note: string): string {
  const match = note.match(/^([A-G](?:#|b)?)(-?\d+)$/i);
  if (!match) return note;
  return `${match[1][0].toUpperCase()}${match[1].slice(1).replace('b', 'B')}${match[2]}`;
}
