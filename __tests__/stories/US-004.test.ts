/** @vitest-environment jsdom */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGED_CSP } from '../../src/main/csp';
import { parseCsp } from '../../tests/helpers/csp';
import {
  DEV_COMPONENT_GALLERY_PATH,
  isDevGalleryPath,
} from '../../src/renderer/dev/gallery-path';
import { restoreFocusSafely } from '../../src/renderer/lib/focus-restore';

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

const UI_FILES = [
  'src/renderer/components/ui/button.tsx',
  'src/renderer/components/ui/input.tsx',
  'src/renderer/components/ui/label.tsx',
  'src/renderer/components/ui/dialog.tsx',
  'src/renderer/components/ui/select.tsx',
  'src/renderer/components/ui/tooltip.tsx',
  'src/renderer/components/ui/progress.tsx',
] as const;

describe('US-004 accessible shadcn component foundation', () => {
  it('pins only the required Radix-backed primitives and shared token wiring', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies['radix-ui']).toMatch(/^\d+\./);
    expect(pkg.dependencies['lucide-react']).toMatch(/^\d+\./);
    expect(pkg.dependencies['class-variance-authority']).toBeTruthy();
    // Official unified radix package — not a private Indigo source copy.
    expect(pkg.dependencies['@indigo'] ?? null).toBeFalsy();

    for (const file of UI_FILES) {
      expect(existsSync(join(root, file)), file).toBe(true);
      const source = read(file);
      expect(source).toContain("from '@/lib/utils'");
      expect(source).not.toMatch(/rounded-(?:md|lg|full|sm)/);
      expect(source).not.toMatch(/font-semibold|font-bold|font-\[7/);
      expect(source).toMatch(/rounded-none|text-hq-canvas|text-hq-title/);
    }

    // Radix-backed overlays and controls (input is a native element styled via tokens).
    for (const file of [
      'src/renderer/components/ui/button.tsx',
      'src/renderer/components/ui/label.tsx',
      'src/renderer/components/ui/dialog.tsx',
      'src/renderer/components/ui/select.tsx',
      'src/renderer/components/ui/tooltip.tsx',
      'src/renderer/components/ui/progress.tsx',
    ] as const) {
      expect(read(file)).toMatch(/from ['"]radix-ui['"]/);
    }

    const styles = read('src/renderer/styles.css');
    expect(styles).toContain('--color-primary: var(--accent)');
    expect(styles).toContain('--color-destructive: var(--status-danger)');
    expect(styles).toContain('--color-popover: var(--background)');

    const docs = read('docs/accessible-components.md');
    expect(docs).toContain('shadcn@4.21.0');
    expect(docs).toContain(DEV_COMPONENT_GALLERY_PATH);
  });

  it('keeps dialog focus restoration safe when the opener unmounts', () => {
    const dialog = read('src/renderer/components/ui/dialog.tsx');
    expect(dialog).toContain('restoreFocusSafely');
    expect(dialog).toContain('focusReturnSelector');
    expect(dialog).toContain('onCloseAutoFocus');
    expect(dialog).toContain('openerRef');

    document.body.innerHTML = '';
    const opener = document.createElement('button');
    const fallback = document.createElement('button');
    fallback.id = 'still-here';
    document.body.append(opener, fallback);
    opener.remove();

    expect(
      restoreFocusSafely({
        opener,
        fallbackSelector: '#still-here',
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(fallback);
  });

  it('exposes a development-only gallery path with no production escape', () => {
    expect(isDevGalleryPath('/dev/components')).toBe(true);
    expect(isDevGalleryPath('/dev/components/')).toBe(true);
    expect(isDevGalleryPath('/')).toBe(false);
    expect(isDevGalleryPath('/components')).toBe(false);

    const main = read('src/renderer/main.tsx');
    expect(main).toContain('import.meta.env.DEV');
    expect(main).toContain('isDevGalleryPath');
    expect(main).toContain("import('./dev/components')");
    expect(main).toContain('data-focus-shell');
    // Application fallback shell stays; no redundant window chrome.
    expect(main).not.toMatch(/platform\.windowMinimize|platform\.windowMaximize|platform\.windowClose/);
    expect(main).toContain('Your desktop companion');

    const gallery = read('src/renderer/dev/components.tsx');
    expect(gallery).toContain('gallery-button-normal');
    expect(gallery).toContain('gallery-button-disabled');
    expect(gallery).toContain('gallery-button-pending');
    expect(gallery).toContain('gallery-button-error');
    expect(gallery).toContain('gallery-email-error');
    expect(gallery).toContain('data-tone="danger"');
    expect(gallery).toContain('Pending · 42%');

    // No production debug escape hatch.
    expect(main).not.toMatch(/localStorage\.getItem\(['"][^'"]*gallery/);
    expect(main).not.toMatch(/\?debug/);
    expect(gallery).not.toMatch(/import\.meta\.env\.PROD/);
  });

  it('preserves packaged CSP while documenting inline positioning needs', () => {
    const csp = parseCsp(PACKAGED_CSP);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['script-src']?.join(' ')).not.toContain('unsafe-inline');
    expect(csp['style-src']).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));

    const progress = read('src/renderer/components/ui/progress.tsx');
    expect(progress).toContain('style={{ transform:');
    expect(progress).toContain("style-src 'self' 'unsafe-inline'");

    const docs = read('docs/accessible-components.md');
    expect(docs).toContain('style-src');
    expect(docs).toContain('inline');
    expect(docs).toContain('script-src');
  });

  it('honours prefers-reduced-motion and animates only compositor properties', () => {
    const styles = read('src/renderer/styles.css');
    const tokens = read('src/renderer/tokens.css');

    // Reduced motion is answered globally, so every primitive inherits it.
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(styles).toMatch(/animation-duration:\s*0\.01ms\s*!important/);

    // Shared motion tokens, not per-component timing copies.
    expect(tokens).toMatch(/--motion-state:\s*\d+ms/);
    expect(tokens).toContain('--motion-ease-out: cubic-bezier');
    // Decelerating curve only: no overshoot/bounce keywords anywhere.
    for (const source of [styles, tokens]) {
      expect(source).not.toMatch(/\b(bounce|elastic|backOut|overshoot)\b/i);
    }

    // Progress movement is token-timed transform; nothing animates layout.
    const progress = read('src/renderer/components/ui/progress.tsx');
    expect(progress).toContain('transition-transform');
    expect(progress).toContain('duration-[var(--motion-state)]');
    expect(progress).toContain('ease-[var(--motion-ease-out)]');
    for (const rel of UI_FILES) {
      const body = read(rel);
      expect(body, rel).not.toMatch(/transition-\[?(width|height|top|left|all)\b/);
    }
  });

  it('does not ship the gallery module in the production renderer assets', () => {
    const rendererDir = join(root, 'dist/renderer/assets');
    if (!existsSync(rendererDir)) {
      // Build gate runs after this suite in CI-less local flow; when assets are
      // missing the source gate above already proves the DEV-only import.
      expect(read('src/renderer/main.tsx')).toContain('import.meta.env.DEV');
      return;
    }
    const assets = readdirSync(rendererDir);
    const js = assets.filter((name) => name.endsWith('.js'));
    expect(js.length).toBeGreaterThan(0);
    for (const name of js) {
      const body = readFileSync(join(rendererDir, name), 'utf8');
      expect(body, name).not.toContain('dev-component-gallery');
      expect(body, name).not.toContain('Component gallery');
      expect(body, name).not.toContain('gallery-button-pending');
    }
  });
});
