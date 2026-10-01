// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // The audio engine deliberately swallows errors from native players that
      // have already been released; an empty catch is the intent, not a bug.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]);
