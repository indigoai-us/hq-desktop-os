import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // The same `@` the renderer ships with, so a mounted component test resolves
  // its imports exactly as the application does.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
  // Automatic JSX runtime, matching the app's react plugin, so a test can mount
  // a component without importing React itself.
  esbuild: { jsx: 'automatic' },
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/native/**/*.test.ts',
      '__tests__/stories/**/*.test.ts',
    ],
  },
});
