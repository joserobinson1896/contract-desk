/**
 * Invoice storage.
 *
 * Separate key from contracts, deliberately. An invoice outlives edits to the
 * contract it came from — it records what was billed, not what the config now
 * says — so nesting it inside the contract record would put issued history at the
 * mercy of every later config change.
 *
 * Same discipline as the contract repository: validated on the way out, one bad
 * row dropped rather than the whole list lost.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { Invoice } from '@/domain/invoice';

const KEY = 'hologram.invoices.v1';

async function readAll(): Promise<Invoice[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const invoices: Invoice[] = [];
    for (const item of parsed) {
      const result = Invoice.safeParse(item);
      if (result.success) invoices.push(result.data);
    }
    return invoices;
  } catch {
    return [];
  }
}

async function writeAll(invoices: Invoice[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(invoices));
}

/* -------------------------------------------------------------------------- */

/** Newest first — an invoice list is read from the top. */
export async function listInvoices(): Promise<Invoice[]> {
  const all = await readAll();
  return all.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function listInvoicesForContract(contractId: string): Promise<Invoice[]> {
  return (await listInvoices()).filter((i) => i.contractId === contractId);
}

export async function saveInvoice(invoice: Invoice): Promise<void> {
  const all = await readAll();
  const index = all.findIndex((i) => i.id === invoice.id);
  if (index >= 0) all[index] = invoice;
  else all.push(invoice);
  await writeAll(all);
}

export async function deleteInvoice(id: string): Promise<void> {
  await writeAll((await readAll()).filter((i) => i.id !== id));
}

export async function clearInvoices(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/**
 * Drop every invoice belonging to a contract.
 *
 * Called when the contract itself is deleted. Without it the invoice outlives its
 * subject and the list shows rows that open a contract which no longer exists —
 * and the receivables totals keep counting money against a customer that is gone.
 */
/** Merge imported invoices in, keyed by id so a re-import cannot duplicate them. */
export async function mergeInvoices(incoming: unknown[]): Promise<number> {
  const existing = await readAll();
  const byId = new Map(existing.map((i) => [i.id, i]));
  let added = 0;
  for (const item of incoming) {
    const parsed = Invoice.safeParse(item);
    if (!parsed.success || byId.has(parsed.data.id)) continue;
    byId.set(parsed.data.id, parsed.data);
    added++;
  }
  if (added > 0) await writeAll([...byId.values()]);
  return added;
}

/** Wholesale replace, for a `replace`-mode import. */
export async function replaceInvoices(incoming: unknown[]): Promise<number> {
  const invoices: Invoice[] = [];
  for (const item of incoming) {
    const parsed = Invoice.safeParse(item);
    if (parsed.success) invoices.push(parsed.data);
  }
  await writeAll(invoices);
  return invoices.length;
}

export async function deleteInvoicesForContract(contractId: string): Promise<void> {
  const all = await readAll();
  const remaining = all.filter((i) => i.contractId !== contractId);
  if (remaining.length !== all.length) await writeAll(remaining);
}
