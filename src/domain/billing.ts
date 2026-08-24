/**
 * The billing engine.
 *
 * Pure functions — no React, no I/O, no storage. That is deliberate: the month
 * math is the part that must be provably right, so it stays testable without a
 * renderer or a network.
 *
 * The formula, verbatim from the contract-to-billing analysis:
 *
 *   qualifying_fees = (sims × mrc) + (MAX(0, mb_used − sims × included) × overage)
 *                     + sms_charge − credits
 *   rate_plan_total = MAX(qualifying_fees, minimum(month))
 *   invoice_total   = rate_plan_total + non_qualifying_charges + tax
 *
 * Two things the engine refuses to do, both on purpose:
 *
 *   1. It will not compute a month whose minimum-spend band is ambiguous. When two
 *      bands claim the same month and nobody has decided which controls, it returns
 *      `blocked` rather than silently picking one. A wrong invoice is worse than no
 *      invoice.
 *   2. It will not infer a policy the contract is silent about. Every such choice
 *      arrives via `BillingPolicy`, so the caller can see what was assumed.
 */

import type { BillingConfig, Charge } from './schema';
import type { BillingPolicy } from './policy';

/* -------------------------------------------------------------------------- */
/* Inputs and outputs                                                          */
/* -------------------------------------------------------------------------- */

export type SimulationInput = {
  /** 1-indexed month of the order form term. Month 1 is the start date's month. */
  month: number;
  /** SIMs in ACTIVE state. Test Mode SIMs are counted separately. */
  activeSims: number;
  /** Total data across the pool for the month, in MB. */
  mbUsed: number;
  /** SIMs still in Test Mode. Affects pool size only if policy says it should. */
  testModeSims?: number;
  outboundSms?: number;
  inboundSms?: number;
  /**
   * Of `outboundSms`, how many were sent by SIMs still in Test Mode. Split out
   * because the contract's exit clause names only recurring and data charges as
   * beginning at ACTIVE, leaving Test Mode SMS undefined — so whether these are
   * billed is a policy call, and we cannot make it without knowing the count.
   */
  testModeOutboundSms?: number;
  credits?: number;
  nonQualifyingCharges?: number;
  taxRate?: number;
};

export type InvoiceLine = {
  chargeId: string;
  label: string;
  quantity: number;
  unitRate: number;
  amount: number;
  countsTowardMinimum: boolean;
  /** Present when the line's minimum-spend treatment came from policy, not the contract. */
  policyDriven?: boolean;
};

export type Breakdown = {
  billableSims: number;
  poolContributingSims: number;
  mbIncluded: number;
  mbUsed: number;
  overageMb: number;

  lines: InvoiceLine[];

  qualifyingFees: number;
  applicableMinimum: number | null;
  minimumPeriodIndex: number | null;

  /** Which side of the MAX won. `none` when the contract has no minimum spend. */
  controlling: 'actual' | 'minimum' | 'none';

  ratePlanTotal: number;
  nonQualifyingTotal: number;
  tax: number;
  invoiceTotal: number;
};

export type SimulationOutcome =
  | { ok: true; breakdown: Breakdown }
  | {
      ok: false;
      reason: 'ambiguous_minimum' | 'invalid_input' | 'incomplete_config';
      message: string;
      /** Flags the user must resolve before this month can be computed. */
      blockingFlagIds: string[];
    };

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Round to cents at the point of assembly, not during accumulation. Rounding each
 * intermediate would drift on large SIM counts.
 */
export function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Minimum spend lookup                                                        */
/* -------------------------------------------------------------------------- */

export type MinimumLookup =
  | { kind: 'none' }
  | { kind: 'found'; amount: number; periodIndex: number }
  | { kind: 'ambiguous'; candidates: { amount: number; periodIndex: number }[] }
  | { kind: 'uncovered' };

/**
 * Find the minimum-spend amount for a month.
 *
 * Overlapping bands are reported as `ambiguous` rather than resolved by first-match.
 * A first-match rule would look like it worked while quietly encoding a guess —
 * which is the exact defect this system is built to catch.
 */
export function minimumForMonth(
  config: BillingConfig,
  policy: BillingPolicy,
  month: number,
): MinimumLookup {
  const ms = config.minimumSpend;
  if (!ms || ms.schedule.length === 0) return { kind: 'none' };

  const matches = ms.schedule
    .filter((p) => month >= p.startMonth && (p.endMonth === null || month <= p.endMonth))
    .map((p) => ({ amount: p.amountPerMonth, periodIndex: p.index }));

  if (matches.length === 0) return { kind: 'uncovered' };
  if (matches.length === 1) return { kind: 'found', ...matches[0] };

  // More than one band claims this month. Only a recorded human decision resolves it.
  const resolution = policy.values.overlappingBandResolution;
  if (resolution === null) return { kind: 'ambiguous', candidates: matches };

  const sorted = [...matches].sort((a, b) => a.amount - b.amount);
  const picked = resolution === 'lower' ? sorted[0] : sorted[sorted.length - 1];
  return { kind: 'found', ...picked };
}

/* -------------------------------------------------------------------------- */
/* Charge lookup helpers                                                       */
/* -------------------------------------------------------------------------- */

function fixedRate(charge: Charge | undefined): number | null {
  if (!charge) return null;
  return charge.rate.kind === 'fixed' ? (charge.rate.amount ?? null) : null;
}

function findCharge(config: BillingConfig, predicate: (c: Charge) => boolean): Charge | undefined {
  return config.charges.find(predicate);
}

/**
 * Whether a charge counts toward minimum spend.
 *
 * The contract's own answer wins when it gives one. Where it leaves the charge
 * `undetermined`, the answer comes from policy — under the narrow reading of Actual
 * Spend, eligibility derives from `kind` (rate plan / add-on / support package),
 * which is why an `unclassified` charge is a finding rather than a default.
 */
export function countsTowardMinimum(
  charge: Charge,
  policy: BillingPolicy,
): { counts: boolean; policyDriven: boolean } {
  switch (charge.countsTowardMinimum) {
    case 'yes':
      return { counts: true, policyDriven: false };
    case 'no':
    case 'reduces_attainment':
      return { counts: false, policyDriven: false };
    case 'undetermined':
      break;
  }

  if (charge.unit === 'per_sms') {
    return { counts: policy.values.smsCountsTowardMinimum, policyDriven: true };
  }

  if (policy.values.actualSpendDefinition === 'broad') {
    // Broad reading: everything invoiced on the Org ID counts, except items the
    // contract names as excluded, which are already marked `no` above.
    return { counts: true, policyDriven: true };
  }

  const narrowKinds: Charge['kind'][] = ['rate_plan', 'add_on', 'support_package'];
  return { counts: narrowKinds.includes(charge.kind), policyDriven: true };
}

/* -------------------------------------------------------------------------- */
/* Pool                                                                        */
/* -------------------------------------------------------------------------- */

function applyRounding(mb: number, mode: BillingPolicy['values']['overageRounding']): number {
  if (mb <= 0) return 0;
  switch (mode) {
    case 'ceil_mb':
      return Math.ceil(mb);
    case 'ceil_kb':
      return Math.ceil(mb * 1024) / 1024;
    case 'none':
    default:
      return mb;
  }
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                  */
/* -------------------------------------------------------------------------- */

export function simulateMonth(
  config: BillingConfig,
  policy: BillingPolicy,
  input: SimulationInput,
  /** Flags currently open, so a block can name what to go resolve. */
  openFlagIds: { ambiguousMinimum: string[] } = { ambiguousMinimum: [] },
): SimulationOutcome {
  const {
    month,
    activeSims,
    mbUsed,
    testModeSims = 0,
    outboundSms = 0,
    inboundSms = 0,
    testModeOutboundSms = 0,
    credits = 0,
    nonQualifyingCharges = 0,
    taxRate = 0,
  } = input;

  if (!Number.isFinite(month) || month < 1) {
    return { ok: false, reason: 'invalid_input', message: 'Month must be 1 or greater.', blockingFlagIds: [] };
  }
  if (!Number.isFinite(activeSims) || activeSims < 0) {
    return { ok: false, reason: 'invalid_input', message: 'Active SIM count cannot be negative.', blockingFlagIds: [] };
  }
  if (!Number.isFinite(mbUsed) || mbUsed < 0) {
    return { ok: false, reason: 'invalid_input', message: 'Data usage cannot be negative.', blockingFlagIds: [] };
  }

  const minimum = minimumForMonth(config, policy, month);
  if (minimum.kind === 'ambiguous') {
    const options = minimum.candidates
      .map((c) => `$${c.amount.toFixed(2)}`)
      .join(' or ');
    return {
      ok: false,
      reason: 'ambiguous_minimum',
      message:
        `Month ${month} falls in ${minimum.candidates.length} minimum-spend bands (${options}). ` +
        `Resolve the overlapping-band flag before this month can be computed.`,
      blockingFlagIds: openFlagIds.ambiguousMinimum,
    };
  }

  /* ---- SIM counts ------------------------------------------------------- */

  // A SIM that isn't paying the recurring charge shouldn't be enlarging the pool
  // either — otherwise the pool grows with no revenue behind it and overage comes
  // out too low. Policy can override, since the contract is silent.
  const billableSims = activeSims;
  const poolContributingSims =
    activeSims + (policy.values.testModeSimsContributeToPool ? testModeSims : 0);

  /* ---- Included data and overage ---------------------------------------- */

  const includedPerSim = config.ratePlan.includedDataMbPerSim ?? 0;
  const mbIncluded = config.ratePlan.pooling
    ? poolContributingSims * includedPerSim
    : includedPerSim;

  const rawOverage =
    config.ratePlan.overageBasis === 'per_sim' && !config.ratePlan.pooling
      ? Math.max(0, mbUsed - includedPerSim * Math.max(billableSims, 1))
      : Math.max(0, mbUsed - mbIncluded);

  const overageMb = applyRounding(rawOverage, policy.values.overageRounding);

  /* ---- Lines ------------------------------------------------------------ */

  const lines: InvoiceLine[] = [];

  const mrcCharge = findCharge(config, (c) => c.unit === 'per_sim' && c.frequency === 'monthly');
  const mrcRate = fixedRate(mrcCharge);
  if (mrcCharge && mrcRate !== null) {
    const { counts, policyDriven } = countsTowardMinimum(mrcCharge, policy);
    lines.push({
      chargeId: mrcCharge.id,
      label: mrcCharge.label,
      quantity: billableSims,
      unitRate: mrcRate,
      amount: toCents(billableSims * mrcRate),
      countsTowardMinimum: counts,
      policyDriven,
    });
  }

  const overageCharge = findCharge(config, (c) => c.unit === 'per_mb');
  const overageRate = fixedRate(overageCharge);
  if (overageCharge && overageRate !== null && overageMb > 0) {
    const { counts, policyDriven } = countsTowardMinimum(overageCharge, policy);
    lines.push({
      chargeId: overageCharge.id,
      label: overageCharge.label,
      quantity: overageMb,
      unitRate: overageRate,
      amount: toCents(overageMb * overageRate),
      countsTowardMinimum: counts,
      policyDriven,
    });
  }

  // Test Mode SMS is excluded unless policy says otherwise: the exit clause names
  // only recurring and data charges as beginning at ACTIVE, so billing SMS before
  // that point is an inference the contract does not support on its own.
  const billableOutboundSms = policy.values.testModeSmsBilled
    ? outboundSms
    : Math.max(0, outboundSms - testModeOutboundSms);

  for (const [count, matcher] of [
    [billableOutboundSms, (c: Charge) => c.unit === 'per_sms' && /out/i.test(c.id + c.label)],
    [inboundSms, (c: Charge) => c.unit === 'per_sms' && /\binbound\b|_in\b|^in/i.test(c.id + c.label)],
  ] as const) {
    if (count <= 0) continue;
    const charge = findCharge(config, matcher);
    const rate = fixedRate(charge);
    if (!charge || rate === null) continue;
    const { counts, policyDriven } = countsTowardMinimum(charge, policy);
    lines.push({
      chargeId: charge.id,
      label: charge.label,
      quantity: count,
      unitRate: rate,
      amount: toCents(count * rate),
      countsTowardMinimum: counts,
      policyDriven,
    });
  }

  // Recurring flat charges (support packages and the like).
  for (const charge of config.charges) {
    if (charge.unit !== 'flat' || charge.frequency !== 'monthly') continue;
    const rate = fixedRate(charge);
    if (rate === null) continue;
    const { counts, policyDriven } = countsTowardMinimum(charge, policy);
    lines.push({
      chargeId: charge.id,
      label: charge.label,
      quantity: 1,
      unitRate: rate,
      amount: toCents(rate),
      countsTowardMinimum: counts,
      policyDriven,
    });
  }

  /* ---- The MAX ---------------------------------------------------------- */

  const qualifyingBeforeCredits = lines
    .filter((l) => l.countsTowardMinimum)
    .reduce((sum, l) => sum + l.amount, 0);

  const qualifyingFees = toCents(qualifyingBeforeCredits - credits);

  const applicableMinimum = minimum.kind === 'found' ? minimum.amount : null;
  const minimumPeriodIndex = minimum.kind === 'found' ? minimum.periodIndex : null;

  let ratePlanTotal: number;
  let controlling: Breakdown['controlling'];
  if (applicableMinimum === null) {
    ratePlanTotal = qualifyingFees;
    controlling = 'none';
  } else if (qualifyingFees >= applicableMinimum) {
    ratePlanTotal = qualifyingFees;
    controlling = 'actual';
  } else {
    ratePlanTotal = applicableMinimum;
    controlling = 'minimum';
  }

  /* ---- Invoice ---------------------------------------------------------- */

  // Charges outside Actual Spend still appear on the invoice — they just do not
  // move the customer toward the minimum. Keeping them in a separate bucket is
  // what stops a SIM purchase from looking like progress toward the commitment.
  const nonQualifyingFromLines = lines
    .filter((l) => !l.countsTowardMinimum)
    .reduce((sum, l) => sum + l.amount, 0);

  const nonQualifyingTotal = toCents(nonQualifyingFromLines + nonQualifyingCharges);
  const tax = toCents((ratePlanTotal + nonQualifyingTotal) * taxRate);
  const invoiceTotal = toCents(ratePlanTotal + nonQualifyingTotal + tax);

  return {
    ok: true,
    breakdown: {
      billableSims,
      poolContributingSims,
      mbIncluded,
      mbUsed,
      overageMb,
      lines,
      qualifyingFees,
      applicableMinimum,
      minimumPeriodIndex,
      controlling,
      ratePlanTotal: toCents(ratePlanTotal),
      nonQualifyingTotal,
      tax,
      invoiceTotal,
    },
  };
}
