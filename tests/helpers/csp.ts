/** Split a Content-Security-Policy into directive → source list. */
export function parseCsp(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name!, sources];
      }),
  );
}

/** Read the CSP the renderer document actually ships. */
export function cspFromHtml(html: string): string | null {
  const meta = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i.exec(html)?.[0];
  if (!meta) return null;
  return /content="([^"]*)"/i.exec(meta)?.[1] ?? null;
}

/**
 * Directives every shipped renderer document must carry. Inline style is
 * required by the bundler and confined to style-src; scripts get no inline or
 * eval escape hatch.
 */
export const REQUIRED_CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'frame-ancestors': ["'none'"],
  'form-action': ["'none'"],
};
