/**
 * Settings — operator identity and library portability.
 *
 * No credential fields, by design. The Gemini key is read from the server's
 * environment inside `/api/parse` and never leaves it; there is nothing for a user
 * to paste here, and nothing here for a compromised client to leak.
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/chip';
import { Card, PageHeader, Row, Screen, Section } from '@/components/ui/layout';
import { SegmentedControl, type Segment } from '@/components/ui/segmented';
import { Text } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { clearAll, exportLibrary, listContracts } from '@/data/repository';
import { reseedReference } from '@/data/seed';
import { getOperator, setOperator } from '@/data/settings';
import { useAppearance, useTheme } from '@/hooks/use-theme';
import type { Appearance } from '@/data/settings';

const APPEARANCE_SEGMENTS: Segment<Appearance>[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const { preference, setPreference } = useAppearance();

  const [operator, setOperatorState] = useState('');
  const [count, setCount] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setOperatorState(await getOperator());
      setCount((await listContracts()).length);
    })();
  }, []);

  const flash = useCallback((message: string) => {
    setSaved(message);
    setTimeout(() => setSaved(null), 2200);
  }, []);

  const onSave = useCallback(async () => {
    await setOperator(operator);
    flash('Saved');
  }, [operator, flash]);

  const onExport = useCallback(async () => {
    const json = await exportLibrary();
    await Clipboard.setStringAsync(json);
    flash('Library JSON copied to clipboard');
  }, [flash]);

  /**
   * The sample contract is opt-in rather than seeded on launch. Auto-loading it
   * meant a fresh install opened showing a customer nobody had imported, which
   * misrepresents an empty library as a populated one.
   */
  const onLoadSample = useCallback(async () => {
    await reseedReference();
    setCount((await listContracts()).length);
    flash('Sample contracts added');
  }, [flash]);

  /**
   * Destructive, so it confirms first — and the confirm has to be the platform's.
   *
   * `Alert.alert` is a silent no-op on react-native-web: it neither prompts nor
   * throws, so the previous implementation made Delete everything a dead button
   * on the platform the app actually runs on. The old feature-test for it
   * (`'alert' in Alert`) never matched either, because the web shim exports no
   * keys at all — so the fallback it guarded was unreachable.
   */
  const onReset = useCallback(() => {
    const message =
      'This removes every contract, every decision recorded against them, and every ' +
      'invoice generated from them. It cannot be undone.';

    const wipe = async () => {
      await clearAll();
      setCount(0);
      flash('Library cleared');
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Delete everything?\n\n${message}`)) void wipe();
      return;
    }

    Alert.alert('Delete everything?', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void wipe() },
    ]);
  }, [flash]);

  return (
    <>
      <Screen>
        <PageHeader title="Settings" subtitle="Operator identity and library management" />

        <Section
          title="Operator"
          footer="Recorded against every finding you resolve and every policy field you decide, so the audit log names a person rather than 'someone'."
        >
          <Card padded={false}>
            <View style={styles.field}>
              <Text variant="footnote" color="textSecondary">
                Your name
              </Text>
              <TextInput
                value={operator}
                onChangeText={setOperatorState}
                placeholder="Recorded against every decision"
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="words"
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.surfaceSunken },
                ]}
              />
            </View>
          </Card>
          <Button title="Save" onPress={onSave} style={styles.save} />
          {saved && (
            <Text variant="footnote" style={{ color: theme.success, marginTop: Spacing.two }}>
              {saved}
            </Text>
          )}
        </Section>

        <Section
          title="Appearance"
          footer="System follows your device, so a night-mode schedule switches the app over with everything else. Light and Dark override it."
        >
          <SegmentedControl
            segments={APPEARANCE_SEGMENTS}
            value={preference}
            onChange={setPreference}
          />
        </Section>

        <Section
          title="Library"
          footer={
            'Contracts are stored in this browser only. Export copies the whole library as JSON so ' +
            'it can be moved to another machine or checked in as a fixture.'
          }
        >
          <Card padded={false}>
            <Row label="Stored contracts" value={String(count)} />
            <Row
              label="Load sample contracts"
              detail="Adds both mock order forms — one defective, one clean — no API key needed"
              onPress={onLoadSample}
            />
            <Row label="Export as JSON" detail="Copies to clipboard" onPress={onExport} />
            <Row
              label="Delete everything"
              detail="Removes all contracts, their decisions, and their invoices"
              onPress={onReset}
              last
            />
          </Card>
        </Section>

        <Section title="About">
          <Card padded={false}>
            <Row label="Extraction model" value="Gemini (server-configured)" />
            <Row label="Detection" value="Rules + model review" last />
          </Card>
        </Section>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  field: { padding: Spacing.three, gap: Spacing.one },
  input: {
    minHeight: 44,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    fontSize: 17,
  },
  save: { marginTop: Spacing.three },
});
