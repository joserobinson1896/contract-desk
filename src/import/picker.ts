/**
 * File selection.
 *
 * Normalises what the document picker hands back — a `File` on web, a URI on
 * native — into one base64 shape the queue can consume.
 *
 * Reading goes through `fetch` + `FileReader` rather than the platform filesystem
 * API. Both work, but this path is identical on web and native, which keeps one
 * code path instead of two that can drift.
 */

import * as DocumentPicker from 'expo-document-picker';

import type { PickedFile } from './queue';

/* -------------------------------------------------------------------------- */

/** Strips the `data:...;base64,` prefix a FileReader result carries. */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result ?? '')));
    reader.readAsDataURL(blob);
  });
}

/* -------------------------------------------------------------------------- */

/** Convert a web `File` (from the picker or a drop event) into a PickedFile. */
export async function fromWebFile(file: File): Promise<PickedFile> {
  return {
    fileName: file.name,
    mimeType: file.type || 'application/pdf',
    byteSize: file.size,
    base64: await readAsBase64(file),
  };
}

/* -------------------------------------------------------------------------- */

export type PickResult = {
  files: PickedFile[];
  /** Files the picker returned but that could not be read. */
  unreadable: { fileName: string; reason: string }[];
  canceled: boolean;
};

export async function pickContracts(): Promise<PickResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    multiple: true,
    copyToCacheDirectory: true,
  });

  if (result.canceled) return { files: [], unreadable: [], canceled: true };

  const files: PickedFile[] = [];
  const unreadable: { fileName: string; reason: string }[] = [];

  for (const asset of result.assets ?? []) {
    const fileName = asset.name || 'contract.pdf';
    try {
      // Web hands back a real File; native gives a URI we fetch from the cache.
      const blob =
        asset.file instanceof Blob ? asset.file : await (await fetch(asset.uri)).blob();

      files.push({
        fileName,
        mimeType: asset.mimeType || 'application/pdf',
        byteSize: asset.size ?? blob.size,
        base64: await readAsBase64(blob),
      });
    } catch (error) {
      unreadable.push({
        fileName,
        reason: error instanceof Error ? error.message : 'Could not read the file.',
      });
    }
  }

  return { files, unreadable, canceled: false };
}
