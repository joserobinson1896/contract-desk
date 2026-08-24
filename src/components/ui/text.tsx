/**
 * Typed text.
 *
 * Every string in the app goes through here, so the iOS type scale stays the only
 * source of sizes and weights. Ad-hoc `fontSize` in a screen is the thing this
 * exists to prevent.
 */

import { StyleSheet, Text as RNText, type TextProps } from 'react-native';

import { Fonts, Type, type ThemeColor, type TypeStyle } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AppTextProps = TextProps & {
  variant?: TypeStyle;
  color?: ThemeColor;
  /** Tabular figures — use for anything in a column that should align. */
  numeric?: boolean;
  mono?: boolean;
  weight?: '400' | '500' | '600' | '700';
};

export function Text({
  variant = 'body',
  color = 'text',
  numeric,
  mono,
  weight,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const base = Type[variant];

  return (
    <RNText
      style={[
        {
          color: theme[color],
          fontSize: base.fontSize,
          lineHeight: base.lineHeight,
          fontWeight: weight ?? (base.fontWeight as AppTextProps['weight']),
          letterSpacing: base.letterSpacing,
        },
        mono && { fontFamily: Fonts.mono },
        numeric && styles.numeric,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  numeric: {
    fontVariant: ['tabular-nums'],
  },
});
