import { useCallback, useEffect, useRef, useState } from 'react';
import {
  completeTrackerUpload,
  createTrackerUpload,
  uploadFileWithProgress,
} from '../../api';
import { rememberTrackerMedia, type MediaKind } from './tracker-media-model';

/**
 * At most this many tracker uploads transfer at once; extra starts queue in pick order. Cells
 * edit one file each, so the cap only binds when several cells upload concurrently — the same
 * one-file-at-a-time feel as the project source-document flow, kept bounded for object stores.
 */
export const MAX_CONCURRENT_MEDIA_UPLOADS = 2;

let activeTransfers = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeTransfers < MAX_CONCURRENT_MEDIA_UPLOADS) {
    activeTransfers += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activeTransfers += 1;
}

function releaseSlot(): void {
  activeTransfers -= 1;
  waiters.shift()?.();
}

export type MediaUploadPhase = 'idle' | 'queued' | 'transferring' | 'finalizing';

/**
 * The shared tracker media upload flow (#382): reserve a tracker-owned upload, PUT the picked
 * bytes (XHR progress; presigned or app-proxied per driver capability), then complete to receive
 * the READY object id handed to `onReady` — which commits the field value through the grid's
 * undo-aware setCell pipeline. Cancels clean up without calling complete; errors surface the
 * API's problem-detail message (size/kind rejections included).
 */
export function useTrackerMediaUpload({
  trackerId,
  kind,
  onReady,
}: {
  trackerId: string;
  kind: MediaKind;
  onReady: (objectId: string) => void;
}): {
  start: (file: File) => void;
  cancel: () => void;
  busy: boolean;
  phase: MediaUploadPhase;
  /** 0..1 byte progress while transferring. */
  progress: number;
  error?: string;
} {
  const [phase, setPhase] = useState<MediaUploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const cancelledRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(
    () => () => {
      cancelledRef.current = true;
      controllerRef.current?.abort();
    },
    [],
  );

  const run = useCallback(
    async (file: File) => {
      cancelledRef.current = false;
      const controller = new AbortController();
      controllerRef.current = controller;
      setError(undefined);
      setProgress(0);
      try {
        setPhase('queued');
        await acquireSlot();
        if (cancelledRef.current) return;
        setPhase('transferring');
        const target = await createTrackerUpload({
          trackerId,
          kind,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });
        if (cancelledRef.current) return;
        await uploadFileWithProgress(target, file, {
          signal: controller.signal,
          onProgress: setProgress,
        });
        setPhase('finalizing');
        if (cancelledRef.current) return;
        const object = await completeTrackerUpload({
          trackerId,
          uploadId: target.id,
          version: target.version,
        });
        rememberTrackerMedia(object.id, {
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });
        onReadyRef.current(object.id);
      } catch (reason) {
        if (!cancelledRef.current)
          setError(reason instanceof Error ? reason.message : 'The upload failed.');
      } finally {
        releaseSlot();
        controllerRef.current = undefined;
        if (!cancelledRef.current) setPhase('idle');
      }
    },
    [kind, trackerId],
  );

  const start = useCallback(
    (file: File) => {
      if (!file) return;
      void run(file);
    },
    [run],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    setPhase('idle');
    setProgress(0);
    setError(undefined);
  }, []);

  return { start, cancel, busy: phase !== 'idle', phase, progress, error };
}
