export function canonicalFountainFilename(filename: string): string {
  const stem = filename.replace(/\.(?:fountain|spmd|txt)$/i, '').trim();
  return `${stem || 'screenplay'}.fountain`;
}

export function downloadFountain(filename: string, sourceText: string) {
  const url = URL.createObjectURL(new Blob([sourceText], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = canonicalFountainFilename(filename);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
