/**
 * Detection tests.
 *
 * Two things are being proven here, and the second matters more than the first:
 *
 *   1. The rule set reproduces the known findings on the reference contract.
 *   2. The rule set finds defects in contracts it has never seen. Recognising
 *      Halcyon is worthless if a mutated contract sails through — so most of this
 *      file injects defects the fixture does not have and checks they surface.
 */

import { describe, expect, it } from 'vitest';

import { buildFlags, canGoLive, flagsBlockingMonth, openBlockingFlags, rebuildPreservingResolutions } from './flags';
import { ALL_RULES, assertUniqueRuleIds } from './rules';
import { HALCYON_CONFIG, HALCYON_COVERAGE, HALCYON_PROVENANCE } from '../fixtures/halcyon';
import type { BillingConfig, ModelFinding } from './schema';

function detect(config: BillingConfig, coverage = HALCYON_COVERAGE) {
  return buildFlags({ config, provenance: HALCYON_PROVENANCE, coverage });
}

const halcyon = detect(HALCYON_CONFIG);
const firedRules = new Set(halcyon.flags.map((f) => f.ruleId));

/** Deep-clone so a mutation in one test cannot leak into another. */
function mutate(fn: (c: BillingConfig) => void): BillingConfig {
  const clone: BillingConfig = JSON.parse(JSON.stringify(HALCYON_CONFIG));
  fn(clone);
  return clone;
}

/* -------------------------------------------------------------------------- */

describe('rule registry', () => {
  it('has no duplicate ids', () => {
    expect(() => assertUniqueRuleIds()).not.toThrow();
  });

  it('gives every rule a description', () => {
    for (const rule of ALL_RULES) {
      expect(rule.describes.length, `${rule.id} needs a description`).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('the reference contract', () => {
  /**
   * The written analysis groups these into 13 numbered items. The engine reports
   * 15 because it splits two of them for independent resolution: the signature
   * item becomes "signed late" plus "start precedes execution", and the SMS item
   * separates the priced outbound case from the zero-rated inbound one. Each half
   * is separately answerable, so each gets its own row.
   */
  const EXPECTED = [
    'spend_band_overlap',
    'spend_band_outlier',
    'contradictory_actual_spend',
    'missing_assessment_cadence',
    'unclassified_charge',
    'zero_rate_unclassified',
    'unpriced_supported_sku',
    'unstated_fallback_rates',
    'testmode_pool_conflict',
    'testmode_charge_gap',
    'signed_after_deadline',
    'start_precedes_execution',
    'undefined_sim_count_basis',
    'no_proration_rule',
    'no_migration_deadline',
  ];

  it.each(EXPECTED)('detects %s', (ruleId) => {
    expect(firedRules.has(ruleId)).toBe(true);
  });

  it('finds nothing beyond the expected set', () => {
    const unexpected = [...firedRules].filter((r) => r && !EXPECTED.includes(r));
    expect(unexpected).toEqual([]);
  });

  it('reports no false positives for rules this contract should not trigger', () => {
    expect(firedRules.has('spend_band_gap')).toBe(false);
    expect(firedRules.has('extraction_gap')).toBe(false);
    expect(firedRules.has('low_confidence_extraction')).toBe(false);
  });

  it('opens every finding — the app decides nothing', () => {
    expect(halcyon.flags.every((f) => f.status === 'open')).toBe(true);
    expect(halcyon.flags.every((f) => f.resolution === null)).toBe(true);
  });

  it('blocks go-live', () => {
    expect(canGoLive(halcyon.flags)).toBe(false);
    expect(openBlockingFlags(halcyon.flags).length).toBeGreaterThan(0);
  });

  it('blocks only month 12 in the simulator', () => {
    expect(flagsBlockingMonth(halcyon.flags, 12).length).toBe(1);
    expect(flagsBlockingMonth(halcyon.flags, 11).length).toBe(0);
    expect(flagsBlockingMonth(halcyon.flags, 13).length).toBe(0);
  });

  it('quantifies the month-12 exposure at $600', () => {
    const flag = halcyon.flags.find((f) => f.ruleId === 'spend_band_overlap');
    expect(flag?.impact.amount).toBe(600);
  });

  it('sorts blocking findings first', () => {
    const firstNonBlocking = halcyon.flags.findIndex((f) => f.severity === 'non_blocking');
    const lastBlocking = halcyon.flags.map((f) => f.severity).lastIndexOf('blocking');
    expect(firstNonBlocking).toBeGreaterThan(lastBlocking);
  });
});

/* -------------------------------------------------------------------------- */

describe('detection under mutation — defects Halcyon does not have', () => {
  it('catches a gap between spend bands', () => {
    const config = mutate((c) => {
      // Months 13-15 belong to nobody.
      c.minimumSpend!.schedule[2].endMonth = 12;
      c.minimumSpend!.schedule[3].startMonth = 16;
    });
    expect(new Set(detect(config).flags.map((f) => f.ruleId)).has('spend_band_gap')).toBe(true);
  });

  it('stops reporting an overlap once the schedule is corrected', () => {
    const config = mutate((c) => {
      c.minimumSpend!.schedule[3].startMonth = 13;
    });
    const ids = new Set(detect(config).flags.map((f) => f.ruleId));
    expect(ids.has('spend_band_overlap')).toBe(false);
    expect(ids.has('spend_band_gap')).toBe(false);
  });

  it('stops reporting the outlier once the decimal is fixed', () => {
    const config = mutate((c) => {
      c.minimumSpend!.schedule[0].amountPerMonth = 300;
    });
    expect(new Set(detect(config).flags.map((f) => f.ruleId)).has('spend_band_outlier')).toBe(false);
  });

  it('catches an outlier on a contract with a different escalation curve', () => {
    // A 5x curve, with one band 500x out of step. Nothing here resembles Halcyon.
    const config = mutate((c) => {
      c.minimumSpend!.schedule = [
        { index: 0, startMonth: 1, endMonth: 6, amountPerMonth: 1000 },
        { index: 1, startMonth: 7, endMonth: 12, amountPerMonth: 5000 },
        { index: 2, startMonth: 13, endMonth: 18, amountPerMonth: 25000 },
        { index: 3, startMonth: 19, endMonth: null, amountPerMonth: 12_500_000 },
      ];
    });
    expect(new Set(detect(config).flags.map((f) => f.ruleId)).has('spend_band_outlier')).toBe(true);
  });

  it('catches a newly unpriced add-on', () => {
    const config = mutate((c) => {
      c.ratePlan.supportedSimSkus.push('G4-X');
    });
    const flag = detect(config).flags.find((f) => f.ruleId === 'unpriced_supported_sku' && f.title.includes('G4-X'));
    expect(flag).toBeDefined();
  });

  it('catches a priced product the Test Mode exit clause omits', () => {
    const config = mutate((c) => {
      c.charges.push({
        id: 'voice_minutes',
        label: 'Voice minutes',
        rate: { kind: 'fixed', amount: 0.02 },
        unit: 'flat',
        frequency: 'usage',
        kind: 'add_on',
        countsTowardMinimum: 'yes',
      });
    });
    const titles = detect(config).flags.map((f) => f.title);
    expect(titles.some((t) => t.includes('Voice minutes'))).toBe(true);
  });

  it('reports extraction gaps as blocking when the field drives an invoice', () => {
    const out = detect(HALCYON_CONFIG, {
      missingFields: ['/ratePlan/overageBasis'],
      lowConfidence: [],
    });
    const flag = out.flags.find((f) => f.ruleId === 'extraction_gap');
    expect(flag?.severity).toBe('blocking');
    expect(flag?.blocks.simulation).toBe(true);
  });

  it('reports extraction gaps as non-blocking when the field does not', () => {
    const out = detect(HALCYON_CONFIG, {
      missingFields: ['/account/governingDocuments'],
      lowConfidence: [],
    });
    const flag = out.flags.find((f) => f.ruleId === 'extraction_gap');
    expect(flag?.severity).toBe('non_blocking');
  });

  /**
   * A well-drafted contract of a different shape entirely: flat platform fee, no
   * pooling, no Test Mode, no migration, contiguous bands, one Actual Spend
   * definition. Nothing here resembles Halcyon, and the engine should say nothing.
   *
   * Note the flat fee rather than a per-SIM charge — `undefined_sim_count_basis`
   * fires on any per-SIM contract that omits a measurement point, which is nearly
   * all of them. That is a true finding, not noise, so a genuinely clean contract
   * has to avoid the construct rather than have the rule look the other way.
   */
  it('goes quiet on a clean contract', () => {
    const clean: BillingConfig = mutate((c) => {
      c.minimumSpend!.schedule = [
        { index: 0, startMonth: 1, endMonth: 12, amountPerMonth: 500 },
        { index: 1, startMonth: 13, endMonth: null, amountPerMonth: 1000 },
      ];
      c.minimumSpend!.assessmentCadence = 'monthly';
      c.minimumSpend!.actualSpendDefinitions.broad = null;
      c.term.signatureDeadline = '2026-07-31';
      c.term.actualSignatureDate = '2026-07-30';
      c.term.startDate = '2026-08-01';
      c.testMode = null;
      c.migration = null;
      c.ratePlan.pooling = false;
      c.ratePlan.supportedSimSkus = [];
      c.charges = [
        {
          id: 'platform_fee',
          label: 'Platform fee',
          rate: { kind: 'fixed', amount: 500 },
          unit: 'flat',
          frequency: 'monthly',
          kind: 'rate_plan',
          countsTowardMinimum: 'yes',
        },
      ];
    });

    const out = detect(clean);
    expect(out.flags, `unexpected: ${out.flags.map((f) => f.ruleId).join(', ')}`).toEqual([]);
    expect(canGoLive(out.flags)).toBe(true);
  });

  it('still flags a per-SIM contract that never defines how SIMs are counted', () => {
    // The counterpart to the case above: identical contract, per-SIM pricing.
    const perSim: BillingConfig = mutate((c) => {
      c.minimumSpend = null;
      c.testMode = null;
      c.migration = null;
      c.ratePlan.supportedSimSkus = [];
      c.term.signatureDeadline = null;
      c.term.actualSignatureDate = null;
      c.charges = [
        {
          id: 'mrc',
          label: 'Monthly recurring charge',
          rate: { kind: 'fixed', amount: 5 },
          unit: 'per_sim',
          frequency: 'monthly',
          kind: 'rate_plan',
          countsTowardMinimum: 'yes',
        },
      ];
    });

    const ids = detect(perSim).flags.map((f) => f.ruleId);
    expect(ids).toContain('undefined_sim_count_basis');
    expect(ids).toContain('no_proration_rule');
  });
});

/* -------------------------------------------------------------------------- */

describe('merging the model review layer', () => {
  const modelFinding = (over: Partial<ModelFinding> = {}): ModelFinding => ({
    title: 'Renewal notice window is ambiguous',
    detail: 'The notice period could be read from either date.',
    question: 'Which date starts the notice window?',
    category: 'term',
    severity: 'blocking',
    confidence: 'medium',
    pointers: ['/term/nonRenewalNoticeDays'],
    evidence: [],
    impact: { kind: 'unknown', amount: null, note: '' },
    ...over,
  });

  it('keeps a model finding the rules did not cover', () => {
    const out = buildFlags({
      config: HALCYON_CONFIG,
      provenance: HALCYON_PROVENANCE,
      coverage: HALCYON_COVERAGE,
      modelFindings: [modelFinding()],
    });
    expect(out.stats.fromModel).toBe(1);
    expect(out.flags.some((f) => f.source === 'model')).toBe(true);
  });

  it('suppresses a model finding that duplicates a rule', () => {
    const out = buildFlags({
      config: HALCYON_CONFIG,
      provenance: HALCYON_PROVENANCE,
      coverage: HALCYON_COVERAGE,
      modelFindings: [
        modelFinding({
          title: 'Month 12 appears in two bands',
          pointers: ['/minimumSpend/schedule/2'],
        }),
      ],
    });
    expect(out.stats.modelSuppressedAsDuplicate).toBe(1);
    expect(out.stats.fromModel).toBe(0);
  });

  it('suppresses a model finding pointing at a parent of a rule pointer', () => {
    const out = buildFlags({
      config: HALCYON_CONFIG,
      provenance: HALCYON_PROVENANCE,
      coverage: HALCYON_COVERAGE,
      modelFindings: [modelFinding({ pointers: ['/minimumSpend/schedule'] })],
    });
    expect(out.stats.modelSuppressedAsDuplicate).toBe(1);
  });

  it('never lets a model finding block go-live or the simulator on its own', () => {
    const out = buildFlags({
      config: HALCYON_CONFIG,
      provenance: HALCYON_PROVENANCE,
      coverage: HALCYON_COVERAGE,
      modelFindings: [modelFinding({ severity: 'blocking' })],
    });
    const flag = out.flags.find((f) => f.source === 'model');
    expect(flag?.blocks.goLive).toBe(false);
    expect(flag?.blocks.simulation).toBe(false);
  });

  it('never marks a model finding as certain', () => {
    const out = buildFlags({
      config: HALCYON_CONFIG,
      provenance: HALCYON_PROVENANCE,
      coverage: HALCYON_COVERAGE,
      modelFindings: [modelFinding()],
    });
    expect(out.flags.find((f) => f.source === 'model')?.confidence).not.toBe('certain');
  });

  it('degrades to rules alone when the review pass returns nothing', () => {
    const out = buildFlags({
      config: HALCYON_CONFIG,
      provenance: HALCYON_PROVENANCE,
      coverage: HALCYON_COVERAGE,
      modelFindings: [],
    });
    expect(out.stats.fromRules).toBe(halcyon.stats.fromRules);
  });
});

/* -------------------------------------------------------------------------- */

describe('resolutions survive re-detection', () => {
  it('keeps a decision when an unrelated part of the config changes', () => {
    const resolved = halcyon.flags.map((f) =>
      f.ruleId === 'missing_assessment_cadence'
        ? {
            ...f,
            status: 'resolved' as const,
            resolution: {
              decision: 'monthly',
              decidedBy: 'jose',
              decidedAt: '2026-08-23T00:00:00Z',
              note: null,
              patch: null,
            },
          }
        : f,
    );

    const edited = mutate((c) => {
      c.account.customerName = 'Halcyon Motors Inc.';
    });

    const rebuilt = rebuildPreservingResolutions(
      { config: edited, provenance: HALCYON_PROVENANCE, coverage: HALCYON_COVERAGE },
      resolved,
    );

    const flag = rebuilt.flags.find((f) => f.ruleId === 'missing_assessment_cadence');
    expect(flag?.status).toBe('resolved');
    expect(flag?.resolution?.decision).toBe('monthly');
  });

  it('drops a finding entirely once the underlying defect is fixed', () => {
    const fixed = mutate((c) => {
      c.minimumSpend!.assessmentCadence = 'monthly';
    });
    const rebuilt = rebuildPreservingResolutions(
      { config: fixed, provenance: HALCYON_PROVENANCE, coverage: HALCYON_COVERAGE },
      halcyon.flags,
    );
    expect(rebuilt.flags.some((f) => f.ruleId === 'missing_assessment_cadence')).toBe(false);
  });
});
