/**
 * Flag assembly — where the two detection layers meet.
 *
 * Layer 1 is the deterministic rule set: precise, repeatable, incapable of
 * inventing a finding, and blind to anything nobody anticipated.
 *
 * Layer 2 is the adversarial model review: catches the unanticipated, but is
 * non-deterministic and can over- or under-call.
 *
 * The merge rules exist to take the strength of each without inheriting the
 * weakness:
 *
 *   1. A model finding that lands on the same config location as a rule finding
 *      collapses into the rule's version. The rule's dollar math is derived from
 *      the config, so it is the one to trust.
 *   2. Model-only findings survive, marked `source: 'model'`, and are never allowed
 *      to gate go-live on their own. A hallucinated finding should cost a human a
 *      glance, never a blocked launch.
 *
 * Everything arrives `status: 'open'`. The app detects; a person decides.
 */

import type { BillingConfig, Flag, ModelFinding, Provenance } from './schema';
import { ALL_RULES, assertUniqueRuleIds, type DetectedFlag, type RuleContext } from './rules';

/* -------------------------------------------------------------------------- */
/* Ids                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Stable across re-runs so a resolution recorded today still matches the same
 * finding tomorrow. Derived from the rule and the location, never from ordering.
 */
function ruleFlagId(detected: DetectedFlag): string {
  const scope = detected.pointers.length > 0 ? detected.pointers.join('|') : 'global';
  return `rule:${detected.ruleId}#${scope}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function modelFlagId(finding: ModelFinding): string {
  return `model:${slug(finding.title)}`;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

const CATEGORY_ORDER: Record<Flag['category'], number> = {
  minimum_spend: 0,
  definitions: 1,
  charges: 2,
  test_mode: 3,
  term: 4,
  migration: 5,
  coverage: 6,
};

/**
 * Blocking first — the register doubles as the go-live blocker list, so the things
 * that stop launch belong at the top. Rules outrank model findings at equal
 * severity because they carry exact impact.
 */
function compareFlags(a: Flag, b: Flag): number {
  if (a.severity !== b.severity) return a.severity === 'blocking' ? -1 : 1;
  if (a.source !== b.source) return a.source === 'rule' ? -1 : 1;
  const cat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  if (cat !== 0) return cat;
  return a.title.localeCompare(b.title);
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                  */
/* -------------------------------------------------------------------------- */

function fromRule(detected: DetectedFlag): Flag {
  return {
    id: ruleFlagId(detected),
    ruleId: detected.ruleId,
    source: 'rule',
    confidence: 'certain',
    ordinal: 0,
    severity: detected.severity,
    category: detected.category,
    title: detected.title,
    detail: detected.detail,
    question: detected.question,
    pointers: detected.pointers,
    evidence: detected.evidence,
    impact: detected.impact,
    policyField: detected.policyField,
    blocks: detected.blocks,
    status: 'open',
    resolution: null,
  };
}

function fromModel(finding: ModelFinding): Flag {
  return {
    id: modelFlagId(finding),
    ruleId: null,
    source: 'model',
    confidence: finding.confidence,
    ordinal: 0,
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    detail: finding.detail,
    question: finding.question,
    pointers: finding.pointers,
    evidence: finding.evidence,
    impact: finding.impact,
    policyField: null,
    blocks: {
      // A model finding never blocks financial projections. Refusing to compute is a strong
      // action, and it should rest on deterministic evidence rather than a judgement
      // call that might be wrong.
      simulation: false,
      months: null,
      goLive: false,
    },
    status: 'open',
    resolution: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Overlap detection                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Whether a model finding is talking about the same thing a rule already caught.
 *
 * Pointer-prefix overlap rather than exact match, because the model tends to point
 * at a parent (`/minimumSpend/schedule`) where a rule points at the specific member
 * (`/minimumSpend/schedule/2`). Treating those as distinct would show the user the
 * same defect twice.
 */
function overlaps(modelPointers: string[], rulePointers: string[]): boolean {
  if (modelPointers.length === 0 || rulePointers.length === 0) return false;
  return modelPointers.some((m) =>
    rulePointers.some((r) => m === r || m.startsWith(`${r}/`) || r.startsWith(`${m}/`)),
  );
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export type BuildFlagsInput = {
  config: BillingConfig;
  provenance: Map<string, Provenance>;
  coverage: { missingFields: string[]; lowConfidence: string[] };
  /** Findings from the adversarial review pass. Empty when that call was skipped or failed. */
  modelFindings?: ModelFinding[];
};

export type BuildFlagsOutput = {
  flags: Flag[];
  stats: {
    fromRules: number;
    fromModel: number;
    modelSuppressedAsDuplicate: number;
    blocking: number;
  };
};

/**
 * Run both detection layers and merge. Deterministic given the same inputs, which
 * is what makes the rule half of this testable.
 */
export function buildFlags(input: BuildFlagsInput): BuildFlagsOutput {
  assertUniqueRuleIds();

  const ctx: RuleContext = {
    config: input.config,
    provenance: input.provenance,
    coverage: input.coverage,
  };

  const ruleFlags: Flag[] = [];
  for (const rule of ALL_RULES) {
    let detected: DetectedFlag[];
    try {
      detected = rule.detect(ctx);
    } catch {
      // One malformed rule must not take down the whole QA pass — the remaining
      // rules still have useful things to say about this contract.
      continue;
    }
    for (const d of detected) ruleFlags.push(fromRule(d));
  }

  let suppressed = 0;
  const modelFlags: Flag[] = [];
  const seenModelIds = new Set<string>();

  for (const finding of input.modelFindings ?? []) {
    if (ruleFlags.some((rf) => overlaps(finding.pointers, rf.pointers))) {
      suppressed++;
      continue;
    }
    const flag = fromModel(finding);
    if (seenModelIds.has(flag.id)) {
      suppressed++;
      continue;
    }
    seenModelIds.add(flag.id);
    modelFlags.push(flag);
  }

  const flags = [...ruleFlags, ...modelFlags]
    .sort(compareFlags)
    .map((f, i) => ({ ...f, ordinal: i + 1 }));

  return {
    flags,
    stats: {
      fromRules: ruleFlags.length,
      fromModel: modelFlags.length,
      modelSuppressedAsDuplicate: suppressed,
      blocking: flags.filter((f) => f.severity === 'blocking' && f.status === 'open').length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Gates                                                                       */
/* -------------------------------------------------------------------------- */

export function openFlags(flags: Flag[]): Flag[] {
  return flags.filter((f) => f.status === 'open');
}

/** Blocking findings nobody has resolved or explicitly accepted. */
export function openBlockingFlags(flags: Flag[]): Flag[] {
  return flags.filter((f) => f.status === 'open' && f.severity === 'blocking');
}

/** Findings that stop a specific month from being computed. */
export function flagsBlockingMonth(flags: Flag[], month: number): Flag[] {
  return flags.filter(
    (f) =>
      f.status === 'open' &&
      f.blocks.simulation &&
      (f.blocks.months === null || f.blocks.months.includes(month)),
  );
}

/** Findings that stop financial projections entirely, regardless of month. */
export function flagsBlockingProjection(flags: Flag[]): Flag[] {
  return flags.filter((f) => f.status === 'open' && f.blocks.simulation && f.blocks.months === null);
}

export function canGoLive(flags: Flag[]): boolean {
  return !flags.some((f) => f.status === 'open' && f.blocks.goLive);
}

/**
 * Re-derive flags after a config change while preserving decisions already made.
 *
 * A resolution belongs to a finding, not to a run. If a defect survives an edit,
 * so should the record of what someone decided about it — otherwise resolving a
 * flag and then correcting an unrelated typo would silently reopen it.
 */
export function rebuildPreservingResolutions(
  input: BuildFlagsInput,
  previous: Flag[],
): BuildFlagsOutput {
  const priorById = new Map(previous.map((f) => [f.id, f]));
  const built = buildFlags(input);

  const flags = built.flags.map((flag) => {
    const prior = priorById.get(flag.id);
    if (!prior || prior.status === 'open') return flag;
    return { ...flag, status: prior.status, resolution: prior.resolution };
  });

  return {
    flags,
    stats: {
      ...built.stats,
      blocking: flags.filter((f) => f.severity === 'blocking' && f.status === 'open').length,
    },
  };
}
