export const MAX_PDF_SIZE = 250 * 1024 * 1024;

export function validateSourceFile(file: File): string | undefined {
  if (file.type !== 'application/pdf' && !file.name.toLocaleLowerCase().endsWith('.pdf')) {
    return 'Choose a PDF document.';
  }
  if (file.size > MAX_PDF_SIZE) return 'The PDF must be 250 MB or smaller.';
  return undefined;
}
