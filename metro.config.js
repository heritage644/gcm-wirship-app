// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Require contexts let the browser sampler discover note-named WAVs added later.
config.transformer.unstable_allowRequireContext = true;

// Recorded multisamples and the legacy native loops are WAV assets. Metro
// currently bundles .wav by default; keep the assertion for future upgrades.
if (!config.resolver.assetExts.includes('wav')) {
  config.resolver.assetExts.push('wav');
}

module.exports = config;
