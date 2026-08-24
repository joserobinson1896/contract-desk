/**
 * Batch import.
 *
 * Files are picked in bulk and processed through a bounded-concurrency queue. The
 * server takes one PDF per request, so the fan-out lives here.
 *
 * Design decisions worth naming:
 *
 *   Partial success is the normal outcome. One corrupt file in a batch of twenty
 *   must not cost the other nineteen, so every job succeeds or fails alone.
 *
 *   Dedupe happens BEFORE the request. Re-importing a contract someone already
 *   parsed is common, and catching it by content hash means it costs nothing
 *   rather than a full extraction.
 *
 *   Retries are bounded and selective. A 429 or a 5xx is worth retrying; a 400 or
 *   a 401 will fail identically forever, so retrying it just wastes time and money.
 */

import { buildFlags } from '@/domain/flags';
import { createDefaultPolicy } from '@/domain/policy';
import { appendAudit, deriveLifecycle, SCHEMA_VERSION, type ContractRecord } from '@/domain/record';
import { ExtractionResult, ModelFinding } from '@/domain/schema';
import { findBySha256, saveContract } from '@/data/repository';
import { estimatePageCount, MAX_BATCH_FILES, validateFile } from './validation';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type JobStatus =
  | 'queued'
  | 'validating'
  | 'parsing'
  | 'done'
  | 'failed'
  | 'duplicate'
  | 'canceled';

export type ImportJob = {
  id: string;
  fileName: string;
  byteSize: number;
  mimeType: string;
  status: JobStatus;
  /** Set once the file is read and hashed. */
  sha256?: string;
  /** Set on success, or on duplicate — pointing at the record that already exists. */
  contractId?: string;
  /** Set on success: how many findings this contract raised. */
  flagCount?: number;
  /** False when the adversarial review pass did not run for this file. */
  reviewPassCompleted?: boolean;
  error?: { code: string; message: string; retryable: boolean };
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
};

export type PickedFile = {
  fileName: string;
  mimeType: string;
  byteSize: number;
  base64: string;
};

export const MAX_CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Codes where retrying cannot help — or costs more than it is worth.
 *
 * `upstream_timeout` is here for the second reason. The request that timed out was
 * still billed, and a contract that exhausted the server's ceiling once will do it
 * again; retrying twice more turns one expensive call into three. The user gets a
 * Retry button either way, so nothing is unrecoverable — it just stops the app
 * spending three times over without being asked.
 */
const NON_RETRYABLE = new Set([
  'bad_request',
  'not_a_pdf',
  'unauthorized',
  'bad_origin',
  'too_large',
  'not_configured',
  'bad_api_key',
  'extraction_failed',
  'upstream_timeout',
]);

function isRetryable(code: string): boolean {
  return !NON_RETRYABLE.has(code);
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* Parse call                                                                  */
/* -------------------------------------------------------------------------- */

type ParseResponse = {
  extraction: unknown;
  review: { findings: unknown[]; configDiscrepancies: unknown[] } | null;
  reviewPassCompleted: boolean;
  meta: { model: string; durationMs: number; inputTokens: number; outputTokens: number };
};

async function callParse(file: PickedFile, signal: AbortSignal): Promise<ParseResponse> {
  // No credential is attached, and none is available to attach. The route holds the
  // model API key server-side and authorises the request by its own rules; the
  // client's job is to hand over the PDF and nothing else.
  const response = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.fileName, base64: file.base64 }),
    signal,
  });

  if (!response.ok) {
    let code = 'upstream_error';
    let message = `Parse failed with status ${response.status}.`;
    try {
      const body = await response.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      // Non-JSON error body — keep the status-derived defaults.
    }
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    throw err;
  }

  return response.json();
}

/* -------------------------------------------------------------------------- */
/* Record assembly                                                             */
/* -------------------------------------------------------------------------- */

function buildRecord(
  file: PickedFile,
  sha256: string,
  parsed: ParseResponse,
): { record: ContractRecord; flagCount: number } {
  const extraction = ExtractionResult.parse(parsed.extraction);

  const provenanceMap = new Map(extraction.provenance.map((p) => [p.pointer, p.source]));

  // Validate model findings individually — one malformed finding should not
  // discard an otherwise useful review pass.
  const modelFindings: ModelFinding[] = [];
  for (const raw of parsed.review?.findings ?? []) {
    const result = ModelFinding.safeParse(raw);
    if (result.success) modelFindings.push(result.data);
  }

  const { flags } = buildFlags({
    config: extraction.config,
    provenance: provenanceMap,
    coverage: extraction.coverage,
    modelFindings,
  });

  const now = new Date().toISOString();

  const base: ContractRecord = {
    id: `contract-${sha256.slice(0, 16)}`,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    source: {
      fileName: file.fileName,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      pageCount: estimatePageCount(file.base64),
      sha256,
    },
    extraction: {
      status: 'extracted',
      model: parsed.meta.model,
      startedAt: now,
      completedAt: now,
      durationMs: parsed.meta.durationMs,
      inputTokens: parsed.meta.inputTokens,
      outputTokens: parsed.meta.outputTokens,
      error: null,
      reviewPassCompleted: parsed.reviewPassCompleted,
      coverage: extraction.coverage,
    },
    lifecycle: 'extracted',
    status: 'draft' as const,
    config: extraction.config,
    provenance: extraction.provenance,
    policy: createDefaultPolicy(),
    flags,
    simulations: [],
    auditLog: [],
  };

  const withAudit = appendAudit(base, {
    by: 'system',
    action: 'imported',
    summary:
      `Extracted from ${file.fileName} — ${flags.length} findings raised, all open.` +
      (parsed.reviewPassCompleted ? '' : ' Adversarial review pass did not run.'),
    meta: {
      flagCount: flags.length,
      reviewPassCompleted: parsed.reviewPassCompleted,
      model: parsed.meta.model,
    },
  });

  return { record: { ...withAudit, lifecycle: deriveLifecycle(withAudit) }, flagCount: flags.length };
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

export type QueueEvents = {
  onUpdate: (jobs: ImportJob[]) => void;
};

export class ImportQueue {
  private jobs: ImportJob[] = [];
  private files = new Map<string, PickedFile>();
  private controller = new AbortController();
  private running = false;

  constructor(private events: QueueEvents) {}

  get snapshot(): ImportJob[] {
    return [...this.jobs];
  }

  private emit() {
    this.events.onUpdate(this.snapshot);
  }

  private patch(id: string, changes: Partial<ImportJob>) {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...changes } : j));
    this.emit();
  }

  /** Returns files rejected outright, so the UI can explain why without a job row. */
  add(picked: PickedFile[]): { accepted: number; rejected: { fileName: string; reason: string }[] } {
    const rejected: { fileName: string; reason: string }[] = [];
    const room = MAX_BATCH_FILES - this.jobs.length;

    const incoming = picked.slice(0, Math.max(0, room));
    for (const extra of picked.slice(Math.max(0, room))) {
      rejected.push({
        fileName: extra.fileName,
        reason: `Batch limit is ${MAX_BATCH_FILES} files.`,
      });
    }

    for (const file of incoming) {
      const id = `${file.fileName}-${file.byteSize}-${this.jobs.length}-${Math.random().toString(36).slice(2, 8)}`;
      this.files.set(id, file);
      this.jobs.push({
        id,
        fileName: file.fileName,
        byteSize: file.byteSize,
        mimeType: file.mimeType,
        status: 'queued',
        attempts: 0,
      });
    }

    this.emit();
    return { accepted: incoming.length, rejected };
  }

  cancel(id: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status === 'done' || job.status === 'duplicate') return;
    this.patch(id, { status: 'canceled' });
  }

  cancelAll() {
    this.controller.abort();
    this.controller = new AbortController();
    this.jobs = this.jobs.map((j) =>
      j.status === 'queued' || j.status === 'parsing' || j.status === 'validating'
        ? { ...j, status: 'canceled' as const }
        : j,
    );
    this.emit();
  }

  retry(id: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || (job.status !== 'failed' && job.status !== 'canceled')) return;
    this.patch(id, { status: 'queued', attempts: 0, error: undefined });
    void this.run();
  }

  /** Process the queue with a bounded number of in-flight requests. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const workers = Array.from({ length: MAX_CONCURRENCY }, () => this.worker());
      await Promise.all(workers);
    } finally {
      this.running = false;
    }
  }

  private nextQueued(): ImportJob | undefined {
    return this.jobs.find((j) => j.status === 'queued');
  }

  private async worker(): Promise<void> {
    for (;;) {
      const job = this.nextQueued();
      if (!job) return;

      // Claim it immediately so a sibling worker cannot pick up the same job.
      this.patch(job.id, { status: 'validating', startedAt: Date.now() });
      await this.process(job.id);
    }
  }

  private async process(id: string): Promise<void> {
    const file = this.files.get(id);
    if (!file) {
      this.patch(id, {
        status: 'failed',
        error: { code: 'missing_file', message: 'File data was lost.', retryable: false },
      });
      return;
    }

    /* ---- Validate ------------------------------------------------------- */

    const validation = await validateFile(file);
    if (!validation.ok) {
      this.patch(id, {
        status: 'failed',
        finishedAt: Date.now(),
        error: { ...validation.error, retryable: false },
      });
      return;
    }

    const { sha256 } = validation.file;
    this.patch(id, { sha256 });

    /* ---- Dedupe --------------------------------------------------------- */

    const existing = await findBySha256(sha256);
    if (existing) {
      this.patch(id, {
        status: 'duplicate',
        contractId: existing.id,
        finishedAt: Date.now(),
      });
      return;
    }

    /* ---- Parse ---------------------------------------------------------- */

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (this.jobs.find((j) => j.id === id)?.status === 'canceled') return;

      this.patch(id, { status: 'parsing', attempts: attempt });

      try {
        const parsed = await callParse(file, this.controller.signal);
        const { record, flagCount } = buildRecord(file, sha256, parsed);
        await saveContract(record);

        this.patch(id, {
          status: 'done',
          contractId: record.id,
          flagCount,
          reviewPassCompleted: parsed.reviewPassCompleted,
          finishedAt: Date.now(),
        });
        // Free the base64 as soon as it is no longer needed — a batch of twenty
        // contracts held in memory adds up fast.
        this.files.delete(id);
        return;
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'unexpected';
        const message = error instanceof Error ? error.message : 'Parse failed.';
        const retryable = isRetryable(code);

        if (!retryable || attempt === MAX_ATTEMPTS) {
          this.patch(id, {
            status: 'failed',
            finishedAt: Date.now(),
            error: { code, message, retryable },
          });
          return;
        }

        await wait(backoffMs(attempt));
      }
    }
  }
}

/* -------------------------------------------------------------------------- */

export function summarise(jobs: ImportJob[]) {
  return {
    total: jobs.length,
    done: jobs.filter((j) => j.status === 'done').length,
    duplicates: jobs.filter((j) => j.status === 'duplicate').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    canceled: jobs.filter((j) => j.status === 'canceled').length,
    inFlight: jobs.filter(
      (j) => j.status === 'parsing' || j.status === 'validating' || j.status === 'queued',
    ).length,
    totalFlags: jobs.reduce((n, j) => n + (j.flagCount ?? 0), 0),
  };
}
