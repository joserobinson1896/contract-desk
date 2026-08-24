/**
 * Opening an invoice PDF.
 *
 * The document is built in memory and handed to the platform — nothing is written
 * to a server, and no network call is involved. On web that means an object URL
 * opened in a new tab, where the browser's own viewer renders it and offers save
 * and print. On native it is written to the app's cache directory and opened by
 * whatever handles PDFs there.
 *
 * The object URL is revoked on a timer rather than immediately: revoking before
 * the new tab has finished fetching leaves the viewer with a dead handle and a
 * blank page.
 */

import { Platform } from 'react-native';

import { getContract } from '@/data/repository';
import { invoicePdf, invoicePdfFilename, type InvoiceContext } from '@/domain/invoice-pdf';
import { pdfBytes } from '@/domain/pdf';
import type { Invoice } from '@/domain/invoice';

/**
 * Descriptive context only — Org ID, plan name, payment terms.
 *
 * Deliberately never an amount. The invoice's own figures are what was billed; a
 * number pulled from the current config could contradict them if the config has
 * been edited since, and the PDF would then disagree with itself.
 */
async function contextFor(invoice: Invoice): Promise<InvoiceContext | undefined> {
  try {
    const record = await getContract(invoice.contractId);
    if (!record) return undefined;
    return {
      orgIds: record.config.account.orgIds,
      ratePlan: record.config.ratePlan.name,
      paymentTerms: record.config.term.paymentTerms,
      startDate: record.config.term.startDate,
    };
  } catch {
    // The document is still correct without it.
    return undefined;
  }
}

export type OpenResult = { ok: true } | { ok: false; reason: string };

export async function openInvoicePdf(invoice: Invoice): Promise<OpenResult> {
  const pdf = invoicePdf(invoice, await contextFor(invoice));

  if (Platform.OS === 'web') {
    try {
      const blob = new Blob([pdfBytes(pdf) as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank');

      if (!opened) {
        // Popup blocked — fall back to a same-tab download so the click still
        // produces the document rather than silently doing nothing.
        const link = document.createElement('a');
        link.href = url;
        link.download = invoicePdfFilename(invoice);
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Could not open the PDF.' };
    }
  }

  try {
    const FileSystem = await import('expo-file-system');
    const Linking = await import('expo-linking');

    const dir = FileSystem.Paths.cache.uri;
    const uri = `${dir}${dir.endsWith('/') ? '' : '/'}${invoicePdfFilename(invoice)}`;
    const file = new FileSystem.File(uri);
    file.write(pdfBytes(pdf));

    await Linking.openURL(uri);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not open the PDF on this device.',
    };
  }
}
