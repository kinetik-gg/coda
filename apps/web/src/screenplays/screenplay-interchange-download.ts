import { exportFinalDraft } from '@coda/fountain';

export function canonicalFinalDraftFilename(filename: string): string {
  const stem = filename.replace(/\.(?:fountain|spmd|txt|fdx)$/iu, '').trim();
  return `${stem || 'screenplay'}.fdx`;
}

export function downloadFinalDraft(filename: string, fountain: string): void {
  const result = exportFinalDraft(fountain);
  const url = URL.createObjectURL(new Blob([result.content], { type: result.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = canonicalFinalDraftFilename(filename);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
