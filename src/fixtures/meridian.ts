/**
 * Meridian Freight Systems — order form 00004417.
 *
 * A second mock contract, deliberately WELL DRAFTED. Same structure as Halcyon —
 * pooled per-SIM data plan, tiered minimum spend, Test Mode, G1→G3 migration — but
 * every defect the rule engine looks for has been drafted out:
 *
 *   contiguous spend bands, no overlap and no gap
 *   a first band in proportion with the rest, so no decimal outlier
 *   one Actual Spend definition, not two that contradict
 *   an assessment cadence that is actually stated
 *   every charge classified, and every supported SKU priced
 *   Test Mode exit naming SMS alongside recurring and data
 *   Test Mode SIMs excluded from the pool in writing
 *   signed before the deadline, and before the start date
 *   a stated SIM-count basis and proration rule
 *   a migration deadline
 *
 * It exists so the invoicing path can be exercised end to end. Halcyon cannot be
 * invoiced by design — it has ten blocking findings, and the gate between an
 * undecided contract and a real invoice is the product. Something has to be on the
 * other side of that gate, or the happy path is never demonstrable.
 *
 * Fictional. Any resemblance to a real freight operator is coincidental.
 */

import type { BillingConfig, Provenance } from '../domain/schema';

export const MERIDIAN_CONFIG: BillingConfig = {
  account: {
    customerName: 'Meridian Freight Systems',
    orgIds: ['74188'],
    orderFormNumber: '00004417',
    scope: 'Rates apply solely to Org ID 74188',
    supersedesPriorAgreements: true,
    supersessionDate: '2026-09-01',
    governingDocuments:
      'Order Form takes precedence over the Terms of Use unless the Order Form expressly states otherwise',
  },

  ratePlan: {
    name: 'G3 25MB Global Data Pool',
    supportedSimSkus: ['G3-F', 'G3-M2'],
    includedDataMbPerSim: 25,
    pooling: true,
    poolAccess: 'Available to every ACTIVE SIM in the pool',
    overageBasis: 'pool_total',
    overageTiming: 'end_of_month',
    provisioningLeadTimeWeeks: 2,
    unlistedProductsRate:
      'Charged at the rate stated in Schedule B of this Order Form; no product is billed at an unquoted rate',
  },

  term: {
    startDate: '2026-09-01',
    initialTermMonths: 24,
    autoRenew: true,
    renewalTermMonths: 12,
    nonRenewalNoticeDays: 60,
    postTermRates: 'Each product continues at the rates stated in this Order Form until amended',
    currency: 'USD',
    billingMethod: 'Invoicing',
    billingCycle: 'calendar_month',
    paymentTerms: 'Net 30',
    prepaidTransitionWeeks: 2,
    // Signed with three days to spare, and before the term begins.
    signatureDeadline: '2026-08-28',
    actualSignatureDate: '2026-08-25',
    simCountBasis: 'month_end',
    prorationOnActivation: 'full_month',
  },

  testMode: {
    durationDays: 60,
    exitTriggers: { dataKb: 250, outboundSms: 5, durationExpiry: true },
    triggerLogic: 'first_to_occur',
    poolContribution: false,
    // Names every priced kind that begins at ACTIVE — including SMS, which is the
    // gap Halcyon leaves open, and the support package.
    onExitChargesBegin: ['rate_plan', 'add_on', 'support_package'],
  },

  migration: {
    attempted: true,
    cost: 0,
    onSuccess: 'SIM moves to G3 25MB Global Data Pool',
    onFailure:
      'SIM remains on its existing plan at the rates stated in Schedule B of this Order Form',
    profileRemoval: { appliesTo: 'G3-M2', outageProtection: true },
    deadline: '2027-03-01',
    fleetResponsibility:
      'Customer must keep SIMs on plans in this order form to receive these rates',
  },

  charges: [
    {
      id: 'mrc',
      label: 'Global Data Pool MRC (includes 25 MB per SIM)',
      rate: { kind: 'fixed', amount: 3.15 },
      unit: 'per_sim',
      frequency: 'monthly',
      kind: 'rate_plan',
      countsTowardMinimum: 'yes',
    },
    {
      id: 'data_overage',
      label: 'Flat rate data overage',
      rate: { kind: 'fixed', amount: 0.6 },
      unit: 'per_mb',
      frequency: 'pay_as_you_go',
      kind: 'rate_plan',
      countsTowardMinimum: 'yes',
    },
    {
      id: 'sms_outbound',
      label: 'Outbound SMS',
      rate: { kind: 'fixed', amount: 0.04 },
      unit: 'per_sms',
      frequency: 'usage',
      kind: 'add_on',
      countsTowardMinimum: 'yes',
    },
    {
      id: 'sms_inbound',
      label: 'Inbound SMS',
      rate: { kind: 'fixed', amount: 0 },
      unit: 'per_sms',
      frequency: 'usage',
      kind: 'add_on',
      countsTowardMinimum: 'yes',
    },
    {
      id: 'support_priority',
      label: 'Priority Support Package',
      rate: { kind: 'fixed', amount: 150 },
      unit: 'flat',
      frequency: 'monthly',
      kind: 'support_package',
      countsTowardMinimum: 'yes',
    },
    {
      id: 'sim_hw_g3f',
      label: 'SIM hardware, G3-F',
      rate: { kind: 'fixed', amount: 3.9 },
      unit: 'per_sim',
      frequency: 'one_time',
      kind: 'hardware',
      countsTowardMinimum: 'no',
    },
    {
      id: 'sim_hw_g3m2',
      label: 'SIM hardware, G3-M2',
      rate: { kind: 'fixed', amount: 5.25 },
      unit: 'per_sim',
      frequency: 'one_time',
      kind: 'hardware',
      countsTowardMinimum: 'no',
    },
    {
      id: 'setup_implementation',
      label: 'Setup / implementation',
      rate: { kind: 'fixed', amount: 0 },
      unit: 'flat',
      frequency: 'one_time',
      kind: 'fee',
      countsTowardMinimum: 'no',
    },
    {
      id: 'late_payment',
      label: 'Late payment charge',
      rate: { kind: 'fixed', amount: 0.015 },
      unit: 'flat',
      frequency: 'per_invoice',
      kind: 'fee',
      countsTowardMinimum: 'no',
    },
    {
      id: 'credits',
      label: 'Credits applied by Hologram',
      rate: { kind: 'variable', amount: null },
      unit: 'flat',
      frequency: 'as_applied',
      kind: 'adjustment',
      countsTowardMinimum: 'reduces_attainment',
    },
    {
      id: 'taxes',
      label: 'Taxes',
      rate: { kind: 'variable', amount: null },
      unit: 'flat',
      frequency: 'per_invoice',
      kind: 'tax',
      countsTowardMinimum: 'no',
    },
  ],

  minimumSpend: {
    coreRule: 'Pay the greater of the applicable Minimum Spend Amount or actual fees incurred',
    actualSpendDefinitions: {
      narrow:
        'Invoiced charges only for Rate Plan(s), Add-On(s) and Support Package(s), less credits',
      // One definition only — nothing to contradict it.
      broad: null,
    },
    namedExclusions: [
      'late_payment_charges',
      'sim_card_purchases',
      'setup_charges',
      'implementation_charges',
    ],
    excessCarriesForward: false,
    earlyTermination:
      'Customer owes the remaining Minimum Spend Amounts for the balance of the term',
    earlyTerminationException: 'Hologram failure to cure a material breach',
    renewalCommitment: 'Set at the last Spend Period level of the prior term, 1800.00',
    assessmentCadence: 'monthly',
    // Contiguous, no overlap, no gap, and each step in proportion.
    schedule: [
      { index: 0, startMonth: 1, endMonth: 6, amountPerMonth: 450 },
      { index: 1, startMonth: 7, endMonth: 12, amountPerMonth: 900 },
      { index: 2, startMonth: 13, endMonth: 24, amountPerMonth: 1800 },
      { index: 3, startMonth: 25, endMonth: null, amountPerMonth: 1800 },
    ],
  },
};

/* -------------------------------------------------------------------------- */

const clause = (quote: string, page: number): Provenance => ({
  quote,
  page,
  confidence: 'high',
});

export const MERIDIAN_PROVENANCE = new Map<string, Provenance>([
  ['/account/orgIds', clause('Hologram Org ID: 74188', 1)],
  ['/account/orderFormNumber', clause('Order Form Number: 00004417', 1)],
  ['/ratePlan/name', clause('Rate Plan: G3 25MB Global Data Pool', 1)],
  [
    '/ratePlan/includedDataMbPerSim',
    clause('Included Data Per SIM: 25 MB, contributed to a shared pool', 1),
  ],
  [
    '/ratePlan/overageBasis',
    clause('Overage is assessed against the pool total at the end of each month', 1),
  ],
  ['/term/startDate', clause('Start Date: 2026-09-01', 2)],
  ['/term/initialTermMonths', clause('Initial Term: 24 months', 2)],
  [
    '/term/simCountBasis',
    clause(
      'Active SIM count is measured as a snapshot on the last day of each calendar month',
      2,
    ),
  ],
  [
    '/term/prorationOnActivation',
    clause('A SIM activating mid-month is charged a full monthly recurring charge', 2),
  ],
  ['/term/actualSignatureDate', clause('Executed by both parties on 2026-08-25', 2)],
  [
    '/testMode/onExit',
    clause(
      'On exit the SIM state changes to ACTIVE and recurring, data usage and SMS charges begin',
      3,
    ),
  ],
  [
    '/testMode/poolContribution',
    clause('SIMs in Test Mode do not contribute included data to the pool', 3),
  ],
  ['/migration/deadline', clause('Migration shall be completed by 2027-03-01', 3)],
  [
    '/minimumSpend/assessmentCadence',
    clause('The greater-of test is applied monthly', 4),
  ],
  [
    '/minimumSpend/schedule/0',
    clause('Months 1-6: $450.00/month', 4),
  ],
  [
    '/minimumSpend/schedule/1',
    clause('Months 7-12: $900.00/month', 4),
  ],
  [
    '/minimumSpend/schedule/2',
    clause('Months 13-24: $1,800.00/month', 4),
  ],
]);

export const MERIDIAN_COVERAGE = {
  missingFields: [] as string[],
  lowConfidence: [] as string[],
};
