/**
 * File validation — the client half of the upload safety checks.
 *
 * Everything here is enforced again on the server. Client-side validation exists
 * to give fast feedback and to avoid spending a request on a file that will be
 * rejected; it is not the security boundary, because anything running in a browser
 * can be bypassed.
 *
 * The rules, and why each one is here:
 *
 *   Magic bytes — a file's extension and reported MIME type are both attacker-
 *   controlled. `%PDF-` in the first five bytes is the only claim worth believing.
 *
 *   Size — the upstream API caps a request at 32 MB, and base64 inflates payloads
 *   by roughly a third. A 20 MB ceiling keeps the encoded request comfortably under
 *   that while staying far above any real contract.
 */

import * as Crypto from 'expo-crypto';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_BATCH_FILES = 20;
export const MAX_PAGES = 600;

/** `%PDF-` — the only reliable signal that a file is what it claims to be. */
const PDF_MAGIC = '%PDF-';

export type ValidationError =
  | { code: 'too_large'; message: string }
  | { code: 'not_a_pdf'; message: string }
  | { code: 'empty'; message: string };

export type ValidatedFile = {
  fileName: string;
  mimeType: string;
  byteSize: number;
  base64: string;
  sha256: string;
};

/* -------------------------------------------------------------------------- */

function base64ToLeadingAscii(base64: string, byteCount: number): string {
  // Each 4 base64 chars encode 3 bytes, so this is enough to cover the header.
  const chunk = base64.slice(0, Math.ceil(byteCount / 3) * 4);
  try {
    const binary = globalThis.atob ? globalThis.atob(chunk) : '';
    return binary.slice(0, byteCount);
  } catch {
    return '';
  }
}

/**
 * Best-effort page count from the raw PDF. Used only to reject documents over the
 * API's limit before spending a request — a wrong count here is not load-bearing,
 * so a failure to determine one is treated as "unknown" rather than an error.
 */
export function estimatePageCount(base64: string): number | null {
  try {
    const binary = globalThis.atob ? globalThis.atob(base64) : '';
    if (!binary) return null;
    const matches = binary.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

export async function hashContent(base64: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
}

/* -------------------------------------------------------------------------- */

export async function validateFile(input: {
  fileName: string;
  mimeType: string;
  byteSize: number;
  base64: string;
}): Promise<{ ok: true; file: ValidatedFile } | { ok: false; error: ValidationError }> {
  const { fileName, mimeType, byteSize, base64 } = input;

  if (byteSize <= 0 || base64.length === 0) {
    return { ok: false, error: { code: 'empty', message: `${fileName} is empty.` } };
  }

  if (byteSize > MAX_FILE_BYTES) {
    const mb = (byteSize / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      error: {
        code: 'too_large',
        message: `${fileName} is ${mb} MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      },
    };
  }

  const header = base64ToLeadingAscii(base64, PDF_MAGIC.length);
  if (!header.startsWith(PDF_MAGIC)) {
    return {
      ok: false,
      error: {
        code: 'not_a_pdf',
        message: `${fileName} is not a PDF. Its contents do not start with "${PDF_MAGIC}", whatever the file extension says.`,
      },
    };
  }

  const pages = estimatePageCount(base64);
  if (pages !== null && pages > MAX_PAGES) {
    return {
      ok: false,
      error: {
        code: 'too_large',
        message: `${fileName} has roughly ${pages} pages. The limit is ${MAX_PAGES}.`,
      },
    };
  }

  return {
    ok: true,
    file: {
      fileName,
      mimeType: mimeType || 'application/pdf',
      byteSize,
      base64,
      sha256: await hashContent(base64),
    },
  };
}
