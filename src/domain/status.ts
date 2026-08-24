/**
 * Contract status — the commercial lifecycle.
 *
 * Draft → Active → Invoiced → Paid. Where a contract sits in the billing cycle.
 *
 * This is a SECOND axis, not a replacement for `record.lifecycle`. The two answer
 * different questions and collapsing them would lose one of the answers:
 *
 *   lifecycle  is this configuration safe to bill from?   derived from findings
 *   status     where is this contract in the billing cycle?   set by actions
 *
 * `lifecycle` is computed from open findings and policy decisions — it is the QA
 * gate, and nobody can set it directly. `status` is moved by things people do:
 * releasing a contract, generating an invoice, recording a payment. A contract can
 * be `verified` (QA passed) and still `draft` (nobody released it), which is a real
 * and common state that a single field cannot express.
 *
 * ONE of them is ever shown as a badge, and it is `status` — the question a person
 * is actually asking. Two status-shaped chips side by side made the reader decide
 * which of them to believe. `lifecycle` keeps doing its job underneath: gating
 * go-live, gating financial projections, and driving the portfolio tiles, and it
 * surfaces as a plain sentence under the badge rather than as a rival chip.
 *
 * Every transition lives here. Scattering them is how a contract ends up marked
 * Paid with no invoice behind it.
 */

import { z } from 'zod';

import type { ContractRecord } from './record';
import { canGoLive } from './flags';

/* -------------------------------------------------------------------------- */

export const ContractStatus = z.enum(['draft', 'active', 'invoiced', 'paid']);
export type ContractStatus = z.infer<typeof ContractStatus>;

/** Display order — the order of the cycle, not alphabetical. */
export const STATUS_ORDER: ContractStatus[] = ['draft', 'active', 'invoiced', 'paid'];

export const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

export const STATUS_DESCRIPTION: Record<ContractStatus, string> = {
  draft: 'Not yet released for billing',
  active: 'Released — billing from this configuration',
  invoiced: 'An invoice has been generated',
  paid: 'Invoice settled',
};

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Which moves are legal.
 *
 * Forward through the cycle, plus the reversals that genuinely happen: a released
 * contract can be withdrawn, and an invoice can be voided. Draft → Paid is not a
 * move — it would mean money arrived against a contract nobody released and no
 * invoice was ever raised for.
 */
const ALLOWED: Record<ContractStatus, ContractStatus[]> = {
  draft: ['active'],
  active: ['invoiced', 'draft'],
  invoiced: ['paid', 'active'],
  paid: ['invoiced'],
};

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}

export type TransitionRefusal = { ok: false; reason: string };
export type TransitionCheck = { ok: true } | TransitionRefusal;

/**
 * Whether a contract may move to a status, and why not when it may not.
 *
 * Going Active is gated on the QA pass: a contract with an open blocking finding
 * has something in it nobody has decided, and releasing it is how that undecided
 * thing reaches an invoice. This is the same gate `canGoLive` applies — asserted
 * here too so the status model cannot be used to route around it.
 */
export function checkTransition(record: ContractRecord, to: ContractStatus): TransitionCheck {
  const from = record.status;

  if (from === to) return { ok: true };

  if (!canTransition(from, to)) {
    return {
      ok: false,
      reason: `A contract cannot move from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.`,
    };
  }

  if (to === 'active' && !canGoLive(record.flags)) {
    const blocking = record.flags.filter((f) => f.status === 'open' && f.blocks.goLive).length;
    return {
      ok: false,
      reason:
        `${blocking} blocking finding${blocking === 1 ? '' : 's'} must be resolved before this ` +
        `contract can go Active.`,
    };
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/** Statuses a contract could legally move to right now. */
export function availableTransitions(record: ContractRecord): ContractStatus[] {
  return STATUS_ORDER.filter((s) => s !== record.status && checkTransition(record, s).ok);
}

/** Counts per status, with every status present so a filter can show a zero. */
export function statusCounts(records: ContractRecord[]): Record<ContractStatus, number> {
  const counts = { draft: 0, active: 0, invoiced: 0, paid: 0 };
  for (const record of records) counts[record.status]++;
  return counts;
}
