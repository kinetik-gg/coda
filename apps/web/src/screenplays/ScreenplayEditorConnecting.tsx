import type { SaveState } from '../workspace/shell';
import styles from './ScreenplayEditorScreen.module.css';

/**
 * What the editor panel shows while the collaborative document has not resolved yet. The editing
 * surface is bound to the CRDT, so it is empty until the session syncs — and an empty editor over a
 * loaded screenplay reads as data loss (#336). The REST payload is already in hand, so show that
 * text, read-only, and say plainly why it cannot be edited yet.
 */
export function ScreenplayEditorConnecting({
  sourceText,
  state,
}: {
  sourceText: string;
  state: SaveState;
}) {
  const failed = state === 'failed';
  return (
    <div className={styles.connecting} data-testid="screenplay-editor-connecting">
      <p className={styles.connectingNotice} role="status" aria-busy={!failed}>
        {failed
          ? 'Coda could not open the collaboration session. This is the last saved text; editing resumes when the connection recovers.'
          : 'Connecting to the collaboration session. This is the last saved text; editing starts as soon as it syncs.'}
      </p>
      <pre className={styles.connectingSource}>{sourceText}</pre>
    </div>
  );
}
