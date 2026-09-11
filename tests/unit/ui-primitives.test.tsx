/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Progress } from '../../src/renderer/components/ui/progress';
import { restoreFocusSafely } from '../../src/renderer/lib/focus-restore';

/**
 * Behaviour of the real primitives, rendered. These assert what the modules do
 * with actual props and an actual DOM, never what their source text contains.
 */
let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  // Tell React this is an act-capable environment, so its warning does not
  // appear in an otherwise clean log.
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  // Radix reads these during layout; jsdom ships neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

function mount(element: React.ReactNode): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(element);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
});

/** The painted fraction of the track, read back off the inline transform. */
function fillPercent(bar: HTMLElement): number {
  const indicator = bar.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!;
  const match = /translateX\(-?([\d.]+)%\)/.exec(indicator.style.transform);
  if (!match) throw new Error(`no translateX in ${indicator.style.transform}`);
  return 100 - Number(match[1]);
}

describe('Progress reports the same amount it paints', () => {
  it('honours a caller-supplied max instead of forcing a 0-100 scale', () => {
    mount(<Progress value={50} max={200} aria-label="Sync" />);
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;

    expect(bar.getAttribute('aria-valuemax')).toBe('200');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    // 50 of 200 is a quarter, and the fill says a quarter too.
    expect(fillPercent(bar)).toBeCloseTo(25, 5);
  });

  it('keeps an absent value indeterminate rather than announcing zero', () => {
    mount(<Progress value={null} aria-label="Sync" />);
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;

    // No number is known, so none is announced.
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('data-state')).toBe('indeterminate');
    const indicator = bar.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!;
    expect(indicator.hasAttribute('data-indeterminate')).toBe(true);
    // And nothing is claimed visually either.
    expect(fillPercent(bar)).toBeCloseTo(0, 5);
  });

  it('clamps an out-of-range value to the effective scale', () => {
    mount(<Progress value={260} max={200} aria-label="Sync" />);
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('200');
    expect(fillPercent(bar)).toBeCloseTo(100, 5);
  });

  it('treats a NaN value as unknown rather than announcing or painting NaN', () => {
    mount(<Progress value={Number.NaN} aria-label="Sync" />);
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;
    const indicator = bar.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!;

    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.outerHTML).not.toContain('NaN');
    expect(bar.getAttribute('data-state')).toBe('indeterminate');
    expect(indicator.hasAttribute('data-indeterminate')).toBe(true);
    expect(indicator.style.transform).not.toContain('NaN');
    expect(fillPercent(bar)).toBeCloseTo(0, 5);
  });

  it('resolves the infinities to the bounds they are nearest', () => {
    mount(<Progress value={Number.POSITIVE_INFINITY} max={200} aria-label="Sync" />);
    let bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('200');
    expect(fillPercent(bar)).toBeCloseTo(100, 5);

    act(() => {
      root.render(<Progress value={Number.NEGATIVE_INFINITY} max={200} aria-label="Sync" />);
    });
    bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('data-state')).not.toBe('indeterminate');
    expect(fillPercent(bar)).toBeCloseTo(0, 5);
  });

  it('falls back to the percentage scale when max is not a usable number', () => {
    for (const max of [Number.NaN, 0, -50, Number.POSITIVE_INFINITY]) {
      mount(<Progress value={25} max={max} aria-label="Sync" />);
      const bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;
      expect(bar.getAttribute('aria-valuemax'), String(max)).toBe('100');
      expect(bar.getAttribute('aria-valuenow'), String(max)).toBe('25');
      expect(bar.outerHTML, String(max)).not.toContain('NaN');
      expect(fillPercent(bar)).toBeCloseTo(25, 5);
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('still reports the default percentage scale unchanged', () => {
    mount(<Progress value={42} aria-label="Workspace sync" />);
    const bar = container.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(fillPercent(bar)).toBeCloseTo(42, 5);
  });
});

describe('focus restoration only claims success when focus actually moved', () => {
  it('falls through a mounted opener that refuses focus', () => {
    mount(
      <div data-focus-shell tabIndex={-1}>
        <button type="button" id="opener" disabled>
          Opener
        </button>
        <button type="button" id="fallback">
          Fallback
        </button>
      </div>,
    );
    const opener = container.querySelector<HTMLElement>('#opener')!;
    const fallback = container.querySelector<HTMLElement>('#fallback')!;

    // The opener is still mounted, so the old code focused it, got refused and
    // reported success with focus left on <body>.
    expect(restoreFocusSafely({ opener, fallbackSelector: '#fallback' })).toBe(true);
    expect(document.activeElement).toBe(fallback);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('falls through to the focus shell when opener and fallback both refuse', () => {
    mount(
      <div data-focus-shell tabIndex={-1}>
        <button type="button" id="opener" disabled>
          Opener
        </button>
        <button type="button" id="fallback" disabled>
          Fallback
        </button>
      </div>,
    );
    const opener = container.querySelector<HTMLElement>('#opener')!;
    const shell = container.querySelector<HTMLElement>('[data-focus-shell]')!;

    expect(restoreFocusSafely({ opener, fallbackSelector: '#fallback' })).toBe(true);
    expect(document.activeElement).toBe(shell);
  });

  it('reports failure instead of a false success when nothing can take focus', () => {
    mount(
      <div>
        <button type="button" id="opener" disabled>
          Opener
        </button>
      </div>,
    );
    const opener = container.querySelector<HTMLElement>('#opener')!;

    expect(restoreFocusSafely({ opener, fallbackSelector: '#absent' })).toBe(false);
    // And it left no stray tabindex behind on the element that refused focus.
    expect(opener.hasAttribute('tabindex')).toBe(false);
  });

  it('still prefers a live opener when that opener can take focus', () => {
    mount(
      <div data-focus-shell tabIndex={-1}>
        <button type="button" id="opener">
          Opener
        </button>
        <button type="button" id="fallback">
          Fallback
        </button>
      </div>,
    );
    const opener = container.querySelector<HTMLElement>('#opener')!;

    expect(restoreFocusSafely({ opener, fallbackSelector: '#fallback' })).toBe(true);
    expect(document.activeElement).toBe(opener);
  });
});
