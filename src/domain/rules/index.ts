/**
 * The rule registry.
 *
 * Every deterministic detector the QA pass runs. Order here determines the order
 * findings are presented in, so it runs roughly by how expensive the defect is to
 * get wrong: minimum spend, then charges, then Test Mode, then term, then coverage.
 *
 * To add a defect class: write the rule in the matching category file, export it,
 * and add it to the array below. Nothing else in the app needs to change.
 */

import type { FlagRule } from './types';
import { minimumSpendRules } from './minimum-spend';
import { chargeRules } from './charges';
import { testModeRules } from './test-mode';
import { termRules } from './term';
import { coverageRules } from './coverage';

export const ALL_RULES: FlagRule[] = [
  ...minimumSpendRules,
  ...chargeRules,
  ...testModeRules,
  ...termRules,
  ...coverageRules,
];

/** Guards against a copy-paste duplicate id silently shadowing a rule. */
export function assertUniqueRuleIds(rules: FlagRule[] = ALL_RULES): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`Duplicate flag rule id: ${rule.id}`);
    seen.add(rule.id);
  }
}

export * from './types';
export { minimumSpendRules, chargeRules, testModeRules, termRules, coverageRules };
