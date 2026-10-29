// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const jestGlobals = Object.fromEntries(['jest', 'test', 'expect', 'describe', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'].map((name) => [name, 'readonly']));

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['src/**/*.test.js', 'src/test/**/*.js', 'jest.setup.js', 'jest.after-env.js'],
    languageOptions: { globals: jestGlobals },
  },
]);
