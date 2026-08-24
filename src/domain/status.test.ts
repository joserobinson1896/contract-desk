/**
 * Contract status tests.
 *
 * The transition table is the part worth asserting. A status model that lets any
 * value follow any other is not a model — it is a string field with extra steps,
 * and the bug it produces (a contract marked Paid that no invoice was ever raised
 * for) is invisible until someone reconciles the books.
 */

import { describe, expect, it } from 'vitest';

import { buildFlags } from './flags';
import { createDefaultPolicy } from './policy';
import { setStatus } from './resolve';
import { HALCYON_CONFIG, HALCYON_COVERAGE, HALCYON_PROVENANCE } from '../fixtures/halcyon';
import {
  STATUS_ORDER,
  availableTransitions,
  canTransition,
  checkTransition,
  statusCounts,
} from './status';
import { ContractRecord as ContractRecordSchema, SCHEMA_VERSION, type ContractRecord } from './record';

const NOW = '2026-08-01T00:00:00.000Z';

/**
 * Built here rather than imported from `data/seed`, which reaches AsyncStorage.
 * The domain layer stays free of I/O so these run in milliseconds with no mocks.
 */
function blocked(): ContractRecord {
  const { flags } = buildFlags({
    config: HALCYON_CONFIG,
    provenance: HALCYON_PROVENANCE,
    coverage: HALCYON_COVERAGE,
  });

  return {
    id: 'test-halcyon',
    schemaVersion: SCHEMA_VERSION,
    createdAt: NOW,
    updatedAt: NOW,
    source: {
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
      byteSize: 0,
      pageCount: 5,
      sha256: 'test:halcyon',
    },
    extraction: {
      status: 'extracted',
      model: null,
      startedAt: NOW,
      completedAt: NOW,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      error: null,
      reviewPassCompleted: false,
      coverage: HALCYON_COVERAGE,
    },
    lifecycle: 'extracted',
    status: 'draft',
    config: HALCYON_CONFIG,
    provenance: [...HALCYON_PROVENANCE.entries()].map(([pointer, source]) => ({ pointer, source })),
    policy: createDefaultPolicy(),
    flags,
    simulations: [],
    auditLog: [],
  };
}

/** Same contract with the QA gate satisfied. */
function clean(): ContractRecord {
  const record = blocked();
  return {
    ...record,
    lifecycle: 'verified',
    flags: record.flags.map((f) => ({ ...f, status: 'resolved' as const })),
  };
}

/* -------------------------------------------------------------------------- */

describe('the transition table', () => {
  it('walks the cycle forward', () => {
    expect(canTransition('draft', 'active')).toBe(true);
    expect(canTransition('active', 'invoiced')).toBe(true);
    expect(canTransition('invoiced', 'paid')).toBe(true);
  });

  it('allows the reversals that actually happen', () => {
    // Withdrawing a release, and voiding an invoice.
    expect(canTransition('active', 'draft')).toBe(true);
    expect(canTransition('invoiced', 'active')).toBe(true);
    expect(canTransition('paid', 'invoiced')).toBe(true);
  });

  it('refuses to skip the cycle', () => {
    // Money against a contract nobody released and no invoice was raised for.
    expect(canTransition('draft', 'paid')).toBe(false);
    expect(canTransition('draft', 'invoiced')).toBe(false);
    expect(canTransition('active', 'paid')).toBe(false);
    expect(canTransition('paid', 'draft')).toBe(false);
  });

  it('treats staying put as legal, so a no-op write is not an error', () => {
    for (const s of STATUS_ORDER) expect(canTransition(s, s)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('the QA gate', () => {
  it('refuses to go Active while a blocking finding is open, and says how many', () => {
    const check = checkTransition(blocked(), 'active');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/blocking finding/);
  });

  it('allows Active once nothing blocks go-live', () => {
    expect(checkTransition(clean(), 'active').ok).toBe(true);
  });

  it('offers no transitions at all from a blocked draft', () => {
    expect(availableTransitions(blocked())).toEqual([]);
  });

  it('offers exactly Active from a clean draft', () => {
    expect(availableTransitions(clean())).toEqual(['active']);
  });
});

/* -------------------------------------------------------------------------- */

describe('setStatus', () => {
  it('refuses an illegal move without mutating the record', () => {
    const record = clean();
    const result = setStatus(record, 'paid', 'jose');
    expect(result.ok).toBe(false);
    expect(record.status).toBe('draft');
  });

  it('refuses rather than throwing, so a screen can show the reason', () => {
    const result = setStatus(blocked(), 'active', 'jose');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('records who moved it, and between which two states', () => {
    const result = setStatus(clean(), 'active', 'jose');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = result.record.auditLog.at(-1);
    expect(entry?.action).toBe('status_changed');
    expect(entry?.by).toBe('jose');
    expect(entry?.summary).toContain('Draft → Active');
    expect(entry?.meta).toMatchObject({ from: 'draft', to: 'active' });
  });

  it('appends the caller-supplied reason, so an invoice can name itself', () => {
    const active = setStatus(clean(), 'active', 'jose');
    if (!active.ok) throw new Error('expected the move to be allowed');
    const invoiced = setStatus(active.record, 'invoiced', 'jose', 'invoice INV-0001');
    if (!invoiced.ok) throw new Error('expected the move to be allowed');
    expect(invoiced.record.auditLog.at(-1)?.summary).toContain('invoice INV-0001');
  });

  it('writes no audit entry when the status does not change', () => {
    const record = clean();
    const before = record.auditLog.length;
    const result = setStatus(record, 'draft', 'jose');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.auditLog.length).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */

describe('storage compatibility', () => {
  it('defaults a record written before the field existed to Draft', () => {
    // Records are validated on read and DROPPED if they fail, so a required field
    // here would silently delete every contract already in storage.
    const { status: _dropped, ...withoutStatus } = clean();
    const parsed = ContractRecordSchema.safeParse(withoutStatus);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.status).toBe('draft');
  });
});

/* -------------------------------------------------------------------------- */

describe('statusCounts', () => {
  it('reports every status, including the empty ones', () => {
    expect(statusCounts([])).toEqual({ draft: 0, active: 0, invoiced: 0, paid: 0 });
  });

  it('counts each contract once', () => {
    const a = clean();
    const b = setStatus(clean(), 'active', 'jose');
    if (!b.ok) throw new Error('expected the move to be allowed');
    expect(statusCounts([a, b.record])).toEqual({ draft: 1, active: 1, invoiced: 0, paid: 0 });
  });
});
