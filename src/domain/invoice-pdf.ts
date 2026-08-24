/**
 * The invoice as a PDF.
 *
 * A document, not a screenshot of the app. It restates every number from the
 * stored invoice — never recomputed here — because an issued invoice is a record
 * of what was billed. Rebuilding the total at render time from a config that has
 * since been edited would produce a PDF that disagrees with the invoice it claims
 * to be.
 *
 * The minimum-spend test is shown explicitly rather than folded into a total.
 * "Greater of qualifying fees or the period minimum" is the one clause customers
 * query, and an invoice that shows only the winner cannot answer the question.
 */

import { Page, buildPdf, PAGE, type Rgb } from './pdf';
import type { Invoice } from './invoice';

const INK: Rgb = [0.06, 0.08, 0.14];
const MUTED: Rgb = [0.42, 0.45, 0.53];
const RULE: Rgb = [0.85, 0.87, 0.91];
const LIME: Rgb = [0.76, 0.96, 0.24];
const WHITE: Rgb = [1, 1, 1];

const M = 48;
const RIGHT = PAGE.width - M;

function money(n: number, currency: string): string {
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === 'USD' ? `$${formatted}` : `${formatted} ${currency}`;
}

/**
 * Optional context from the contract the invoice came from.
 *
 * Passed in rather than read here, because this module must not reach for the
 * live config: the invoice is a record of what was billed, and anything derived
 * from a config edited since would contradict the figures beside it. Everything
 * here is descriptive — Org ID, plan name, payment terms — never an amount.
 */
export type InvoiceContext = {
  orgIds?: string[];
  ratePlan?: string;
  paymentTerms?: string | null;
  startDate?: string | null;
};

/** Rates can be sub-cent (SMS at $0.04), so they carry more precision than totals. */
function rate(n: number, currency: string): string {
  const decimals = Math.abs(n) > 0 && Math.abs(n) < 0.1 ? 4 : 2;
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return currency === 'USD' ? `$${formatted}` : `${formatted} ${currency}`;
}

/**
 * The calendar month a term month maps to, when the start date is known.
 *
 * "Month 8 of term" alone makes the reader do date arithmetic to know what period
 * they are being billed for.
 */
function billingPeriod(invoice: Invoice, contract?: InvoiceContext): string {
  const label = `Month ${invoice.month} of term`;
  if (!contract?.startDate) return label;

  const start = new Date(`${contract.startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return label;

  const period = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + invoice.month - 1, 1),
  );
  const month = period.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${month} (month ${invoice.month})`;
}

/** A sentence explaining which side of the greater-of test won, and by how much. */
function derivation(invoice: Invoice): string {
  const fees = money(invoice.qualifyingFees, invoice.currency);

  if (invoice.applicableMinimum === null) {
    return `This contract carries no minimum spend, so the total is qualifying fees of ${fees}.`;
  }

  const minimum = money(invoice.applicableMinimum, invoice.currency);
  if (invoice.controlling === 'minimum') {
    const shortfall = money(invoice.applicableMinimum - invoice.qualifyingFees, invoice.currency);
    return (
      `Qualifying fees of ${fees} fell below the period minimum of ${minimum}, so the minimum ` +
      `controls. The customer is billed ${shortfall} above what usage alone would have cost.`
    );
  }

  const headroom = money(invoice.qualifyingFees - invoice.applicableMinimum, invoice.currency);
  return (
    `Qualifying fees of ${fees} exceed the period minimum of ${minimum} by ${headroom}, so ` +
    `actual fees control and the minimum does not apply.`
  );
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/* -------------------------------------------------------------------------- */

export function invoicePdf(invoice: Invoice, contract?: InvoiceContext): string {
  const page = new Page();

  /* ---- Masthead --------------------------------------------------------- */

  page.rect(0, 0, PAGE.width, 104, INK);
  page.rect(M, 36, 4, 24, LIME);
  page.text('Contract Desk', M + 14, 38, { size: 15, face: 'bold', color: WHITE });
  page.text('Reviewed billing configuration', M + 14, 58, { size: 8, color: [0.62, 0.65, 0.72] });

  page.text('INVOICE', RIGHT, 34, { size: 20, face: 'bold', color: LIME, align: 'right' });
  page.text(invoice.number, RIGHT, 60, { size: 10, color: [0.78, 0.8, 0.85], align: 'right' });
  page.text(date(invoice.generatedAt), RIGHT, 76, { size: 8.5, color: [0.62, 0.65, 0.72], align: 'right' });

  /* ---- Parties ---------------------------------------------------------- */

  let y = 140;
  page.text('BILL TO', M, y, { size: 7.5, face: 'bold', color: MUTED });
  page.text('INVOICE DETAILS', RIGHT - 210, y, { size: 7.5, face: 'bold', color: MUTED });

  y += 16;
  page.text(invoice.contractName, M, y, { size: 13, face: 'bold', color: INK });

  let ly = y + 17;
  if (contract?.orgIds?.length) {
    page.text(`Hologram Org ID ${contract.orgIds.join(', ')}`, M, ly, { size: 9, color: MUTED });
    ly += 13;
  }
  if (contract?.ratePlan) {
    page.text(contract.ratePlan, M, ly, { size: 9, color: MUTED });
    ly += 13;
  }
  page.text(
    `${invoice.activeSims.toLocaleString()} active SIMs · ${invoice.mbUsed.toLocaleString()} MB pooled`,
    M,
    ly,
    { size: 9, color: MUTED },
  );
  ly += 13;

  const details: [string, string][] = [
    ['Invoice number', invoice.number],
    ['Issue date', date(invoice.generatedAt)],
    ['Billing period', billingPeriod(invoice, contract)],
    ['Order form', invoice.orderFormNumber ?? 'Not stated'],
    ['Payment terms', contract?.paymentTerms ?? 'Per order form'],
    ['Prepared by', invoice.generatedBy],
  ];

  let dy = y;
  for (const [label, value] of details) {
    page.text(label, RIGHT - 210, dy, { size: 9, color: MUTED });
    page.text(value, RIGHT, dy, { size: 9, color: INK, align: 'right' });
    dy += 14;
  }

  /* ---- Lines ------------------------------------------------------------ */

  y = Math.max(dy, ly) + 26;

  page.rect(M, y - 6, RIGHT - M, 20, [0.96, 0.97, 0.99]);
  page.text('DESCRIPTION', M + 10, y, { size: 7.5, face: 'bold', color: MUTED });
  page.text('QTY', RIGHT - 190, y, { size: 7.5, face: 'bold', color: MUTED, align: 'right' });
  page.text('RATE', RIGHT - 100, y, { size: 7.5, face: 'bold', color: MUTED, align: 'right' });
  page.text('AMOUNT', RIGHT - 10, y, { size: 7.5, face: 'bold', color: MUTED, align: 'right' });
  y += 24;

  const qualifying = invoice.lines.filter((l) => l.countsTowardMinimum);
  const other = invoice.lines.filter((l) => !l.countsTowardMinimum);

  const drawLine = (line: (typeof invoice.lines)[number]) => {
    page.text(line.label, M + 10, y, { size: 9.5, color: INK });
    page.text(line.quantity.toLocaleString(), RIGHT - 190, y, { size: 9.5, color: INK, align: 'right' });
    page.text(rate(line.unitRate, invoice.currency), RIGHT - 100, y, { size: 9.5, color: INK, align: 'right' });
    page.text(money(line.amount, invoice.currency), RIGHT - 10, y, {
      size: 9.5, face: 'bold', color: INK, align: 'right',
    });
    y += 17;
    page.line(M + 10, y - 5, RIGHT - M - 20, [0.93, 0.94, 0.96], 0.5);
  };

  qualifying.forEach(drawLine);

  if (other.length > 0) {
    y += 8;
    page.text('NOT COUNTING TOWARD MINIMUM SPEND', M + 10, y, { size: 7, face: 'bold', color: MUTED });
    y += 14;
    other.forEach(drawLine);
  }

  /* ---- The greater-of test ---------------------------------------------- */

  y += 14;

  const rows: [string, string][] = [['Qualifying fees', money(invoice.qualifyingFees, invoice.currency)]];
  if (invoice.applicableMinimum !== null) {
    rows.push(['Period minimum', money(invoice.applicableMinimum, invoice.currency)]);
  }
  if (other.length > 0) {
    const otherTotal = other.reduce((sum, l) => sum + l.amount, 0);
    rows.push(['Other charges', money(otherTotal, invoice.currency)]);
  }

  for (const [label, value] of rows) {
    page.text(label, RIGHT - 170, y, { size: 9.5, color: MUTED });
    page.text(value, RIGHT - 10, y, { size: 9.5, color: INK, align: 'right' });
    y += 15;
  }

  y += 6;
  page.rect(RIGHT - 250, y - 6, 250, 36, INK);
  page.text('TOTAL DUE', RIGHT - 238, y + 6, { size: 9, face: 'bold', color: [0.72, 0.75, 0.82] });
  page.text(money(invoice.total, invoice.currency), RIGHT - 12, y + 2, {
    size: 16, face: 'bold', color: WHITE, align: 'right',
  });
  y += 48;

  /* ---- How the total was reached ---------------------------------------- */

  page.text('HOW THIS TOTAL WAS REACHED', M, y, { size: 7.5, face: 'bold', color: MUTED });
  y += 14;
  y = page.paragraph(derivation(invoice), M, y, RIGHT - M - 270, {
    size: 8.5, color: MUTED, leading: 12,
  });

  /* ---- Payment ---------------------------------------------------------- */

  y += 12;
  page.line(M, y, RIGHT - M, RULE);
  y += 16;

  const paid = invoice.paymentStatus === 'paid';
  page.rect(M, y - 4, paid ? 44 : 56, 16, paid ? LIME : [0.97, 0.94, 0.83]);
  page.text(paid ? 'PAID' : 'UNPAID', M + 9, y, {
    size: 8.5, face: 'bold', color: paid ? INK : [0.42, 0.32, 0.02],
  });
  page.text(
    paid && invoice.paidAt
      ? `Settled ${date(invoice.paidAt)}${invoice.paidBy ? ` · recorded by ${invoice.paidBy}` : ''}`
      : contract?.paymentTerms
        ? `Payment outstanding · ${contract.paymentTerms}`
        : 'Payment outstanding',
    M + (paid ? 56 : 68),
    y,
    { size: 9, color: MUTED },
  );

  /* ---- Foot ------------------------------------------------------------- */

  const footY = PAGE.height - 82;
  page.line(M, footY, RIGHT - M, RULE);
  page.paragraph(
    'Amounts are exclusive of tax. The customer pays the greater of qualifying fees or the ' +
      'applicable minimum spend for the period — never both. Charges listed as not counting ' +
      'toward minimum spend are billed but do not contribute to the contract commitment. ' +
      'Generated from the reviewed billing configuration for this order form; figures are as ' +
      'issued and are not restated if the configuration changes later.',
    M,
    footY + 12,
    RIGHT - M - 90,
    { size: 7.5, color: MUTED, leading: 10 },
  );
  page.text(invoice.number, RIGHT, footY + 12, { size: 7.5, face: 'bold', color: MUTED, align: 'right' });
  page.text('Page 1 of 1', RIGHT, footY + 24, { size: 7.5, color: MUTED, align: 'right' });

  return buildPdf([page], `${invoice.number} — ${invoice.contractName}`);
}

/** Filename for downloads. Safe on every filesystem the app can reach. */
export function invoicePdfFilename(invoice: Invoice): string {
  const slug = invoice.contractName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${invoice.number}-${slug}.pdf`;
}
