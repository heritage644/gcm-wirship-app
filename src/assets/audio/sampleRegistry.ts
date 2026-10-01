import type { AmbientBedId } from '../../config/padPresets';

export type AudioAssetModule = number | string | { uri: string };

type AssetContext = {
  keys(): string[];
  (key: string): AudioAssetModule;
};

// Optional ambience remains a user-supplied local loop. Pad samples are fetched
// from the public sources declared in config/padPresets.ts instead.
const BED_CONTEXTS: Record<AmbientBedId, AssetContext> = {
  'room-bed': require.context('./beds/room-bed', false, /\.wav$/i),
  'rain-bed': require.context('./beds/rain-bed', false, /\.wav$/i),
  'vinyl-bed': require.context('./beds/vinyl-bed', false, /\.wav$/i),
};

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
