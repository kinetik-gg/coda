export const MAX_PROJECT_IMPORT_BYTES = 25 * 1024 * 1024;

export function readImportFile(
  file: File,
  onProgress: (percentage: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    reader.onerror = () => reject(new Error('The selected import file could not be read.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The selected import file is not text.'));
        return;
      }
      onProgress(100);
      resolve(reader.result);
    };
    reader.readAsText(file);
  });
}
