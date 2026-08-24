/**
 * Import — batch upload with a live queue.
 *
 * A batch of twenty is a normal working session, so the screen is built around
 * partial outcomes: every file reports its own status, failures are retryable
 * individually, and duplicates are surfaced as a link to what already exists
 * rather than as an error.
 */

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, StatTile, TileGrid } from '@/components/ui/chip';
import { Card, EmptyState, PageHeader, Screen, Section } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { fromWebFile, pickContracts } from '@/import/picker';
import { ImportQueue, summarise, type ImportJob, type PickedFile } from '@/import/queue';
import { MAX_BATCH_FILES, MAX_FILE_BYTES } from '@/import/validation';
import { useTheme } from '@/hooks/use-theme';

/* -------------------------------------------------------------------------- */

function statusChip(job: ImportJob, theme: ReturnType<typeof useTheme>) {
  switch (job.status) {
    case 'done':
      return { label: 'Parsed', fg: theme.success, bg: theme.successMuted };
    case 'duplicate':
      return { label: 'Already imported', fg: theme.warning, bg: theme.warningMuted };
    case 'failed':
      return { label: 'Failed', fg: theme.danger, bg: theme.dangerMuted };
    case 'canceled':
      return { label: 'Canceled', fg: theme.textSecondary, bg: theme.surfaceSunken };
    case 'parsing':
      return { label: 'Parsing', fg: theme.accent, bg: theme.accentMuted };
    case 'validating':
      return { label: 'Checking', fg: theme.accent, bg: theme.accentMuted };
    default:
      return { label: 'Queued', fg: theme.textSecondary, bg: theme.surfaceSunken };
  }
}

function JobRow({ job, onRetry, onOpen }: { job: ImportJob; onRetry: () => void; onOpen: () => void }) {
  const theme = useTheme();
  const chip = statusChip(job, theme);
  const busy = job.status === 'parsing' || job.status === 'validating';
  const elapsed =
    job.startedAt && job.finishedAt ? ((job.finishedAt - job.startedAt) / 1000).toFixed(1) : null;

  return (
    <Card style={styles.job}>
      <View style={styles.jobHeader}>
        <View style={styles.jobTitle}>
          <Text variant="subhead" weight="600" numberOfLines={1}>
            {job.fileName}
          </Text>
          <Text variant="caption" color="textTertiary">
            {(job.byteSize / 1024).toFixed(0)} KB
            {elapsed ? ` · ${elapsed}s` : ''}
            {job.attempts > 1 ? ` · attempt ${job.attempts}` : ''}
          </Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={theme.accent} /> : null}
        <Chip label={chip.label} fg={chip.fg} bg={chip.bg} />
      </View>

      {job.status === 'done' && (
        <View style={styles.jobFooter}>
          <Text variant="footnote" color="textSecondary">
            {job.flagCount === 0
              ? 'No findings raised'
              : `${job.flagCount} finding${job.flagCount === 1 ? '' : 's'} raised`}
            {job.reviewPassCompleted === false ? ' · review pass unavailable' : ''}
          </Text>
          <Pressable onPress={onOpen} hitSlop={8}>
            <Text variant="footnote" style={{ color: theme.accent, fontWeight: '600' }}>
              Open
            </Text>
          </Pressable>
        </View>
      )}

      {job.status === 'duplicate' && (
        <View style={styles.jobFooter}>
          <Text variant="footnote" color="textSecondary">
            Identical contract already in the library
          </Text>
          <Pressable onPress={onOpen} hitSlop={8}>
            <Text variant="footnote" style={{ color: theme.accent, fontWeight: '600' }}>
              Open existing
            </Text>
          </Pressable>
        </View>
      )}

      {job.status === 'failed' && job.error && (
        <View style={styles.jobFooter}>
          <Text variant="footnote" style={[styles.jobError, { color: theme.danger }]}>
            {job.error.message}
          </Text>
          {job.error.retryable && (
            <Pressable onPress={onRetry} hitSlop={8}>
              <Text variant="footnote" style={{ color: theme.accent, fontWeight: '600' }}>
                Retry
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

export default function ImportScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [rejected, setRejected] = useState<{ fileName: string; reason: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);

  // Lazy state initializer rather than a ref written during render — the queue is
  // created once, and reading a ref mid-render is a React rules violation.
  const [queue] = useState(() => new ImportQueue({ onUpdate: setJobs }));

  const stats = useMemo(() => summarise(jobs), [jobs]);
  const settled = stats.total > 0 && stats.inFlight === 0;

  const enqueue = useCallback(
    (files: PickedFile[], unreadable: { fileName: string; reason: string }[] = []) => {
      if (files.length === 0 && unreadable.length === 0) return;
      const { rejected: over } = queue.add(files);
      setRejected((prev) => [...prev, ...unreadable, ...over]);
      void queue.run();
    },
    [queue],
  );

  const onPick = useCallback(async () => {
    setPicking(true);
    try {
      const result = await pickContracts();
      if (!result.canceled) enqueue(result.files, result.unreadable);
    } finally {
      setPicking(false);
    }
  }, [enqueue]);

  /* ---- Web drag and drop ------------------------------------------------ */

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      const files: PickedFile[] = [];
      const unreadable: { fileName: string; reason: string }[] = [];
      for (const file of dropped) {
        try {
          files.push(await fromWebFile(file));
        } catch {
          unreadable.push({ fileName: file.name, reason: 'Could not read the file.' });
        }
      }
      enqueue(files, unreadable);
    },
    [enqueue],
  );

  const dropProps =
    Platform.OS === 'web'
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            setDragging(true);
          },
          onDragLeave: () => setDragging(false),
          onDrop,
        }
      : {};

  /* ---------------------------------------------------------------------- */

  return (
    <>
      <Screen>
        <PageHeader
          title="Upload"
          subtitle="Signed order forms — PDF, up to 20 at a time"
          action={
            stats.inFlight > 0 ? (
              <Button title="Stop" variant="destructive" onPress={() => queue.cancelAll()} />
            ) : undefined
          }
        />
        {/* dropProps is empty on native; on web react-native-web forwards them to the DOM node. */}
        <View {...dropProps} style={styles.dropZoneWrap}>
          <Card
            style={[
              styles.dropZone,
              {
                borderColor: dragging ? theme.accent : theme.separatorOpaque,
                backgroundColor: dragging ? theme.accentMuted : theme.surface,
              },
            ]}
          >
            <Text variant="headline" style={styles.dropTitle}>
              {Platform.OS === 'web' ? 'Drop contracts here' : 'Add contracts'}
            </Text>
            <Text variant="footnote" color="textSecondary" style={styles.dropHint}>
              PDF only · up to {MAX_BATCH_FILES} files · {MAX_FILE_BYTES / 1024 / 1024} MB each
            </Text>
            <Button
              title={picking ? 'Choosing…' : 'Choose files'}
              onPress={onPick}
              loading={picking}
              style={styles.dropButton}
            />
          </Card>
        </View>

        {stats.total > 0 && (
          <Section title="Batch">
            <TileGrid>
              <StatTile label="Parsed" value={String(stats.done)} tone={theme.success} />
              <StatTile label="Duplicates" value={String(stats.duplicates)} />
              <StatTile
                label="Failed"
                value={String(stats.failed)}
                tone={stats.failed > 0 ? theme.danger : undefined}
              />
              <StatTile
                label="Findings"
                value={String(stats.totalFlags)}
                caption="across this batch"
              />
            </TileGrid>
          </Section>
        )}

        {rejected.length > 0 && (
          <Section title="Not queued">
            <Card>
              {rejected.map((r, i) => (
                <Text key={`${r.fileName}-${i}`} variant="footnote" color="textSecondary">
                  {r.fileName} — {r.reason}
                </Text>
              ))}
            </Card>
          </Section>
        )}

        {jobs.length > 0 ? (
          <Section title="Files">
            <View style={styles.jobs}>
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onRetry={() => queue.retry(job.id)}
                  onOpen={() => job.contractId && router.push(`/contract/${job.contractId}`)}
                />
              ))}
            </View>
          </Section>
        ) : (
          <EmptyState
            title="Nothing queued"
            message="Choose one or more signed order forms. Each is extracted, reviewed for anything ambiguous, and added to the library."
          />
        )}

        {settled && (
          <Button
            title="Done"
            onPress={() => router.back()}
            variant="secondary"
            style={styles.done}
          />
        )}
      </Screen>
    </>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  dropZoneWrap: { marginTop: Spacing.three },
  dropZone: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: Radius.large,
  },
  dropTitle: { textAlign: 'center' },
  dropHint: { textAlign: 'center' },
  dropButton: { marginTop: Spacing.two, minWidth: 200 },
  jobs: { gap: Spacing.two },
  job: { gap: Spacing.two },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  jobTitle: { flex: 1, gap: 2 },
  jobFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  jobError: { flex: 1 },
  done: { marginTop: Spacing.four },
});
