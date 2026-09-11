/**
 * Blocking, same-origin theme bootstrap.
 * Loaded as a classic script before the module graph so the first paint uses
 * the saved preference. Must stay free of remote URLs and inline evaluation.
 * Behaviour mirrors src/renderer/lib/theme.ts.
 */
(function bootstrapTheme(global) {
  var STORAGE_KEY = 'hq-desktop-os.theme-preference';
  var root = global.document && global.document.documentElement;
  if (!root) return;

  function parseStored(raw) {
    if (raw == null) return 'system';
    var trimmed = String(raw).trim();
    if (trimmed === 'system' || trimmed === 'light' || trimmed === 'dark') return trimmed;
    return 'system';
  }

  function readPreference() {
    try {
      if (!global.localStorage) return 'system';
      return parseStored(global.localStorage.getItem(STORAGE_KEY));
    } catch {
      return 'system';
    }
  }

  function systemDark() {
    try {
      return Boolean(
        global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches,
      );
    } catch {
      return false;
    }
  }

  function resolveAppearance(preference) {
    if (preference === 'light') return 'light';
    if (preference === 'dark') return 'dark';
    return systemDark() ? 'dark' : 'light';
  }

  var preference = readPreference();
  var appearance = resolveAppearance(preference);
  root.setAttribute('data-theme', preference);
  root.style.colorScheme = appearance;
})(globalThis);
