import { Asset } from 'expo-asset';

import { getAmbientBedModule, getPadSampleModules } from '../assets/audio/sampleRegistry';
import type { AmbientBedId, PadPresetId } from '../config/padPresets';
import type {
  SampleAssetModule,
  SampleAssetResolver,
  SampleBufferLoader,
} from './SampleSamplerEngine';

export const metroSampleAssets: SampleAssetResolver = {
  getPadSamples: (presetId: PadPresetId) => getPadSampleModules(presetId),
  getAmbientBed: (bedId: AmbientBedId) => getAmbientBedModule(bedId),
};

/** Resolve a Metro-bundled WAV to a URI, then decode the recorded bytes. */
export const loadMetroSampleBuffer: SampleBufferLoader = async (
  module: SampleAssetModule,
  context: AudioContext,
) => {
  let uri: string;
  if (typeof module === 'string') {
    // Metro's web asset modules resolve directly to same-origin /assets URLs.
    uri = module;
  } else if (typeof module === 'object' && module !== null) {
    uri = module.uri;
  } else {
    // Native Metro modules are numeric IDs resolved by expo-asset.
    const asset = Asset.fromModule(module);
    await asset.downloadAsync();
    uri = asset.localUri ?? asset.uri;
  }

  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Sample request failed (${response.status}).`);
  const encodedAudio = await response.arrayBuffer();
  return context.decodeAudioData(encodedAudio.slice(0));
};
