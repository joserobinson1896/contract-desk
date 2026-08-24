/**
 * A very small PDF writer.
 *
 * Hand-rolled rather than a dependency, for the same reason the charts are: the
 * output is a fixed, known shape, and a PDF toolkit is a large amount of code and
 * bundle weight to render one page of text and rules.
 *
 * Scope is deliberately narrow — PDF 1.4, one or more pages, the two base-14
 * Helvetica faces, text and filled rectangles. No images, no embedded fonts, no
 * compression. Base-14 fonts need no embedding, which is what keeps this small
 * enough to be worth owning.
 *
 * Everything is latin1: one character is one byte, so string offsets are byte
 * offsets and the cross-reference table can be built by measuring the string as it
 * is assembled. Non-latin1 characters are transliterated rather than emitted raw,
 * because a base-14 font cannot encode them and a raw multi-byte character would
 * corrupt the offsets it appears before.
 */

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

/** Standard Helvetica advance widths, units per 1000, for ASCII 32-126. */
// prettier-ignore
const HELVETICA = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,
];

// prettier-ignore
const HELVETICA_BOLD = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,
];

export type Face = 'regular' | 'bold';

/** Advances for the WinAnsi characters above 0x7F that this writer emits. */
const HIGH_WIDTHS: Record<number, number> = {
  0x85: 1000, // ellipsis
  0x91: 222, 0x92: 222, // single quotes
  0x93: 333, 0x94: 333, // double quotes
  0x95: 350, // bullet
  0x96: 556, // en dash
  0x97: 1000, // em dash
  0x99: 1000, // trademark
  0xb7: 278, // periodcentered
};

/**
 * Characters outside latin1, mapped into the WinAnsi byte the font actually has.
 *
 * The fonts are declared `/WinAnsiEncoding`, which is latin1 plus a block of
 * typographic characters at 0x80-0x9F — real em dashes, curly quotes, bullets and
 * ellipses. Those live above U+00FF in JavaScript, so they have to be mapped to
 * their WinAnsi byte rather than emitted raw: raw, they would be multi-byte UTF-16
 * and would shift every cross-reference offset after them.
 *
 * Mapping them properly rather than degrading to ASCII is the difference between
 * "Month 1-3" and "Month 1–3" on a document a customer reads.
 */
const WIN = (byte: number) => String.fromCharCode(byte);

const TRANSLITERATE: Record<string, string> = {
  '—': WIN(0x97), // em dash
  '–': WIN(0x96), // en dash
  '‘': WIN(0x91),
  '’': WIN(0x92),
  '“': WIN(0x93),
  '”': WIN(0x94),
  '•': WIN(0x95),
  '…': WIN(0x85),
  '™': WIN(0x99),
  // No WinAnsi codepoint exists for these, so they degrade to ASCII.
  '→': '->', '←': '<-', '≥': '>=', '≤': '<=',
  '−': '-', '×': 'x',
};

export function toLatin1(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = TRANSLITERATE[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 63;
    out += code >= 32 && code <= 255 ? ch : '?';
  }
  return out;
}

/** Width of a string in points at a given size. */
export function textWidth(text: string, size: number, face: Face = 'regular'): number {
  const widths = face === 'bold' ? HELVETICA_BOLD : HELVETICA;
  let total = 0;
  for (const ch of toLatin1(text)) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) {
      total += widths[code - 32];
    } else {
      // WinAnsi typographic block. Approximated from the AFM metrics so that
      // right-aligned text still lands where it should.
      total += HIGH_WIDTHS[code] ?? 556;
    }
  }
  return (total / 1000) * size;
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

export type Rgb = [number, number, number];

/** A4 in points. Origin is bottom-left, which the helpers below hide. */
export const PAGE = { width: 595.28, height: 841.89 };

const esc = (s: string) => toLatin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** A PDF text string as UTF-16BE hex, which needs no character mapping at all. */
function utf16BeString(value: string): string {
  let hex = 'FEFF';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 63;
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0').toUpperCase();
      hex += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0').toUpperCase();
    } else {
      hex += code.toString(16).padStart(4, '0').toUpperCase();
    }
  }
  return `<${hex}>`;
}
const num = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * One page's content stream, built with a top-left origin.
 *
 * PDF measures y upward from the bottom of the page, which makes laying out a
 * document that flows downward an exercise in subtraction at every call site.
 * This class takes y from the top and does the flip once.
 */
export class Page {
  private ops: string[] = [];

  text(
    value: string,
    x: number,
    yFromTop: number,
    opts: { size?: number; face?: Face; color?: Rgb; align?: 'left' | 'right' } = {},
  ): this {
    const { size = 10, face = 'regular', color = [0, 0, 0], align = 'left' } = opts;
    const width = textWidth(value, size, face);
    const drawX = align === 'right' ? x - width : x;
    const font = face === 'bold' ? '/F2' : '/F1';

    this.ops.push(
      `BT ${font} ${num(size)} Tf ${num(color[0])} ${num(color[1])} ${num(color[2])} rg ` +
        `1 0 0 1 ${num(drawX)} ${num(PAGE.height - yFromTop - size)} Tm (${esc(value)}) Tj ET`,
    );
    return this;
  }

  rect(x: number, yFromTop: number, width: number, height: number, color: Rgb): this {
    this.ops.push(
      `${num(color[0])} ${num(color[1])} ${num(color[2])} rg ` +
        `${num(x)} ${num(PAGE.height - yFromTop - height)} ${num(width)} ${num(height)} re f`,
    );
    return this;
  }

  /** A hairline. Drawn as a filled rect so there is one code path for both. */
  line(x: number, yFromTop: number, width: number, color: Rgb, thickness = 0.75): this {
    return this.rect(x, yFromTop, width, thickness, color);
  }

  /**
   * Wraps `value` to `maxWidth` and returns the y after the last line, so callers
   * can flow content without measuring text themselves.
   */
  paragraph(
    value: string,
    x: number,
    yFromTop: number,
    maxWidth: number,
    opts: { size?: number; face?: Face; color?: Rgb; leading?: number } = {},
  ): number {
    const { size = 10, leading = size * 1.4 } = opts;
    const words = toLatin1(value).split(/\s+/).filter(Boolean);

    let line = '';
    let y = yFromTop;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, opts.face) > maxWidth && line) {
        this.text(line, x, y, opts);
        y += leading;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      this.text(line, x, y, opts);
      y += leading;
    }
    return y;
  }

  build(): string {
    return this.ops.join('\n');
  }
}

/* -------------------------------------------------------------------------- */
/* Document                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Assemble pages into a PDF.
 *
 * The cross-reference table needs the byte offset of every object, so objects are
 * appended to one string and each offset recorded as it goes. A reader that finds
 * a wrong offset here rejects the whole file, so this is measured rather than
 * estimated.
 */
export function buildPdf(pages: Page[], title: string): string {
  const contents = pages.map((p) => p.build());
  const pageCount = pages.length;

  // 1 catalog, 2 pages, then per page: a page object and a content stream,
  // then the two fonts, then the info dictionary.
  const firstPageObj = 3;
  const fontRegular = firstPageObj + pageCount * 2;
  const fontBold = fontRegular + 1;
  const infoObj = fontBold + 1;

  const objects: string[] = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);

  const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageObj + i * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);

  contents.forEach((stream, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE.width)} ${num(PAGE.height)}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> ` +
        `/Contents ${firstPageObj + i * 2 + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  // The Info dictionary is NOT WinAnsi — an unmarked string there is decoded as
  // PDFDocEncoding, where the em-dash byte reads as a different letter entirely
  // and the document title in the viewer's tab comes out misspelt. UTF-16BE with
  // a byte-order mark is the encoding PDF defines for text strings, and it takes
  // any character without a mapping table.
  objects.push(
    `<< /Title ${utf16BeString(title)} /Producer ${utf16BeString('Contract Desk')} ` +
      `/Creator ${utf16BeString('Contract Desk')} >>`,
  );

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  out +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return out;
}

/** The PDF as bytes. Latin1 in, one byte out per character. */
export function pdfBytes(pdf: string): Uint8Array {
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
