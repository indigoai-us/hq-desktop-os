import type { Page, Request } from '@playwright/test';

export interface ThemeSample {
  readonly dataTheme: string | null;
  readonly colorScheme: string;
  readonly background: string;
  readonly rootChildren: number;
}

export interface ThemeTimeline {
  /** Document state sampled in the first animation frame, i.e. before first paint. */
  readonly firstFrame: ThemeSample | null;
  /** Every theme application observed on <html>, in order. */
  readonly applied: ThemeSample[];
}

/**
 * Record how the document is themed from document-start onwards.
 *
 * The honest seam for "no flash of the wrong theme" is the document itself:
 * the render-blocking bootstrap applies the saved preference before React
 * exists, and the first animation frame runs before the browser paints. Both
 * are observed here rather than inferred from source.
 */
export async function recordThemeTimeline(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sink = { firstFrame: null as unknown, applied: [] as unknown[] };
    (globalThis as Record<string, unknown>).__themeTimeline = sink;

    const sample = () => {
      const root = document.documentElement;
      if (!root) return null;
      const style = getComputedStyle(root);
      const mount = document.getElementById('root');
      return {
        dataTheme: root.getAttribute('data-theme'),
        colorScheme: style.colorScheme,
        background: style.getPropertyValue('--background').trim(),
        rootChildren: mount ? mount.childElementCount : -1,
      };
    };

    // At document-start there is no <html> yet, so the document node is the
    // only thing there is to observe. Attribute changes on the element the
    // parser creates a moment later surface through the subtree, which is
    // still strictly earlier than anything the page itself can run.
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName !== 'data-theme') continue;
        if (record.target !== document.documentElement) continue;
        const entry = sample();
        if (entry) sink.applied.push(entry);
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });

    requestAnimationFrame(() => {
      sink.firstFrame = sample();
    });
  });
}

export async function readThemeTimeline(page: Page): Promise<ThemeTimeline> {
  return page.evaluate(
    () =>
      (globalThis as Record<string, unknown>).__themeTimeline as unknown as {
        firstFrame: ThemeSample | null;
        applied: ThemeSample[];
      },
  );
}

/** Relative luminance of a `#rrggbb` token value, so themes are compared by behaviour. */
export function hexLuminance(value: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())?.[1];
  if (!hex) throw new Error(`Expected a #rrggbb token value, received "${value}"`);
  const channel = (offset: number) => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export interface NetworkLog {
  /** Requests the page tried to make outside the local origin. */
  readonly external: string[];
  /** Every request URL the page issued. */
  readonly all: string[];
}

/**
 * Forbid every non-local request for the rest of the page's life and report
 * what was attempted. This is a browser-level offline condition over locally
 * built assets — it proves the renderer needs no network, and it is explicitly
 * not evidence about a packaged native launch.
 */
export async function forbidExternalNetwork(page: Page, localHost: string): Promise<NetworkLog> {
  const external: string[] = [];
  const all: string[] = [];
  page.on('request', (request: Request) => all.push(request.url()));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host === localHost) {
      await route.continue();
      return;
    }
    external.push(url.href);
    await route.abort('blockedbyclient');
  });
  return { external, all };
}
