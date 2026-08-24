/**
 * Field projection tests.
 *
 * The load-bearing assertion here is the null one. `null` means the contract is
 * silent, and the whole app exists to surface exactly that — a projection that
 * renders it as `0`, `false`, or a blank cell hides the gap the reader is looking
 * for. Everything else in this file is arithmetic on top of that.
 */

import { describe, expect, it } from 'vitest';

import { absentCount, contractFields } from './fields';
import { HALCYON_CONFIG } from '../fixtures/halcyon';
import type { BillingConfig } from './schema';

const groups = contractFields(HALCYON_CONFIG);
const all = groups.flatMap((g) => g.fields);
const byLabel = (label: string) => all.find((f) => f.label === label);

/* -------------------------------------------------------------------------- */

describe('coverage of the spec field set', () => {
  it('emits every group from Table 1 plus commercial terms', () => {
    expect(groups.map((g) => g.title)).toEqual([
      'Account',
      'Rate plan & included data',
      'Terms, renewal & payment',
      'Test mode conversion',
      'Migration',
      'Commercial terms',
    ]);
  });

  it('never repeats a label, so the grid cannot show the same field twice', () => {
    const labels = all.map((f) => f.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('omits the columns the collapsed row already shows', () => {
    // Repeating these would make the reader check whether the two agreed.
    expect(byLabel('Customer')).toBeUndefined();
    expect(byLabel('Rate plan')).toBeUndefined();
    expect(byLabel('Status')).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe('the reference contract reads correctly', () => {
  it('transcribes account identity', () => {
    expect(byLabel('Hologram Org ID')?.value).toBe('90342');
    expect(byLabel('Order form number')?.value).toBe('00002891');
  });

  it('states the term as signed', () => {
    expect(byLabel('Start date')?.value).toBe('2026-08-01');
    expect(byLabel('Initial term')?.value).toBe('36 months');
    expect(byLabel('Signature deadline')?.value).toBe('2026-07-31');
    expect(byLabel('Actual signature date')?.value).toBe('2026-08-05');
  });

  it('reports pooling as the shared allowance it is', () => {
    expect(byLabel('Included data per SIM')?.value).toBe('10 MB');
    expect(byLabel('Pooling')?.value).toMatch(/shared/i);
    expect(byLabel('Overage assessed on')?.value).toBe('Pool total');
  });

  it('singularises counts of one', () => {
    expect(byLabel('Renewal term')?.value).toBe('12 months');
    expect(byLabel('Non-renewal notice')?.value).toBe('30 days');
  });
});

/* -------------------------------------------------------------------------- */

describe('silence is preserved, not filled in', () => {
  it('renders a null migration deadline as Not stated, and marks it absent', () => {
    // The contract genuinely does not set one — it is finding #12.
    const deadline = byLabel('Migration deadline');
    expect(deadline?.value).toBe('Not stated');
    expect(deadline?.absent).toBe(true);
  });

  it('renders an unstated assessment cadence as Not stated', () => {
    expect(byLabel('Assessment cadence')?.value).toBe('Not stated');
  });

  it('never renders a null number as 0 or a null boolean as No', () => {
    const stripped: BillingConfig = {
      ...HALCYON_CONFIG,
      term: {
        ...HALCYON_CONFIG.term,
        initialTermMonths: null,
        autoRenew: null,
        nonRenewalNoticeDays: null,
      },
    };
    const fields = contractFields(stripped).flatMap((g) => g.fields);
    const find = (l: string) => fields.find((f) => f.label === l);

    expect(find('Initial term')?.value).toBe('Not stated');
    expect(find('Auto renewal')?.value).toBe('Not stated');
    expect(find('Non-renewal notice')?.value).toBe('Not stated');

    // The distinction that matters: a real zero still reads as a zero.
    const zeroed = contractFields({
      ...HALCYON_CONFIG,
      term: { ...HALCYON_CONFIG.term, nonRenewalNoticeDays: 0 },
    }).flatMap((g) => g.fields);
    expect(zeroed.find((f) => f.label === 'Non-renewal notice')?.value).toBe('0 days');
  });

  it('marks absent only the fields that really are silent', () => {
    expect(byLabel('Order form number')?.absent).toBeUndefined();
    expect(absentCount(groups)).toBe(all.filter((f) => f.value === 'Not stated').length);
  });
});

/* -------------------------------------------------------------------------- */

describe('optional sections', () => {
  it('drops Test mode and Migration when the contract has neither', () => {
    const bare = contractFields({ ...HALCYON_CONFIG, testMode: null, migration: null });
    expect(bare.map((g) => g.title)).not.toContain('Test mode conversion');
    expect(bare.map((g) => g.title)).not.toContain('Migration');
  });

  it('still reports commercial terms when there is no minimum spend', () => {
    const bare = contractFields({ ...HALCYON_CONFIG, minimumSpend: null });
    const commercial = bare.find((g) => g.title === 'Commercial terms');
    expect(commercial?.fields.find((f) => f.label === 'Spend periods')?.value).toBe('0');
    expect(commercial?.fields.find((f) => f.label === 'Core rule')?.value).toBe('Not stated');
  });
});
