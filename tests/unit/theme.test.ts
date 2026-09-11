import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cn } from '../../src/renderer/lib/utils';
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  parseStoredTheme,
  readStoredTheme,
  resolveAppearance,
  systemPrefersDark,
  writeStoredTheme,
} from '../../src/renderer/lib/theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

describe('theme preference logic', () => {
  it('parses only the three allowed preferences and rejects corrupt values', () => {
    expect(parseStoredTheme('light')).toBe('light');
    expect(parseStoredTheme('dark')).toBe('dark');
    expect(parseStoredTheme('system')).toBe('system');
    expect(parseStoredTheme(' light ')).toBe('light');
    expect(parseStoredTheme(null)).toBe('system');
    expect(parseStoredTheme(undefined)).toBe('system');
    expect(parseStoredTheme('')).toBe('system');
    expect(parseStoredTheme('{"theme":"dark"}')).toBe('system');
    expect(parseStoredTheme('DARK')).toBe('system');
    expect(parseStoredTheme('sepia')).toBe('system');
  });

  it('resolves appearance from preference and system media', () => {
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
  });

  it('reads and writes storage, surviving unavailable and throwing stores', () => {
    const storage = memoryStorage();
    expect(readStoredTheme(storage)).toBe('system');
    expect(writeStoredTheme(storage, 'dark')).toBe(true);
    expect(readStoredTheme(storage)).toBe('dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    expect(readStoredTheme(null)).toBe('system');
    expect(writeStoredTheme(null, 'light')).toBe(false);

    const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(readStoredTheme(throwing)).toBe('system');
    expect(writeStoredTheme(throwing, 'light')).toBe(false);
  });

  it('treats missing or throwing matchMedia as light system preference', () => {
    expect(systemPrefersDark(null)).toBe(false);
    expect(systemPrefersDark({ matches: true })).toBe(true);
    expect(
      systemPrefersDark({
        get matches(): boolean {
          throw new Error('gone');
        },
      }),
    ).toBe(false);
  });

  it('applies data-theme preference and resolved color-scheme on the document root', () => {
    const attrs = new Map<string, string>();
    const style = { colorScheme: '' };
    const root = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
      style,
    };
    applyThemeToDocument(root, 'system', 'dark');
    expect(attrs.get('data-theme')).toBe('system');
    expect(style.colorScheme).toBe('dark');
    applyThemeToDocument(root, 'light', 'light');
    expect(attrs.get('data-theme')).toBe('light');
    expect(style.colorScheme).toBe('light');
    applyThemeToDocument(null, 'dark', 'dark');
  });

  it('merges class names through the shadcn cn helper', () => {
    const hidden = false;
    expect(cn('px-2', hidden && 'hidden', 'px-4')).toBe('px-4');
    expect(cn('hq-button', 'hq-nav-item')).toContain('hq-button');
  });
});

describe('isolated theme-init artifact', () => {
  it('bootstraps from storage before paint without remote URLs', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/public/theme-init.js'),
      'utf8',
    );
    expect(source).not.toMatch(/https?:\/\//i);
    expect(source).not.toMatch(/fonts\.google/i);
    expect(source).toContain(THEME_STORAGE_KEY);

    const attrs = new Map<string, string>();
    const style: { colorScheme?: string } = {};
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: 'dark' });
    const documentElement = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
      style,
    };
    const sandbox = {
      globalThis: null as unknown,
      window: null as unknown,
      document: { documentElement },
      localStorage: storage,
      matchMedia: () => ({ matches: false }),
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;

    vm.runInNewContext(source, sandbox);
    expect(attrs.get('data-theme')).toBe('dark');
    expect(style.colorScheme).toBe('dark');
  });

  it('falls back to system appearance when storage is corrupt or missing', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/public/theme-init.js'),
      'utf8',
    );

    function run(storage: unknown, systemIsDark: boolean) {
      const attrs = new Map<string, string>();
      const style: { colorScheme?: string } = {};
      const sandbox = {
        globalThis: null as unknown,
        window: null as unknown,
        document: {
          documentElement: {
            setAttribute(name: string, value: string) {
              attrs.set(name, value);
            },
            style,
          },
        },
        localStorage: storage,
        matchMedia: () => ({ matches: systemIsDark }),
      };
      sandbox.globalThis = sandbox;
      sandbox.window = sandbox;
      vm.runInNewContext(source, sandbox);
      return { attrs, style };
    }

    const corrupt = run(memoryStorage({ [THEME_STORAGE_KEY]: 'nope' }), true);
    expect(corrupt.attrs.get('data-theme')).toBe('system');
    expect(corrupt.style.colorScheme).toBe('dark');

    const throwing = run(
      {
        getItem() {
          throw new Error('denied');
        },
      },
      false,
    );
    expect(throwing.attrs.get('data-theme')).toBe('system');
    expect(throwing.style.colorScheme).toBe('light');

    const missing = run(undefined, true);
    expect(missing.attrs.get('data-theme')).toBe('system');
    expect(missing.style.colorScheme).toBe('dark');
  });

  it('is referenced as a same-origin classic script ahead of the module entry', () => {
    const html = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8');
    const initAt = html.indexOf('src="./theme-init.js"');
    const moduleAt = html.indexOf('src="/main.tsx"');
    expect(initAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(initAt);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
    // File URL form proves the artifact is a real checkout path, not a CDN.
    expect(pathToFileURL(join(process.cwd(), 'src/renderer/public/theme-init.js')).protocol).toBe(
      'file:',
    );
  });
});
