/**
 * Charge-level defects: items that are priced but unclassifiable, supported but
 * unpriced, or referenced but absent from the rate table.
 */

import type { DetectedFlag, FlagRule, RuleContext } from './types';
import { evidenceFor, money, pricedCharges } from './types';

/* -------------------------------------------------------------------------- */

/**
 * A priced charge that fits none of the categories the narrow Actual Spend
 * definition names.
 *
 * This is where `Charge.kind` earns its place: under the narrow reading, minimum-
 * spend eligibility derives from the category, so an item that is none of rate
 * plan, add-on or support package has genuinely undefined treatment. Detected
 * structurally rather than by looking for any particular product.
 */
export const unclassifiedCharge: FlagRule = {
  id: 'unclassified_charge',
  category: 'charges',
  describes: 'A priced charge fits none of the categories named in the Actual Spend definition.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const ms = ctx.config.minimumSpend;
    if (!ms) return [];

    return pricedCharges(ctx.config)
      .filter((c) => c.kind === 'unclassified' && c.countsTowardMinimum === 'undetermined')
      .map((charge) => {
        const idx = ctx.config.charges.indexOf(charge);
        const rate = charge.rate.amount ?? 0;
        return {
          ruleId: unclassifiedCharge.id,
          severity: 'blocking' as const,
          category: 'charges' as const,
          title: `${charge.label} may or may not count toward the minimum`,
          detail:
            `${charge.label} is priced at ${money(rate)} ${charge.unit ? `(${charge.unit.replace(/_/g, ' ')})` : ''}, ` +
            `but the Actual Spend definition names only Rate Plans, Add-Ons and Support Packages. ` +
            `This charge is not clearly any of the three, so whether it counts toward the commitment is undefined.`,
          question: `Does ${charge.label} count toward minimum spend?`,
          pointers: [`/charges/${idx}`],
          evidence: evidenceFor(ctx, `/charges/${idx}`),
          impact: {
            kind: 'per_invoice' as const,
            amount: rate,
            note: `At ${money(rate)} per unit this is material at volume.`,
          },
          policyField: charge.unit === 'per_sms' ? ('smsCountsTowardMinimum' as const) : null,
          blocks: { simulation: false, months: null, goLive: true },
        };
      });
  },
};

/* -------------------------------------------------------------------------- */

/**
 * Same classification question, zero rate. Raised separately and non-blocking:
 * the ambiguity is real but carries no dollar consequence while the rate is zero,
 * and conflating it with the priced case would inflate the blocker list.
 */
export const zeroRateUnclassified: FlagRule = {
  id: 'zero_rate_unclassified',
  category: 'charges',
  describes: 'An unclassified charge is priced at zero, so the ambiguity is currently immaterial.',
  detect(ctx: RuleContext): DetectedFlag[] {
    if (!ctx.config.minimumSpend) return [];

    return ctx.config.charges
      .filter(
        (c) =>
          c.kind === 'unclassified' &&
          c.countsTowardMinimum === 'undetermined' &&
          c.rate.kind === 'fixed' &&
          (c.rate.amount ?? 0) === 0,
      )
      .map((charge) => {
        const idx = ctx.config.charges.indexOf(charge);
        return {
          ruleId: zeroRateUnclassified.id,
          severity: 'non_blocking' as const,
          category: 'charges' as const,
          title: `${charge.label} is unclassified but priced at zero`,
          detail:
            `${charge.label} raises the same classification question as other unclassified charges, but it is ` +
            `priced at ${money(0)}, so it has no effect on any invoice while that holds. Worth resolving for ` +
            `consistency, and before the rate ever changes.`,
          question: `Does ${charge.label} count toward minimum spend? No dollar impact at the current rate.`,
          pointers: [`/charges/${idx}`],
          evidence: evidenceFor(ctx, `/charges/${idx}`),
          impact: { kind: 'unknown' as const, amount: 0, note: 'No dollar impact at a zero rate.' },
          policyField: null,
          blocks: { simulation: false, months: null, goLive: false },
        };
      });
  },
};

/* -------------------------------------------------------------------------- */

/**
 * A SKU the plan supports but never prices.
 *
 * The fallback is whatever the dashboard says that day, which means part of the
 * catalogue on a signed contract sits at a rate the customer never saw.
 */
export const unpricedSupportedSku: FlagRule = {
  id: 'unpriced_supported_sku',
  category: 'charges',
  describes: 'A supported SIM SKU has no rate anywhere on the order form.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const skus = ctx.config.ratePlan.supportedSimSkus;
    if (skus.length === 0) return [];

    const pricedLabels = pricedCharges(ctx.config)
      .map((c) => `${c.id} ${c.label}`.toLowerCase())
      .join(' | ');

    return skus
      .filter((sku) => !pricedLabels.includes(sku.toLowerCase()))
      .map((sku) => ({
        ruleId: unpricedSupportedSku.id,
        severity: 'non_blocking' as const,
        category: 'charges' as const,
        title: `${sku} is a supported SKU with no rate on the order form`,
        detail:
          `${sku} is listed among the plan's supported SIM SKUs, but no charge on this order form prices it. ` +
          `Unlisted products fall back to the current dashboard rate, which means part of the hardware ` +
          `catalogue on a signed contract sits at a price the customer never agreed to.`,
        question: `What is the ${sku} rate, and should it be added to the order form?`,
        pointers: ['/ratePlan/supportedSimSkus'],
        evidence: evidenceFor(ctx, '/ratePlan/supportedSimSkus'),
        impact: {
          kind: 'per_sim' as const,
          amount: null,
          note: 'Hardware purchases only; does not affect recurring charges.',
        },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: false },
      }));
  },
};

/* -------------------------------------------------------------------------- */

/**
 * The contract routes some SIMs to "standard rates" that appear nowhere in it.
 * Those charges land on the same Org ID, so their treatment under the commitment
 * is undefined as well as their price.
 */
export const unstatedFallbackRates: FlagRule = {
  id: 'unstated_fallback_rates',
  category: 'migration',
  describes: 'A fallback path sends SIMs to rates the order form never states.',
  detect(ctx: RuleContext): DetectedFlag[] {
    const migration = ctx.config.migration;
    if (!migration?.onFailure) return [];

    // Only fires when the fallback text actually points at unstated pricing.
    if (!/standard\s+(rate|plan)/i.test(migration.onFailure)) return [];

    return [
      {
        ruleId: unstatedFallbackRates.id,
        severity: 'non_blocking',
        category: 'migration',
        title: 'Standard-plan rates for non-migrated SIMs are not stated',
        detail:
          `The contract says: "${migration.onFailure}". Those standard rates appear nowhere on this order form. ` +
          `Charges from such SIMs are rate-plan charges on the same Org ID but not on this order form's plan, so ` +
          `both their price and their contribution to Actual Spend are undefined.`,
        question:
          'What are the standard rates for non-migrated SIMs, and do charges from those SIMs count toward ' +
          'minimum spend?',
        pointers: ['/migration/onFailure'],
        evidence: evidenceFor(ctx, '/migration/onFailure'),
        impact: {
          kind: 'per_sim',
          amount: null,
          note: 'Scales with however many SIMs fail to migrate.',
        },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: false },
      },
    ];
  },
};

export const chargeRules: FlagRule[] = [
  unclassifiedCharge,
  zeroRateUnclassified,
  unpricedSupportedSku,
  unstatedFallbackRates,
];
