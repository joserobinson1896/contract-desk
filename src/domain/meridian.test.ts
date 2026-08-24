/**
 * The clean reference contract.
 *
 * Halcyon proves the engine finds defects. Meridian proves it does not invent
 * them — a well-drafted contract of the same shape must be silent, or every
 * finding on Halcyon is suspect.
 *
 * It also has to stay invoiceable. If a future rule starts firing here, the
 * happy path becomes unreachable in the app, and this test is what says so.
 */

import { describe, expect, it } from 'vitest';

import { simulateMonth } from './billing';
import { buildFlags, canGoLive } from './flags';
import { createDefaultPolicy } from './policy';
import { MERIDIAN_CONFIG, MERIDIAN_COVERAGE, MERIDIAN_PROVENANCE } from '../fixtures/meridian';

const { flags } = buildFlags({
  config: MERIDIAN_CONFIG,
  provenance: MERIDIAN_PROVENANCE,
  coverage: MERIDIAN_COVERAGE,
});

describe('Meridian Freight Systems', () => {
  it('raises no findings at all', () => {
    expect(flags.map((f) => f.ruleId)).toEqual([]);
  });

  it('can therefore go live, and be invoiced', () => {
    expect(canGoLive(flags)).toBe(true);
  });

  it('has contiguous spend bands — no overlap and no gap', () => {
    const schedule = MERIDIAN_CONFIG.minimumSpend!.schedule;
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].startMonth).toBe((schedule[i - 1].endMonth ?? 0) + 1);
    }
  });

  it('computes every month of the initial term without blocking', () => {
    const policy = createDefaultPolicy();
    for (let month = 1; month <= 24; month++) {
      const outcome = simulateMonth(MERIDIAN_CONFIG, policy, {
        month,
        activeSims: 200,
        mbUsed: 6000,
      });
      expect(outcome.ok, `month ${month} did not compute`).toBe(true);
    }
  });

  it('bills a worked month to the cent', () => {
    // 200 SIMs × $3.15 = $630.00 recurring.
    // Pool is 200 × 25 = 5,000 MB; 6,000 used leaves 1,000 MB over at $0.60 = $600.00.
    // Priority Support adds $150.00 flat. Qualifying fees = $1,380.00.
    // Month 8 sits in the 7-12 band at $900.00, so actual fees control.
    const outcome = simulateMonth(MERIDIAN_CONFIG, createDefaultPolicy(), {
      month: 8,
      activeSims: 200,
      mbUsed: 6000,
    });
    if (!outcome.ok) throw new Error(outcome.message);

    expect(outcome.breakdown.mbIncluded).toBe(5000);
    expect(outcome.breakdown.overageMb).toBe(1000);
    expect(outcome.breakdown.qualifyingFees).toBe(1380);
    expect(outcome.breakdown.applicableMinimum).toBe(900);
    expect(outcome.breakdown.controlling).toBe('actual');
    expect(outcome.breakdown.invoiceTotal).toBe(1380);
  });

  it('lets the minimum control on a quiet month', () => {
    // 20 SIMs × $3.15 = $63.00, pool 500 MB covers 300 used, plus $150 support
    // = $213.00 against a $450.00 floor in month 3.
    const outcome = simulateMonth(MERIDIAN_CONFIG, createDefaultPolicy(), {
      month: 3,
      activeSims: 20,
      mbUsed: 300,
    });
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.breakdown.qualifyingFees).toBe(213);
    expect(outcome.breakdown.controlling).toBe('minimum');
    expect(outcome.breakdown.invoiceTotal).toBe(450);
  });
});
