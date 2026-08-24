/**
 * Home — the entry point.
 *
 * The app's front door. Light ground, dark chrome: the same relationship Hologram's
 * own platform uses, where a navy sidebar frames a white working area. The title
 * sits directly on the page rather than inside a coloured slab — a filled block
 * behind a heading adds weight without adding meaning, and at this size the type
 * carries the page on its own.
 *
 * The lime rule above the title is the only saturated mark here. Restraint is what
 * makes it read as a brand signal rather than decoration; used on all three cards
 * as well, it would stop meaning anything.
 *
 * Deliberately not a dashboard. Numbers here would be a second, competing summary
 * of what the Contracts screen already answers properly, and would go stale the
 * moment the library changed. The home screen routes; it does not report.
 */

import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen, elevation } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Hologram, Radius, Spacing } from '@/constants/theme';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useIsDark, useTheme } from '@/hooks/use-theme';

/* -------------------------------------------------------------------------- */

type Destination = {
  href: '/contracts' | '/import' | '/invoices' | '/settings';
  label: string;
  description: string;
  glyph: string;
};

const DESTINATIONS: Destination[] = [
  {
    href: '/contracts',
    label: 'Contracts',
    description: 'View and manage existing contracts',
    glyph: '◧',
  },
  {
    href: '/import',
    label: 'Upload',
    description: 'Import a new contract',
    glyph: '↑',
  },
  {
    href: '/invoices',
    label: 'Invoices',
    description: 'Every invoice across all contracts',
    glyph: '§',
  },
  {
    href: '/settings',
    label: 'Settings',
    description: 'Manage your name and the library',
    glyph: '⚙',
  },
];

/* -------------------------------------------------------------------------- */

function ActionCard({ destination, compact }: { destination: Destination; compact: boolean }) {
  const theme = useTheme();
  const isDark = useIsDark();
  const [hovered, setHovered] = useState(false);

  return (
    <Link href={destination.href} asChild>
      <Pressable
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={StyleSheet.flatten([
          styles.card,
          compact ? styles.cardRow : styles.cardStack,
          {
            backgroundColor: theme.surface,
            borderColor: hovered ? Hologram.blue : theme.separatorOpaque,
          },
          elevation(theme.shadow, hovered ? 2 : 1),
        ])}
      >
        {/* The glyph sits in ink, not lime. Three saturated blocks in a row would
            read as three warnings; the accent belongs on one thing per screen.
            In dark mode the ink and the card surface are nearly the same value, so
            the block steps up to `inkRaised` to stay visible at all. */}
        <View
          style={[
            styles.glyphBox,
            { backgroundColor: isDark ? Hologram.inkRaised : Hologram.ink },
            isDark && { borderWidth: 1, borderColor: theme.separatorOpaque },
          ]}
        >
          <Text variant="title3" style={{ color: Hologram.lime }}>
            {destination.glyph}
          </Text>
        </View>

        <View style={[styles.cardText, compact ? styles.cardTextRow : styles.cardTextStack]}>
          <Text variant="headline">{destination.label}</Text>
          <Text variant="footnote" color="textSecondary">
            {destination.description}
          </Text>
        </View>

        {/* Sits on the baseline of the card rather than beside the text, so the
            three cards align on a shared bottom edge whatever their copy length. */}
        <Text
          variant="footnote"
          weight="600"
          style={{ color: hovered ? Hologram.blue : theme.textTertiary }}
        >
          →
        </Text>
      </Pressable>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

export default function HomeScreen() {
  const { isCompact } = useBreakpoint();

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={[styles.heroRule, { backgroundColor: Hologram.lime }]} />
        <Text variant={isCompact ? 'title1' : 'largeTitle'} weight="700">
          Hologram Contract Manager
        </Text>
        {/* Smaller and lighter than the title — an attribution, not a subtitle
            competing with it for the same attention. */}
        <Text variant="subhead" weight="400" color="textSecondary">
          By Jose Robinson
        </Text>
      </View>

      <Text variant="caption2" color="textTertiary" style={styles.eyebrow}>
        WHERE TO
      </Text>

      <View style={[styles.cards, !isCompact && styles.cardsWide]}>
        {DESTINATIONS.map((destination) => (
          /* Each card sits in a half-width cell rather than carrying the gutter
             itself. A percentage width plus a flex `gap` overflows the row, because
             the gap is added on top of 100% — the cell's padding is the gutter. */
          <View
            key={destination.href}
            style={!isCompact ? styles.cell : undefined}
          >
            <ActionCard destination={destination} compact={isCompact} />
          </View>
        ))}
      </View>

    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  /* Generous and asymmetric: more air above the title than below it, so the block
     sits optically centred rather than measured centred. */
  hero: { paddingTop: Spacing.six, paddingBottom: Spacing.five, gap: Spacing.one },
  heroRule: { width: 40, height: 3, borderRadius: Radius.pill, marginBottom: Spacing.four },

  eyebrow: { letterSpacing: 1.2, marginBottom: Spacing.two, paddingHorizontal: Spacing.one },

  cards: { gap: Spacing.three },
  /* 2x2 rather than one row of four. Four across leaves each card too narrow for
     its description, and a single row of four reads as a toolbar; a square grid
     gives every card the same weight. No `gap` here — the cells carry it. */
  cardsWide: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  cell: { width: '50%', padding: Spacing.two },

  /* The card changes axis with the space it is given, rather than shrinking.
     Stacked in the desktop grid, so each description gets the full column width
     and the longest no longer wraps while its neighbours do not. In a single
     narrow column that arrangement just makes four tall boxes and pushes the last
     below the fold, so compact goes back to a row. */
  card: {
    flex: 1,
    padding: Spacing.four,
    borderRadius: Radius.large,
    borderWidth: 1,
  },
  cardStack: { alignItems: 'flex-start', gap: Spacing.three },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  glyphBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { gap: 2 },
  cardTextStack: { minHeight: 46 },
  cardTextRow: { flex: 1 },

});
