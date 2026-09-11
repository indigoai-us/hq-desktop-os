import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  { ignores: ['dist/**', 'dist-runtime/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx,mjs}'], languageOptions: { globals: globals.node } },
  { files: ['src/renderer/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  {
    files: ['src/renderer/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser, globalThis: 'readonly' } },
  },
  // Playwright specs run assertions in Node and evaluate callbacks in the page.
  { files: ['tests/e2e/**/*.ts', 'tests/electron/**/*.ts', 'tests/host-acceptance/**/*.ts', 'tests/helpers/csp*.ts'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
