/**
 * The deterministic detection layer.
 *
 * A rule is a predicate over an extracted config that names a defect class. Rules
 * are the reliable floor of the QA pass: precise pointers, real dollar impact,
 * repeatable, no API cost, and incapable of inventing a finding that isn't there.
 *
 * Their limit is equally real — a rule only catches what someone anticipated. That
 * gap is why the adversarial model review runs alongside them (see `flags.ts`).
 * Rules are the floor, not the ceiling.
 *
 * Adding a defect class means adding a rule to one of the category files and
 * registering it in `index.ts`. Nothing else changes.
 */

import type { BillingConfig, FlagCategory, FlagImpact, FlagSeverity, Provenance } from '../schema';
import type { PolicyField } from '../policy';

/** What a rule emits. Ids, ordinals, and status are assigned by the merge step. */
export type DetectedFlag = {
  ruleId: string;
  severity: FlagSeverity;
  category: FlagCategory;
  title: string;
  /** What the contract says, and why it is a problem. */
  detail: string;
  /** The question to put to Deal Desk or the AE. Never a resolution. */
  question: string;
  pointers: string[];
  evidence: { quote: string; page: number | null }[];
  impact: FlagImpact;
  /** Which policy toggle resolves this, when one does. */
  policyField: PolicyField | null;
  blocks: {
    simulation: boolean;
    /** Specific months that cannot be computed, when the defect is month-scoped. */
    months: number[] | null;
    goLive: boolean;
  };
};

export type RuleContext = {
  config: BillingConfig;
  /** Pointer → where the value came from in the PDF. */
  provenance: Map<string, Provenance>;
  coverage: { missingFields: string[]; lowConfidence: string[] };
};

export type FlagRule = {
  id: string;
  category: FlagCategory;
  /** One-line statement of the defect class, for docs and the rule inspector. */
  describes: string;
  detect: (ctx: RuleContext) => DetectedFlag[];
};

/* -------------------------------------------------------------------------- */
/* Helpers shared across rule files                                            */
/* -------------------------------------------------------------------------- */

/** Pull evidence for a set of pointers, skipping any without recorded provenance. */
export function evidenceFor(
  ctx: RuleContext,
  ...pointers: string[]
): { quote: string; page: number | null }[] {
  const out: { quote: string; page: number | null }[] = [];
  for (const p of pointers) {
    const src = ctx.provenance.get(p);
    if (src) out.push({ quote: src.quote, page: src.page });
  }
  return out;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Charges with a real, non-zero price — the ones whose misclassification costs money. */
export function pricedCharges(config: BillingConfig) {
  return config.charges.filter((c) => c.rate.kind === 'fixed' && (c.rate.amount ?? 0) > 0);
}
