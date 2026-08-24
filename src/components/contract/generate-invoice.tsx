/**
 * Generate Invoice.
 *
 * Lives on the contract detail page because an invoice is always OF a contract —
 * the action belongs where its subject is, not in a global menu where you would
 * have to name the contract again.
 *
 * The dialog previews before it commits. The same `simulateMonth` the projections
 * pane uses computes a live total as the inputs change, so nobody issues an
 * invoice whose amount they first see after it exists. When the engine refuses a
 * month — overlapping minimum-spend bands, nobody has decided which controls —
 * the button disables and the refusal is shown verbatim rather than being reduced
 * to a greyed-out control with no explanation.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/chip';
import { Card, Divider, Row } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { listInvoices, saveInvoice } from '@/data/invoices';
import { canGoLive, openBlockingFlags } from '@/domain/flags';
import {
  currentTermMonth,
  duplicateFor,
  generateInvoice,
  previewInvoice,
  type Invoice,
} from '@/domain/invoice';
import type { ContractRecord } from '@/domain/record';
import { setLive, setStatus } from '@/domain/resolve';
import { useTheme } from '@/hooks/use-theme';

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* -------------------------------------------------------------------------- */

function NumberField({
  label,
  value,
  onChange,
  step,
  min = 0,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  suffix?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <View>
        <Text variant="footnote" color="textSecondary">
          {label}
        </Text>
        <Text variant="title3" numeric>
          {value.toLocaleString()}
          {suffix ? ` ${suffix}` : ''}
        </Text>
      </View>
      <View style={[styles.stepper, { backgroundColor: theme.surfaceSunken }]}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - step))}
          style={styles.stepperButton}
          accessibilityLabel={`Decrease ${label}`}
        >
          <Text variant="title3" style={{ color: theme.accent }}>
            −
          </Text>
        </Pressable>
        <View style={[styles.stepperDivider, { backgroundColor: theme.separator }]} />
        <Pressable
          onPress={() => onChange(value + step)}
          style={styles.stepperButton}
          accessibilityLabel={`Increase ${label}`}
        >
          <Text variant="title3" style={{ color: theme.accent }}>
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

export function GenerateInvoiceButton({
  record,
  operator,
  onGenerated,
}: {
  record: ContractRecord;
  operator: string;
  onGenerated: (next: ContractRecord) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [issued, setIssued] = useState<Invoice[]>([]);
  // Opens on the period the contract is actually in, not month 1.
  const [month, setMonth] = useState(() =>
    currentTermMonth(record.config.term.startDate, record.config.term.initialTermMonths),
  );
  const [activeSims, setActiveSims] = useState(100);
  const [mbUsed, setMbUsed] = useState(1000);

  const preview = useMemo(
    () => previewInvoice(record, { month, activeSims, mbUsed }),
    [record, month, activeSims, mbUsed],
  );

  // Loaded when the dialog opens so the duplicate warning is accurate without
  // making every contract screen read the invoice store on mount.
  useEffect(() => {
    if (!open) return;
    void listInvoices().then(setIssued);
  }, [open]);

  const duplicate = duplicateFor(issued, record.id, month);
  const releasable = record.status !== 'draft';
  /** Draft, but nothing is blocking — one press away from being invoiceable. */
  const readyToRelease = record.status === 'draft' && canGoLive(record.flags);
  const blocking = openBlockingFlags(record.flags).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const existing = await listInvoices();
      const result = generateInvoice(record, { month, activeSims, mbUsed }, operator, existing);
      if (!result.ok) {
        setError(result.reason);
        return;
      }

      await saveInvoice(result.invoice);

      // The contract moves with the invoice. Doing this in one place is what stops
      // an invoice existing against a contract still marked Active.
      const moved = setStatus(record, 'invoiced', operator, `invoice ${result.invoice.number}`);
      if (!moved.ok) {
        setError(moved.reason);
        return;
      }

      setIssued(await listInvoices());
      onGenerated(moved.record);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        title="Generate Invoice"
        onPress={() => {
          setError(null);
          setOpen(true);
        }}
      />

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background }]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text variant="title3">Generate Invoice</Text>
              <Text variant="footnote" color="textSecondary">
                {record.config.account.customerName}
                {record.config.account.orderFormNumber
                  ? ` · Order form ${record.config.account.orderFormNumber}`
                  : ''}
              </Text>

              {!releasable && (
                <Card style={[styles.notice, { backgroundColor: theme.warningMuted }]}>
                  <Text variant="subhead" weight="600" style={{ color: theme.warning }}>
                    This contract is {record.status}, not Active
                  </Text>
                  <Text variant="footnote" color="textSecondary">
                    {readyToRelease
                      ? 'Nothing is blocking it. Releasing it here makes it invoiceable.'
                      : `${blocking} blocking finding${
                          blocking === 1 ? '' : 's'
                        } must be resolved in Findings first — that gate is the point of the app: it is what stops an undecided contract reaching a real invoice.`}
                  </Text>
                  {/* Offered here rather than only on Overview. Once nothing blocks,
                      making the user leave, release, and come back is friction with
                      no decision left in it. */}
                  {readyToRelease && (
                    <Button
                      title="Mark Active"
                      variant="secondary"
                      onPress={() => onGenerated(setLive(record, operator))}
                    />
                  )}
                </Card>
              )}

              <Card padded={false}>
                <View style={styles.fields}>
                  <NumberField label="Month of term" value={month} onChange={setMonth} step={1} min={1} />
                  <Divider />
                  <NumberField
                    label="Active SIMs"
                    value={activeSims}
                    onChange={setActiveSims}
                    step={10}
                  />
                  <Divider />
                  <NumberField
                    label="Pooled data used"
                    value={mbUsed}
                    onChange={setMbUsed}
                    step={100}
                    suffix="MB"
                  />
                </View>
              </Card>

              {duplicate && (
                <Card style={[styles.notice, { backgroundColor: theme.warningMuted }]}>
                  <Text variant="subhead" weight="600" style={{ color: theme.warning }}>
                    Month {month} has already been invoiced
                  </Text>
                  <Text variant="footnote" color="textSecondary">
                    {duplicate.number} covers this month. Generating another bills it twice —
                    continue only if this is a deliberate re-issue.
                  </Text>
                </Card>
              )}

              {preview.ok ? (
                <Card padded={false}>
                  <Row
                    label="Qualifying fees"
                    value={money(preview.breakdown.qualifyingFees)}
                  />
                  <Row
                    label="Period minimum"
                    value={
                      preview.breakdown.applicableMinimum === null
                        ? '—'
                        : money(preview.breakdown.applicableMinimum)
                    }
                  />
                  <Row
                    label="Controlling"
                    value={preview.breakdown.controlling === 'minimum' ? 'Minimum' : 'Actual fees'}
                  />
                  <Row label="Invoice total" value={money(preview.breakdown.invoiceTotal)} last />
                </Card>
              ) : (
                <Card style={[styles.notice, { backgroundColor: theme.dangerMuted }]}>
                  <Text variant="subhead" weight="600" style={{ color: theme.danger }}>
                    Month {month} cannot be invoiced
                  </Text>
                  <Text variant="footnote" color="textSecondary">
                    {preview.reason}
                  </Text>
                </Card>
              )}

              {error && (
                <Text variant="footnote" style={{ color: theme.danger }}>
                  {error}
                </Text>
              )}

              <View style={styles.actions}>
                <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} />
                <Button
                  title={busy ? 'Generating…' : 'Generate'}
                  onPress={submit}
                  disabled={busy || !preview.ok || !releasable}
                />
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,10,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '90%', borderRadius: Radius.xlarge },
  sheetBody: { padding: Spacing.four, gap: Spacing.three },
  notice: { gap: Spacing.one },
  fields: { padding: Spacing.three, gap: Spacing.three },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', borderRadius: Radius.medium, overflow: 'hidden' },
  stepperButton: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepperDivider: { width: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
});
