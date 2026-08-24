/**
 * Appearance.
 *
 * Three states, not two: `system` follows the device, `light` and `dark` are
 * explicit overrides. A two-state toggle cannot express "match my device", which
 * is the setting most people actually want and the one an OS-level schedule
 * drives — collapsing it would break night mode switching itself over at dusk.
 *
 * The preference is read once at start and held in context. Reading storage per
 * component would make every themed view do async work on mount and flash the
 * wrong palette on the way through.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { Colors, type Theme } from '@/constants/theme';
import { getAppearance, setAppearance, type Appearance } from '@/data/settings';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AppearanceContext = {
  theme: Theme;
  isDark: boolean;
  /** What the user chose — `system` means "whatever the device says". */
  preference: Appearance;
  setPreference: (next: Appearance) => void;
};

const Context = createContext<AppearanceContext | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<Appearance>('system');

  useEffect(() => {
    // Async, so this resolves after the effect rather than setting state during
    // it — the synchronous form trips `set-state-in-effect`.
    void getAppearance().then(setPreferenceState);
  }, []);

  const setPreference = useCallback((next: Appearance) => {
    setPreferenceState(next);
    void setAppearance(next);
  }, []);

  const isDark = preference === 'system' ? system === 'dark' : preference === 'dark';

  const value = useMemo(
    () => ({
      theme: isDark ? Colors.dark : Colors.light,
      isDark,
      preference,
      setPreference,
    }),
    [isDark, preference, setPreference],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * Falls back to the light palette rather than throwing when no provider is above
 * it. A missing provider should render a readable screen, not a blank one.
 */
export function useTheme(): Theme {
  return useContext(Context)?.theme ?? Colors.light;
}

/** Explicit accessor for the rare case a component must know the mode. */
export function useIsDark(): boolean {
  return useContext(Context)?.isDark ?? false;
}

/** For the Settings control — the only place that needs to write the preference. */
export function useAppearance(): AppearanceContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useAppearance must be used inside <AppearanceProvider>.');
  return ctx;
}
