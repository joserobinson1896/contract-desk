/**
 * Halcyon Motors — order form 00002891.
 *
 * The mock contract from the Hologram post-sales exercise, transcribed into the
 * app's config shape. It is the reference case: the rule engine's expected output
 * against this fixture is the acceptance test for the whole detection layer.
 *
 * Values are recorded EXACTLY as the contract states them, defects included. The
 * $3.00 first band and the month-12 overlap are wrong, and they stay wrong here on
 * purpose — a fixture that quietly repairs the contract would give the rules
 * nothing to find and would prove nothing.
 *
 * This contract is a public mock from the exercise, which is why it is safe to
 * commit. Real customer contracts must never be checked in — see `.gitignore`.
 */

import type { BillingConfig, Provenance } from '../domain/schema';

export const HALCYON_CONFIG: BillingConfig = {
  account: {
    customerName: 'Halcyon Motors',
    orgIds: ['90342'],
    orderFormNumber: '00002891',
    scope: 'Rates apply solely to Org ID 90342',
    supersedesPriorAgreements: true,
    supersessionDate: '2026-08-01',
    governingDocuments:
      'Order Form takes precedence over the Terms of Use unless the Order Form expressly states otherwise',
  },

  ratePlan: {
    name: 'G3 10MB Dynamic Data Pool',
    supportedSimSkus: ['G3-F', 'G3-G1'],
    includedDataMbPerSim: 10,
    pooling: true,
    poolAccess: 'Data Pool data is available to every SIM in the data pool',
    overageBasis: 'pool_total',
    overageTiming: 'end_of_month',
    provisioningLeadTimeWeeks: 4,
    unlistedProductsRate: "Charged at the product's current rate defined in the Hologram Dashboard",
  },

  term: {
    startDate: '2026-08-01',
    initialTermMonths: 36,
    autoRenew: true,
    renewalTermMonths: 12,
    nonRenewalNoticeDays: 30,
    postTermRates: 'Each product charged at Hologram standard rates',
    currency: 'USD',
    billingMethod: 'Invoicing',
    billingCycle: 'calendar_month',
    paymentTerms: 'Net 30',
    prepaidTransitionWeeks: 3,
    signatureDeadline: '2026-07-31',
    actualSignatureDate: '2026-08-05',
    // The order form addresses neither. Both are findings 8 and 9.
    simCountBasis: null,
    prorationOnActivation: null,
  },

  testMode: {
    durationDays: 90,
    exitTriggers: { dataKb: 100, outboundSms: 10, durationExpiry: true },
    triggerLogic: 'first_to_occur',
    // The order form never settles it — that is finding 6.
    poolContribution: null,
    // The exit clause names MRC and data usage fees only. Both are rate-plan
    // charges. SMS is a separate priced product and is conspicuously absent —
    // recorded as the contract has it, so `testmode_charge_gap` can catch it.
    onExitChargesBegin: ['rate_plan'],
  },

  migration: {
    attempted: true,
    cost: 0,
    onSuccess: 'SIM moves to the G3 10MB Dynamic Data Pool plan',
    onFailure: 'SIM remains on one of Hologram’s standard plans with the associated rates',
    profileRemoval: { appliesTo: 'G3-G1', outageProtection: false },
    deadline: null,
    fleetResponsibility:
      'Customer is responsible for managing their SIM fleet to ensure SIMs are associated with plans noted on this Order Form',
  },

  charges: [
    {
      id: 'mrc',
      label: 'Dynamic Data Pool Monthly Recurring Charge (includes 10 MB per SIM)',
      rate: { kind: 'fixed', amount: 2.43 },
      unit: 'per_sim',
      frequency: 'monthly',
      kind: 'rate_plan',
      countsTowardMinimum: 'yes',
    },
    {
      id: 'data_overage',
      label: 'Flat rate data overage',
      rate: { kind: 'fixed', amount: 0.75 },
      unit: 'per_mb',
      frequency: 'pay_as_you_go',
      kind: 'rate_plan',
      countsTowardMinimum: 'yes',
    },
    {
      id: 'sms_inbound',
      label: 'Inbound SMS',
      rate: { kind: 'fixed', amount: 0 },
      unit: 'per_sms',
      frequency: 'usage',
      // Same classification problem as outbound: SMS is not a Rate Plan, Add-On,
      // or Support Package under the narrow Actual Spend definition.
      kind: 'unclassified',
      countsTowardMinimum: 'undetermined',
    },
    {
      id: 'sms_outbound',
      label: 'Outbound SMS',
      rate: { kind: 'fixed', amount: 0.57 },
      unit: 'per_sms',
      frequency: 'usage',
      kind: 'unclassified',
      countsTowardMinimum: 'undetermined',
    },
    {
      id: 'support_dev',
      label: 'Developer Support',
      rate: { kind: 'fixed', amount: 0 },
      unit: 'flat',
      frequency: 'monthly',
      kind: 'support_package',
      countsTowardMinimum: 'yes',
    },
    {
      id: 'sim_hw_g3f',
      label: 'SIM hardware, G3-F',
      rate: { kind: 'fixed', amount: 4.5 },
      unit: 'per_sim',
      frequency: 'one_time',
      kind: 'hardware',
      countsTowardMinimum: 'no',
    },
    {
      id: 'sim_hw_g3g1',
      label: 'SIM hardware, G3-G1',
      // Supported SKU, never priced. Left unstated rather than guessed.
      rate: { kind: 'unstated', amount: null },
      unit: 'per_sim',
      frequency: 'one_time',
      kind: 'hardware',
      countsTowardMinimum: 'no',
    },
    {
      id: 'setup_implementation',
      label: 'Setup / implementation',
      rate: { kind: 'unstated', amount: null },
      unit: null,
      frequency: null,
      kind: 'fee',
      countsTowardMinimum: 'no',
    },
    {
      id: 'late_payment',
      label: 'Late payment charges',
      rate: { kind: 'unstated', amount: null },
      unit: null,
      frequency: null,
      kind: 'fee',
      countsTowardMinimum: 'no',
    },
    {
      id: 'non_migrated_sims',
      label: 'Non-migrated SIMs, standard plan',
      rate: { kind: 'unstated', amount: null },
      unit: 'per_sim',
      frequency: 'monthly',
      kind: 'rate_plan',
      countsTowardMinimum: 'undetermined',
    },
    {
      id: 'credits',
      label: 'Credits applied by Hologram',
      rate: { kind: 'variable', amount: null },
      unit: null,
      frequency: 'as_applied',
      kind: 'adjustment',
      countsTowardMinimum: 'reduces_attainment',
    },
    {
      id: 'taxes',
      label: 'Taxes',
      rate: { kind: 'variable', amount: null },
      unit: null,
      frequency: 'per_invoice',
      kind: 'tax',
      countsTowardMinimum: 'no',
    },
  ],

  minimumSpend: {
    coreRule:
      'For each Minimum Spend Period, Customer will pay the greater of the applicable Minimum Spend Amount or Customer’s actual fees incurred',
    actualSpendDefinitions: {
      narrow:
        'Actual Spend will be calculated as invoiced charges only for the Rate Plan(s) and the Add-On(s) or Support Package(s), less any credits applied by Hologram',
      broad:
        'All of Customer’s actual fees incurred on the Hologram Org ID(s) will be applied toward the applicable Minimum Spend Amount',
    },
    namedExclusions: [
      'late payment charges',
      'SIM card purchases',
      'setup charges',
      'implementation charges',
    ],
    excessCarriesForward: false,
    earlyTermination:
      'Customer is responsible for paying the Minimum Spend Amount(s) for the remaining portion of the Initial Term or then-current Renewal Term',
    earlyTerminationException: 'Hologram’s failure to cure a material breach',
    renewalCommitment:
      'Automatically set at the Minimum Spend Commitment level of the last Spend Period of the immediately prior Term',
    assessmentCadence: null,
    // Recorded exactly as printed. Months 7-12 and 12-24 both claim month 12,
    // and the first band is 100x below the second. Both are defects; neither is
    // repaired here.
    schedule: [
      { index: 0, startMonth: 1, endMonth: 3, amountPerMonth: 3.0 },
      { index: 1, startMonth: 4, endMonth: 6, amountPerMonth: 300.0 },
      { index: 2, startMonth: 7, endMonth: 12, amountPerMonth: 600.0 },
      { index: 3, startMonth: 12, endMonth: 24, amountPerMonth: 1200.0 },
      { index: 4, startMonth: 25, endMonth: null, amountPerMonth: 2400.0 },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Provenance                                                                  */
/* -------------------------------------------------------------------------- */

const p = (quote: string, page: number): Provenance => ({ quote, page, confidence: 'high' });

export const HALCYON_PROVENANCE = new Map<string, Provenance>([
  ['/account/orgIds', p('Hologram org ID(s): 90342', 1)],
  ['/account/orderFormNumber', p('Order form number: 00002891', 1)],
  ['/ratePlan/name', p('Data Plan: G3 10MB Dynamic Data Pool', 1)],
  ['/ratePlan/supportedSimSkus', p('Plan Supported SIM SKUs: G3-F, G3-G1', 1)],
  [
    '/ratePlan/pooling',
    p(
      'Each SIM added to a Dynamic Data Pool adds the specified amount of data to the overall pool size.',
      2,
    ),
  ],
  [
    '/ratePlan/poolAccess',
    p('Data Pool data is available to every SIM in the data pool.', 2),
  ],
  [
    '/ratePlan/overageBasis',
    p(
      "Overage rates will be charged for any data used over the data pool's total included data at the end of the month.",
      2,
    ),
  ],
  ['/term/startDate', p('Order form start date: 2026-08-01', 1)],
  ['/term/initialTermMonths', p('Initial term: 36 months from Order Form Start Date', 1)],
  ['/term/billingCycle', p('Billing cycle: Calendar month', 1)],
  ['/term/signatureDeadline', p('Customer signature deadline: 07/31/2026', 1)],
  ['/term/actualSignatureDate', p('DOCUMENT COMPLETED BY ALL PARTIES ON 05 AUG 2026', 5)],
  [
    '/testMode',
    p(
      'Test Mode remains active for the duration specified below, unless the SIM card consumes 100 KB of data or the SIM card sends 10 outbound SMS messages.',
      3,
    ),
  ],
  [
    '/testMode/onExitChargesBegin',
    p(
      'the SIM state will be changed to ACTIVE, and the Customer will be charged MRC and data usage fees.',
      3,
    ),
  ],
  [
    '/migration/onFailure',
    p(
      "If any SIMs are unable to be migrated, they will remain on one of Hologram's standard plans with the associated rates.",
      2,
    ),
  ],
  [
    '/migration/onSuccess',
    p(
      'Hologram will attempt to migrate the Customer’s G1 SIMs to the G3 profile, and SIMs that are successfully migrated will be moved to the above plan.',
      2,
    ),
  ],
  [
    '/charges/0',
    p('Dynamic Data Pool Monthly Recurring Charge Includes 10 MB per SIM — $2.43 Per SIM Monthly', 2),
  ],
  ['/charges/1', p('Flat rate data overage — $0.75 Per MB Pay as you go', 2)],
  ['/charges/2', p('Inbound SMS — Always free Per SMS', 2)],
  ['/charges/3', p('Outbound SMS — $0.57 Per SMS', 2)],
  ['/charges/5', p('G3-F — $4.50 Per SIM', 2)],
  [
    '/minimumSpend/coreRule',
    p(
      'For each Minimum Spend Period during the Order Form Term, Customer will pay the greater of the applicable Minimum Spend Amount or Customer’s actual fees incurred.',
      3,
    ),
  ],
  [
    '/minimumSpend/actualSpendDefinitions/broad',
    p(
      'All of Customer’s actual fees incurred on the Hologram Org ID(s) will be applied toward the applicable Minimum Spend Amount for each Minimum Spend Period.',
      3,
    ),
  ],
  [
    '/minimumSpend/actualSpendDefinitions/narrow',
    p(
      'Actual Spend will be calculated as Halcyon Motors’s invoiced charges only for the Rate Plan(s) and the Add-On(s) or Support Packages(s), less any credits applied by Hologram.',
      3,
    ),
  ],
  ['/minimumSpend/schedule/0', p('Month 1-3 (beginning 2026-08-01) — $3.00/month', 3)],
  ['/minimumSpend/schedule/1', p('Months 4-6 — $300.00/month', 3)],
  ['/minimumSpend/schedule/2', p('Months 7-12 — $600.00/month', 3)],
  ['/minimumSpend/schedule/3', p('Months 12-24 — $1,200.00/month', 3)],
  ['/minimumSpend/schedule/4', p('Months 25-36 and any months following — $2,400.00/month', 4)],
]);

export const HALCYON_COVERAGE = {
  missingFields: [] as string[],
  lowConfidence: [] as string[],
};
