/**
 * Test Mode defects.
 *
 * Test Mode is where two sections of a contract routinely disagree: the pooling
 * section says every SIM contributes, the Test Mode section says nothing is charged
 * until ACTIVE. Both cannot be true without the pool inflating for free.
 */

import type { DetectedFlag, FlagRule, RuleContext } from './types';
import { evidenceFor, money, pricedCharges } from './types';

/* -------------------------------------------------------------------------- */

/**
 * Pooling and Test Mode in the same contract.
 *
 * If a non-billable SIM still adds its allowance to the pool, the pool grows with
 * no revenue behind it and overage is undercharged. Structural: fires wherever both
 * features coexist, since no contract seen so far reconciles them explicitly.
 */
export const testModePoolConflict: FlagRule = {
  id: 'testmode_pool_conflict',
  category: 'test_mode',
  describes: 'Pooling and Test Mode conflict over whether non-billable SIMs enlarge the pool.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const { testMode, ratePlan } = ctx.config;
    if (!testMode || !ratePlan.pooling) return [];
    // The contract settles it, so there is no conflict to raise.
    if (testMode.poolContribution !== null) return [];

    const included = ratePlan.includedDataMbPerSim;
    const mrc = ctx.config.charges.find((c) => c.unit === 'per_sim' && c.frequency === 'monthly');
    const mrcRate = mrc?.rate.kind === 'fixed' ? mrc.rate.amount : null;

    return [
      {
        ruleId: testModePoolConflict.id,
        severity: 'blocking',
        category: 'test_mode',
        title: 'Test Mode SIMs and the data pool conflict',
        detail:
          `The pooling section says every SIM added to the pool contributes its included data` +
          (included !== null ? ` (${included} MB)` : '') +
          `. The Test Mode section says a SIM is not charged until it goes ACTIVE. If a Test Mode SIM ` +
          `contributes` +
          (included !== null ? ` ${included} MB` : '') +
          ` without paying` +
          (mrcRate !== null ? ` its ${money(mrcRate)} recurring charge` : ' the recurring charge') +
          `, the pool inflates with no revenue behind it and overage is undercharged.`,
        question:
          'Do Test Mode SIMs contribute their included data to the pool? Configured on the assumption ' +
          'that they neither pay nor contribute.',
        pointers: ['/ratePlan/pooling', '/testMode'],
        evidence: evidenceFor(ctx, '/ratePlan/pooling', '/ratePlan/poolAccess', '/testMode'),
        impact: {
          kind: 'per_invoice',
          amount: null,
          note: 'Understates overage in any month with SIMs still in Test Mode.',
        },
        policyField: 'testModeSimsContributeToPool',
        blocks: { simulation: false, months: null, goLive: true },
      },
    ];
  },
};

/* -------------------------------------------------------------------------- */

/**
 * A priced product the exit clause never names.
 *
 * When the clause says only certain charges begin at ACTIVE, every other priced
 * product on the order form is left undefined for the Test Mode window. Computed
 * as a set difference, so it catches whatever a given contract happens to omit.
 */
export const testModeChargeGap: FlagRule = {
  id: 'testmode_charge_gap',
  category: 'test_mode',
  describes: 'A priced product is not named among the charges that begin when Test Mode ends.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const { testMode } = ctx.config;
    if (!testMode || testMode.onExitChargesBegin.length === 0) return [];

    const named = new Set(testMode.onExitChargesBegin);

    // Only recurring/usage products matter here — one-time hardware and taxes are
    // not tied to SIM state, so their absence from the exit clause is not a gap.
    const relevant = pricedCharges(ctx.config).filter(
      (c) =>
        !named.has(c.kind) &&
        c.frequency !== 'one_time' &&
        c.frequency !== 'per_invoice' &&
        c.kind !== 'tax' &&
        c.kind !== 'hardware',
    );

    return relevant.map((charge) => {
      const idx = ctx.config.charges.indexOf(charge);
      const rate = charge.rate.amount ?? 0;
      const trigger = testMode.exitTriggers.outboundSms;
      const exposure = charge.unit === 'per_sms' && trigger ? rate * trigger : null;

      return {
        ruleId: testModeChargeGap.id,
        severity: 'blocking' as const,
        category: 'test_mode' as const,
        title: `${charge.label} during Test Mode is not addressed`,
        detail:
          `The exit clause names ${[...named].map((k) => k.replace(/_/g, ' ')).join(' and ')} as beginning when ` +
          `a SIM goes ACTIVE. ${charge.label} is a separate priced product on this order form and is not named, ` +
          `so whether it is billed during the Test Mode window is undefined` +
          (exposure !== null
            ? `. A SIM may send up to ${trigger} messages before converting, leaving ${money(exposure)} per SIM undefined.`
            : '.'),
        question: `Is ${charge.label} billed while a SIM is in Test Mode? Configured as not billed, consistent with the SIM being non-billable until ACTIVE.`,
        pointers: [`/charges/${idx}`, '/testMode/onExitChargesBegin'],
        evidence: evidenceFor(ctx, '/testMode/onExitChargesBegin', `/charges/${idx}`),
        impact: {
          kind: 'per_sim' as const,
          amount: exposure,
          note:
            exposure !== null
              ? `Up to ${money(exposure)} per SIM across the Test Mode window.`
              : 'Applies to every SIM passing through Test Mode.',
        },
        policyField: charge.unit === 'per_sms' ? ('testModeSmsBilled' as const) : null,
        blocks: { simulation: false, months: null, goLive: true },
      };
    });
  },
};

export const testModeRules: FlagRule[] = [testModePoolConflict, testModeChargeGap];
