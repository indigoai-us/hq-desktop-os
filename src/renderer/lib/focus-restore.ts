/**
 * Safe focus restoration for overlays whose opener may unmount while open.
 * Local helper only — not an app-wide modal framework.
 */

export type FocusRestoreTarget = {
  /** Element that opened the overlay, if still known. */
  opener?: Element | null;
  /** Stable selector preferred when the opener is gone (policy fallback). */
  fallbackSelector?: string;
  /** Last-resort focusable shell (e.g. `[data-focus-shell]`). */
  shellFallback?: Element | null;
};

function asFocusable(candidate: Element | null | undefined): HTMLElement | null {
  if (!(candidate instanceof HTMLElement) || !candidate.isConnected) return null;
  if (typeof candidate.focus !== 'function') return null;
  return candidate;
}

/**
 * Restore keyboard focus to the first still-connected candidate.
 * Returns true when focus was moved to a live element.
 */
export function restoreFocusSafely(targets: FocusRestoreTarget = {}): boolean {
  const selectorMatch =
    typeof document !== 'undefined' && targets.fallbackSelector
      ? document.querySelector(targets.fallbackSelector)
      : null;
  const shell =
    targets.shellFallback ??
    (typeof document !== 'undefined' ? document.querySelector('[data-focus-shell]') : null);

  const ordered = [targets.opener, selectorMatch, shell];
  for (const candidate of ordered) {
    const el = asFocusable(candidate);
    if (!el) continue;
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) {
      el.tabIndex = -1;
    }
    el.focus({ preventScroll: true });
    return true;
  }
  return false;
}
