import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), {
    name: 'development-refresh-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      // React Fast Refresh injects an inline preamble only in development.
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    },
  }],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
