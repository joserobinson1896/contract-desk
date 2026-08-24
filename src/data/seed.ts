/**
 * Seeding.
 *
 * Records live in one browser's storage, so a freshly-cloned repo opens to an
 * empty app. Seeding the reference contract means anyone can see the full
 * detect → decide → project loop without an API key or a PDF to hand.
 *
 * Only the public mock contract from the exercise is seeded. Real customer
 * contracts are never committed — see `.gitignore`.
 */

import { buildFlags } from '@/domain/flags';
import { createDefaultPolicy } from '@/domain/policy';
import { appendAudit, deriveLifecycle, type ContractRecord, SCHEMA_VERSION } from '@/domain/record';
import { HALCYON_CONFIG, HALCYON_COVERAGE, HALCYON_PROVENANCE } from '@/fixtures/halcyon';
import { MERIDIAN_CONFIG, MERIDIAN_COVERAGE, MERIDIAN_PROVENANCE } from '@/fixtures/meridian';
import type { BillingConfig, Provenance } from '@/domain/schema';
import { findBySha256, listContracts, saveContract } from './repository';

/** Stable so re-seeding replaces rather than duplicates. */
const HALCYON_ID = 'seed-halcyon-00002891';
const HALCYON_SHA = 'seed:halcyon-motors-00002891';
const MERIDIAN_ID = 'seed-meridian-00004417';
const MERIDIAN_SHA = 'seed:meridian-freight-00004417';

type Seed = {
  id: string;
  sha: string;
  fileName: string;
  pageCount: number;
  config: BillingConfig;
  provenance: Map<string, Provenance>;
  coverage: { missingFields: string[]; lowConfidence: string[] };
};

const SEEDS: Seed[] = [
  {
    id: HALCYON_ID,
    sha: HALCYON_SHA,
    fileName: 'Mock_Hologram_Agreement_Halcyon_Motors.pdf',
    pageCount: 5,
    config: HALCYON_CONFIG,
    provenance: HALCYON_PROVENANCE,
    coverage: HALCYON_COVERAGE,
  },
  {
    id: MERIDIAN_ID,
    sha: MERIDIAN_SHA,
    fileName: 'Mock_Hologram_Agreement_Meridian_Freight.pdf',
    pageCount: 4,
    config: MERIDIAN_CONFIG,
    provenance: MERIDIAN_PROVENANCE,
    coverage: MERIDIAN_COVERAGE,
  },
];

function buildSeedRecord(seed: Seed, now: string): ContractRecord {
  const { flags } = buildFlags({
    config: seed.config,
    provenance: seed.provenance,
    coverage: seed.coverage,
  });

  const base: ContractRecord = {
    id: seed.id,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,

    source: {
      fileName: seed.fileName,
      mimeType: 'application/pdf',
      byteSize: 0,
      pageCount: seed.pageCount,
      sha256: seed.sha,
    },

    extraction: {
      status: 'extracted',
      model: null,
      startedAt: now,
      completedAt: now,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      error: null,
      // Rules only — this record is transcribed, not model-extracted, so claiming
      // a review pass ran would misrepresent where its findings came from.
      reviewPassCompleted: false,
      coverage: seed.coverage,
    },

    lifecycle: 'extracted',
    status: 'draft' as const,
    config: seed.config,
    provenance: [...seed.provenance.entries()].map(([pointer, source]) => ({ pointer, source })),
    policy: createDefaultPolicy(),
    flags,
    simulations: [],
    auditLog: [],
  };

  const withAudit = appendAudit(base, {
    by: 'system',
    action: 'imported',
    summary:
      flags.length === 0
        ? 'Seeded reference contract — no findings raised.'
        : `Seeded reference contract — ${flags.length} findings raised, all open.`,
    meta: { flagCount: flags.length, source: 'fixture' },
  });

  return { ...withAudit, lifecycle: deriveLifecycle(withAudit) };
}

export function buildHalcyonRecord(now: string = new Date().toISOString()): ContractRecord {
  return buildSeedRecord(SEEDS[0], now);
}

export function buildMeridianRecord(now: string = new Date().toISOString()): ContractRecord {
  return buildSeedRecord(SEEDS[1], now);
}

/** Add the reference contracts if the library is empty. */
export async function seedIfEmpty(): Promise<boolean> {
  const existing = await listContracts();
  if (existing.length > 0) return false;
  await reseedReference();
  return true;
}

/**
 * Re-add both reference contracts on demand, replacing any prior copy.
 *
 * Two, not one, and they are opposites on purpose. Halcyon carries every defect
 * the rule engine looks for and cannot be released or invoiced — that gate is the
 * product. Meridian is drafted clean, so the go-live and invoicing path can
 * actually be walked. With only the defective one, the happy path is unreachable
 * and looks broken rather than gated.
 */
export async function reseedReference(): Promise<void> {
  const now = new Date().toISOString();
  for (const seed of SEEDS) await saveContract(buildSeedRecord(seed, now));
}

export async function hasReference(): Promise<boolean> {
  return (await findBySha256(HALCYON_SHA)) !== null;
}
