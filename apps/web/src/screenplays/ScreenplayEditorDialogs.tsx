import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { ScreenplayRenameDialog } from './ScreenplayRenameDialog';
import type { ScreenplayEditorChrome } from './useScreenplayEditorChrome';

/**
 * The editor's rename and move-to-trash dialogs, extracted so the editor view stays within the
 * maintainability budget. Visibility and mutations are owned by the editor chrome hook.
 */
export function ScreenplayEditorDialogs({
  title,
  chrome,
}: {
  title: string;
  chrome: ScreenplayEditorChrome;
}) {
  return (
    <>
      {chrome.renameOpen && (
        <ScreenplayRenameDialog
          currentTitle={title}
          busy={chrome.rename.isPending}
          error={chrome.rename.error?.message}
          onCancel={() => {
            chrome.rename.reset();
            chrome.closeRename();
          }}
          onSubmit={(next) => chrome.rename.mutate(next)}
        />
      )}
      {chrome.trashOpen && (
        <ConfirmationDialog
          title="Move screenplay to trash?"
          description={
            <p>
              <strong>{title}</strong> will remain recoverable from the trash for 30 days, then is
              permanently removed.
            </p>
          }
          confirmLabel="Move to trash"
          busyLabel="Moving…"
          busy={chrome.trash.isPending}
          error={chrome.trash.error?.message}
          onCancel={() => {
            chrome.trash.reset();
            chrome.closeTrash();
          }}
          onConfirm={() => chrome.trash.mutate()}
        />
      )}
    </>
  );
}
