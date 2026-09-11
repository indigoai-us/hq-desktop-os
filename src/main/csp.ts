/**
 * One source of truth for the Content-Security-Policy this app ships with.
 *
 * The packaged policy has to be applied in three places that must not drift
 * apart: the document's own `<meta>` tag, the session header hook, and every
 * `app://` protocol response — successful and refused alike. Response-level
 * delivery is the only one of the three that can enforce `frame-ancestors`,
 * which a `<meta>` CSP is required to ignore, so the handler attaches the
 * policy itself rather than trusting a hook to run for custom-scheme
 * responses.
 */
export const PACKAGED_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws://127.0.0.1:4173 http://127.0.0.1:4173",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');
