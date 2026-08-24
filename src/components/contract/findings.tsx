/**
 * Findings — the QA register, and the go-live blocker list.
 *
 * This is where the app stops detecting and a person starts deciding. Nothing
 * arrives pre-answered: every finding opens, states what the contract says, what
 * it would cost to get wrong, and the question to put to Deal Desk.
 *
 * Two ways out of a finding, kept deliberately distinct:
 *   Resolve — someone answered the question.
 *   Accept risk — nobody answered it, and someone chose to proceed anyway.
 * Collapsing them would let the second masquerade as the first.
 */

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Chip } from '@/components/ui/chip';
import { Card, EmptyState, Section } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Radius, Spacing, severityColor } from '@/constants/theme';
import type { ContractRecord } from '@/domain/record';
import { acceptRisk, reopenFlag, resolveFlag, suggestedPatch } from '@/domain/resolve';
import type { Flag } from '@/domain/schema';
import { useTheme } from '@/hooks/use-theme';

/* -------------------------------------------------------------------------- */

function FlagCard({
  flag,
  record,
  operator,
  onChange,
}: {
  flag: Flag;
  record: ContractRecord;
  operator: string;
  onChange: (next: ContractRecord) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState<'resolve' | 'accept' | null>(null);
  const [input, setInput] = useState('');

  const tone = severityColor(theme, flag.severity, flag.source);
  const isOpen = flag.status === 'open';

  const patch = suggestedPatch(flag, record.config);

  const submit = () => {
    const value = input.trim();
    if (value.length === 0) return;

    onChange(
      prompt === 'resolve'
        ? resolveFlag(record, flag.id, value, operator, null, patch)
        : acceptRisk(record, flag.id, operator, value),
    );
    setInput('');
    setPrompt(null);
  };

  return (
    <Card style={styles.flag} tone={isOpen ? tone.fg : undefined}>
      <Pressable onPress={() => setExpanded((v) => !v)}>
        <View style={styles.flagHeader}>
          <View style={styles.flagTitle}>
            <Text variant="subhead" weight="600">
              {flag.title}
            </Text>
            <View style={styles.flagMeta}>
              <Chip
                label={flag.severity === 'blocking' ? 'Blocking' : 'Review'}
                fg={tone.fg}
                bg={tone.bg}
              />
              {flag.source === 'model' && (
                <Chip label="AI review" fg={theme.advisory} bg={theme.advisoryMuted} />
              )}
              {!isOpen && (
                <Chip
                  label={flag.status === 'resolved' ? 'Resolved' : 'Risk accepted'}
                  fg={theme.success}
                  bg={theme.successMuted}
                />
              )}
            </View>
          </View>
          <Text variant="footnote" color="textTertiary">
            {expanded ? '▲' : '▼'}
          </Text>
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.flagBody}>
          <Text variant="footnote" color="textSecondary">
            {flag.detail}
          </Text>

          {flag.evidence.length > 0 && (
            <View style={[styles.evidence, { borderLeftColor: theme.separatorOpaque }]}>
              {flag.evidence.map((e, i) => (
                <View key={i} style={styles.evidenceItem}>
                  <Text variant="caption" style={styles.quote}>
                    “{e.quote}”
                  </Text>
                  {e.page && (
                    <Text variant="caption2" color="textTertiary">
                      Page {e.page}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {flag.impact.amount !== null && (
            <Text variant="footnote" weight="600" style={{ color: tone.fg }}>
              Exposure: ${flag.impact.amount.toLocaleString()} — {flag.impact.note}
            </Text>
          )}

          <View style={[styles.question, { backgroundColor: theme.surfaceSunken }]}>
            <Text variant="caption" color="textSecondary">
              QUESTION TO ASK
            </Text>
            <Text variant="footnote">{flag.question}</Text>
          </View>

          {flag.policyField && isOpen && (
            <Text variant="caption" color="textTertiary">
              Also answerable from the Policy tab.
            </Text>
          )}

          {flag.resolution && (
            <View style={[styles.resolution, { backgroundColor: theme.successMuted }]}>
              <Text variant="caption" style={{ color: theme.success, fontWeight: '700' }}>
                {flag.status === 'resolved' ? 'RESOLVED' : 'RISK ACCEPTED'}
              </Text>
              <Text variant="footnote">{flag.resolution.decision}</Text>
              {flag.resolution.note && (
                <Text variant="caption" color="textSecondary">
                  {flag.resolution.note}
                </Text>
              )}
              <Text variant="caption2" color="textTertiary">
                {flag.resolution.decidedBy} ·{' '}
                {new Date(flag.resolution.decidedAt).toLocaleDateString()}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            {isOpen ? (
              <>
                <Button
                  title="Record decision"
                  variant="secondary"
                  onPress={() => setPrompt('resolve')}
                  style={styles.action}
                />
                <Button
                  title="Accept risk"
                  variant="plain"
                  onPress={() => setPrompt('accept')}
                  style={styles.action}
                />
              </>
            ) : (
              <Button
                title="Reopen"
                variant="plain"
                onPress={() => onChange(reopenFlag(record, flag.id, operator))}
                style={styles.action}
              />
            )}
          </View>
        </View>
      )}

      <Modal visible={prompt !== null} transparent animationType="fade">
        <Pressable style={styles.backdrop} onPress={() => setPrompt(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={() => {}}>
            <Text variant="headline">
              {prompt === 'resolve' ? 'Record the decision' : 'Accept as a known risk'}
            </Text>
            <Text variant="footnote" color="textSecondary">
              {prompt === 'resolve'
                ? 'What was decided, and by whom? This is recorded against the finding and in the audit log.'
                : 'Why is it acceptable to proceed without an answer? An unexplained accepted risk is indistinguishable from an oversight.'}
            </Text>

            {prompt === 'resolve' && patch && (
              <Text variant="caption" style={{ color: theme.accent }}>
                Recording this will also correct the schedule so the bands no longer overlap.
              </Text>
            )}

            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={
                prompt === 'resolve' ? 'e.g. Deal Desk confirmed $600 applies' : 'e.g. …'
              }
              placeholderTextColor={theme.textTertiary}
              multiline
              style={[styles.input, { color: theme.text, backgroundColor: theme.surfaceSunken }]}
            />

            <View style={styles.sheetActions}>
              <Button
                title="Cancel"
                variant="plain"
                onPress={() => setPrompt(null)}
                style={styles.action}
              />
              <Button
                title="Save"
                onPress={submit}
                disabled={input.trim().length === 0}
                style={styles.action}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

export function FindingsPane({
  record,
  operator,
  onChange,
}: {
  record: ContractRecord;
  operator: string;
  onChange: (next: ContractRecord) => void;
}) {
  const blocking = record.flags.filter((f) => f.severity === 'blocking' && f.status === 'open');
  const other = record.flags.filter((f) => f.severity === 'non_blocking' && f.status === 'open');
  const settled = record.flags.filter((f) => f.status !== 'open');

  if (record.flags.length === 0) {
    return (
      <EmptyState
        title="Nothing flagged"
        message="No rule found a defect in this contract, and the review pass raised nothing. It is ready to go live."
      />
    );
  }

  const props = { record, operator, onChange };

  return (
    <>
      {blocking.length > 0 && (
        <Section
          title={`Blocking · ${blocking.length}`}
          footer="These change an invoice amount. Billing cannot go live until each is resolved or explicitly accepted."
        >
          <View style={styles.list}>
            {blocking.map((flag) => (
              <FlagCard key={flag.id} flag={flag} {...props} />
            ))}
          </View>
        </Section>
      )}

      {other.length > 0 && (
        <Section
          title={`Non-blocking · ${other.length}`}
          footer="Worth resolving, but none of these changes the first invoice."
        >
          <View style={styles.list}>
            {other.map((flag) => (
              <FlagCard key={flag.id} flag={flag} {...props} />
            ))}
          </View>
        </Section>
      )}

      {settled.length > 0 && (
        <Section title={`Settled · ${settled.length}`}>
          <View style={styles.list}>
            {settled.map((flag) => (
              <FlagCard key={flag.id} flag={flag} {...props} />
            ))}
          </View>
        </Section>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  flag: { gap: Spacing.two },
  flagHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  flagTitle: { flex: 1, gap: Spacing.one },
  flagMeta: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  flagBody: { gap: Spacing.three, marginTop: Spacing.one },
  evidence: { borderLeftWidth: 3, paddingLeft: Spacing.two, gap: Spacing.two },
  evidenceItem: { gap: 2 },
  quote: { fontStyle: 'italic' },
  question: { padding: Spacing.two, borderRadius: Radius.medium, gap: Spacing.one },
  resolution: { padding: Spacing.two, borderRadius: Radius.medium, gap: 2 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1, minHeight: 40 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  sheet: {
    borderRadius: Radius.large,
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  input: {
    minHeight: 88,
    borderRadius: Radius.medium,
    padding: Spacing.three,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  sheetActions: { flexDirection: 'row', gap: Spacing.two },
});
