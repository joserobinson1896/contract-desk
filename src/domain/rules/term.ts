/**
 * Term, signature, and fleet-mechanics defects — the things that decide when the
 * clock starts and what happens to SIMs while it runs.
 */

import type { DetectedFlag, FlagRule, RuleContext } from './types';
import { evidenceFor } from './types';

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function isValidDate(s: string | null): s is string {
  return typeof s === 'string' && Number.isFinite(Date.parse(s));
}

/* -------------------------------------------------------------------------- */

/** Both parties signed after the deadline the order form set for signing. */
export const signedAfterDeadline: FlagRule = {
  id: 'signed_after_deadline',
  category: 'term',
  describes: 'Execution happened after the stated signature deadline.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const { signatureDeadline, actualSignatureDate } = ctx.config.term;
    if (!isValidDate(signatureDeadline) || !isValidDate(actualSignatureDate)) return [];
    if (Date.parse(actualSignatureDate) <= Date.parse(signatureDeadline)) return [];

    const late = daysBetween(signatureDeadline, actualSignatureDate);

    return [
      {
        ruleId: signedAfterDeadline.id,
        severity: 'non_blocking',
        category: 'term',
        title: 'Signature deadline was missed',
        detail:
          `The order form set a signature deadline of ${signatureDeadline}, and it was executed on ` +
          `${actualSignatureDate} — ${late} day${late === 1 ? '' : 's'} late. Whether the quoted rates still ` +
          `stand past their own deadline is worth confirming rather than assuming.`,
        question: `Confirm the rates and terms still stand given execution was ${late} day${late === 1 ? '' : 's'} after the deadline.`,
        pointers: ['/term/signatureDeadline', '/term/actualSignatureDate'],
        evidence: evidenceFor(ctx, '/term/signatureDeadline', '/term/actualSignatureDate'),
        impact: { kind: 'unknown', amount: null, note: 'Contractual validity question, not a rate change.' },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: false },
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */

/**
 * The term starts before anyone signed.
 *
 * More consequential than it looks: the start date sets month 1 for the entire
 * minimum-spend schedule and the term end date, so a backdated start shifts every
 * band and the renewal notice window with it.
 */
export const startPrecedesExecution: FlagRule = {
  id: 'start_precedes_execution',
  category: 'term',
  describes: 'The order form start date is earlier than the date it was executed.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const { startDate, actualSignatureDate } = ctx.config.term;
    if (!isValidDate(startDate) || !isValidDate(actualSignatureDate)) return [];
    if (Date.parse(startDate) >= Date.parse(actualSignatureDate)) return [];

    const gap = daysBetween(startDate, actualSignatureDate);
    const prepaid = ctx.config.term.prepaidTransitionWeeks;

    return [
      {
        ruleId: startPrecedesExecution.id,
        severity: 'blocking',
        category: 'term',
        title: 'Start date precedes execution',
        detail:
          `The order form start date is ${startDate}, ${gap} day${gap === 1 ? '' : 's'} before both parties ` +
          `signed on ${actualSignatureDate}. The start date sets month 1 for the whole minimum-spend schedule ` +
          `and the term end date, so it is not a cosmetic discrepancy` +
          (prepaid !== null
            ? `. There is also a ${prepaid}-week prepaid-to-invoicing transition window that overlaps this gap.`
            : '.'),
        question:
          `Confirm ${startDate} stands as the start date, and how the first invoice handles the ${gap}-day gap ` +
          `before execution.`,
        pointers: ['/term/startDate', '/term/actualSignatureDate'],
        evidence: evidenceFor(ctx, '/term/startDate', '/term/actualSignatureDate'),
        impact: {
          kind: 'per_invoice',
          amount: null,
          note: 'Shifts every minimum-spend band and the term end date.',
        },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: true },
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */

/**
 * Per-SIM charges with no stated measurement point.
 *
 * The count drives both the recurring charge and, under pooling, the pool size —
 * so a snapshot-versus-average choice moves the invoice twice.
 */
export const undefinedSimCountBasis: FlagRule = {
  id: 'undefined_sim_count_basis',
  category: 'term',
  describes: 'Per-SIM charges exist but the contract never says how SIMs are counted.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const hasPerSim = ctx.config.charges.some(
      (c) => c.unit === 'per_sim' && c.frequency === 'monthly',
    );
    if (!hasPerSim) return [];
    // The contract answers the question — nothing to raise.
    if (ctx.config.term.simCountBasis !== null) return [];

    const pooled = ctx.config.ratePlan.pooling;

    return [
      {
        ruleId: undefinedSimCountBasis.id,
        severity: 'blocking',
        category: 'term',
        title: '"Active SIM count" is not defined',
        detail:
          `Billing runs on ${ctx.config.term.billingCycle?.replace(/_/g, ' ') ?? 'a recurring cycle'}, but nothing ` +
          `states whether the SIM count is a snapshot on the last day, the first day, an average, or a peak. ` +
          (pooled
            ? 'It drives both the recurring charge and the pool size, so the choice moves the invoice twice.'
            : 'It drives the recurring charge directly.'),
        question: 'Confirm the measurement point for active SIM count. Configured as a month-end snapshot.',
        pointers: ['/term/billingCycle', '/charges'],
        evidence: evidenceFor(ctx, '/term/billingCycle'),
        impact: {
          kind: 'per_invoice',
          amount: null,
          note: 'Affects every month with fleet movement.',
        },
        policyField: 'simCountBasis',
        blocks: { simulation: false, months: null, goLive: true },
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */

/** Calendar-month billing with no proration rule for mid-month activation. */
export const noProrationRule: FlagRule = {
  id: 'no_proration_rule',
  category: 'term',
  describes: 'Calendar-month billing with no stated proration for mid-cycle activation.',
  detect(ctx: RuleContext): DetectedFlag[] {
    if (ctx.config.term.billingCycle !== 'calendar_month') return [];
    const mrc = ctx.config.charges.find((c) => c.unit === 'per_sim' && c.frequency === 'monthly');
    if (!mrc) return [];
    if (ctx.config.term.prorationOnActivation !== null) return [];

    const rate = mrc.rate.kind === 'fixed' ? mrc.rate.amount : null;

    return [
      {
        ruleId: noProrationRule.id,
        severity: 'blocking',
        category: 'term',
        title: 'Mid-month activation proration is not addressed',
        detail:
          'Billing runs on calendar months, but nothing covers what happens when a SIM goes ACTIVE partway ' +
          'through a month, or when one is deactivated. This affects every month with fleet movement, which ' +
          'during a migration is most of them.',
        question: `Is the ${rate !== null ? `$${rate.toFixed(2)} ` : ''}recurring charge prorated, or charged in full for the activation month? Configured as a full month.`,
        pointers: ['/term/billingCycle'],
        evidence: evidenceFor(ctx, '/term/billingCycle'),
        impact: {
          kind: 'per_sim',
          amount: rate,
          note: 'Applies to each SIM activated or deactivated mid-cycle.',
        },
        policyField: 'prorateMidMonthActivation',
        blocks: { simulation: false, months: null, goLive: true },
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */

/** A migration commitment with no completion date or escalation path. */
export const noMigrationDeadline: FlagRule = {
  id: 'no_migration_deadline',
  category: 'migration',
  describes: 'A migration is promised with no deadline or success criteria.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const m = ctx.config.migration;
    if (!m || !m.attempted || m.deadline !== null) return [];

    const start = ctx.config.term.startDate;

    return [
      {
        ruleId: noMigrationDeadline.id,
        severity: 'non_blocking',
        category: 'migration',
        title: 'No migration deadline or completion criteria',
        detail:
          'The contract commits only to attempting migration — there is no completion date, success threshold, ' +
          'or escalation trigger.' +
          (start ? ` The minimum-spend clock started ${start} regardless of migration progress.` : ''),
        question:
          'What is the target completion date for migration, and what happens to SIMs still unmigrated after it?',
        pointers: ['/migration/deadline'],
        evidence: evidenceFor(ctx, '/migration/onSuccess', '/migration/onFailure'),
        impact: {
          kind: 'unknown',
          amount: null,
          note: 'Unmigrated SIMs bill at unstated rates for an unbounded period.',
        },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: false },
      },
    ];
  },
};

export const termRules: FlagRule[] = [
  signedAfterDeadline,
  startPrecedesExecution,
  undefinedSimCountBasis,
  noProrationRule,
  noMigrationDeadline,
];
