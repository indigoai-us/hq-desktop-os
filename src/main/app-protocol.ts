/**
 * The packaged renderer is served from a confined custom origin instead of
 * `file://`.
 *
 * On `file://` a document's CSP `'self'` resolves to the whole `file:` scheme,
 * so a renderer with script execution can `fetch()` any absolute path on the
 * host and read it — entirely outside the typed PlatformClient boundary. A
 * registered *standard* scheme gives the document a real origin
 * (`app://hq-desktop-os`), so `'self'` names exactly this app's asset root and
 * nothing else, and every read still has to pass through the handler below.
 *
 * The handler is deliberately dull: it maps a URL to one file under the built
 * renderer directory, or refuses. Main, preload and any other packaged file
 * live outside that root and are therefore unreachable from the renderer.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { PACKAGED_CSP } from './csp.js';

export const APP_SCHEME = 'app';
export const APP_HOST = 'hq-desktop-os';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

export type AppAssetRefusal =
  | 'bad_url'
  | 'bad_scheme'
  | 'bad_host'
  | 'has_credentials'
  | 'has_query'
  | 'bad_encoding'
  | 'escapes_root'
  | 'unsupported_type';

export type AppAssetResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: AppAssetRefusal };

/** Content types the renderer bundle can legitimately consist of. */
const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

export function contentTypeFor(filePath: string): string | null {
  return CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? null;
}

function refuse(reason: AppAssetRefusal): AppAssetResolution {
  return { ok: false, reason };
}

/**
 * Map an `app://` URL onto a single file inside `rootDir`, or refuse.
 *
 * Pure so the refusal set is unit-testable without an Electron runtime.
 */
export function resolveAppAsset(rawUrl: string, rootDir: string): AppAssetResolution {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return refuse('bad_url');
  }

  if (url.protocol !== `${APP_SCHEME}:`) return refuse('bad_scheme');
  if (url.username !== '' || url.password !== '') return refuse('has_credentials');
  if (url.host !== APP_HOST) return refuse('bad_host');
  // A query string reaches no real behaviour here, so it is refused rather than
  // silently ignored: nothing should be able to vary the bytes served.
  if (url.search !== '') return refuse('has_query');

  // The checks below run on the path exactly as it was requested. `new URL()`
  // already collapses `..` and `%2e%2e` segments, so reading `url.pathname`
  // would inspect a path that has had the traversal removed and report it
  // clean. Chromium normalises too before it ever reaches the handler, but the
  // refusal set must hold on its own.
  const raw = rawPathOf(rawUrl);
  if (raw === null || !raw.startsWith('/')) return refuse('bad_url');
  // `//server/share` becomes a UNC path the moment it is handed to the fs.
  if (raw.startsWith('//')) return refuse('escapes_root');

  // Percent-encoding must not be able to smuggle a separator, a traversal
  // segment or a NUL terminator past the checks below.
  if (/%2e|%2f|%5c|%00/i.test(raw)) return refuse('bad_encoding');
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return refuse('bad_encoding');
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return refuse('bad_encoding');

  const requested = decoded === '/' ? '/index.html' : decoded;
  if (requested.split('/').includes('..')) return refuse('escapes_root');
  // `/C:/Windows/...` is an absolute path on Windows once the slash is dropped.
  if (/^\/[A-Za-z]:/.test(requested)) return refuse('escapes_root');

  const root = resolve(rootDir);
  const target = resolve(root, `.${requested}`);
  if (target === root) return refuse('escapes_root');
  if (!target.startsWith(root + sep)) return refuse('escapes_root');

  if (!contentTypeFor(target)) return refuse('unsupported_type');
  return { ok: true, path: target };
}

/** The path component exactly as written, before any URL normalisation. */
function rawPathOf(rawUrl: string): string | null {
  const prefix = `${APP_SCHEME}://`;
  if (!rawUrl.toLowerCase().startsWith(prefix)) return null;
  const afterScheme = rawUrl.slice(prefix.length);
  const pathStart = afterScheme.search(/[/?#]/);
  if (pathStart === -1) return '/';
  const path = afterScheme.slice(pathStart);
  if (path.startsWith('?') || path.startsWith('#')) return '/';
  return path.split(/[?#]/)[0] || '/';
}

/**
 * Refusals the response layer adds on top of resolution: a request for a path
 * that resolves cleanly but is not there, and a request that uses a method
 * this read-only scheme does not implement.
 */
export type AppResponseRefusal = AppAssetRefusal | 'not_found' | 'unsupported_method';

/** HTTP status the renderer sees for each refusal. */
export function statusForRefusal(reason: AppResponseRefusal): number {
  if (reason === 'not_found') return 404;
  if (reason === 'unsupported_method') return 405;
  return reason === 'bad_url' || reason === 'bad_encoding' || reason === 'has_query' ? 400 : 403;
}

/** The scheme serves bytes and nothing else, so only reads are implemented. */
export const SUPPORTED_METHODS: readonly string[] = ['GET', 'HEAD'];

/**
 * Headers every response from this scheme carries, whatever its status.
 *
 * The CSP is attached here rather than left to `webRequest.onHeadersReceived`
 * because that hook is not a guaranteed path for custom-scheme responses, and
 * because an error response is exactly the document an attacker would want to
 * frame or to run script in.
 */
function securityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': PACKAGED_CSP,
    'X-Content-Type-Options': 'nosniff',
  };
}

function refused(reason: AppResponseRefusal, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: statusForRefusal(reason),
    headers: { ...securityHeaders(), 'X-Refusal-Reason': reason, ...extra },
  });
}

/**
 * Serve one file from `rootDir` for an `app://` request, or refuse.
 *
 * Deliberately free of any Electron import so the delivered status, headers
 * and body can be asserted directly in unit tests as well as through a real
 * Chromium renderer.
 */
export async function serveAppAsset(request: Request, rootDir: string): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!SUPPORTED_METHODS.includes(method)) {
    return refused('unsupported_method', { Allow: SUPPORTED_METHODS.join(', ') });
  }

  const resolution = resolveAppAsset(request.url, rootDir);
  if (!resolution.ok) return refused(resolution.reason);

  // Containment is re-checked after symlink resolution: a link inside the
  // renderer directory must not be able to point outside it.
  let real: string;
  try {
    real = await realpath(resolution.path);
  } catch {
    return refused('not_found');
  }
  const root = await realpath(rootDir).catch(() => resolve(rootDir));
  if (real !== root && !real.startsWith(root + sep)) return refused('escapes_root');

  const info = await stat(real).catch(() => null);
  if (!info?.isFile()) return refused('not_found');

  const contentType = contentTypeFor(real);
  if (!contentType) return refused('unsupported_type');

  const body = await readFile(real);
  const headers = {
    ...securityHeaders(),
    'Content-Type': contentType,
    'Content-Length': String(body.byteLength),
  };
  // HEAD answers with the headers a GET would produce and no body at all.
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
