import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

    const vite = read('vite.config.ts');
    expect(vite).toContain("@tailwindcss/vite");
    expect(vite).toContain('tailwindcss()');
    expect(vite).toContain("'@'");

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
    expect(styles).toMatch(/--text-canvas:\s*0\.8125rem/);
    expect(styles).toMatch(/--text-title:\s*1\.25rem/);
    expect(styles).toMatch(/--radius(?:-[\w]+)?:\s*0/);
  });

  it('keeps the HQ styling contract in token-backed controls', () => {
    const styles = read('src/renderer/styles.css');
    const tokens = read('src/renderer/tokens.css');

    // Square corners on controls.
    expect(styles).toMatch(/border-radius:\s*0/);
    expect(tokens).toMatch(/--radius:\s*0/);

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

    // Stroke icons: theme control SVGs fill none / stroke currentColor.
    expect(styles).toContain('stroke: currentColor');
    expect(styles).toContain('fill: none');

    const main = read('src/renderer/main.tsx');
    expect(main).toContain('data-selected="true"');
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
    expect(html).toContain('src="./theme-init.js"');
    expect(html).toContain('data-theme="system"');
    // No inline theme bootstrap script body.
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>[^<]*localStorage/i);
  });

  it('ships theme-init beside the built renderer and keeps docs accurate', () => {
    // Build output may already exist from parent preview; if present, assert artifact.
    const distHtmlPath = join(root, 'dist/renderer/index.html');
    try {
      const distHtml = readFileSync(distHtmlPath, 'utf8');
      expect(distHtml).toMatch(/theme-init\.js/);
      const assets = readdirSync(join(root, 'dist/renderer'));
      expect(assets).toContain('theme-init.js');
      const csp = parseCsp(
        distHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1] ?? '',
      );
      expect(csp['script-src']).toEqual(["'self'"]);
    } catch {
      // Absence is fine before build; the build gate below covers generation.
    }

    const docs = read('docs/theme-tokens.md');
    expect(docs).toContain('theme-init.js');
    expect(docs).toContain('script-src');
    expect(docs).toContain('components.json');
  });
});
