/**
 * Raw config — the machine-readable half.
 *
 * This is the artefact a billing platform or CRM would actually consume, so it is
 * shown verbatim rather than prettified into something that no longer matches what
 * would be exported.
 *
 * Rendered through <Text>, never interpreted as markup. Contract content is
 * untrusted input, and this is the one screen that displays it at length.
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/chip';
import { Card, Row, Section } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import type { ContractRecord } from '@/domain/record';
import { useTheme } from '@/hooks/use-theme';

export function ConfigJsonPane({ record }: { record: ContractRecord }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const json = useMemo(() => JSON.stringify(record.config, null, 2), [record.config]);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [json]);

  const decided = Object.values(record.policy.setBy).filter((m) => m.source === 'user').length;

  return (
    <>
      <Section
        title="Extraction"
        footer="Token counts and timing for the extraction and review calls that produced this config."
      >
        <Card padded={false}>
          <Row label="Model" value={record.extraction.model ?? 'Transcribed fixture'} />
          <Row
            label="Review pass"
            value={record.extraction.reviewPassCompleted ? 'Completed' : 'Did not run'}
          />
          <Row
            label="Duration"
            value={
              record.extraction.durationMs ? `${(record.extraction.durationMs / 1000).toFixed(1)}s` : '—'
            }
          />
          <Row
            label="Tokens"
            value={
              record.extraction.inputTokens !== null
                ? `${record.extraction.inputTokens.toLocaleString()} in · ${(record.extraction.outputTokens ?? 0).toLocaleString()} out`
                : '—'
            }
          />
          <Row label="Policy decisions recorded" value={String(decided)} last />
        </Card>
      </Section>

      <Section
        title="Billing configuration"
        action={
          <Button
            title={copied ? 'Copied' : 'Copy JSON'}
            variant="plain"
            onPress={copy}
            style={styles.copy}
          />
        }
        footer="What a billing platform or CRM would consume. Nobody should reopen the PDF to answer a billing question once this exists."
      >
        <Card padded={false}>
          {/*
            Horizontal only, and deliberately without a maxHeight. A horizontal
            ScrollView scrolls the X axis and clips the Y one (overflow-y: hidden on
            web), so any height cap here silently hides the tail of the config with
            no way to scroll to it. Vertical scrolling belongs to the page.
          */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            style={[styles.codeWrap, { backgroundColor: theme.surfaceSunken }]}
          >
            <View style={styles.code}>
              <Text variant="caption" mono>
                {json}
              </Text>
            </View>
          </ScrollView>
        </Card>
      </Section>

      {record.auditLog.length > 0 && (
        <Section title="Audit log" footer="Every decision made against this contract, in order.">
          <Card padded={false}>
            {record.auditLog
              .slice()
              .reverse()
              .map((entry, i) => (
                <Row
                  key={`${entry.at}-${i}`}
                  label={entry.summary}
                  detail={`${entry.by} · ${new Date(entry.at).toLocaleString()}`}
                  last={i === record.auditLog.length - 1}
                />
              ))}
          </Card>
        </Section>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  copy: { minHeight: 32, paddingHorizontal: 0 },
  codeWrap: { borderRadius: Radius.large },
  code: { padding: Spacing.three },
});
