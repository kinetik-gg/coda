import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { ScreenplayShareDialog } from './management/ScreenplayShareDialog';
import { ScreenplayRenameDialog } from './ScreenplayRenameDialog';
import type { ScreenplayEditorChrome } from './useScreenplayEditorChrome';

/**
 * The editor's rename, move-to-trash, and share dialogs, extracted so the editor view stays within
 * the maintainability budget. Visibility and mutations are owned by the editor chrome hook. All
 * three present over the document: managing a screenplay never leaves the screenplay (#169).
 *
 * `ScreenplayEditorScreen` mounts this component behind an *outer* gate, so that gate has to name
 * every flag the inner ones read. It named only rename and trash, which made both of the editor's
 * Share affordances set a state nothing rendered — the control existed and did nothing, from #175
 * until #176. Any dialog added here needs its flag added to that gate too.
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
      {chrome.shareOpen && (
        <ScreenplayShareDialog screenplayId={chrome.screenplayId} onClose={chrome.closeShare} />
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
