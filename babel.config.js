module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    // babel-preset-expo wires up the react-native-worklets plugin that
    // Reanimated 4 needs, so no extra plugin entry is required here.
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
  };
};
