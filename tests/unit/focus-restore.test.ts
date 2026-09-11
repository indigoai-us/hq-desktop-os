/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { restoreFocusSafely } from '../../src/renderer/lib/focus-restore';

describe('restoreFocusSafely', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('restores focus to a still-connected opener', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.append(opener);
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();

    expect(restoreFocusSafely({ opener })).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('skips a disconnected opener and uses the fallback selector', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Gone';
    document.body.append(opener);

    const fallback = document.createElement('button');
    fallback.setAttribute('data-testid', 'fallback');
    document.body.append(fallback);

    opener.remove();
    expect(opener.isConnected).toBe(false);

    expect(
      restoreFocusSafely({
        opener,
        fallbackSelector: '[data-testid="fallback"]',
      }),
    ).toBe(true);
    expect(document.activeElement).toBe(fallback);
  });

  it('falls back to the focus shell when opener and selector are gone', () => {
    const shell = document.createElement('main');
    shell.setAttribute('data-focus-shell', '');
    document.body.append(shell);

    expect(restoreFocusSafely({ opener: null, fallbackSelector: '#missing' })).toBe(true);
    expect(document.activeElement).toBe(shell);
    expect(shell.tabIndex).toBe(-1);
  });

  it('returns false when no live focusable target exists', () => {
    expect(restoreFocusSafely({ opener: null, fallbackSelector: '#nope' })).toBe(false);
  });
});
