/**
 * Invoice tests.
 *
 * The invoice must agree with the billing engine to the cent, and must refuse the
 * cases the engine refuses. An invoice that quietly picks a number where the
 * engine declined is the worst failure this system has: it is wrong, it looks
 * authoritative, and it has already been sent.
 */

import { describe, expect, it } from 'vitest';

import { buildFlags } from './flags';
import { createDefaultPolicy } from './policy';
import { SCHEMA_VERSION, type ContractRecord } from './record';
import { setStatus } from './resolve';
import {
  currentTermMonth,
  duplicateFor,
  generateInvoice,
  impliedStatus,
  markPaid,
  markUnpaid,
  nextInvoiceNumber,
  outstandingTotal,
  previewInvoice,
  type Invoice,
} from './invoice';
import { HALCYON_CONFIG, HALCYON_COVERAGE, HALCYON_PROVENANCE } from '../fixtures/halcyon';

const NOW = '2026-09-01T00:00:00.000Z';

function record(): ContractRecord {
  const { flags } = buildFlags({
    config: HALCYON_CONFIG,
    provenance: HALCYON_PROVENANCE,
    coverage: HALCYON_COVERAGE,
  });
  return {
    id: 'c1',
    schemaVersion: SCHEMA_VERSION,
    createdAt: NOW,
    updatedAt: NOW,
    source: { fileName: 'x.pdf', mimeType: 'application/pdf', byteSize: 0, pageCount: 5, sha256: 'x' },
    extraction: {
      status: 'extracted', model: null, startedAt: NOW, completedAt: NOW, durationMs: null,
      inputTokens: null, outputTokens: null, error: null, reviewPassCompleted: false,
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

/** The same contract, QA passed and released. */
function active(): ContractRecord {
  const base = record();
  const cleaned: ContractRecord = {
    ...base,
    lifecycle: 'verified',
    flags: base.flags.map((f) => ({ ...f, status: 'resolved' as const })),
  };
  const moved = setStatus(cleaned, 'active', 'jose');
  if (!moved.ok) throw new Error(moved.reason);
  return moved.record;
}

/* -------------------------------------------------------------------------- */

describe('the gate', () => {
  it('refuses to invoice a Draft contract', () => {
    const result = generateInvoice(record(), { month: 8, activeSims: 150, mbUsed: 2400 }, 'jose', [], NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Draft/);
  });

  it('invoices once the contract is Active', () => {
    const result = generateInvoice(active(), { month: 8, activeSims: 150, mbUsed: 2400 }, 'jose', [], NOW);
    expect(result.ok).toBe(true);
  });

  /**
   * The regression that mattered most: requiring status `active` exactly meant a
   * contract could be invoiced once and never again, because the first invoice
   * moved it to Invoiced. Billing is monthly — that is the ordinary case.
   */
  it('keeps invoicing month after month once released', () => {
    const first = generateInvoice(active(), { month: 1, activeSims: 100, mbUsed: 1000 }, 'jose', [], NOW);
    if (!first.ok) throw new Error(first.reason);

    const invoiced = setStatus(active(), 'invoiced', 'jose');
    if (!invoiced.ok) throw new Error(invoiced.reason);

    const second = generateInvoice(
      invoiced.record,
      { month: 2, activeSims: 100, mbUsed: 1000 },
      'jose',
      [first.invoice],
      NOW,
    );
    expect(second.ok, 'a released contract must stay invoiceable').toBe(true);
    if (second.ok) expect(second.invoice.number).toBe('INV-0002');
  });

  it('invoices a Paid contract again — next month is money owed again', () => {
    const paid = setStatus(
      (() => {
        const a = setStatus(active(), 'invoiced', 'jose');
        if (!a.ok) throw new Error(a.reason);
        return a.record;
      })(),
      'paid',
      'jose',
    );
    if (!paid.ok) throw new Error(paid.reason);

    const next = generateInvoice(paid.record, { month: 3, activeSims: 100, mbUsed: 1000 }, 'jose', [], NOW);
    expect(next.ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('double billing', () => {
  it('reports a month already invoiced for that contract', () => {
    const first = generateInvoice(active(), { month: 4, activeSims: 100, mbUsed: 1000 }, 'jose', [], NOW);
    if (!first.ok) throw new Error(first.reason);

    expect(duplicateFor([first.invoice], 'c1', 4)?.number).toBe('INV-0001');
    expect(duplicateFor([first.invoice], 'c1', 5)).toBeNull();
    // Same month, different contract, is not a duplicate.
    expect(duplicateFor([first.invoice], 'other', 4)).toBeNull();
  });

  it('gives two invoices distinct ids even in the same millisecond', () => {
    const a = generateInvoice(active(), { month: 1, activeSims: 10, mbUsed: 0 }, 'jose', [], NOW);
    if (!a.ok) throw new Error(a.reason);
    const b = generateInvoice(active(), { month: 2, activeSims: 10, mbUsed: 0 }, 'jose', [a.invoice], NOW);
    if (!b.ok) throw new Error(b.reason);
    // Storage replaces by id — a collision silently loses one of them.
    expect(a.invoice.id).not.toBe(b.invoice.id);
  });
});

/* -------------------------------------------------------------------------- */

describe('the amount agrees with the billing engine', () => {
  it('matches the worked month to the cent — actual fees control', () => {
    const result = generateInvoice(active(), { month: 8, activeSims: 150, mbUsed: 2400 }, 'jose', [], NOW);
    if (!result.ok) throw new Error(result.reason);
    expect(result.invoice.total).toBe(1039.5);
    expect(result.invoice.qualifyingFees).toBe(1039.5);
    expect(result.invoice.applicableMinimum).toBe(600);
    expect(result.invoice.controlling).toBe('actual');
  });

  it('matches the worked month where the minimum controls', () => {
    const result = generateInvoice(active(), { month: 5, activeSims: 20, mbUsed: 100 }, 'jose', [], NOW);
    if (!result.ok) throw new Error(result.reason);
    expect(result.invoice.total).toBe(300);
    expect(result.invoice.qualifyingFees).toBe(48.6);
    expect(result.invoice.controlling).toBe('minimum');
  });

  it('carries its own inputs, so the total can be explained later', () => {
    const result = generateInvoice(active(), { month: 8, activeSims: 150, mbUsed: 2400 }, 'jose', [], NOW);
    if (!result.ok) throw new Error(result.reason);
    expect(result.invoice.month).toBe(8);
    expect(result.invoice.activeSims).toBe(150);
    expect(result.invoice.mbUsed).toBe(2400);
    expect(result.invoice.lines.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('a month the engine refuses cannot be invoiced', () => {
  it('refuses month 12 while the band overlap is unresolved', () => {
    const result = generateInvoice(active(), { month: 12, activeSims: 100, mbUsed: 500 }, 'jose', [], NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/minimum-spend bands/);
  });

  it('previews the same refusal before anything is committed', () => {
    const preview = previewInvoice(active(), { month: 12, activeSims: 100, mbUsed: 500 });
    expect(preview.ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('currentTermMonth', () => {
  const at = (iso: string) => new Date(iso);

  it('opens on the period the contract is actually in', () => {
    // Term starts Sept 2026; April 2027 is month 8.
    expect(currentTermMonth('2026-09-01', 24, at('2027-04-15T00:00:00Z'))).toBe(8);
  });

  it('treats the starting month as month 1, not month 0', () => {
    expect(currentTermMonth('2026-09-01', 24, at('2026-09-01T00:00:00Z'))).toBe(1);
    expect(currentTermMonth('2026-09-01', 24, at('2026-09-30T23:59:00Z'))).toBe(1);
    expect(currentTermMonth('2026-09-01', 24, at('2026-10-01T00:00:00Z'))).toBe(2);
  });

  it('never returns a month before the term began', () => {
    expect(currentTermMonth('2026-09-01', 24, at('2026-01-01T00:00:00Z'))).toBe(1);
  });

  it('stops at the end of the term rather than counting on forever', () => {
    expect(currentTermMonth('2026-09-01', 24, at('2030-01-01T00:00:00Z'))).toBe(24);
  });

  it('falls back to month 1 when the contract states no start date', () => {
    expect(currentTermMonth(null, 24, at('2027-04-15T00:00:00Z'))).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('numbering', () => {
  it('starts at INV-0001', () => {
    expect(nextInvoiceNumber([])).toBe('INV-0001');
  });

  it('follows the highest issued, not the count — deleting must not reuse a number', () => {
    const issued = [{ number: 'INV-0001' }, { number: 'INV-0007' }] as Invoice[];
    expect(nextInvoiceNumber(issued)).toBe('INV-0008');
    // One deleted: still must not go back to 0002.
    expect(nextInvoiceNumber([{ number: 'INV-0007' }] as Invoice[])).toBe('INV-0008');
  });
});

/* -------------------------------------------------------------------------- */

describe('payment', () => {
  const make = (n: string, paid: boolean, total = 100): Invoice =>
    ({ id: n, number: n, contractId: 'c1', total, paymentStatus: paid ? 'paid' : 'unpaid' }) as Invoice;

  it('records who settled it and when', () => {
    const paid = markPaid(make('INV-0001', false), 'jose', NOW);
    expect(paid.paymentStatus).toBe('paid');
    expect(paid.paidBy).toBe('jose');
    expect(paid.paidAt).toBe(NOW);
  });

  it('clears the payment trail when reversed', () => {
    const back = markUnpaid(markPaid(make('INV-0001', false), 'jose', NOW));
    expect(back.paymentStatus).toBe('unpaid');
    expect(back.paidAt).toBeNull();
    expect(back.paidBy).toBeNull();
  });

  it('does not make a contract Paid until every invoice is settled', () => {
    expect(impliedStatus([make('a', true), make('b', false)])).toBe('invoiced');
    expect(impliedStatus([make('a', true), make('b', true)])).toBe('paid');
    expect(impliedStatus([])).toBeNull();
  });

  it('counts only unpaid invoices as outstanding', () => {
    expect(outstandingTotal([make('a', true, 500), make('b', false, 250)])).toBe(250);
  });
});
