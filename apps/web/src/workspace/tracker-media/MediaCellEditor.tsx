import { useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTrackerMediaUpload } from './use-tracker-media-upload';
import {
  mediaAcceptFor,
  mediaFieldValue,
  trackerMediaMeta,
  type MediaKind,
} from './tracker-media-model';
import { ImageThumbnail } from './TrackerMediaReadonly';
import type { ApiFieldValue } from '../panels/item-panel-utils';
import styles from './TrackerMedia.module.css';

/**
 * The media cell editor (#382): image fields edit through a thumbnail picker with upload,
 * replace, and remove; file and video fields through a meta chip carrying the same actions.
 * Picking a file runs the shared reserve → PUT → complete flow with live progress; the READY
 * object id commits as the field value through onSave (the grid's undo-aware setCell pipeline).
 * API rejections — size limits, kind mismatches — surface from the problem detail verbatim.
 */
export function MediaCellEditor({
  trackerId,
  kind,
  recordId,
  objectId,
  onSave,
  onCancel,
}: {
  trackerId: string;
  kind: MediaKind;
  recordId: string;
  /** The stored storage-object id, when the cell already carries a value. */
  objectId: string | null;
  onSave: (value: ApiFieldValue | null) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const upload = useTrackerMediaUpload({
    trackerId,
    kind,
    onReady: (objectId) => onSave(mediaFieldValue(kind, objectId)),
  });
  useEffect(() => inputRef.current?.focus(), []);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) upload.start(file);
  };
  const keyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <span
      className={styles.editorShell}
      data-editor-kind="media"
      data-media-kind={kind}
      onKeyDown={keyDown}
    >
      <input
        ref={inputRef}
        type="file"
        accept={mediaAcceptFor(kind)}
        hidden
        onChange={pick}
        aria-label={`Upload ${kind} for record ${recordId}`}
      />
      {upload.busy ? (
        <>
          <span
            className={styles.progressTrack}
            role="progressbar"
            aria-label={`Uploading for record ${recordId}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(upload.progress * 100)}
          >
            <span className={styles.progressFill} style={{ width: `${upload.progress * 100}%` }} />
          </span>
          <span className={styles.progressLabel}>{Math.round(upload.progress * 100)}%</span>
          <span className={styles.editorActions}>
            <button type="button" onClick={upload.cancel}>
              Cancel
            </button>
          </span>
        </>
      ) : (
        <>
          <MetaPreview objectId={objectId} kind={kind} trackerId={trackerId} recordId={recordId} />
          <span className={styles.editorActions}>
            <button type="button" onClick={() => inputRef.current?.click()}>
              {objectId ? 'Replace' : 'Upload'}
            </button>
            {objectId && (
              <button type="button" onClick={() => onSave(null)}>
                Remove
              </button>
            )}
          </span>
        </>
      )}
      {upload.error && (
        <small role="alert" className={styles.errorText}>
          {upload.error}
        </small>
      )}
    </span>
  );
}

function MetaPreview({
  objectId,
  kind,
  trackerId,
  recordId,
}: {
  objectId: string | null;
  kind: MediaKind;
  trackerId: string;
  recordId: string;
}) {
  if (!objectId) return null;
  if (kind === 'image')
    return (
      <ImageThumbnail
        trackerId={trackerId}
        objectId={objectId}
        alt={`${kind} for record ${recordId}`}
      />
    );
  return (
    <span className={styles.metaChip}>
      <span className={styles.metaName}>
        {trackerMediaMeta(objectId)?.filename ?? 'Attachment'}
      </span>
    </span>
  );
}
