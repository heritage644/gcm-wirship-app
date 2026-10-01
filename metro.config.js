// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// The generated pad loops are .wav; Metro bundles that extension by default,
// but assert it so a future upstream change cannot silently break the library.
if (!config.resolver.assetExts.includes('wav')) {
  config.resolver.assetExts.push('wav');
}

module.exports = config;
