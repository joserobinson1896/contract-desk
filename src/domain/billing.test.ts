/**
 * Billing engine tests.
 *
 * The two worked months from the contract-to-billing analysis are the anchor
 * cases. They exercise both branches of the minimum-spend MAX, which is the part
 * most likely to be silently wrong: one month where actual fees win, one where the
 * floor does.
 */

import { describe, expect, it } from 'vitest';

import { minimumForMonth, simulateMonth, toCents } from './billing';
import { createDefaultPolicy, setPolicyField } from './policy';
import { HALCYON_CONFIG } from '../fixtures/halcyon';
import type { BillingConfig } from './schema';

const policy = createDefaultPolicy();

function expectOk(outcome: ReturnType<typeof simulateMonth>) {
  if (!outcome.ok) throw new Error(`Expected success, got: ${outcome.reason} — ${outcome.message}`);
  return outcome.breakdown;
}

/* -------------------------------------------------------------------------- */

describe('worked month 8 — actual fees control', () => {
  const breakdown = expectOk(
    simulateMonth(HALCYON_CONFIG, policy, { month: 8, activeSims: 150, mbUsed: 2400 }),
  );

  it('pools 10 MB per SIM into a shared allowance', () => {
    expect(breakdown.mbIncluded).toBe(1500);
  });

  it('assesses overage against the pool total, not per SIM', () => {
    expect(breakdown.overageMb).toBe(900);
  });

  it('computes qualifying fees of $1,039.50', () => {
    expect(breakdown.qualifyingFees).toBe(1039.5);
  });

  it('applies the months 7-12 minimum of $600.00', () => {
    expect(breakdown.applicableMinimum).toBe(600);
  });

  it('lets actual fees control, since they exceed the minimum', () => {
    expect(breakdown.controlling).toBe('actual');
  });

  it('invoices $1,039.50 exclusive of tax', () => {
    expect(breakdown.invoiceTotal).toBe(1039.5);
  });
});

/* -------------------------------------------------------------------------- */

describe('worked month 5 — the minimum controls', () => {
  const breakdown = expectOk(
    simulateMonth(HALCYON_CONFIG, policy, { month: 5, activeSims: 20, mbUsed: 100 }),
  );

  it('creates no overage when usage sits inside the pool', () => {
    expect(breakdown.mbIncluded).toBe(200);
    expect(breakdown.overageMb).toBe(0);
  });

  it('computes qualifying fees of $48.60', () => {
    expect(breakdown.qualifyingFees).toBe(48.6);
  });

  it('lets the $300.00 minimum control', () => {
    expect(breakdown.applicableMinimum).toBe(300);
    expect(breakdown.controlling).toBe('minimum');
  });

  it('invoices $300.00', () => {
    expect(breakdown.invoiceTotal).toBe(300);
  });
});

/* -------------------------------------------------------------------------- */

describe('the pooled-data trap', () => {
  it('does not create overage when one SIM exceeds its own allowance but the pool has room', () => {
    // 10 SIMs share 100 MB. One SIM using 50 MB is irrelevant while the pool holds.
    const breakdown = expectOk(
      simulateMonth(HALCYON_CONFIG, policy, { month: 5, activeSims: 10, mbUsed: 60 }),
    );
    expect(breakdown.overageMb).toBe(0);
  });

  it('scales the pool with the SIM count rather than using a flat allowance', () => {
    const small = expectOk(
      simulateMonth(HALCYON_CONFIG, policy, { month: 5, activeSims: 10, mbUsed: 0 }),
    );
    const large = expectOk(
      simulateMonth(HALCYON_CONFIG, policy, { month: 5, activeSims: 100, mbUsed: 0 }),
    );
    expect(small.mbIncluded).toBe(100);
    expect(large.mbIncluded).toBe(1000);
  });
});

/* -------------------------------------------------------------------------- */

describe('month 12 — the overlapping band', () => {
  it('refuses to compute while the overlap is unresolved', () => {
    const outcome = simulateMonth(HALCYON_CONFIG, policy, {
      month: 12,
      activeSims: 100,
      mbUsed: 500,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('ambiguous_minimum');
    expect(outcome.message).toContain('$600.00');
    expect(outcome.message).toContain('$1200.00');
  });

  it('computes once a human records which band controls', () => {
    const decided = setPolicyField(policy, 'overlappingBandResolution', 'upper', 'test');
    const breakdown = expectOk(
      simulateMonth(HALCYON_CONFIG, decided, { month: 12, activeSims: 100, mbUsed: 500 }),
    );
    expect(breakdown.applicableMinimum).toBe(1200);
    expect(breakdown.controlling).toBe('minimum');
  });

  it('honours the lower band when that is the decision', () => {
    const decided = setPolicyField(policy, 'overlappingBandResolution', 'lower', 'test');
    const breakdown = expectOk(
      simulateMonth(HALCYON_CONFIG, decided, { month: 12, activeSims: 100, mbUsed: 500 }),
    );
    expect(breakdown.applicableMinimum).toBe(600);
  });

  it('leaves every unambiguous month computable meanwhile', () => {
    for (const month of [1, 5, 8, 11, 13, 25, 40]) {
      const outcome = simulateMonth(HALCYON_CONFIG, policy, {
        month,
        activeSims: 50,
        mbUsed: 100,
      });
      expect(outcome.ok, `month ${month} should compute`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('non-qualifying charges', () => {
  it('bills SIM hardware without letting it count toward the minimum', () => {
    const breakdown = expectOk(
      simulateMonth(HALCYON_CONFIG, policy, {
        month: 5,
        activeSims: 20,
        mbUsed: 100,
        nonQualifyingCharges: 45, // ten G3-F SIMs at $4.50
      }),
    );
    // Qualifying fees stay at the recurring charge alone...
    expect(breakdown.qualifyingFees).toBe(48.6);
    // ...so the floor still controls...
    expect(breakdown.controlling).toBe('minimum');
    expect(breakdown.ratePlanTotal).toBe(300);
    // ...and the hardware rides on top rather than counting toward it.
    expect(breakdown.invoiceTotal).toBe(345);
  });
});

/* -------------------------------------------------------------------------- */

describe('test mode', () => {
  it('excludes Test Mode SIMs from the pool by default', () => {
    const breakdown = expectOk(
      simulateMonth(HALCYON_CONFIG, policy, {
        month: 5,
        activeSims: 10,
        testModeSims: 40,
        mbUsed: 0,
      }),
    );
    expect(breakdown.mbIncluded).toBe(100);
    expect(breakdown.poolContributingSims).toBe(10);
  });

  it('includes them once policy says they contribute', () => {
    const decided = setPolicyField(policy, 'testModeSimsContributeToPool', true, 'test');
    const breakdown = expectOk(
      simulateMonth(HALCYON_CONFIG, decided, {
        month: 5,
        activeSims: 10,
        testModeSims: 40,
        mbUsed: 0,
      }),
    );
    expect(breakdown.mbIncluded).toBe(500);
  });

  it('never bills a Test Mode SIM the recurring charge', () => {
    const breakdown = expectOk(
      simulateMonth(HALCYON_CONFIG, policy, {
        month: 5,
        activeSims: 10,
        testModeSims: 40,
        mbUsed: 0,
      }),
    );
    expect(breakdown.billableSims).toBe(10);
    const mrc = breakdown.lines.find((l) => l.chargeId === 'mrc');
    expect(mrc?.amount).toBe(toCents(10 * 2.43));
  });

  it('excludes Test Mode SMS from the invoice by default', () => {
    const breakdown = expectOk(
      simulateMonth(HALCYON_CONFIG, policy, {
        month: 5,
        activeSims: 10,
        mbUsed: 0,
        outboundSms: 100,
        testModeOutboundSms: 40,
      }),
    );
    const sms = breakdown.lines.find((l) => l.chargeId === 'sms_outbound');
    expect(sms?.quantity).toBe(60);
  });
});

/* -------------------------------------------------------------------------- */

describe('contracts that are not Halcyon', () => {
  it('skips the MAX entirely when there is no minimum spend', () => {
    const noMinimum: BillingConfig = { ...HALCYON_CONFIG, minimumSpend: null };
    const breakdown = expectOk(
      simulateMonth(noMinimum, policy, { month: 5, activeSims: 20, mbUsed: 100 }),
    );
    expect(breakdown.applicableMinimum).toBeNull();
    expect(breakdown.controlling).toBe('none');
    expect(breakdown.invoiceTotal).toBe(48.6);
  });

  it('uses a flat allowance when the plan does not pool', () => {
    const unpooled: BillingConfig = {
      ...HALCYON_CONFIG,
      ratePlan: { ...HALCYON_CONFIG.ratePlan, pooling: false, overageBasis: 'per_sim' },
      minimumSpend: null,
    };
    const breakdown = expectOk(
      simulateMonth(unpooled, policy, { month: 5, activeSims: 20, mbUsed: 100 }),
    );
    // 20 SIMs × 10 MB assessed per SIM, not as one 200 MB pool.
    expect(breakdown.mbIncluded).toBe(10);
    expect(breakdown.overageMb).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('input guards', () => {
  it('rejects a month below 1', () => {
    const outcome = simulateMonth(HALCYON_CONFIG, policy, { month: 0, activeSims: 1, mbUsed: 0 });
    expect(outcome.ok).toBe(false);
  });

  it('rejects negative SIM counts and usage', () => {
    expect(
      simulateMonth(HALCYON_CONFIG, policy, { month: 1, activeSims: -1, mbUsed: 0 }).ok,
    ).toBe(false);
    expect(
      simulateMonth(HALCYON_CONFIG, policy, { month: 1, activeSims: 1, mbUsed: -5 }).ok,
    ).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('minimumForMonth', () => {
  it('reports ambiguity rather than picking a band', () => {
    expect(minimumForMonth(HALCYON_CONFIG, policy, 12).kind).toBe('ambiguous');
  });

  it('reports `none` when the contract has no minimum spend', () => {
    const noMinimum: BillingConfig = { ...HALCYON_CONFIG, minimumSpend: null };
    expect(minimumForMonth(noMinimum, policy, 5).kind).toBe('none');
  });

  it('extends the final open-ended band past the initial term', () => {
    const found = minimumForMonth(HALCYON_CONFIG, policy, 99);
    expect(found.kind).toBe('found');
    if (found.kind === 'found') expect(found.amount).toBe(2400);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Term-level totals.
 *
 * The single-month cases above pin the formula at a point. These walk a span of
 * months and sum it, which is what catches a calculation that quietly ignores one
 * of its inputs — a month-end total that never moves when the fleet grows, or a
 * term total that is really one month repeated.
 *
 * Note what does and does not vary. Qualifying fees carry no month term:
 *
 *   qualifying_fees = (sims × 2.43) + (MAX(0, mb_used − sims × 10) × 0.75)
 *                     + sms_charge − credits
 *
 * so at a fixed fleet and usage they are identical in every month. The month
 * enters one level up, through `minimum(month)` in the greater-of test. A term
 * total therefore steps as the bands step, while the qualifying-fee figure behind
 * it holds flat — both halves of that are asserted below.
 */
describe('term totals', () => {
  /** Sum `months` of identical usage, as a projection over a span of the term would. */
  function runTerm(months: number[], activeSims: number, mbUsed: number) {
    const breakdowns = months.map((month) =>
      expectOk(simulateMonth(HALCYON_CONFIG, policy, { month, activeSims, mbUsed })),
    );
    return {
      breakdowns,
      total: toCents(breakdowns.reduce((sum, b) => sum + b.invoiceTotal, 0)),
    };
  }

  const MONTHS_1_TO_6 = [1, 2, 3, 4, 5, 6];

  describe('40 SIMs over 6 months at 500 MB/month', () => {
    const { breakdowns, total } = runTerm(MONTHS_1_TO_6, 40, 500);

    it('pools 400 MB and bills 100 MB of overage', () => {
      expect(breakdowns[0].mbIncluded).toBe(400);
      expect(breakdowns[0].overageMb).toBe(100);
    });

    // 40 × $2.43 = $97.20 recurring, plus 100 MB × $0.75 = $75.00 overage.
    it('computes the same $172.20 of qualifying fees in every month', () => {
      for (const b of breakdowns) expect(b.qualifyingFees).toBe(172.2);
    });

    it('lets actual fees control in months 1-3, where the minimum is $3.00', () => {
      for (const b of breakdowns.slice(0, 3)) {
        expect(b.applicableMinimum).toBe(3);
        expect(b.controlling).toBe('actual');
        expect(b.invoiceTotal).toBe(172.2);
      }
    });

    it('lets the $300.00 minimum control in months 4-6', () => {
      for (const b of breakdowns.slice(3)) {
        expect(b.applicableMinimum).toBe(300);
        expect(b.controlling).toBe('minimum');
        expect(b.invoiceTotal).toBe(300);
      }
    });

    // (3 × $172.20) + (3 × $300.00) = $516.60 + $900.00
    it('totals $1,416.60 over the six months', () => {
      expect(total).toBe(1416.6);
    });
  });

  describe('the same six months at 80 SIMs', () => {
    const { breakdowns, total } = runTerm(MONTHS_1_TO_6, 80, 500);

    // 80 SIMs pool 800 MB, so 500 MB of usage now sits inside the allowance and
    // the overage line disappears entirely.
    it('drops the overage once the pool outgrows the usage', () => {
      expect(breakdowns[0].mbIncluded).toBe(800);
      expect(breakdowns[0].overageMb).toBe(0);
    });

    // 80 × $2.43 = $194.40, with no overage behind it.
    it('computes $194.40 of qualifying fees in every month', () => {
      for (const b of breakdowns) expect(b.qualifyingFees).toBe(194.4);
    });

    // (3 × $194.40) + (3 × $300.00) = $583.20 + $900.00
    it('totals $1,483.20 over the six months', () => {
      expect(total).toBe(1483.2);
    });

    it('differs from the 40-SIM term, so the total tracks the fleet', () => {
      expect(total).not.toBe(runTerm(MONTHS_1_TO_6, 40, 500).total);
    });
  });

  it('steps the total as the bands step, at a fixed fleet and usage', () => {
    // Same inputs in every month; only the band changes. Month 12 is omitted —
    // it sits in two bands and refuses to compute until someone decides.
    const perMonth = [7, 11, 13, 24, 25, 36].map(
      (month) => expectOk(simulateMonth(HALCYON_CONFIG, policy, { month, activeSims: 150, mbUsed: 2400 })),
    );

    expect(perMonth.map((b) => b.qualifyingFees)).toEqual([
      1039.5, 1039.5, 1039.5, 1039.5, 1039.5, 1039.5,
    ]);
    expect(perMonth.map((b) => b.invoiceTotal)).toEqual([
      1039.5, 1039.5, 1200, 1200, 2400, 2400,
    ]);
  });
});
