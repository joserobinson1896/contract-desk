/**
 * Billing policy — the decisions a contract leaves open.
 *
 * Every field here exists because some order form is silent on something that
 * changes an invoice. The app cannot compute without picking a side, but picking
 * silently is exactly the failure mode this whole system exists to prevent. So:
 * ship a conservative default, record that it is *only* a default, and keep the
 * corresponding flag open until a human confirms it.
 *
 * `setBy[field].source` is the load-bearing part. `'default'` means nobody has
 * decided yet. `'user'` means someone did, and the audit log says who and when.
 * Without that distinction a default is indistinguishable from a decision, which
 * is how a guess ends up on an invoice.
 */

import * as z from 'zod';

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

export const PolicyValues = z.object({
  /**
   * Which reading of "Actual Spend" controls when a contract defines it twice.
   * `narrow` = Rate Plans, Add-Ons, Support Packages only, less credits.
   * `broad`  = all fees incurred on the Org ID.
   */
  actualSpendDefinition: z.enum(['narrow', 'broad']),

  /** Whether SMS counts toward minimum spend when it fits none of the named categories. */
  smsCountsTowardMinimum: z.boolean(),

  /**
   * Whether SIMs still in Test Mode contribute their included data to the pool.
   * If they do without paying the recurring charge, the pool inflates with no
   * revenue behind it and overage is undercharged.
   */
  testModeSimsContributeToPool: z.boolean(),

  /** Whether outbound SMS sent while a SIM is in Test Mode is billed at all. */
  testModeSmsBilled: z.boolean(),

  /** Whether the recurring charge is prorated in the month a SIM goes active. */
  prorateMidMonthActivation: z.boolean(),

  /** How the active SIM count is measured within a billing month. */
  simCountBasis: z.enum(['month_end', 'month_start', 'average', 'peak']),

  /** How partial megabytes are treated when assessing overage. */
  overageRounding: z.enum(['none', 'ceil_mb', 'ceil_kb']),

  /** Whether unused pooled data carries into the next month. */
  poolRollover: z.boolean(),

  /**
   * Which side wins when two minimum-spend bands claim the same month.
   * `null` means undecided — and undecided means those months refuse to compute
   * rather than quietly picking one. That refusal is the feature.
   */
  overlappingBandResolution: z.enum(['lower', 'upper']).nullable(),
});

export type PolicyValues = z.infer<typeof PolicyValues>;
export type PolicyField = keyof PolicyValues;

/* -------------------------------------------------------------------------- */
/* Provenance of each decision                                                 */
/* -------------------------------------------------------------------------- */

export const PolicyFieldMeta = z.object({
  source: z.enum(['default', 'user']),
  at: z.string().nullable(),
  by: z.string().nullable(),
  note: z.string().nullable(),
});

export type PolicyFieldMeta = z.infer<typeof PolicyFieldMeta>;

export const BillingPolicy = z.object({
  values: PolicyValues,
  setBy: z.record(z.string(), PolicyFieldMeta),
});

export type BillingPolicy = z.infer<typeof BillingPolicy>;

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Conservative starting positions. Each mirrors the reading most defensible from
 * the contract text alone:
 *
 * - `narrow` because a specific definition controls over a general statement.
 * - Test Mode SIMs neither pay nor contribute, because billing begins at ACTIVE.
 * - Test Mode SMS unbilled, on the same basis.
 * - Full month charged, because these contracts bill on calendar months and say
 *   nothing about proration.
 * - Month-end snapshot, as the most common industry measurement point.
 * - No rounding and no rollover, since overage is assessed at month end.
 * - Overlapping bands unresolved, because there is no defensible way to guess.
 */
export const DEFAULT_POLICY_VALUES: PolicyValues = {
  actualSpendDefinition: 'narrow',
  smsCountsTowardMinimum: true,
  testModeSimsContributeToPool: false,
  testModeSmsBilled: false,
  prorateMidMonthActivation: false,
  simCountBasis: 'month_end',
  overageRounding: 'none',
  poolRollover: false,
  overlappingBandResolution: null,
};

const POLICY_FIELDS = Object.keys(DEFAULT_POLICY_VALUES) as PolicyField[];

/** A fresh policy where nothing has been decided yet. */
export function createDefaultPolicy(): BillingPolicy {
  const setBy: Record<string, PolicyFieldMeta> = {};
  for (const field of POLICY_FIELDS) {
    setBy[field] = { source: 'default', at: null, by: null, note: null };
  }
  return { values: { ...DEFAULT_POLICY_VALUES }, setBy };
}

/** Record a human decision, stamping who and when. */
export function setPolicyField<K extends PolicyField>(
  policy: BillingPolicy,
  field: K,
  value: PolicyValues[K],
  by: string,
  note: string | null = null,
  at: string = new Date().toISOString(),
): BillingPolicy {
  return {
    values: { ...policy.values, [field]: value },
    setBy: { ...policy.setBy, [field]: { source: 'user', at, by, note } },
  };
}

/** True when a human has explicitly decided this field. */
export function isDecided(policy: BillingPolicy, field: PolicyField): boolean {
  return policy.setBy[field]?.source === 'user';
}

/** Fields still sitting on their default — i.e. nobody has decided them. */
export function undecidedFields(policy: BillingPolicy): PolicyField[] {
  return POLICY_FIELDS.filter((f) => !isDecided(policy, f));
}

export { POLICY_FIELDS };
