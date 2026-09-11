import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  THEME_PREFERENCES,
  applyThemeToDocument,
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

/** Native select provides keyboard and assistive-technology behavior. */
export function ThemeControl({ className }: { className?: string }) {
  const { preference, setPreference, storageAvailable } = useTheme();
  return <div className={cn('hq-theme-control', className)} data-testid="theme-control">
    <label htmlFor="appearance">Appearance</label>
    <select id="appearance" value={preference} onChange={(event) => setPreference(event.target.value as ThemePreference)}>
      {THEME_PREFERENCES.map((option) => <option key={option} value={option}>{option === 'system' ? 'Use system setting' : option === 'light' ? 'Light' : 'Dark'}</option>)}
    </select>
    {!storageAvailable && <p role="status" data-testid="theme-storage-warning">Your appearance choice applies until you close the app. It could not be saved.</p>}
  </div>;
}
