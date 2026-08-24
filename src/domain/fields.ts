/**
 * Contract field projection.
 *
 * Turns a `BillingConfig` into labelled groups for display — the full field set
 * from Table 1 of the assignment spec, plus the commercial terms from Table 4.
 *
 * Pure, and here rather than in a component, for one reason: the null handling is
 * a domain rule, not a formatting preference. `null` means the contract is SILENT
 * on something, which is not the same as zero and not the same as "we could not
 * find it". Several detection rules fire precisely on null. A formatter that
 * renders it as an em-dash, or worse as `0` or `false`, quietly erases the
 * distinction the whole app is built to surface — so it renders as "Not stated",
 * and that behaviour is asserted in tests.
 */

import type { BillingConfig } from './schema';

export type Field = {
  label: string;
  value: string;
  /** True when the contract says nothing here. Rendered differently, and findable. */
  absent?: boolean;
};

export type FieldGroup = {
  title: string;
  fields: Field[];
};

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const NOT_STATED = 'Not stated';

function text(value: string | null | undefined): Field['value'] {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : NOT_STATED;
}

/** `snake_case` enum → sentence case, without a lookup table per enum. */
function humanise(value: string | null): string {
  if (!value) return NOT_STATED;
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return NOT_STATED;
  return value ? 'Yes' : 'No';
}

function count(value: number | null | undefined, unit: string, plural = `${unit}s`): string {
  if (value === null || value === undefined) return NOT_STATED;
  return `${value.toLocaleString()} ${value === 1 ? unit : plural}`;
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_STATED;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function list(values: string[]): string {
  return values.length > 0 ? values.join(', ') : NOT_STATED;
}

/** Marks the field absent whenever the formatter fell through to "Not stated". */
function field(label: string, value: string): Field {
  return value === NOT_STATED ? { label, value, absent: true } : { label, value };
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every field except the ones the collapsed row already shows — customer name,
 * rate plan, finding counts and status. Repeating those in the expansion would
 * make the reader check whether the two agreed.
 */
export function contractFields(config: BillingConfig): FieldGroup[] {
  const { account, ratePlan, term, testMode, migration, minimumSpend, charges } = config;

  const groups: FieldGroup[] = [
    {
      title: 'Account',
      fields: [
        field('Hologram Org ID', list(account.orgIds)),
        field('Order form number', text(account.orderFormNumber)),
        field('Scope', text(account.scope)),
        field('Supersedes prior agreements', yesNo(account.supersedesPriorAgreements)),
        field('Supersession date', text(account.supersessionDate)),
        field('Governing documents', text(account.governingDocuments)),
      ],
    },
    {
      title: 'Rate plan & included data',
      fields: [
        field('Supported SIM SKUs', list(ratePlan.supportedSimSkus)),
        field('Included data per SIM', count(ratePlan.includedDataMbPerSim, 'MB', 'MB')),
        field('Pooling', ratePlan.pooling ? 'Yes — shared across the fleet' : 'No'),
        field('Pool access', text(ratePlan.poolAccess)),
        field('Overage assessed on', humanise(ratePlan.overageBasis)),
        field('Overage assessed at', humanise(ratePlan.overageTiming)),
        field('Provisioning lead time', count(ratePlan.provisioningLeadTimeWeeks, 'week')),
        field('Unlisted products', text(ratePlan.unlistedProductsRate)),
      ],
    },
    {
      title: 'Terms, renewal & payment',
      fields: [
        field('Start date', text(term.startDate)),
        field('Initial term', count(term.initialTermMonths, 'month')),
        field('Auto renewal', yesNo(term.autoRenew)),
        field('Renewal term', count(term.renewalTermMonths, 'month')),
        field('Non-renewal notice', count(term.nonRenewalNoticeDays, 'day')),
        field('At end of order form term', text(term.postTermRates)),
        field('Currency', text(term.currency)),
        field('Billing method', text(term.billingMethod)),
        field('Billing cycle', humanise(term.billingCycle)),
        field('Payment terms', text(term.paymentTerms)),
        field('Prepaid → invoicing transition', count(term.prepaidTransitionWeeks, 'week')),
        field('Signature deadline', text(term.signatureDeadline)),
        field('Actual signature date', text(term.actualSignatureDate)),
      ],
    },
  ];

  if (testMode) {
    groups.push({
      title: 'Test mode conversion',
      fields: [
        field('Duration', count(testMode.durationDays, 'day')),
        field('Exit — data used', count(testMode.exitTriggers.dataKb, 'KB', 'KB')),
        field('Exit — outbound SMS', count(testMode.exitTriggers.outboundSms, 'message')),
        field('Exit — duration expiry', yesNo(testMode.exitTriggers.durationExpiry)),
        field('Trigger logic', humanise(testMode.triggerLogic)),
        field(
          'On exit, charges begin',
          testMode.onExitChargesBegin.length > 0
            ? testMode.onExitChargesBegin.map((k) => humanise(k)).join(', ')
            : NOT_STATED,
        ),
      ],
    });
  }

  if (migration) {
    groups.push({
      title: 'Migration',
      fields: [
        field('Attempted by Hologram', yesNo(migration.attempted)),
        field('Cost to customer', money(migration.cost)),
        field('On success', text(migration.onSuccess)),
        field('On failure', text(migration.onFailure)),
        field('Profile removal', text(migration.profileRemoval?.appliesTo ?? null)),
        field(
          'Outage protection after removal',
          migration.profileRemoval ? yesNo(migration.profileRemoval.outageProtection) : NOT_STATED,
        ),
        field('Migration deadline', text(migration.deadline)),
        field('Fleet responsibility', text(migration.fleetResponsibility)),
      ],
    });
  }

  groups.push({
    title: 'Commercial terms',
    fields: [
      field('Priced charges', `${charges.length}`),
      field('Core rule', text(minimumSpend?.coreRule ?? null)),
      field('Assessment cadence', humanise(minimumSpend?.assessmentCadence ?? null)),
      field('Excess carries forward', yesNo(minimumSpend?.excessCarriesForward)),
      field('Named exclusions', list((minimumSpend?.namedExclusions ?? []).map((e) => humanise(e)))),
      field('Early termination', text(minimumSpend?.earlyTermination ?? null)),
      field('Renewal commitment', text(minimumSpend?.renewalCommitment ?? null)),
      field('Spend periods', `${minimumSpend?.schedule.length ?? 0}`),
    ],
  });

  return groups;
}

/** How many fields the contract says nothing about — the coverage gap, at a glance. */
export function absentCount(groups: FieldGroup[]): number {
  return groups.reduce((n, g) => n + g.fields.filter((f) => f.absent).length, 0);
}
