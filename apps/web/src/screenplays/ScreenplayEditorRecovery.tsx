import { lazy, Suspense } from 'react';
import { downloadFountain } from './fountain-download';
import type { useScreenplayAutosave } from './useScreenplayAutosave';

const ScreenplayRecoveryNotice = lazy(() =>
  import('./ScreenplayRecoveryNotice').then((module) => ({
    default: module.ScreenplayRecoveryNotice,
  })),
);

/**
 * Loads recovery chrome only when the editor has a recoverable snapshot or a
 * storage error. Keeping this boundary outside the main editor module also
 * keeps its eager command-and-layout orchestration within the module budget.
 */
export function ScreenplayEditorRecovery({
  autosave,
  filename,
}: {
  autosave: ReturnType<typeof useScreenplayAutosave>;
  filename: string;
}) {
  if (!autosave.recovery && !autosave.recoveryError) return null;
  return (
    <Suspense fallback={null}>
      <ScreenplayRecoveryNotice
        recovery={autosave.recovery}
        storageError={autosave.recoveryError}
        serverVersion={autosave.recoveryServerVersion}
        onRecover={autosave.recoverDraft}
        onDownload={() =>
          downloadFountain(filename, autosave.recovery?.sourceText ?? autosave.draft)
        }
        onDiscard={() => void autosave.discardRecovery()}
        onDismissError={autosave.dismissRecoveryError}
      />
    </Suspense>
  );
}
