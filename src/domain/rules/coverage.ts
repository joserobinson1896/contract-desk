/**
 * Extraction-coverage defects.
 *
 * These do not describe the contract — they describe what the extraction pass could
 * not find or was unsure about. Separated from contract defects because the remedy
 * differs: a contract defect goes to Deal Desk, a coverage gap goes back to the
 * document or to a human re-read.
 *
 * They matter most on contracts the rules have never seen, where a silently missing
 * field would otherwise read as a contract that simply has no such term.
 */

import type { DetectedFlag, FlagRule, RuleContext } from './types';

/** Pointers whose absence changes an invoice, versus merely being incomplete. */
const INVOICE_CRITICAL = [
  '/ratePlan/includedDataMbPerSim',
  '/ratePlan/pooling',
  '/ratePlan/overageBasis',
  '/term/startDate',
  '/term/billingCycle',
  '/minimumSpend/schedule',
];

function isCritical(pointer: string): boolean {
  return INVOICE_CRITICAL.some((c) => pointer === c || pointer.startsWith(`${c}/`));
}

function humanise(pointer: string): string {
  return pointer
    .replace(/^\//, '')
    .replace(/\//g, ' → ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */

/**
 * The contract never addresses a field the billing engine needs.
 *
 * Raised as one flag per gap rather than a single lumped item, so each can be
 * resolved and tracked independently.
 */
export const extractionGap: FlagRule = {
  id: 'extraction_gap',
  category: 'coverage',
  describes: 'The contract does not address a field the billing configuration needs.',
  detect(ctx: RuleContext): DetectedFlag[] {
    return ctx.coverage.missingFields.map((pointer) => {
      const critical = isCritical(pointer);
      return {
        ruleId: extractionGap.id,
        severity: critical ? ('blocking' as const) : ('non_blocking' as const),
        category: 'coverage' as const,
        title: `Contract does not address ${humanise(pointer)}`,
        detail:
          `No clause in this contract covers ${humanise(pointer)}. ` +
          (critical
            ? 'The billing engine needs this value, so it cannot be left undefined before go-live.'
            : 'Not required to compute an invoice, but it leaves part of the configuration unstated.'),
        question: `What value applies for ${humanise(pointer)}? The contract is silent.`,
        pointers: [pointer],
        evidence: [],
        impact: {
          kind: critical ? ('per_invoice' as const) : ('unknown' as const),
          amount: null,
          note: critical ? 'Required to compute a month.' : 'Configuration completeness only.',
        },
        policyField: null,
        blocks: { simulation: critical, months: null, goLive: critical },
      };
    });
  },
};

/* -------------------------------------------------------------------------- */

/**
 * A value was extracted, but the reading is genuinely uncertain.
 *
 * Always non-blocking and always low-confidence: the point is to route a human to
 * verify it against the source, not to gate go-live on a machine's self-doubt.
 */
export const lowConfidenceExtraction: FlagRule = {
  id: 'low_confidence_extraction',
  category: 'coverage',
  describes: 'A value was extracted but the underlying clause is ambiguous or hard to read.',
  detect(ctx: RuleContext): DetectedFlag[] {
    return ctx.coverage.lowConfidence.map((pointer) => {
      const src = ctx.provenance.get(pointer);
      return {
        ruleId: lowConfidenceExtraction.id,
        severity: 'non_blocking' as const,
        category: 'coverage' as const,
        title: `Verify ${humanise(pointer)} against the contract`,
        detail:
          `The value for ${humanise(pointer)} was extracted with low confidence` +
          (src?.quote ? `, from: "${src.quote}"` : '') +
          '. Worth a human read before this drives an invoice.',
        question: `Confirm ${humanise(pointer)} was read correctly from the contract.`,
        pointers: [pointer],
        evidence: src ? [{ quote: src.quote, page: src.page }] : [],
        impact: { kind: 'unknown' as const, amount: null, note: 'Depends on the field.' },
        policyField: null,
        blocks: { simulation: false, months: null, goLive: false },
      };
    });
  },
};

export const coverageRules: FlagRule[] = [extractionGap, lowConfidenceExtraction];
