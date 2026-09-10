import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx,mjs}'], languageOptions: { globals: globals.node } },
  { files: ['src/renderer/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
);
