import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { ViteDevServer } from 'vite';
import { isDevGalleryPath } from './src/renderer/dev/gallery-path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

/** Host:port the running dev server is reachable on, or null when unknown. */
function devServerOrigin(server: ViteDevServer | undefined): string | null {
  const resolved = server?.resolvedUrls?.local?.[0] ?? server?.resolvedUrls?.network?.[0];
  if (resolved) {
    try {
      return new URL(resolved).host;
    } catch {
      return null;
    }
  }
  const configured = server?.config.server;
  if (!configured?.port) return null;
  const host = typeof configured.host === 'string' ? configured.host : '127.0.0.1';
  return `${host}:${configured.port}`;
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      // `/dev/components` also names a source module below this root, so Vite's
      // transform middleware answers the documented gallery route with
      // JavaScript and the browser never reaches the application document.
      // Rewrite the route to the HTML entry before that happens — the same
      // thing the SPA fallback does for a path with no file behind it.
      name: 'development-gallery-route',
      apply: 'serve',
      configureServer(server: ViteDevServer) {
        server.middlewares.use((req, _res, next) => {
          const [pathname] = (req.url ?? '').split('?');
          if (isDevGalleryPath(pathname)) req.url = '/index.html';
          next();
        });
      },
    },
    {
      name: 'development-refresh-csp',
      apply: 'serve',
      transformIndexHtml(html: string, ctx: { server?: ViteDevServer }) {
        // React Fast Refresh injects an inline preamble only in development.
        const withInline = html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
        // The HMR socket lives on whichever address this dev server actually
        // bound. Pinning the default port in the document would silence live
        // updates for any contributor serving the app anywhere else.
        const origin = devServerOrigin(ctx.server);
        if (!origin) return withInline;
        return withInline.replace(
          /connect-src [^;"]*/,
          `connect-src 'self' ws://${origin} http://${origin}`,
        );
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
