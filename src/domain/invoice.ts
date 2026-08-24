/**
 * Invoices.
 *
 * An invoice is a COMMITTED run of the billing engine, not a second calculation.
 * It calls `simulateMonth` — the same function the projections pane uses and the
 * same one the worked-example tests pin to the cent. A separate invoice-only
 * formula is how two numbers for one month start disagreeing.
 *
 * Three consequences follow from that, all deliberate:
 *
 *   1. A month the engine refuses to compute cannot be invoiced. When two
 *      minimum-spend bands claim the same month and nobody has decided which
 *      controls, generation fails and names the finding. A plausible wrong invoice
 *      is worse than no invoice, and worse still once it has been sent.
 *
 *   2. The invoice stores its own inputs and its own line items. Re-deriving the
 *      total later from a config that has since been edited would silently restate
 *      history; an issued invoice is a record of what was billed, not a live view.
 *
 *   3. Only an Active contract can be invoiced. The status transition table
 *      enforces it, which means the go-live gate — every blocking finding resolved
 *      — stands between an undecided contract and a real invoice.
 */

import { simulateMonth, type Breakdown, type SimulationInput } from './billing';
import { flagsBlockingMonth } from './flags';
import type { ContractRecord } from './record';
import * as z from 'zod';

/* -------------------------------------------------------------------------- */

export const PaymentStatus = z.enum(['unpaid', 'paid']);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const InvoiceLine = z.object({
  chargeId: z.string(),
  label: z.string(),
  quantity: z.number(),
  unitRate: z.number(),
  amount: z.number(),
  countsTowardMinimum: z.boolean(),
});

export const Invoice = z.object({
  id: z.string(),
  /** Human-facing, sequential, stable once issued. */
  number: z.string(),

  contractId: z.string(),
  /** Denormalised so the list renders without loading every contract, and so a
   *  deleted contract does not blank out its own invoice history. */
  contractName: z.string(),
  orderFormNumber: z.string().nullable(),

  generatedAt: z.string(),
  generatedBy: z.string(),

  /** The inputs, kept so the total can be explained without guessing. */
  month: z.number().int().positive(),
  activeSims: z.number().int().nonnegative(),
  mbUsed: z.number().nonnegative(),

  lines: z.array(InvoiceLine),
  qualifyingFees: z.number(),
  applicableMinimum: z.number().nullable(),
  controlling: z.enum(['actual', 'minimum', 'none']),
  total: z.number(),
  currency: z.string(),

  paymentStatus: PaymentStatus,
  paidAt: z.string().nullable(),
  paidBy: z.string().nullable(),
});

export type InvoiceLine = z.infer<typeof InvoiceLine>;
export type Invoice = z.infer<typeof Invoice>;

/* -------------------------------------------------------------------------- */
/* Numbering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Sequential across the whole library, not per contract.
 *
 * Derived from the highest number already issued rather than from the count, so
 * deleting an invoice cannot cause the next one to reuse a number that has
 * already been sent to a customer.
 */
export function nextInvoiceNumber(existing: Invoice[]): string {
  const highest = existing.reduce((max, inv) => {
    const n = Number.parseInt(inv.number.replace(/^INV-/, ''), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `INV-${String(highest + 1).padStart(4, '0')}`;
}

/**
 * Which month of the term today falls in.
 *
 * The dialog opened on month 1 every time, so invoicing the current period meant
 * counting months by hand and stepping to it — on a contract eighteen months in,
 * that is eighteen presses and an easy off-by-one. Clamped to the term, because a
 * month past the end is not a period anyone can bill.
 */
export function currentTermMonth(
  startDate: string | null,
  termMonths: number | null,
  now: Date = new Date(),
): number {
  if (!startDate) return 1;
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return 1;

  const months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth()) +
    1;

  if (months < 1) return 1;
  // The final band runs open-ended, so past the initial term the last month of it
  // is still the right default rather than an ever-growing number.
  return termMonths && months > termMonths ? termMonths : months;
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

export type GenerateInput = Pick<SimulationInput, 'month' | 'activeSims' | 'mbUsed'>;

export type GenerateResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; reason: string; blockingFlagIds: string[] };

/**
 * An invoice already issued for this contract and month.
 *
 * Billing the same month twice is a double charge, and it is easy to do by
 * accident — the dialog reopens on the month you last used. Surfaced rather than
 * silently blocked, so a deliberate re-issue is still possible.
 */
export function duplicateFor(
  invoices: Invoice[],
  contractId: string,
  month: number,
): Invoice | null {
  return invoices.find((i) => i.contractId === contractId && i.month === month) ?? null;
}

/** What the invoice would say, without committing it. Drives the live preview. */
export function previewInvoice(
  record: ContractRecord,
  input: GenerateInput,
): { ok: true; breakdown: Breakdown } | { ok: false; reason: string; blockingFlagIds: string[] } {
  const blocking = flagsBlockingMonth(record.flags, input.month).map((f) => f.id);
  const outcome = simulateMonth(record.config, record.policy, input, {
    ambiguousMinimum: blocking,
  });

  if (!outcome.ok) {
    return { ok: false, reason: outcome.message, blockingFlagIds: outcome.blockingFlagIds };
  }
  return { ok: true, breakdown: outcome.breakdown };
}

export function generateInvoice(
  record: ContractRecord,
  input: GenerateInput,
  by: string,
  existing: Invoice[],
  now: string = new Date().toISOString(),
): GenerateResult {
  /**
   * The gate is "has been released", not "is exactly Active".
   *
   * Requiring `active` meant a contract could be invoiced exactly once: the first
   * invoice moved it to Invoiced, and every later month was then refused. Billing
   * is monthly, so that is the normal case, not an edge one. A Paid contract can
   * be invoiced again too — the next month's charges make money owed again.
   *
   * Draft is still refused, which is the part that matters: the go-live gate keeps
   * an undecided contract away from a real invoice.
   */
  if (record.status === 'draft') {
    return {
      ok: false,
      reason:
        'This contract is still a Draft. Resolve anything blocking and mark it Active ' +
        'before invoicing — that gate is what keeps an undecided contract off an invoice.',
      blockingFlagIds: [],
    };
  }

  const preview = previewInvoice(record, input);
  if (!preview.ok) return preview;

  const { breakdown } = preview;
  const number = nextInvoiceNumber(existing);

  return {
    ok: true,
    invoice: {
      // Keyed on the invoice number, which is unique by construction. A timestamp
      // alone collides when two are generated inside the same millisecond, and
      // `saveInvoice` replaces by id — so the first would vanish silently.
      id: `inv-${number}`,
      number,

      contractId: record.id,
      contractName: record.config.account.customerName,
      orderFormNumber: record.config.account.orderFormNumber,

      generatedAt: now,
      generatedBy: by,

      month: input.month,
      activeSims: input.activeSims,
      mbUsed: input.mbUsed,

      lines: breakdown.lines.map((l) => ({
        chargeId: l.chargeId,
        label: l.label,
        quantity: l.quantity,
        unitRate: l.unitRate,
        amount: l.amount,
        countsTowardMinimum: l.countsTowardMinimum,
      })),
      qualifyingFees: breakdown.qualifyingFees,
      applicableMinimum: breakdown.applicableMinimum,
      controlling: breakdown.controlling,
      total: breakdown.invoiceTotal,
      currency: record.config.term.currency ?? 'USD',

      paymentStatus: 'unpaid',
      paidAt: null,
      paidBy: null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Payment                                                                     */
/* -------------------------------------------------------------------------- */

export function markPaid(invoice: Invoice, by: string, now = new Date().toISOString()): Invoice {
  if (invoice.paymentStatus === 'paid') return invoice;
  return { ...invoice, paymentStatus: 'paid', paidAt: now, paidBy: by };
}

export function markUnpaid(invoice: Invoice): Invoice {
  return { ...invoice, paymentStatus: 'unpaid', paidAt: null, paidBy: null };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export function invoicesForContract(invoices: Invoice[], contractId: string): Invoice[] {
  return invoices.filter((i) => i.contractId === contractId);
}

/**
 * The status a contract's invoices imply.
 *
 * `paid` only when every invoice is settled — one paid invoice out of three does
 * not make the contract paid, and reporting it that way is how a receivable goes
 * missing.
 */
export function impliedStatus(invoices: Invoice[]): 'invoiced' | 'paid' | null {
  if (invoices.length === 0) return null;
  return invoices.every((i) => i.paymentStatus === 'paid') ? 'paid' : 'invoiced';
}

export function outstandingTotal(invoices: Invoice[]): number {
  return invoices
    .filter((i) => i.paymentStatus === 'unpaid')
    .reduce((sum, i) => sum + i.total, 0);
}
