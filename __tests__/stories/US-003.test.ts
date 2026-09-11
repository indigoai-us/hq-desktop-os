import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Plugin, UserConfig } from 'vite';
import viteConfig from '../../vite.config';
import { compileStylesheet, ruleBody } from '../../tests/helpers/tailwind';
import { loadRendererConfig } from '../../tests/helpers/renderer-dev-server';
import { PACKAGED_CSP, DEVELOPMENT_CSP } from '../../src/main/csp';
import { parseCsp } from '../../tests/helpers/csp';
import {
  parseStoredTheme,
  resolveAppearance,
  THEME_STORAGE_KEY,
} from '../../src/renderer/lib/theme';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

/** Every plugin the shipped Vite config installs, including nested presets. */
function configuredPlugins(): Plugin[] {
  const flatten = (value: unknown): Plugin[] =>
    Array.isArray(value) ? value.flatMap(flatten) : value ? [value as Plugin] : [];
  return flatten((viteConfig as UserConfig).plugins);
}

/** The real plugin instance from the shipped Vite config, by name. */
function plugin(name: string): Plugin {
  const found = configuredPlugins().find((candidate) => candidate.name === name);
  if (!found) throw new Error(`vite.config has no plugin named ${name}`);
  return found;
}

/** Run a plugin's index-HTML transform the way Vite would. */
function transformHtml(name: string, html: string, ctx: unknown): string {
  const hook = plugin(name).transformIndexHtml;
  if (typeof hook !== 'function') throw new Error(`${name} has no callable transformIndexHtml`);
  const result = (hook as (html: string, ctx: unknown) => unknown)(html, ctx);
  if (typeof result !== 'string') throw new Error(`${name} did not return HTML`);
  return result;
}

interface BootstrapRun {
  readonly dataTheme: string | undefined;
  readonly colorScheme: string;
}

/**
 * Execute the shipped theme bootstrap against a stub document, so its real
 * behaviour — not its source text — is what the story asserts.
 */
function runThemeBootstrap(options: {
  stored?: string | null;
  storageThrows?: boolean;
  systemDark?: boolean;
  matchMediaThrows?: boolean;
}): BootstrapRun {
  const attributes: Record<string, string> = {};
  const root = {
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
    style: { colorScheme: '' },
  };
  const sandbox: Record<string, unknown> = {
    document: { documentElement: root },
    matchMedia: (query: string) => {
      if (options.matchMediaThrows) throw new Error('matchMedia unavailable');
      return { matches: Boolean(options.systemDark) && query.includes('dark') };
    },
  };
  Object.defineProperty(sandbox, 'localStorage', {
    get() {
      if (options.storageThrows) throw new Error('storage blocked');
      return { getItem: () => (options.stored === undefined ? null : options.stored) };
    },
  });
  runInNewContext(read('src/renderer/public/theme-init.js'), sandbox);
  return { dataTheme: attributes['data-theme'], colorScheme: root.style.colorScheme };
}

function cssCustomProperties(source: string): Set<string> {
  const found = new Set<string>();
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    found.add(match[1]!.toLowerCase());
  }
  return found;
}

describe('US-003 Tailwind and HQ theme tokens', () => {
  it('wires Tailwind through the Vite plugin and shadcn source configuration', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.tailwindcss).toMatch(/^4\./);
    expect(pkg.dependencies['@tailwindcss/vite']).toMatch(/^4\./);
    expect(pkg.dependencies.clsx).toBeTruthy();
    expect(pkg.dependencies['tailwind-merge']).toBeTruthy();
    expect(pkg.dependencies['class-variance-authority']).toBeTruthy();

    // The config object itself must carry the Tailwind Vite plugin and alias.
    const plugins = configuredPlugins();
    expect(plugins.map((candidate) => candidate.name)).toContain('@tailwindcss/vite:scan');
    expect(plugins.some((candidate) => candidate.name.startsWith('vite:react'))).toBe(true);
    const alias = (viteConfig as UserConfig).resolve?.alias as Record<string, string>;
    expect(alias['@']).toBe(join(root, 'src/renderer'));

    const components = JSON.parse(read('components.json')) as {
      style: string;
      rsc: boolean;
      tsx: boolean;
      tailwind: { config: string; css: string; cssVariables: boolean };
      aliases: Record<string, string>;
    };
    expect(components.rsc).toBe(false);
    expect(components.tsx).toBe(true);
    expect(components.tailwind.config).toBe('');
    expect(components.tailwind.css).toBe('src/renderer/styles.css');
    expect(components.tailwind.cssVariables).toBe(true);
    expect(components.aliases.utils).toBe('@/lib/utils');
    expect(components.aliases.ui).toBe('@/components/ui');
    expect(components.aliases.components).toBe('@/components');

    const styles = read('src/renderer/styles.css');
    expect(styles).toMatch(/@import\s+['"]tailwindcss['"]/);
    expect(styles).toContain('./tokens.css');
    expect(styles).toContain('./assets/fonts.css');

    // Path alias prerequisites resolve to real files.
    expect(read('src/renderer/lib/utils.ts')).toContain('export function cn');
    expect(read('tsconfig.app.json')).toContain('"@/*"');
  });

  it('defines semantic tokens for color, spacing, typography and focus', () => {
    const tokens = cssCustomProperties(read('src/renderer/tokens.css'));
    for (const required of [
      '--background',
      '--foreground',
      '--muted',
      '--muted-foreground',
      '--border',
      '--accent',
      '--ring',
      '--selection',
      '--status-success',
      '--status-warning',
      '--status-danger',
      '--status-info',
      '--space-1',
      '--space-4',
      '--text-canvas',
      '--text-title',
      '--radius',
    ]) {
      expect(tokens.has(required), required).toBe(true);
    }

    const styles = read('src/renderer/styles.css');
    expect(styles).toContain('::selection');
    expect(styles).toContain('var(--selection)');
    expect(styles).toContain(':focus-visible');
    expect(styles).toContain('var(--ring)');

    const declared = cssCustomProperties(read('src/renderer/tokens.css'));
    expect(declared.has('--text-canvas')).toBe(true);
    expect(declared.has('--text-title')).toBe(true);
    expect(declared.has('--radius')).toBe(true);
  });

  it('compiles spacing and typography utilities from the semantic tokens', async () => {
    const css = await compileStylesheet(join(root, 'src/renderer/styles.css'), [
      'gap-1',
      'gap-2',
      'p-4',
      'text-hq-canvas',
      'text-hq-title',
    ]);

    // Utilities must resolve through the HQ tokens, not bake in a literal.
    for (const selector of ['.gap-1', '.gap-2', '.p-4']) {
      expect(ruleBody(css, selector), selector).toContain('var(--space-1)');
      expect(ruleBody(css, selector), selector).not.toMatch(/\d(?:\.\d+)?rem/);
    }
    expect(ruleBody(css, '.text-hq-canvas')).toContain('var(--text-canvas)');
    expect(ruleBody(css, '.text-hq-title')).toContain('var(--text-title)');
    for (const selector of ['.text-hq-canvas', '.text-hq-title']) {
      expect(ruleBody(css, selector), selector).not.toMatch(/font-size:\s*\d/);
    }

    // Components spend the same vocabulary, so a token change moves them too.
    const components: Record<string, string[]> = {
      '.hq-page': ['var(--space-6)'],
      '.hq-actions': ['var(--space-2)', 'var(--space-5)'],
      '.hq-button': ['var(--space-2)', 'var(--space-3)'],
      '.hq-theme-control': ['var(--space-4)'],
      '.hq-theme-control select, .hq-select': ['var(--space-2)', 'var(--space-3)'],
    };
    for (const [selector, expected] of Object.entries(components)) {
      const body = ruleBody(css, selector);
      for (const token of expected) expect(body, selector).toContain(token);
      // No hardcoded spacing survives beside the tokens.
      expect(body.replace(/max-width:[^;]+;/, ''), selector).not.toMatch(
        /(?:padding|margin|gap)[^;]*\d(?:\.\d+)?rem/,
      );
    }
  });

  it('loads the shipped Vite config through Vite own loader', async () => {
    // The HMR fixture server loads the config this way instead of importing the
    // TypeScript file, which leaves its module format to the test runner.
    const loaded = await loadRendererConfig(root);
    const names = (((loaded.plugins ?? []) as unknown[]).flatMap(function flatten(
      value: unknown,
    ): Plugin[] {
      return Array.isArray(value) ? value.flatMap(flatten) : value ? [value as Plugin] : [];
    }) as Plugin[]).map((entry) => entry.name);
    expect(names).toContain('@tailwindcss/vite:scan');
    expect(names).toContain('development-refresh-csp');
    expect(names).toContain('production-csp');
    expect(names.some((name) => name.startsWith('vite:react'))).toBe(true);
  });

  it('keeps the HQ styling contract in token-backed controls', () => {
    const styles = read('src/renderer/styles.css');
    const tokens = read('src/renderer/tokens.css');

    // Updated user direction uses HQ V4 control radii.
    expect(styles).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(tokens).toMatch(/--radius:\s*6px/);

    // Weight cap: component rules use 400/500 only.
    const weights = [...styles.matchAll(/font-weight:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(weights.length).toBeGreaterThan(0);
    expect(weights.every((w) => w <= 500)).toBe(true);

    // Selection is background-only; no left accent pattern in styles.
    expect(styles).toContain('background: var(--selection)');
    expect(styles).not.toMatch(/border-left:\s*[^;]*var\(--accent/);
    expect(styles).not.toMatch(/border-left:\s*[3-9]px/);

    // Semantic status tones exist as classes.
    for (const tone of ['success', 'warning', 'danger', 'info']) {
      expect(styles).toContain(`data-tone='${tone}'`);
      expect(styles).toContain(`var(--status-${tone})`);
    }

    // Appearance is one labeled native select.
    expect(read('src/renderer/theme.tsx')).toContain('<select id="appearance"');
    expect(read('src/renderer/theme.tsx')).not.toContain('role="radio"');

    const main = read('src/renderer/main.tsx') + read('src/renderer/companion-app.tsx');
    expect(main).toContain('data-selected={section === name}');
    expect(main).toContain('ThemeControl');
    // US-002 native frame: still no redundant window-control IPC wiring in the page.
    expect(main).not.toMatch(/platform\.windowMinimize|platform\.windowMaximize|platform\.windowClose/);
    expect(main).not.toMatch(/data-testid=["']window-(minimize|maximize|close)["']/);
  });

  it('persists theme offline without remote fonts or a weakened script CSP', () => {
    expect(parseStoredTheme('dark')).toBe('dark');
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(THEME_STORAGE_KEY).toBe('hq-desktop-os.theme-preference');

    const fonts = read('src/renderer/assets/fonts.css');
    expect(fonts).not.toMatch(/@import\s+url\s*\(\s*['"]?https?:/i);
    expect(fonts).not.toMatch(/@font-face\s*\{/);
    expect(fonts).toContain('system-ui');

    const init = read('src/renderer/public/theme-init.js');
    expect(init).not.toMatch(/https?:\/\//i);
    expect(init).toContain(THEME_STORAGE_KEY);

    const packaged = parseCsp(PACKAGED_CSP);
    expect(packaged['script-src']).toEqual(["'self'"]);
    expect(packaged['script-src']?.join(' ')).not.toContain('unsafe-inline');
    expect(packaged['style-src']).toContain("'self'");

    const development = parseCsp(DEVELOPMENT_CSP);
    // Dev may allow unsafe-inline for React Refresh, but theme must not require
    // loosening production script-src.
    expect(development['script-src']).toContain("'self'");

    const html = read('src/renderer/index.html');
    expect(html).toContain('src="/theme-init.js"');
    expect(html).toContain('data-theme="system"');
    // No inline theme bootstrap script body.
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>[^<]*localStorage/i);
  });

  it('ships theme-init beside the built renderer and keeps docs accurate', () => {
    // Vite copies publicDir verbatim, so the bootstrap ships as a same-origin
    // classic script next to index.html.
    expect(read('src/renderer/public/theme-init.js')).toContain(THEME_STORAGE_KEY);
    expect(read('src/renderer/index.html')).toContain('src="/theme-init.js"');

    // Run the shipped build transform over the shipped document.
    const built = transformHtml('production-csp', read('src/renderer/index.html'), {});
    const csp = parseCsp(
      built.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1] ?? '',
    );
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['connect-src']).toEqual(["'self'"]);
    expect(built).toContain('src="/theme-init.js"');

    const docs = read('docs/theme-tokens.md');
    expect(docs).toContain('theme-init.js');
    expect(docs).toContain('script-src');
    expect(docs).toContain('components.json');
  });
  it('applies the stored preference in the bootstrap before any framework runs', () => {
    expect(runThemeBootstrap({ stored: 'dark' })).toEqual({
      dataTheme: 'dark',
      colorScheme: 'dark',
    });
    expect(runThemeBootstrap({ stored: 'light', systemDark: true })).toEqual({
      dataTheme: 'light',
      colorScheme: 'light',
    });
    expect(runThemeBootstrap({ stored: 'system', systemDark: true })).toEqual({
      dataTheme: 'system',
      colorScheme: 'dark',
    });
  });

  it('falls back to system in the bootstrap when storage or matchMedia fails', () => {
    for (const corrupt of ['', '  ', 'Dark', '{"preference":"dark"}', 'null']) {
      expect(runThemeBootstrap({ stored: corrupt }).dataTheme, corrupt).toBe('system');
    }
    expect(runThemeBootstrap({ stored: null })).toEqual({
      dataTheme: 'system',
      colorScheme: 'light',
    });
    expect(runThemeBootstrap({ storageThrows: true, systemDark: true })).toEqual({
      dataTheme: 'system',
      colorScheme: 'dark',
    });
    expect(runThemeBootstrap({ stored: 'system', matchMediaThrows: true })).toEqual({
      dataTheme: 'system',
      colorScheme: 'light',
    });
  });

  it('points the development CSP at the dev server that is actually running', () => {
    const html = read('src/renderer/index.html');
    const served = transformHtml('development-refresh-csp', html, {
      server: { resolvedUrls: { local: ['http://127.0.0.1:4331/'] }, config: { server: {} } },
    });
    const csp = parseCsp(
      served.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1] ?? '',
    );
    // The HMR socket of this server must be reachable, not only the default port.
    expect(csp['connect-src']).toEqual([
      "'self'",
      'ws://127.0.0.1:4331',
      'http://127.0.0.1:4331',
    ]);
    expect(csp['script-src']).toContain("'unsafe-inline'");

    // Without a running server the document keeps its declared policy.
    const untouched = transformHtml('development-refresh-csp', html, {});
    expect(parseCsp(untouched.match(/content="([^"]*)"/)?.[1] ?? '')['connect-src']).toEqual(
      parseCsp(html.match(/content="([^"]*)"/)?.[1] ?? '')['connect-src'],
    );
  });
});
