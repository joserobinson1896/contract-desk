/**
 * The stored contract record — everything the app knows about one order form.
 *
 * Note what is NOT here: the PDF bytes. Records live in key-value storage, which
 * on web is localStorage with a ~5 MB quota; two base64 contracts would exhaust
 * it. PDFs go to IndexedDB via `blob-store`, keyed by the same `sha256` recorded
 * below. Keeping bytes out of the record is a correctness requirement, not a
 * space optimisation.
 */

import * as z from 'zod';

import { BillingConfig, Flag, Provenance } from './schema';
import { BillingPolicy } from './policy';
// Value import, but not a cycle: `status.ts` imports only the TYPE back from here.
import { ContractStatus } from './status';

export const SCHEMA_VERSION = 1;

/* -------------------------------------------------------------------------- */

export const SourceFile = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  pageCount: z.number().int().positive().nullable(),
  /** Content hash. Dedupes imports and links the record to its stored PDF. */
  sha256: z.string(),
});

export const ExtractionMeta = z.object({
  status: z.enum(['queued', 'parsing', 'extracted', 'failed']),
  model: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  /** False when the adversarial review call failed — rules-only detection. */
  reviewPassCompleted: z.boolean(),
  coverage: z.object({
    missingFields: z.array(z.string()),
    lowConfidence: z.array(z.string()),
  }),
});

export const AuditEntry = z.object({
  at: z.string(),
  by: z.string(),
  action: z.enum([
    'imported',
    'reparsed',
    'flag_resolved',
    'flag_reopened',
    'flag_accepted_risk',
    'policy_changed',
    'lifecycle_changed',
    'status_changed',
    'simulated',
  ]),
  summary: z.string(),
  /** Free-form detail for the entry — previous/next values, flag id, and so on. */
  meta: z.record(z.string(), z.unknown()).nullable(),
});

export const SimulationRun = z.object({
  id: z.string(),
  at: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  /** Null when the run was blocked rather than computed. */
  invoiceTotal: z.number().nullable(),
  controlling: z.enum(['actual', 'minimum', 'none']).nullable(),
  blocked: z.boolean(),
});

/* -------------------------------------------------------------------------- */

export const ContractRecord = z.object({
  id: z.string(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  createdAt: z.string(),
  updatedAt: z.string(),

  source: SourceFile,
  extraction: ExtractionMeta,

  /**
   * `extracted` → parsed, untouched. `in_review` → someone has started deciding.
   * `verified` → no open blocking findings. `live` → explicitly switched on.
   * Only `verified` and `live` unlock the go-live affordances on the detail screen.
   */
  lifecycle: z.enum(['extracted', 'in_review', 'verified', 'live']),

  /**
   * The commercial lifecycle — see `status.ts`. A separate axis from `lifecycle`:
   * that one asks whether the config is safe to bill from, this one asks where the
   * contract is in the billing cycle.
   *
   * Defaulted rather than required so records written before this field existed
   * still parse. `parseRecords` drops anything that fails validation, so making it
   * required would silently delete every contract already in storage.
   */
  status: ContractStatus.default('draft'),

  config: BillingConfig,
  /** Pointer → source clause. Stored as pairs; rehydrated to a Map in the domain. */
  provenance: z.array(z.object({ pointer: z.string(), source: Provenance })),
  policy: BillingPolicy,
  flags: z.array(Flag),
  simulations: z.array(SimulationRun),
  auditLog: z.array(AuditEntry),
});

export type SourceFile = z.infer<typeof SourceFile>;
export type ExtractionMeta = z.infer<typeof ExtractionMeta>;
export type AuditEntry = z.infer<typeof AuditEntry>;
export type SimulationRun = z.infer<typeof SimulationRun>;
export type ContractRecord = z.infer<typeof ContractRecord>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function provenanceMap(record: ContractRecord): Map<string, Provenance> {
  return new Map(record.provenance.map((p) => [p.pointer, p.source]));
}

export function appendAudit(
  record: ContractRecord,
  entry: Omit<AuditEntry, 'at'> & { at?: string },
): ContractRecord {
  return {
    ...record,
    updatedAt: new Date().toISOString(),
    auditLog: [...record.auditLog, { at: new Date().toISOString(), ...entry }],
  };
}

/**
 * Lifecycle is derived, never hand-set — except `live`, which is a deliberate
 * human act. Deriving it means a contract cannot drift into "verified" because
 * someone forgot to update a field after resolving the last blocker.
 */
export function deriveLifecycle(record: ContractRecord): ContractRecord['lifecycle'] {
  if (record.lifecycle === 'live') return 'live';
  if (record.extraction.status !== 'extracted') return 'extracted';

  const hasOpenBlocking = record.flags.some((f) => f.status === 'open' && f.blocks.goLive);
  if (hasOpenBlocking) {
    const touched =
      record.flags.some((f) => f.status !== 'open') ||
      Object.values(record.policy.setBy).some((m) => m.source === 'user');
    return touched ? 'in_review' : 'extracted';
  }
  return 'verified';
}
