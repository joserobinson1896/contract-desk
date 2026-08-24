/**
 * The single schema definition for the whole app.
 *
 * It does three jobs, which is why it lives in one place:
 *   1. Claude's extraction contract, via `zodOutputFormat()` in the parse route
 *   2. Runtime validation of anything read back out of storage
 *   3. Compile-time types, via `z.infer`
 *
 * Two conventions run through everything below:
 *
 * `null` means THE CONTRACT IS SILENT. It is not the same as zero, and it is not
 * "we couldn't find it". Several flag rules fire precisely on null, so collapsing
 * the distinction would blind them.
 *
 * Fields are required-but-nullable rather than optional. That forces the model to
 * state `null` explicitly instead of omitting a key, so a missing term is a
 * positive assertion of absence rather than something we infer from silence.
 */

import * as z from 'zod';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** ISO calendar date, `YYYY-MM-DD`. Validated for real-date-ness in `validate.ts`. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** RFC-6901 JSON Pointer into a BillingConfig, e.g. `/minimumSpend/schedule/3`. */
export const JsonPointer = z.string().regex(/^(\/[^/]*)*$/);

export const Confidence = z.enum(['high', 'medium', 'low']);

/**
 * Where a value came from in the source PDF. Attached to every extracted field so
 * the UI can answer "why does it say this?" without reopening the contract — which
 * is the whole point of the config existing.
 */
export const Provenance = z.object({
  quote: z.string().describe('The clause verbatim, exactly as printed. Do not paraphrase.'),
  page: z.number().int().positive().nullable().describe('1-indexed PDF page, or null if unclear.'),
  confidence: Confidence,
});

/* -------------------------------------------------------------------------- */
/* Charges                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Charge classification. Load-bearing: the narrow reading of "Actual Spend" in
 * these contracts is "Rate Plan(s), Add-On(s), Support Package(s)", so under that
 * reading a charge's minimum-spend eligibility DERIVES from its kind.
 *
 * `unclassified` is deliberately available and deliberately meaningful — a priced
 * item that fits none of the named categories is exactly the ambiguity we want
 * surfaced, not silently bucketed. The `unclassified_charge` rule fires on it.
 */
export const ChargeKind = z.enum([
  'rate_plan',
  'add_on',
  'support_package',
  'hardware',
  'fee',
  'adjustment',
  'tax',
  'unclassified',
]);

export const ChargeUnit = z.enum(['per_sim', 'per_mb', 'per_kb', 'per_sms', 'flat']);

export const ChargeFrequency = z.enum([
  'monthly',
  'one_time',
  'usage',
  'pay_as_you_go',
  'per_invoice',
  'as_applied',
]);

/**
 * Split into kind + amount so "priced at zero", "varies", and "the contract never
 * says" stay distinguishable. Folding them into a single nullable number loses the
 * difference between a free item and an unpriced one — and an unpriced item on a
 * signed contract is a finding.
 */
export const Rate = z.object({
  kind: z
    .enum(['fixed', 'variable', 'unstated'])
    .describe('`unstated` when the contract names the product but gives no rate.'),
  amount: z.number().nullable().describe('Null unless kind is `fixed`.'),
});

/** Tri-state plus an explicit unknown, so "we could not tell" survives into the UI. */
export const CountsTowardMinimum = z.enum(['yes', 'no', 'reduces_attainment', 'undetermined']);

export const Charge = z.object({
  id: z.string().describe('Stable slug, e.g. `mrc`, `data_overage`, `sms_outbound`.'),
  label: z.string().describe('Human label as the contract words it.'),
  rate: Rate,
  unit: ChargeUnit.nullable(),
  frequency: ChargeFrequency.nullable(),
  kind: ChargeKind,
  countsTowardMinimum: CountsTowardMinimum,
});

/* -------------------------------------------------------------------------- */
/* Minimum spend                                                               */
/* -------------------------------------------------------------------------- */

export const SpendPeriod = z.object({
  index: z.number().int().nonnegative(),
  startMonth: z.number().int().positive().describe('1-indexed month of the term.'),
  endMonth: z.number().int().positive().nullable().describe('Null means open-ended.'),
  amountPerMonth: z.number(),
});

export const MinimumSpend = z.object({
  coreRule: z.string().nullable(),
  /**
   * Both readings are captured when both appear. These contracts have been seen to
   * define Actual Spend broadly in one sentence and narrowly four sentences later;
   * recording only one would erase the contradiction the QA pass exists to catch.
   */
  actualSpendDefinitions: z.object({
    narrow: z.string().nullable(),
    broad: z.string().nullable(),
  }),
  namedExclusions: z.array(z.string()),
  excessCarriesForward: z.boolean().nullable(),
  earlyTermination: z.string().nullable(),
  earlyTerminationException: z.string().nullable(),
  renewalCommitment: z.string().nullable(),
  assessmentCadence: z.enum(['monthly', 'period_aggregate']).nullable(),
  schedule: z.array(SpendPeriod),
});

/* -------------------------------------------------------------------------- */
/* Config sections                                                             */
/* -------------------------------------------------------------------------- */

export const Account = z.object({
  customerName: z.string(),
  orgIds: z.array(z.string()).describe('Plural — these contracts scope to "Org ID(s)".'),
  orderFormNumber: z.string().nullable(),
  scope: z.string().nullable(),
  supersedesPriorAgreements: z.boolean().nullable(),
  supersessionDate: IsoDate.nullable(),
  governingDocuments: z.string().nullable(),
});

export const RatePlan = z.object({
  name: z.string(),
  supportedSimSkus: z.array(z.string()),
  includedDataMbPerSim: z.number().nullable(),
  pooling: z.boolean().describe('True when each SIM contributes its allowance to a shared pool.'),
  poolAccess: z.string().nullable(),
  overageBasis: z.enum(['pool_total', 'per_sim']).nullable(),
  overageTiming: z.enum(['end_of_month', 'real_time']).nullable(),
  provisioningLeadTimeWeeks: z.number().nullable(),
  unlistedProductsRate: z.string().nullable(),
});

export const Term = z.object({
  startDate: IsoDate.nullable(),
  initialTermMonths: z.number().int().positive().nullable(),
  autoRenew: z.boolean().nullable(),
  renewalTermMonths: z.number().int().positive().nullable(),
  nonRenewalNoticeDays: z.number().int().nonnegative().nullable(),
  postTermRates: z.string().nullable(),
  currency: z.string().nullable(),
  billingMethod: z.string().nullable(),
  billingCycle: z.enum(['calendar_month', 'anniversary_month', 'other']).nullable(),
  paymentTerms: z.string().nullable(),
  prepaidTransitionWeeks: z.number().nullable(),
  signatureDeadline: IsoDate.nullable(),
  actualSignatureDate: IsoDate.nullable(),

  /**
   * How the active SIM count is measured, when the contract says.
   *
   * Added because two rules described absences the schema could not represent as
   * present: a well-drafted contract that DOES state its measurement point had no
   * field to put it in, so the rule fired on every per-SIM contract without
   * exception. A rule nothing can satisfy is not a check, it is a constant.
   *
   * Null still means the contract is silent, and the rule still fires on null.
   */
  simCountBasis: z
    .enum(['month_end', 'month_start', 'average', 'peak'])
    .nullable()
    .default(null),

  /** Whether the recurring charge prorates on mid-cycle activation, when stated. */
  prorationOnActivation: z
    .enum(['full_month', 'prorated_daily'])
    .nullable()
    .default(null),
});

export const TestMode = z.object({
  durationDays: z.number().int().positive().nullable(),
  exitTriggers: z.object({
    dataKb: z.number().nullable(),
    outboundSms: z.number().int().nullable(),
    durationExpiry: z.boolean(),
  }),
  triggerLogic: z.enum(['first_to_occur', 'all']).nullable(),

  /**
   * Whether Test Mode SIMs contribute their included data to the pool, when the
   * contract says. Null means it does not — which is the conflict the rule raises,
   * since the pooling clause and the Test Mode clause then disagree.
   */
  poolContribution: z.boolean().nullable().default(null),

  /**
   * ONLY the charge kinds the contract explicitly names as beginning at ACTIVE.
   * Do not infer the complete set — the gap between what is named here and what is
   * actually priced on the order form is itself a finding.
   */
  onExitChargesBegin: z.array(ChargeKind),
});

export const Migration = z.object({
  attempted: z.boolean(),
  cost: z.number().nullable(),
  onSuccess: z.string().nullable(),
  onFailure: z.string().nullable(),
  profileRemoval: z
    .object({
      appliesTo: z.string(),
      outageProtection: z.boolean(),
    })
    .nullable(),
  deadline: IsoDate.nullable(),
  fleetResponsibility: z.string().nullable(),
});

/* -------------------------------------------------------------------------- */
/* BillingConfig                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Halcyon is one instance of this shape, not the shape itself. `minimumSpend`,
 * `testMode`, and `migration` are nullable because plenty of real order forms have
 * none of them, and the billing engine branches accordingly.
 */
export const BillingConfig = z.object({
  account: Account,
  ratePlan: RatePlan,
  term: Term,
  testMode: TestMode.nullable(),
  migration: Migration.nullable(),
  charges: z.array(Charge),
  minimumSpend: MinimumSpend.nullable(),
});

/* -------------------------------------------------------------------------- */
/* Extraction envelope                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What the extraction call returns. `provenance` is a flat pointer→source map
 * rather than being interleaved into the config, so the config stays clean enough
 * to diff, patch, and hand to the billing engine unmodified.
 */
export const ExtractionResult = z.object({
  config: BillingConfig,
  provenance: z
    .array(
      z.object({
        pointer: JsonPointer,
        source: Provenance,
      }),
    )
    .describe('One entry per extracted value. Pointer targets a path in `config`.'),
  coverage: z.object({
    missingFields: z
      .array(JsonPointer)
      .describe('Pointers the contract simply does not address.'),
    lowConfidence: z
      .array(JsonPointer)
      .describe('Pointers where the reading is genuinely uncertain, not merely terse.'),
  }),
});

/* -------------------------------------------------------------------------- */
/* Flags                                                                       */
/* -------------------------------------------------------------------------- */

export const FlagSeverity = z.enum(['blocking', 'non_blocking']);

export const FlagCategory = z.enum([
  'minimum_spend',
  'charges',
  'test_mode',
  'migration',
  'term',
  'definitions',
  'coverage',
]);

export const FlagStatus = z.enum(['open', 'resolved', 'accepted_risk']);

export const FlagImpact = z.object({
  kind: z.enum(['per_invoice', 'per_sim', 'one_time', 'unknown']),
  amount: z.number().nullable(),
  note: z.string(),
});

/**
 * A finding. Produced by a deterministic rule (`source: 'rule'`) or by the
 * adversarial model review pass (`source: 'model'`).
 *
 * Flags always arrive `open`. The app detects; a human decides. Nothing here
 * encodes a pre-made answer.
 */
export const Flag = z.object({
  id: z.string(),
  ruleId: z.string().nullable().describe('Null for model-sourced findings.'),
  source: z.enum(['rule', 'model']),
  /** `certain` is reserved for deterministic rules; the model never claims it. */
  confidence: z.enum(['certain', 'high', 'medium', 'low']),
  ordinal: z.number().int().nonnegative(),
  severity: FlagSeverity,
  category: FlagCategory,
  title: z.string(),
  detail: z.string().describe('What the contract says and why it is a problem.'),
  question: z.string().describe('The question to put to Deal Desk or the AE.'),
  pointers: z.array(JsonPointer),
  evidence: z.array(z.object({ quote: z.string(), page: z.number().int().nullable() })),
  impact: FlagImpact,
  policyField: z.string().nullable().describe('Which BillingPolicy field resolves this, if any.'),
  blocks: z.object({
    simulation: z.boolean(),
    months: z.array(z.number().int()).nullable().describe('Specific months that cannot compute.'),
    goLive: z.boolean(),
  }),
  status: FlagStatus,
  resolution: z
    .object({
      decision: z.string(),
      decidedBy: z.string(),
      decidedAt: z.string(),
      note: z.string().nullable(),
      patch: z.array(z.unknown()).nullable().describe('RFC-6902 ops applied to the config.'),
    })
    .nullable(),
});

/**
 * What the adversarial review call returns. Narrower than `Flag` on purpose: the
 * model supplies the finding, and the merge step in `flags.ts` assigns ids,
 * ordinals, status, and blocking semantics. Letting the model set those would let
 * a hallucinated finding gate go-live.
 */
export const ModelFinding = z.object({
  title: z.string(),
  detail: z.string().describe('What the clause says, and both readings it permits.'),
  question: z.string().describe('The question to ask, phrased for Deal Desk. Resolve nothing.'),
  category: FlagCategory,
  severity: FlagSeverity.describe('`blocking` only if it changes an invoice amount.'),
  confidence: Confidence,
  pointers: z.array(JsonPointer).describe('Best-effort paths into the config. May be empty.'),
  evidence: z.array(z.object({ quote: z.string(), page: z.number().int().nullable() })),
  impact: FlagImpact,
});

export const ReviewResult = z.object({
  findings: z.array(ModelFinding),
  configDiscrepancies: z
    .array(
      z.object({
        pointer: JsonPointer,
        contractSays: z.string(),
        configSays: z.string(),
        note: z.string(),
      }),
    )
    .describe('Places the extracted config disagrees with the contract. Usually empty.'),
});

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type Provenance = z.infer<typeof Provenance>;
export type ChargeKind = z.infer<typeof ChargeKind>;
export type ChargeUnit = z.infer<typeof ChargeUnit>;
export type ChargeFrequency = z.infer<typeof ChargeFrequency>;
export type Rate = z.infer<typeof Rate>;
export type CountsTowardMinimum = z.infer<typeof CountsTowardMinimum>;
export type Charge = z.infer<typeof Charge>;
export type SpendPeriod = z.infer<typeof SpendPeriod>;
export type MinimumSpend = z.infer<typeof MinimumSpend>;
export type Account = z.infer<typeof Account>;
export type RatePlan = z.infer<typeof RatePlan>;
export type Term = z.infer<typeof Term>;
export type TestMode = z.infer<typeof TestMode>;
export type Migration = z.infer<typeof Migration>;
export type BillingConfig = z.infer<typeof BillingConfig>;
export type ExtractionResult = z.infer<typeof ExtractionResult>;
export type FlagSeverity = z.infer<typeof FlagSeverity>;
export type FlagCategory = z.infer<typeof FlagCategory>;
export type FlagStatus = z.infer<typeof FlagStatus>;
export type FlagImpact = z.infer<typeof FlagImpact>;
export type Flag = z.infer<typeof Flag>;
export type ModelFinding = z.infer<typeof ModelFinding>;
export type ReviewResult = z.infer<typeof ReviewResult>;
