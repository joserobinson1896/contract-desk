/**
 * Minimum-spend defects.
 *
 * These are the most expensive class to get wrong: a schedule error is silently
 * multiplied across every invoice in the band, and a commitment amount feeds
 * revenue forecasting as well as billing.
 */

import type { DetectedFlag, FlagRule, RuleContext } from './types';
import { evidenceFor, money } from './types';

const P = '/minimumSpend';

/* -------------------------------------------------------------------------- */

/**
 * Two bands claiming the same month.
 *
 * A billing system cannot load overlapping periods, and the two readings differ by
 * real money on that month's invoice. Blocks only the disputed months — the rest of
 * the schedule stays computable, so one defect doesn't ground the whole contract.
 */
export const spendBandOverlap: FlagRule = {
  id: 'spend_band_overlap',
  category: 'minimum_spend',
  describes: 'Two minimum-spend periods cover the same month.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const ms = ctx.config.minimumSpend;
    if (!ms) return [];

    const sorted = [...ms.schedule].sort((a, b) => a.startMonth - b.startMonth);
    const out: DetectedFlag[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a.endMonth === null || a.endMonth < b.startMonth) continue;

      const overlapStart = b.startMonth;
      const overlapEnd = Math.min(a.endMonth, b.endMonth ?? a.endMonth);
      const months: number[] = [];
      for (let m = overlapStart; m <= overlapEnd; m++) months.push(m);

      const exposure = Math.abs(b.amountPerMonth - a.amountPerMonth) * months.length;

      out.push({
        ruleId: spendBandOverlap.id,
        severity: 'blocking',
        category: 'minimum_spend',
        title:
          months.length === 1
            ? `Month ${months[0]} falls in two minimum-spend bands`
            : `Months ${overlapStart}–${overlapEnd} fall in two minimum-spend bands`,
        detail:
          `Period ${a.index} covers months ${a.startMonth}–${a.endMonth} at ${money(a.amountPerMonth)}/month, ` +
          `and period ${b.index} covers months ${b.startMonth}–${b.endMonth ?? '∞'} at ${money(b.amountPerMonth)}/month. ` +
          `They overlap. A billing system cannot load overlapping periods, and the schedule as signed reads two ways.`,
        question:
          `Which amount applies in ${months.length === 1 ? `month ${months[0]}` : `months ${overlapStart}–${overlapEnd}`}: ` +
          `${money(a.amountPerMonth)} or ${money(b.amountPerMonth)}? ` +
          `If the intent was that period ${b.index} starts at month ${(a.endMonth ?? 0) + 1}, does that need an amendment ` +
          `or is written confirmation on file enough?`,
        pointers: [`${P}/schedule/${a.index}`, `${P}/schedule/${b.index}`],
        evidence: evidenceFor(ctx, `${P}/schedule/${a.index}`, `${P}/schedule/${b.index}`),
        impact: {
          kind: 'per_invoice',
          amount: Math.abs(b.amountPerMonth - a.amountPerMonth),
          note: `Up to ${money(exposure)} across the disputed month${months.length === 1 ? '' : 's'}.`,
        },
        policyField: 'overlappingBandResolution',
        blocks: { simulation: true, months, goLive: true },
      });
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */

/** A month covered by no band at all — billing has nothing to test against. */
export const spendBandGap: FlagRule = {
  id: 'spend_band_gap',
  category: 'minimum_spend',
  describes: 'A gap between minimum-spend periods leaves months uncovered.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const ms = ctx.config.minimumSpend;
    if (!ms || ms.schedule.length < 2) return [];

    const sorted = [...ms.schedule].sort((a, b) => a.startMonth - b.startMonth);
    const out: DetectedFlag[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a.endMonth === null) continue;
      if (a.endMonth + 1 >= b.startMonth) continue;

      const months: number[] = [];
      for (let m = a.endMonth + 1; m < b.startMonth; m++) months.push(m);

      out.push({
        ruleId: spendBandGap.id,
        severity: 'blocking',
        category: 'minimum_spend',
        title: `Months ${months[0]}–${months[months.length - 1]} have no minimum-spend band`,
        detail:
          `Period ${a.index} ends at month ${a.endMonth} and period ${b.index} begins at month ${b.startMonth}, ` +
          `leaving ${months.length} month${months.length === 1 ? '' : 's'} with no stated commitment. ` +
          `Either the customer owes nothing in those months or a band is missing from the order form.`,
        question:
          `What minimum applies in month${months.length === 1 ? '' : 's'} ${months.join(', ')}? ` +
          `Is the commitment genuinely zero there, or is a band missing?`,
        pointers: [`${P}/schedule/${a.index}`, `${P}/schedule/${b.index}`],
        evidence: evidenceFor(ctx, `${P}/schedule/${a.index}`, `${P}/schedule/${b.index}`),
        impact: {
          kind: 'per_invoice',
          amount: null,
          note: 'Uncovered months have no commitment floor until this is resolved.',
        },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: true },
      });
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */

/**
 * An amount wildly out of step with its neighbours.
 *
 * Compares each step against the schedule's own median step rather than a fixed
 * threshold, so it adapts to whatever escalation curve a given contract uses
 * instead of assuming Halcyon's roughly-2× pattern.
 */
export const spendBandOutlier: FlagRule = {
  id: 'spend_band_outlier',
  category: 'minimum_spend',
  describes: 'A minimum-spend amount is orders of magnitude out of step with its neighbours.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const ms = ctx.config.minimumSpend;
    if (!ms || ms.schedule.length < 3) return [];

    const sorted = [...ms.schedule].sort((a, b) => a.startMonth - b.startMonth);
    const ratios: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i].amountPerMonth;
      const to = sorted[i + 1].amountPerMonth;
      if (from > 0 && to > 0) ratios.push(to / from);
    }
    if (ratios.length < 2) return [];

    const median = [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
    if (!Number.isFinite(median) || median <= 0) return [];

    const out: DetectedFlag[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      if (from.amountPerMonth <= 0 || to.amountPerMonth <= 0) continue;

      const ratio = to.amountPerMonth / from.amountPerMonth;
      // Flag when this step is at least 10× the schedule's typical step.
      if (ratio < median * 10) continue;

      const implied = to.amountPerMonth / median;

      out.push({
        ruleId: spendBandOutlier.id,
        severity: 'blocking',
        category: 'minimum_spend',
        title: `Months ${from.startMonth}–${from.endMonth ?? '∞'} minimum reads ${money(from.amountPerMonth)}`,
        detail:
          `Period ${from.index} is ${money(from.amountPerMonth)}/month and period ${to.index} is ` +
          `${money(to.amountPerMonth)}/month — a ${Math.round(ratio)}× step, where every other step in this ` +
          `schedule is roughly ${median.toFixed(1)}×. That pattern is consistent with a misplaced decimal.`,
        question:
          `Is ${money(from.amountPerMonth)} correct for months ${from.startMonth}–${from.endMonth ?? '∞'}, ` +
          `or should it read ${money(implied)}?`,
        pointers: [`${P}/schedule/${from.index}`],
        evidence: evidenceFor(ctx, `${P}/schedule/${from.index}`),
        impact: {
          kind: 'per_invoice',
          amount: Math.abs(implied - from.amountPerMonth),
          note: `If the intended figure was ${money(implied)}, the gap is ${money(Math.abs(implied - from.amountPerMonth))} per month.`,
        },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: true },
      });
    }
    return out;
  },
};

/* -------------------------------------------------------------------------- */

/**
 * Actual Spend defined twice, two different ways.
 *
 * A general statement and a specific definition in the same paragraph. Which one
 * controls decides whether SIM purchases and setup fees count toward the
 * commitment, so it is not a drafting nicety.
 */
export const contradictoryActualSpend: FlagRule = {
  id: 'contradictory_actual_spend',
  category: 'definitions',
  describes: 'Actual Spend is defined both broadly and narrowly.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const ms = ctx.config.minimumSpend;
    if (!ms) return [];
    const { narrow, broad } = ms.actualSpendDefinitions;
    if (!narrow || !broad) return [];

    return [
      {
        ruleId: contradictoryActualSpend.id,
        severity: 'blocking',
        category: 'definitions',
        title: 'Actual Spend is defined two ways in the same section',
        detail:
          `One passage says: "${broad}". Another says: "${narrow}". ` +
          `The broad reading counts every fee on the Org ID toward the commitment; the narrow reading counts ` +
          `only rate plans, add-ons and support packages, less credits. They produce different invoices.`,
        question:
          'Confirm which definition of Actual Spend controls. Configured to the narrow reading, on the basis ' +
          'that a specific definition controls over a general statement — but this should not be assumed.',
        pointers: [
          `${P}/actualSpendDefinitions/narrow`,
          `${P}/actualSpendDefinitions/broad`,
        ],
        evidence: evidenceFor(
          ctx,
          `${P}/actualSpendDefinitions/narrow`,
          `${P}/actualSpendDefinitions/broad`,
        ),
        impact: {
          kind: 'per_invoice',
          amount: null,
          note: 'Changes which charges count toward the minimum, and so which months bill at the floor.',
        },
        policyField: 'actualSpendDefinition',
        blocks: { simulation: false, months: null, goLive: true },
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */

/**
 * The schedule is written per-month but the rule is stated per-period. Monthly
 * testing and period-aggregate testing produce different invoices whenever usage
 * is uneven, which is most of the time.
 */
export const missingAssessmentCadence: FlagRule = {
  id: 'missing_assessment_cadence',
  category: 'minimum_spend',
  describes: 'The contract does not say whether the minimum is tested monthly or per period.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const ms = ctx.config.minimumSpend;
    if (!ms || ms.assessmentCadence !== null) return [];

    return [
      {
        ruleId: missingAssessmentCadence.id,
        severity: 'blocking',
        category: 'minimum_spend',
        title: 'Minimum-spend assessment cadence is not stated',
        detail:
          'The schedule is expressed as an amount per month, but the greater-of test is stated as applying ' +
          '"for each Minimum Spend Period", and a period spans several months. Testing monthly and testing ' +
          'in aggregate at period end give different results whenever usage is uneven across the period.',
        question:
          'Is the minimum tested monthly, or in aggregate at the end of each Minimum Spend Period?',
        pointers: [`${P}/assessmentCadence`, `${P}/coreRule`],
        evidence: evidenceFor(ctx, `${P}/coreRule`),
        impact: {
          kind: 'per_invoice',
          amount: null,
          note: 'Diverges whenever usage is uneven within a period.',
        },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: true },
      },
    ];
  },
};

export const minimumSpendRules: FlagRule[] = [
  spendBandOverlap,
  spendBandGap,
  spendBandOutlier,
  contradictoryActualSpend,
  missingAssessmentCadence,
];
