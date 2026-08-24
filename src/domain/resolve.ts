/**
 * Recording decisions.
 *
 * Every mutation a person makes to a contract goes through here, so three things
 * are guaranteed rather than remembered: the audit log gets an entry, the
 * lifecycle is re-derived, and flags are re-detected against the updated config.
 *
 * Resolutions are attached to findings, never merged into the config silently. If
 * someone later corrects an unrelated field and detection re-runs, a decision
 * already made survives — `rebuildPreservingResolutions` matches on stable flag
 * ids. The alternative, reopening every flag on any edit, would train people to
 * ignore the register.
 */

import { applyPatch, type Operation } from 'fast-json-patch';

import { rebuildPreservingResolutions } from './flags';
import { setPolicyField, type PolicyField, type PolicyValues } from './policy';
import { appendAudit, deriveLifecycle, provenanceMap, type ContractRecord } from './record';
import type { BillingConfig, Flag } from './schema';
import { STATUS_LABEL, checkTransition, type ContractStatus } from './status';

/* -------------------------------------------------------------------------- */

function refresh(record: ContractRecord): ContractRecord {
  const rebuilt = rebuildPreservingResolutions(
    {
      config: record.config,
      provenance: provenanceMap(record),
      coverage: record.extraction.coverage,
    },
    record.flags,
  );
  const next = { ...record, flags: rebuilt.flags };
  return { ...next, lifecycle: deriveLifecycle(next) };
}

/* -------------------------------------------------------------------------- */

/**
 * Resolve a finding.
 *
 * An optional JSON Patch corrects the config where the decision changes a value —
 * a band boundary, say. Applied immutably, and recorded in the resolution so the
 * change is traceable to the decision that caused it rather than appearing as an
 * unexplained edit.
 */
export function resolveFlag(
  record: ContractRecord,
  flagId: string,
  decision: string,
  by: string,
  note: string | null = null,
  patch: Operation[] | null = null,
): ContractRecord {
  const flag = record.flags.find((f) => f.id === flagId);
  if (!flag) return record;

  let config: BillingConfig = record.config;
  if (patch && patch.length > 0) {
    try {
      config = applyPatch(structuredClone(record.config), patch, true, false).newDocument;
    } catch {
      // A patch that will not apply means the config moved underneath the decision.
      // Record the decision without it rather than corrupting the config.
      config = record.config;
    }
  }

  const resolvedAt = new Date().toISOString();

  const withResolution: ContractRecord = {
    ...record,
    config,
    flags: record.flags.map((f) =>
      f.id === flagId
        ? {
            ...f,
            status: 'resolved' as const,
            resolution: { decision, decidedBy: by, decidedAt: resolvedAt, note, patch },
          }
        : f,
    ),
  };

  return refresh(
    appendAudit(withResolution, {
      by,
      action: 'flag_resolved',
      summary: `Resolved “${flag.title}” — ${decision}`,
      meta: { flagId, decision, ruleId: flag.ruleId, patched: Boolean(patch?.length) },
    }),
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Accept a finding as a known risk.
 *
 * Distinct from resolving it: nothing was decided, someone chose to proceed
 * anyway. It clears the go-live gate but stays visible in the register, and the
 * audit log records who accepted it. Requires a reason — an unexplained accepted
 * risk is indistinguishable from an oversight.
 */
export function acceptRisk(
  record: ContractRecord,
  flagId: string,
  by: string,
  reason: string,
): ContractRecord {
  const flag = record.flags.find((f) => f.id === flagId);
  if (!flag) return record;

  const withAcceptance: ContractRecord = {
    ...record,
    flags: record.flags.map((f) =>
      f.id === flagId
        ? {
            ...f,
            status: 'accepted_risk' as const,
            resolution: {
              decision: 'Accepted as a known risk',
              decidedBy: by,
              decidedAt: new Date().toISOString(),
              note: reason,
              patch: null,
            },
          }
        : f,
    ),
  };

  return refresh(
    appendAudit(withAcceptance, {
      by,
      action: 'flag_accepted_risk',
      summary: `Accepted risk on “${flag.title}” — ${reason}`,
      meta: { flagId, ruleId: flag.ruleId },
    }),
  );
}

/* -------------------------------------------------------------------------- */

export function reopenFlag(record: ContractRecord, flagId: string, by: string): ContractRecord {
  const flag = record.flags.find((f) => f.id === flagId);
  if (!flag) return record;

  const reopened: ContractRecord = {
    ...record,
    flags: record.flags.map((f) =>
      f.id === flagId ? { ...f, status: 'open' as const, resolution: null } : f,
    ),
  };

  return refresh(
    appendAudit(reopened, {
      by,
      action: 'flag_reopened',
      summary: `Reopened “${flag.title}”`,
      meta: { flagId },
    }),
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Change a billing policy value.
 *
 * Also resolves any open finding that names this field, since answering the
 * question is what the finding was asking for. Keeping them in sync here means a
 * user never has to record the same decision twice.
 */
export function changePolicy<K extends PolicyField>(
  record: ContractRecord,
  field: K,
  value: PolicyValues[K],
  by: string,
  note: string | null = null,
): ContractRecord {
  const previous = record.policy.values[field];
  const policy = setPolicyField(record.policy, field, value, by, note);

  const linked = record.flags.filter((f) => f.policyField === field && f.status === 'open');
  const decidedAt = new Date().toISOString();

  const withPolicy: ContractRecord = {
    ...record,
    policy,
    flags: record.flags.map((f) =>
      f.policyField === field && f.status === 'open'
        ? {
            ...f,
            status: 'resolved' as const,
            resolution: {
              decision: `${field} = ${String(value)}`,
              decidedBy: by,
              decidedAt,
              note,
              patch: null,
            },
          }
        : f,
    ),
  };

  const summary =
    linked.length > 0
      ? `Set ${field} to ${String(value)} — resolves ${linked.length} finding${linked.length === 1 ? '' : 's'}`
      : `Set ${field} to ${String(value)}`;

  return refresh(
    appendAudit(withPolicy, {
      by,
      action: 'policy_changed',
      summary,
      meta: { field, from: String(previous), to: String(value), resolvedFlagIds: linked.map((f) => f.id) },
    }),
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Release a contract for billing.
 *
 * Moves both axes together: `lifecycle` to `live` (the QA gate has passed) and
 * `status` to `active` (it is now billable). They are separate fields because they
 * answer separate questions, but this one action is what advances both, so they
 * cannot drift apart here.
 */
export function setLive(record: ContractRecord, by: string): ContractRecord {
  return appendAudit(
    { ...record, lifecycle: 'live', status: 'active' },
    { by, action: 'lifecycle_changed', summary: 'Marked live — billing configuration released.', meta: null },
  );
}

export function unsetLive(record: ContractRecord, by: string): ContractRecord {
  const reverted = { ...record, lifecycle: 'verified' as const, status: 'draft' as const };
  return appendAudit(
    { ...reverted, lifecycle: deriveLifecycle(reverted) },
    { by, action: 'lifecycle_changed', summary: 'Withdrawn from live.', meta: null },
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Move a contract's commercial status.
 *
 * Refuses rather than throws. An illegal move is a caller mistake, not an
 * exception — the screen that asked for it needs a reason it can show, and a
 * thrown error at this layer would take the whole detail view down with it.
 *
 * Every accepted move is written to the audit log with both endpoints, because
 * "who marked this Paid, and when" is the first question anyone asks when an
 * invoice and a contract disagree.
 */
export function setStatus(
  record: ContractRecord,
  to: ContractStatus,
  by: string,
  /** Appended to the audit summary — e.g. which invoice caused the move. */
  because?: string,
): { ok: true; record: ContractRecord } | { ok: false; reason: string } {
  const check = checkTransition(record, to);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (record.status === to) return { ok: true, record };

  const from = record.status;
  return {
    ok: true,
    record: appendAudit(
      { ...record, status: to },
      {
        by,
        action: 'status_changed',
        summary:
          `Status ${STATUS_LABEL[from]} → ${STATUS_LABEL[to]}` + (because ? ` — ${because}` : ''),
        meta: { from, to },
      },
    ),
  };
}

/* -------------------------------------------------------------------------- */

/** Suggested config patch for findings where the fix is mechanical. */
export function suggestedPatch(flag: Flag, config: BillingConfig): Operation[] | null {
  if (flag.ruleId !== 'spend_band_overlap') return null;

  const schedule = config.minimumSpend?.schedule;
  if (!schedule) return null;

  // Pull the two overlapping period indexes out of the flag's own pointers.
  const indexes = flag.pointers
    .map((p) => /^\/minimumSpend\/schedule\/(\d+)$/.exec(p)?.[1])
    .filter((i): i is string => i !== undefined)
    .map(Number);
  if (indexes.length !== 2) return null;

  const [firstIdx, secondIdx] = indexes;
  const first = schedule.findIndex((p) => p.index === firstIdx);
  const second = schedule.findIndex((p) => p.index === secondIdx);
  if (first < 0 || second < 0) return null;

  const firstEnd = schedule[first].endMonth;
  if (firstEnd === null) return null;

  // Move the later band to start after the earlier one ends — the reading that
  // makes the schedule contiguous, which every other band in these contracts is.
  return [{ op: 'replace', path: `/minimumSpend/schedule/${second}/startMonth`, value: firstEnd + 1 }];
}
