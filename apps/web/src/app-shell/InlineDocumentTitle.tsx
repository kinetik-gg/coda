import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import appStyles from '../App.styles';
import styles from './ApplicationMasthead.module.css';

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'The document name could not be saved.';
}

/**
 * A stable, fixed-width document title. Editable titles are inputs in every visual state, so
 * entering edit mode never swaps elements or changes geometry. The transparent resting border
 * reserves the exact focus treatment in advance.
 */
export function InlineDocumentTitle({
  value,
  noun,
  canEdit,
  onCommit,
}: {
  value: string;
  noun: 'breakdown' | 'screenplay';
  canEdit: boolean;
  onCommit: (value: string) => Promise<void>;
}) {
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const committed = useRef(value);
  const committing = useRef(false);
  const skipBlurCommit = useRef(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (committing.current || document.activeElement === input.current) return;
    committed.current = value;
    setDraft(value);
  }, [value]);

  const commit = async () => {
    if (committing.current) return;
    const next = draft.trim();
    const previous = committed.current;
    if (next === previous) {
      setDraft(previous);
      return;
    }
    if (!next) {
      setDraft(previous);
      setError(`The ${noun} name cannot be empty.`);
      return;
    }
    committing.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onCommit(next);
      committed.current = next;
      setDraft(next);
    } catch (reason) {
      setDraft(previous);
      setError(failureMessage(reason));
    } finally {
      committing.current = false;
      setPending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      skipBlurCommit.current = true;
      setDraft(committed.current);
      setError(undefined);
      event.currentTarget.blur();
    }
  };

  return (
    <div className={styles.documentTitle}>
      <h1 className={appStyles.visuallyHidden}>{value}</h1>
      {canEdit ? (
        <input
          ref={input}
          className={styles.documentTitleInput}
          aria-label={`Rename ${noun}`}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? 'true' : undefined}
          data-pending={pending ? 'true' : undefined}
          disabled={pending}
          maxLength={160}
          value={draft}
          title={draft}
          onBlur={() => {
            if (skipBlurCommit.current) {
              skipBlurCommit.current = false;
              return;
            }
            void commit();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={onKeyDown}
        />
      ) : (
        <span className={styles.documentTitleText} aria-label={`${noun} name`} title={value}>
          {value}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.documentTitleError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
