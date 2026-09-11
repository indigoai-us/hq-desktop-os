/**
 * Theme preference persistence and resolution.
 *
 * The blocking `public/theme-init.js` mirrors this logic so the first paint
 * already matches the saved preference without inline scripts (CSP script-src
 * stays `'self'`). Keep both implementations behaviourally aligned.
 */

export const THEME_STORAGE_KEY = 'hq-desktop-os.theme-preference';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type ResolvedAppearance = 'light' | 'dark';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Corrupt, empty, or foreign storage values fall back to system. */
export function parseStoredTheme(raw: string | null | undefined): ThemePreference {
  if (raw == null) return 'system';
  const trimmed = raw.trim();
  if (!isThemePreference(trimmed)) return 'system';
  return trimmed;
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null | undefined): ThemePreference {
  if (!storage) return 'system';
  try {
    return parseStoredTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Unavailable or throwing storage (private mode, quota, policy) → system.
    return 'system';
  }
}

export function writeStoredTheme(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  preference: ThemePreference,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function resolveAppearance(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedAppearance {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

export function systemPrefersDark(
  media: Pick<MediaQueryList, 'matches'> | null | undefined,
): boolean {
  if (!media) return false;
  try {
    return Boolean(media.matches);
  } catch {
    return false;
  }
}

/**
 * Apply preference to the document. `data-theme` stores the user preference
 * (including `system`); `color-scheme` follows the resolved appearance so
 * native form controls match.
 */
export function applyThemeToDocument(
  root:
    | {
        setAttribute: (name: string, value: string) => void;
        style: { colorScheme: string };
      }
    | null
    | undefined,
  preference: ThemePreference,
  appearance: ResolvedAppearance,
): void {
  if (!root) return;
  root.setAttribute('data-theme', preference);
  root.style.colorScheme = appearance;
}

/**
 * Roving-focus target for a radiogroup key press, or null when the key is not
 * a group navigation key. A declared `role="radio"` group has to answer arrow,
 * Home and End keys; without this a keyboard user can focus the group but
 * never reach the other options.
 */
export function nextThemeIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const from = current < 0 ? 0 : current % count;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (from + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (from + count - 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
