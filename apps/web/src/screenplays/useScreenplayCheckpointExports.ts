import { useCallback, useMemo } from 'react';
import { downloadFountain } from './fountain-download';
import { downloadFinalDraft } from './screenplay-interchange-download';
import {
  ScreenplayExportCoordinator,
  type ScreenplayExportDocument,
  type ScreenplayExportSnapshot,
} from './screenplay-export-checkpoint';

interface ScreenplayCheckpointExportsOptions {
  screenplayId: string;
  persist: () => Promise<boolean>;
  getCurrentDocument: () => ScreenplayExportDocument;
  getCurrentVersion: () => number;
  reportError: (message: string) => void;
}

export function useScreenplayCheckpointExports({
  screenplayId,
  persist,
  getCurrentDocument,
  getCurrentVersion,
  reportError,
}: ScreenplayCheckpointExportsOptions) {
  const coordinator = useMemo(
    () =>
      new ScreenplayExportCoordinator({
        screenplayId,
        persist,
        getCurrentDocument,
        getCurrentVersion,
      }),
    [getCurrentDocument, getCurrentVersion, persist, screenplayId],
  );
  const run = useCallback(
    (
      kind: 'fountain' | 'pdf' | 'final-draft',
      exporter: (snapshot: ScreenplayExportSnapshot) => void | Promise<void>,
    ) => {
      void coordinator.run(kind, exporter).catch((error: unknown) => {
        reportError(error instanceof Error ? error.message : 'Coda could not create the export.');
      });
    },
    [coordinator, reportError],
  );
  const exportFountain = useCallback(
    () => run('fountain', ({ filename, sourceText }) => downloadFountain(filename, sourceText)),
    [run],
  );
  const exportFinalDraft = useCallback(
    () =>
      run('final-draft', ({ filename, sourceText }) => downloadFinalDraft(filename, sourceText)),
    [run],
  );
  const exportPdf = useCallback(
    () =>
      run('pdf', async ({ filename, paperSize, sourceText }) => {
        const { downloadScreenplayPdf } = await import('./screenplay-pdf-export');
        await downloadScreenplayPdf(filename, sourceText, paperSize);
      }),
    [run],
  );
  return { exportFountain, exportFinalDraft, exportPdf };
}
