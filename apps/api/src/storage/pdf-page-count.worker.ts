import { parentPort, workerData } from 'node:worker_threads';
import { PDFDocument } from 'pdf-lib';

async function inspectPdf(bytes: ArrayBuffer): Promise<void> {
  const document = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  const pageCount = document.getPageCount();
  if (pageCount < 1) throw new Error('PDF has no pages');
  parentPort?.postMessage({ pageCount });
}

void inspectPdf(workerData as ArrayBuffer).catch((error: unknown) => {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : 'Invalid PDF' });
});
