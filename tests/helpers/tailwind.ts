import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { compile } from 'tailwindcss';

const require = createRequire(import.meta.url);

/** Resolve `@import` the way the Tailwind Vite plugin does: from disk. */
function loadStylesheet(id: string, base: string) {
  const path = id.startsWith('.')
    ? resolve(base, id)
    : require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id, { paths: [base] });
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
}

/**
 * Compile a stylesheet with the installed Tailwind compiler and return the CSS
 * it actually emits for the given utility candidates. Nothing is written; this
 * is the same work the build does, so assertions read real output rather than
 * source text.
 */
export async function compileStylesheet(
  entry: string,
  candidates: string[],
): Promise<string> {
  const compiled = await compile(readFileSync(entry, 'utf8'), {
    base: dirname(entry),
    loadStylesheet: async (id: string, base: string) => loadStylesheet(id, base),
  });
  return compiled.build(candidates);
}

/** The declaration block a compiled rule emits, e.g. `.gap-2`. */
export function ruleBody(css: string, selector: string): string {
  const index = css.indexOf(`${selector} {`);
  if (index === -1) throw new Error(`compiled CSS has no rule for ${selector}`);
  const body = css.slice(index + selector.length + 2);
  return body.slice(0, body.indexOf('}')).trim();
}
