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
 * Restore keyboard focus to the first candidate that actually accepts it.
 *
 * Calling `focus()` is a request, not a result: a disabled, `inert`, hidden or
 * otherwise unfocusable element leaves the active element exactly where it was,
 * usually `<body>`. So each candidate is verified after the call and the search
 * continues when focus did not land, which is what keeps a keyboard user off
 * `<body>` when the opener is still mounted but no longer focusable.
 *
 * Returns true only when focus is genuinely on a live element.
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
    const added = el.tabIndex < 0 && !el.hasAttribute('tabindex');
    if (added) el.tabIndex = -1;
    el.focus({ preventScroll: true });
    if (typeof document === 'undefined') return true;
    const active = document.activeElement;
    if (active === el || el.contains(active)) return true;
    // Focus was refused. Undo the tabindex we added so the DOM is left as found.
    if (added) el.removeAttribute('tabindex');
  }
  return false;
}
