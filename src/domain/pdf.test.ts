/**
 * PDF writer tests.
 *
 * A malformed cross-reference table produces a file that opens as a blank page or
 * an error rather than an obviously broken one, so the offsets are asserted
 * directly: every entry must point at the object it claims to.
 */

import { describe, expect, it } from 'vitest';

import { invoicePdf, invoicePdfFilename } from './invoice-pdf';
import { PAGE, Page, pdfBytes, textWidth, toLatin1 } from './pdf';
import type { Invoice } from './invoice';

const invoice: Invoice = {
  id: 'i1',
  number: 'INV-0042',
  contractId: 'c1',
  contractName: 'Meridian Freight Systems',
  orderFormNumber: '00004417',
  generatedAt: '2026-09-14T10:22:00.000Z',
  generatedBy: 'Jose Robinson',
  month: 8,
  activeSims: 200,
  mbUsed: 6000,
  lines: [
    { chargeId: 'mrc', label: 'Global Data Pool MRC', quantity: 200, unitRate: 3.15, amount: 630, countsTowardMinimum: true },
    { chargeId: 'hw', label: 'SIM hardware, G3-F', quantity: 20, unitRate: 3.9, amount: 78, countsTowardMinimum: false },
  ],
  qualifyingFees: 1380,
  applicableMinimum: 900,
  controlling: 'actual',
  total: 1458,
  currency: 'USD',
  paymentStatus: 'unpaid',
  paidAt: null,
  paidBy: null,
};

const pdf = invoicePdf(invoice);

/* -------------------------------------------------------------------------- */

describe('file structure', () => {
  it('declares a PDF header and terminates properly', () => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('points every xref entry at the object it claims', () => {
    const startxref = Number(pdf.slice(pdf.lastIndexOf('startxref')).match(/startxref\s+(\d+)/)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    const table = pdf.slice(startxref);
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(0);

    offsets.forEach((offset, i) => {
      // Entry i is object i+1, and the body at that byte offset must say so.
      expect(pdf.slice(offset, offset + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });

  it('declares a stream length matching the bytes actually written', () => {
    const match = pdf.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/)!;
    expect(match[2].length).toBe(Number(match[1]));
  });

  it('encodes the document title as UTF-16BE so the viewer tab reads correctly', () => {
    // An unmarked string in the Info dictionary is decoded as PDFDocEncoding,
    // where the em-dash byte is a different letter and the title comes out wrong.
    const title = pdf.match(/\/Title <([0-9A-F]+)>/)![1];
    expect(title.startsWith('FEFF')).toBe(true);
    const decoded = title
      .slice(4)
      .match(/.{4}/g)!
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join('');
    expect(decoded).toBe('INV-0042 — Meridian Freight Systems');
  });

  it('converts to one byte per character', () => {
    const bytes = pdfBytes(pdf);
    expect(bytes.length).toBe(pdf.length);
    expect(bytes.every((b) => b <= 0xff)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('encoding', () => {
  it('maps typographic characters to their WinAnsi byte, not to ASCII', () => {
    // Left raw these are multi-byte and corrupt every offset after them; degraded
    // to ASCII they make a customer-facing document look cheap.
    const out = toLatin1('Month 1—3 · “quoted” … end');
    expect(out.charCodeAt(7)).toBe(0x97); // em dash, not '-'
    expect(out).toContain(String.fromCharCode(0x93)); // opening curly quote
    expect(out).toContain(String.fromCharCode(0x85)); // ellipsis
    expect(out).toContain('·'); // already latin1, passes through
    // Characters WinAnsi genuinely lacks still degrade rather than corrupt.
    expect(toLatin1('a → b')).toBe('a -> b');
  });

  it('escapes the delimiters that would otherwise end a string object', () => {
    const page = new Page().text('a (b) \\ c', 10, 10);
    expect(page.build()).toContain('(a \\(b\\) \\\\ c)');
  });

  it('measures bold wider than regular for the same text', () => {
    expect(textWidth('Meridian', 10, 'bold')).toBeGreaterThan(textWidth('Meridian', 10));
  });
});

/* -------------------------------------------------------------------------- */

describe('the invoice document', () => {
  it('restates the stored figures rather than recomputing them', () => {
    expect(pdf).toContain('INV-0042');
    expect(pdf).toContain('Meridian Freight Systems');
    expect(pdf).toContain('$1,458.00');
    expect(pdf).toContain('$1,380.00');
    expect(pdf).toContain('$900.00');
  });

  it('explains which side of the greater-of test won, and by how much', () => {
    // Actual fees ($1,380) beat the minimum ($900) by $480.
    expect(pdf).toContain('actual fees control');
    expect(pdf).toContain('$480.00');

    // The other branch names the shortfall the customer pays over usage.
    const floored = invoicePdf({ ...invoice, controlling: 'minimum', qualifyingFees: 400, total: 900 });
    expect(floored).toContain('the minimum controls');
    expect(floored).toContain('$500.00');
  });

  it('groups charges that do not count toward minimum spend under their own heading', () => {
    expect(pdf).toContain('NOT COUNTING TOWARD MINIMUM SPEND');
  });

  it('names the calendar month when the contract start date is known', () => {
    const withStart = invoicePdf(invoice, { startDate: '2026-09-01' });
    // Month 8 of a term starting September 2026 is April 2027.
    expect(withStart).toContain('April 2027');
  });

  it('shows sub-cent rates at more precision than totals', () => {
    const sms = invoicePdf({
      ...invoice,
      lines: [{ chargeId: 's', label: 'Outbound SMS', quantity: 500, unitRate: 0.04, amount: 20, countsTowardMinimum: true }],
    });
    expect(sms).toContain('$0.0400');
  });

  it('carries descriptive context without letting it restate any amount', () => {
    const ctx = invoicePdf(invoice, {
      orgIds: ['74188'],
      ratePlan: 'G3 25MB Global Data Pool',
      paymentTerms: 'Net 30',
    });
    expect(ctx).toContain('Hologram Org ID 74188');
    expect(ctx).toContain('G3 25MB Global Data Pool');
    expect(ctx).toContain('Net 30');
    // The total is still the stored one, untouched by context.
    expect(ctx).toContain('$1,458.00');
  });

  it('shows payment state, and who recorded it', () => {
    expect(pdf).toContain('UNPAID');
    const settled = invoicePdf({
      ...invoice,
      paymentStatus: 'paid',
      paidAt: '2026-10-01T00:00:00.000Z',
      paidBy: 'Jose Robinson',
    });
    expect(settled).toContain('PAID');
    expect(settled).toContain('recorded by Jose Robinson');
  });

  it('names the file safely for any filesystem', () => {
    expect(invoicePdfFilename(invoice)).toBe('INV-0042-Meridian-Freight-Systems.pdf');
  });
});

/* -------------------------------------------------------------------------- */

describe('layout primitives', () => {
  it('takes y from the top and flips it into PDF space', () => {
    const page = new Page().text('x', 0, 0, { size: 10 });
    // y=0 from the top means a baseline one font-size below the page top.
    expect(page.build()).toContain(`1 0 0 1 0 ${(PAGE.height - 10).toFixed(2)} Tm`);
  });

  it('wraps a paragraph and reports where it ended', () => {
    const page = new Page();
    const end = page.paragraph('one two three four five six seven eight', 0, 0, 40, { size: 10 });
    expect(end).toBeGreaterThan(14);
    expect(page.build().match(/BT/g)!.length).toBeGreaterThan(1);
  });
});
