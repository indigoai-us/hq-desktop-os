import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'development-refresh-csp',
      apply: 'serve',
      transformIndexHtml(html) {
        // React Fast Refresh injects an inline preamble only in development.
        return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
      },
    },
    {
      name: 'production-csp',
      apply: 'build',
      transformIndexHtml(html) {
        return html.replace(
          /http-equiv="Content-Security-Policy"\s+content="[^"]*"/,
          `http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}"`,
        );
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src/renderer'),
    },
  },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
