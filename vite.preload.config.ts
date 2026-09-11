import { defineConfig } from 'vite';

/**
 * A sandboxed preload cannot resolve arbitrary local modules: Electron only
 * provides a small polyfilled `require`. Emitting the preload as one
 * self-contained CommonJS file keeps `sandbox: true` while still letting the
 * preload share the typed platform contract in `src/shared`.
 */
export default defineConfig({
  build: {
    outDir: 'dist/preload',
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: ['electron', /^node:/],
    },
  },
});
