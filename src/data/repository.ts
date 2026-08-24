/**
 * Record storage.
 *
 * A single async interface over AsyncStorage (localStorage on web). Deliberately
 * narrow — every read and write in the app goes through these functions, so
 * swapping to SQLite or a real backend later means rewriting this file and nothing
 * else.
 *
 * Records are validated on the way out, not trusted. Storage survives app
 * upgrades, so a record written by an older schema will eventually show up here;
 * better to drop it loudly than to let a malformed config reach the billing
 * engine.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { ContractRecord, SCHEMA_VERSION } from '@/domain/record';
import {
  clearInvoices,
  deleteInvoicesForContract,
  listInvoices,
  mergeInvoices,
  replaceInvoices,
} from './invoices';

const KEY = 'hologram.contracts.v1';

type Envelope = {
  schemaVersion: number;
  records: unknown[];
  /** Absent in exports written before invoicing existed. */
  invoices?: unknown[];
};

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function readEnvelope(): Promise<Envelope> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { schemaVersion: SCHEMA_VERSION, records: [] };
    const parsed = JSON.parse(raw) as Envelope;
    if (!parsed || !Array.isArray(parsed.records)) {
      return { schemaVersion: SCHEMA_VERSION, records: [] };
    }
    return parsed;
  } catch {
    // Corrupt or unreadable storage should not brick the app — start clean and
    // let the user re-import rather than crashing on launch.
    return { schemaVersion: SCHEMA_VERSION, records: [] };
  }
}

async function writeEnvelope(records: ContractRecord[]): Promise<void> {
  const envelope: Envelope = { schemaVersion: SCHEMA_VERSION, records };
  await AsyncStorage.setItem(KEY, JSON.stringify(envelope));
}

/** Validate each record independently so one bad row doesn't lose the rest. */
function parseRecords(raw: unknown[]): { records: ContractRecord[]; dropped: number } {
  const records: ContractRecord[] = [];
  let dropped = 0;
  for (const item of raw) {
    const result = ContractRecord.safeParse(item);
    if (result.success) records.push(result.data);
    else dropped++;
  }
  return { records, dropped };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export async function listContracts(): Promise<ContractRecord[]> {
  const envelope = await readEnvelope();
  const { records } = parseRecords(envelope.records);
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getContract(id: string): Promise<ContractRecord | null> {
  const all = await listContracts();
  return all.find((r) => r.id === id) ?? null;
}

/** Insert or replace by id. */
export async function saveContract(record: ContractRecord): Promise<void> {
  const all = await listContracts();
  const next = all.filter((r) => r.id !== record.id);
  next.push({ ...record, updatedAt: new Date().toISOString() });
  await writeEnvelope(next);
}

export async function deleteContract(id: string): Promise<void> {
  const all = await listContracts();
  await writeEnvelope(all.filter((r) => r.id !== id));
  // Invoices belong to their contract. Leaving them behind means the list shows
  // rows that open nothing, and receivables keep counting a customer who is gone.
  await deleteInvoicesForContract(id);
}

/**
 * Read-modify-write under a single logical operation.
 *
 * Not a real transaction — AsyncStorage offers none — but it keeps every mutation
 * funnelled through one path, so there is exactly one place to add locking if
 * concurrent writes ever become possible.
 */
export async function updateContract(
  id: string,
  mutate: (record: ContractRecord) => ContractRecord,
): Promise<ContractRecord | null> {
  const existing = await getContract(id);
  if (!existing) return null;
  const updated = mutate(existing);
  await saveContract(updated);
  return updated;
}

/** Content-hash lookup, so re-importing the same PDF is caught before it costs a request. */
export async function findBySha256(sha256: string): Promise<ContractRecord | null> {
  const all = await listContracts();
  return all.find((r) => r.source.sha256 === sha256) ?? null;
}

export async function clearAll(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  await clearInvoices();
}

/* -------------------------------------------------------------------------- */
/* Portability                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Records live in one browser's storage, so export/import is the only way to move
 * a library between machines — or to commit a set of parsed contracts as fixtures.
 */
export async function exportLibrary(): Promise<string> {
  const [records, invoices] = await Promise.all([listContracts(), listInvoices()]);
  // Invoices travel with the contracts they belong to. Exporting records alone
  // moves a library that has silently lost its billing history.
  return JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), records, invoices },
    null,
    2,
  );
}

export async function importLibrary(
  json: string,
  mode: 'merge' | 'replace' = 'merge',
): Promise<{ imported: number; skipped: number }> {
  const parsed = JSON.parse(json) as Envelope;
  if (!parsed || !Array.isArray(parsed.records)) {
    throw new Error('Not a valid library export: expected a `records` array.');
  }

  const { records: incoming, dropped } = parseRecords(parsed.records);
  // Older exports predate invoices; an absent array is not an error.
  const incomingInvoices = Array.isArray(parsed.invoices) ? parsed.invoices : [];

  if (mode === 'replace') {
    await writeEnvelope(incoming);
    await replaceInvoices(incomingInvoices);
    return { imported: incoming.length, skipped: dropped };
  }

  await mergeInvoices(incomingInvoices);

  const existing = await listContracts();
  const byId = new Map(existing.map((r) => [r.id, r]));
  let imported = 0;
  for (const record of incoming) {
    if (byId.has(record.id)) continue;
    byId.set(record.id, record);
    imported++;
  }
  await writeEnvelope([...byId.values()]);
  return { imported, skipped: dropped + (incoming.length - imported) };
}
