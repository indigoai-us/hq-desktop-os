import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  THEME_PREFERENCES,
  applyThemeToDocument,
  nextThemeIndex,
  readStoredTheme,
  resolveAppearance,
  systemPrefersDark,
  writeStoredTheme,
  type ResolvedAppearance,
  type ThemePreference,
} from './lib/theme';
import { cn } from './lib/utils';

type ThemeContextValue = {
  preference: ThemePreference;
  appearance: ResolvedAppearance;
  setPreference: (next: ThemePreference) => void;
  storageAvailable: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemMedia(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredTheme(typeof window === 'undefined' ? null : getLocalStorage()),
  );
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark(getSystemMedia()));
  const [storageAvailable, setStorageAvailable] = useState(true);

  const appearance = useMemo(
    () => resolveAppearance(preference, systemDark),
    [preference, systemDark],
  );

  useEffect(() => {
    applyThemeToDocument(document.documentElement, preference, appearance);
  }, [preference, appearance]);

  useEffect(() => {
    const media = getSystemMedia();
    if (!media) return;

    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };

    media.addEventListener('change', onChange);
    setSystemDark(media.matches);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    const wrote = writeStoredTheme(getLocalStorage(), next);
    setStorageAvailable(wrote);
  }, []);

  const value = useMemo(
    () => ({ preference, appearance, setPreference, storageAvailable }),
    [preference, appearance, setPreference, storageAvailable],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme requires ThemeProvider');
  return value;
}

function StrokeIcon({ kind }: { kind: ThemePreference }) {
  if (kind === 'light') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="3.25" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
      </svg>
    );
  }
  if (kind === 'dark') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M13.2 10.1A5.5 5.5 0 0 1 5.9 2.8 5.75 5.75 0 1 0 13.2 10.1Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2.5" y="3.5" width="11" height="8" rx="0" />
      <path d="M5.5 13.5h5" />
    </svg>
  );
}

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** Accessible theme preference control. No app identity or window chrome. */
export function ThemeControl({ className }: { className?: string }) {
  const { preference, setPreference, storageAvailable } = useTheme();
  const group = useRef<HTMLDivElement | null>(null);

  // Arrow / Home / End move selection and focus together, as a radiogroup must.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = nextThemeIndex(
      THEME_PREFERENCES.indexOf(preference),
      event.key,
      THEME_PREFERENCES.length,
    );
    if (target === null) return;
    event.preventDefault();
    setPreference(THEME_PREFERENCES[target]!);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[target]?.focus();
  };

  return (
    <fieldset className={cn('hq-theme-control', className)} data-testid="theme-control">
      <legend>Appearance</legend>
      <div
        ref={group}
        role="radiogroup"
        aria-label="Appearance"
        className="flex flex-wrap gap-1"
        onKeyDown={onKeyDown}
      >
        {THEME_PREFERENCES.map((option) => {
          const checked = preference === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={checked}
              // Roving tabindex: the group is one tab stop, arrows move inside it.
              tabIndex={checked ? 0 : -1}
              data-testid={`theme-option-${option}`}
              className="hq-theme-option"
              onClick={() => setPreference(option)}
            >
              <StrokeIcon kind={option} />
              {LABELS[option]}
            </button>
          );
        })}
      </div>
      {storageAvailable ? null : (
        <p className="hq-status" data-tone="warning" role="status" data-testid="theme-storage-warning">
          Theme choice could not be saved on this device. It applies for this session only.
        </p>
      )}
    </fieldset>
  );
}
