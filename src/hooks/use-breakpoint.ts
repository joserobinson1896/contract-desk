/**
 * Viewport breakpoints.
 *
 * The app runs on a phone and in a desktop browser, and those want genuinely
 * different layouts — not the same column stretched. A phone-shaped column on a
 * 1900px screen leaves most of the window empty, which is what this exists to fix.
 */

import { useWindowDimensions } from 'react-native';

export type Breakpoint = 'compact' | 'medium' | 'wide';

export function useBreakpoint(): {
  breakpoint: Breakpoint;
  isCompact: boolean;
  isWide: boolean;
  width: number;
  /** Columns for the stat grid — 2 on a phone, 4 once there is room. */
  statColumns: number;
  /** Content column cap. Wide screens get more, but never edge-to-edge: long
   *  measures are hard to read regardless of how much window there is. */
  maxWidth: number;
} {
  const { width } = useWindowDimensions();

  const breakpoint: Breakpoint = width < 700 ? 'compact' : width < 1100 ? 'medium' : 'wide';

  return {
    breakpoint,
    isCompact: breakpoint === 'compact',
    isWide: breakpoint === 'wide',
    width,
    statColumns: breakpoint === 'compact' ? 2 : 4,
    maxWidth: breakpoint === 'wide' ? 1100 : breakpoint === 'medium' ? 860 : 640,
  };
}
