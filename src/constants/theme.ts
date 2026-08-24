/**
 * Design tokens.
 *
 * Modelled on the iOS system palette and type scale, because the app reads as a
 * native tool rather than a web dashboard in a phone frame. Native niceties
 * (Liquid Glass, SF Symbols, haptics) layer on top via `Platform.select`, but
 * nothing here depends on them — the same tokens drive the web build.
 *
 * `Colors.light` / `Colors.dark` keep the shape `useTheme()` expects, so the
 * template's `ThemedText` / `ThemedView` continue to work unchanged.
 */

import '@/global.css';

import { Platform } from 'react-native';

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Declared explicitly rather than inferred from the light palette. Inferring it
 * would give each colour a string-literal type, and the two palettes would then
 * fail to unify — `useTheme()` returns one or the other.
 */
export type Theme = {
  text: string;
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  textSecondary: string;
  textTertiary: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  separator: string;
  separatorOpaque: string;
  accent: string;
  accentMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  advisory: string;
  advisoryMuted: string;
  shadow: string;
};

export const Colors: { light: Theme; dark: Theme } = {
  light: {
    /**
     * Near-black carrying a trace of the brand navy rather than a neutral grey.
     * True black reads harsh at body sizes; tinting the ink toward `Hologram.ink`
     * is what makes the neutrals feel drawn from one family instead of assembled.
     * 18.3:1 on white.
     */
    text: '#0F1424',
    /** Cool ground, one step off white. Crisp cards need something to sit on. */
    background: '#F4F5F9',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E8EAF2',
    /** 6.2:1 on white. */
    textSecondary: '#5A6076',
    /**
     * 4.5:1 on white — raised from the old #9A9AA0, which measured 2.8:1 and put
     * captions and metadata below the readable floor.
     */
    textTertiary: '#6F7689',
    /** Card / row surface sitting on `background`. */
    surface: '#FFFFFF',
    /** A second elevation, for nested groups. */
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#F1F3F8',

    /** Soft hairlines — structure should be felt, not drawn. */
    separator: 'rgba(15,20,36,0.08)',
    separatorOpaque: '#DFE2EC',

    /** Hologram's action blue. 7.1:1 on white, and 7.1:1 white-on-it. */
    accent: '#2C41E0',
    accentMuted: 'rgba(44,65,224,0.10)',

    /**
     * Verified / passing, pulled toward the brand lime but darkened until it is
     * legible as text: 7.2:1 on white. The lime itself is 1.3:1 there and can only
     * ever be a filled block behind dark text, never a foreground.
     */
    success: '#43600A',
    successMuted: 'rgba(195,245,60,0.30)',
    /**
     * Non-blocking findings.
     *
     * Stepped to #8A6100 rather than the iOS orange: against `danger` the original
     * measured ΔE 10.4 for normal vision — below the 15 floor, meaning full-colour
     * readers struggled to tell a blocking chip from a non-blocking one. This step
     * measures 18.4. Under red-green CVD the two remain close (no warm hue
     * separates from red), which is why every severity chip carries a text label
     * and severity is never encoded by colour alone.
     */
    warning: '#8A6100',
    warningMuted: 'rgba(214,152,0,0.18)',
    /** Blocking findings. */
    danger: '#D70015',
    dangerMuted: 'rgba(255,59,48,0.12)',
    /** Model-sourced findings — deliberately cooler than a rule finding. */
    advisory: '#8944AB',
    advisoryMuted: 'rgba(175,82,222,0.10)',

    /** Diffuse and low-opacity — depth should be sensed, not seen. */
    shadow: 'rgba(15,20,36,0.07)',
  },

  /**
   * Kept in step with light rather than left on the old iOS values — appearance
   * switching is off, but a dark palette that has drifted out of brand is not
   * "kept and validated", it is a trap for whoever turns it back on.
   */
  dark: {
    text: '#FFFFFF',
    background: '#07090F',
    backgroundElement: '#141826',
    backgroundSelected: '#232838',
    textSecondary: '#A8AEC0',

    textTertiary: '#858BA0',
    surface: '#141826',
    surfaceRaised: '#1F2434',
    surfaceSunken: '#0B0E17',

    separator: 'rgba(160,170,200,0.16)',
    separatorOpaque: '#2C3244',

    /** Lifted off the brand blue, which is too dark to read on a dark ground.
     *  5.7:1 on `surface`, against 4.7:1 for the iOS blue it replaces. */
    accent: '#7C8BFF',
    accentMuted: 'rgba(124,139,255,0.20)',

    /** The brand lime works as a foreground here — 13.3:1 on `surface`. */
    success: '#C3F53C',
    successMuted: 'rgba(195,245,60,0.18)',
    warning: '#FF9F0A',
    warningMuted: 'rgba(255,159,10,0.20)',
    danger: '#FF453A',
    dangerMuted: 'rgba(255,69,58,0.20)',
    advisory: '#BF5AF2',
    advisoryMuted: 'rgba(191,90,242,0.20)',

    shadow: 'rgba(0,0,0,0.45)',
  },
};

export type ThemeColor = keyof Theme;

/* -------------------------------------------------------------------------- */
/* Typography                                                                  */
/* -------------------------------------------------------------------------- */

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/**
 * The text-style scale, so weights and leading stay consistent app-wide.
 *
 * `letterSpacing` is optical, not decorative. Type set at one tracking value
 * across every size looks loose at display sizes and cramped at caption sizes,
 * because apparent letter-fit scales with the type, not with the em. Large sizes
 * are therefore tightened and small sizes opened slightly — the single change
 * that most separates typography that was set from typography that was defaulted.
 */
export const Type = {
  largeTitle: { fontSize: 40, lineHeight: 46, fontWeight: '700', letterSpacing: -0.8 },
  title1: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.5 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400', letterSpacing: 0 },
  callout: { fontSize: 16, lineHeight: 22, fontWeight: '400', letterSpacing: 0 },
  subhead: { fontSize: 15, lineHeight: 21, fontWeight: '400', letterSpacing: 0 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0.05 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0.1 },
  caption2: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.3 },
} as const;

export type TypeStyle = keyof typeof Type;

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 6,
  /** Standard iOS grouped-list corner. */
  medium: 10,
  large: 14,
  xlarge: 20,
  pill: 999,
} as const;

export const Hairline = Platform.select({ ios: 0.33, default: 1 });

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 760;

/* -------------------------------------------------------------------------- */
/* Hologram brand                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Hologram's platform palette, used on the home screen so the entry point reads
 * as part of their product rather than a generic tool.
 *
 * Kept separate from `Theme` on purpose. These are brand constants, not semantic
 * roles — `accent` still means "the interactive colour" everywhere else in the
 * app, and nothing here overrides it. Only the home screen reaches for these.
 *
 * Contrast, measured against the surface each one is actually used on:
 *   lime on ink      17.4:1   — the accent marks and rules
 *   white on ink     16.8:1   — the title
 *   onInkMuted/ink    7.1:1   — the byline, above the 4.5 floor for body text
 *   white on blue     8.6:1   — the primary card
 * Lime is never used for text on white; at 1.4:1 it would be unreadable, so it
 * appears there only as a solid block behind near-black glyphs.
 */
export const Hologram = {
  /** Sidebar navy from the platform chrome. */
  ink: '#151A2E',
  inkRaised: '#1F2540',
  /** The signal colour — status pills, connection lines. */
  lime: '#C3F53C',
  /** Near-black for text sitting on lime. */
  onLime: '#0B0E1A',
  /** Primary action blue, as on "Manage SIM". */
  blue: '#2C41E0',
  onInk: '#FFFFFF',
  onInkMuted: 'rgba(255,255,255,0.66)',
} as const;

/* -------------------------------------------------------------------------- */
/* Semantic mapping                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Chart palette.
 *
 * Charts use exactly two marks: the base series, and one defect colour marking
 * bands the rule engine flagged. Validated as a categorical pair under CIEDE2000
 * with Viénot–Brettel–Mollon dichromat simulation, across normal, protan, deutan
 * and tritan vision. Worst case ΔE 46.1 (light) and 44.2 (dark) — both far clear
 * of the 15 floor, and the separation only widens under CVD, since a blue and a
 * red diverge further once the red-green axis collapses.
 *
 * Deliberately NOT three colours. Putting `warning` beside `danger` in a plot
 * would encode severity by two warm hues that red-green CVD collapses into one;
 * severity distinctions live in text-labelled chips instead, never in a mark.
 */
export function chartPalette(theme: Theme) {
  return {
    series: theme.accent,
    /** Bands the engine flagged. Always accompanied by a label — never colour alone. */
    defect: theme.danger,
    grid: theme.separator,
    axis: theme.textTertiary,
    surface: theme.surface,
  };
}

/** Flag severity → colour role. Centralised so the register, dashboard, and
 *  library can never disagree about what "blocking" looks like. */
export function severityColor(
  theme: Theme,
  severity: 'blocking' | 'non_blocking',
  source: 'rule' | 'model' = 'rule',
): { fg: string; bg: string } {
  if (source === 'model') return { fg: theme.advisory, bg: theme.advisoryMuted };
  return severity === 'blocking'
    ? { fg: theme.danger, bg: theme.dangerMuted }
    : { fg: theme.warning, bg: theme.warningMuted };
}

/**
 * Contract status → colour role.
 *
 * A progression, not four arbitrary hues: neutral while nothing has happened,
 * the action colour once released, amber while money is owed, the brand lime when
 * it is settled.
 *
 * Colour is the second encoding here, never the first. Worst pairwise separation
 * is ΔE 3.5 (draft/paid under tritanopia, light) — far under the 15 floor, which
 * means these four are NOT reliably distinguishable by hue. Every status badge
 * therefore carries its text label, exactly as severity chips do. Never render one
 * as a bare dot. Run `node scratchpad/validate-status.mjs`.
 */
export function statusColor(
  theme: Theme,
  status: 'draft' | 'active' | 'invoiced' | 'paid',
): { fg: string; bg: string } {
  switch (status) {
    case 'active':
      return { fg: theme.accent, bg: theme.accentMuted };
    case 'invoiced':
      return { fg: theme.warning, bg: theme.warningMuted };
    case 'paid':
      return { fg: theme.success, bg: theme.successMuted };
    case 'draft':
    default:
      return { fg: theme.textSecondary, bg: theme.surfaceSunken };
  }
}

/** Contract lifecycle → colour role. */
export function lifecycleColor(
  theme: Theme,
  lifecycle: 'extracted' | 'in_review' | 'verified' | 'live',
): { fg: string; bg: string } {
  switch (lifecycle) {
    case 'live':
      return { fg: theme.accent, bg: theme.accentMuted };
    case 'verified':
      return { fg: theme.success, bg: theme.successMuted };
    case 'in_review':
      return { fg: theme.warning, bg: theme.warningMuted };
    case 'extracted':
    default:
      return { fg: theme.textSecondary, bg: theme.surfaceSunken };
  }
}
