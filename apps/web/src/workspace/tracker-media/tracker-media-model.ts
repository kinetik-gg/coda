import type { TrackerField, TrackerRecord } from '../../trackers/types';

/**
 * Media field vocabulary shared by the grid cell editors, the read-only renders, and the upload
 * hook (#382). Field types `file`, `image`, and `video` store a single storage-object reference;
 * everything else about the object (name, size, duration) is remembered client-side at upload
 * time because record values carry only the id.
 */

export type MediaKind = 'file' | 'image' | 'video';

export function isMediaFieldType(type: string): boolean {
  return ['file', 'image', 'video'].includes(type.toLowerCase());
}

export function mediaKindOfField(field: Pick<TrackerField, 'type'>): MediaKind {
  return field.type.toLowerCase() as MediaKind;
}

/** The file-picker `accept` value for one media kind; plain files accept anything. */
export function mediaAcceptFor(kind: MediaKind): string | undefined {
  if (kind === 'image') return 'image/*';
  if (kind === 'video') return 'video/*';
  return undefined;
}

/** The storage-object reference of one record's media cell, when it has one. */
export function storageObjectIdOf(record: TrackerRecord, fieldId: string): string | null {
  return record.values.find((entry) => entry.fieldId === fieldId)?.storageObjectId ?? null;
}

/** What a media chip knows about one uploaded object beyond its id. */
export interface TrackerMediaMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
}

/**
 * Client-side metadata for uploaded objects, keyed by storage-object id. Populated the moment an
 * upload completes; read-only chips fall back to generic labels for objects this browser never
 * uploaded (another session or a reload).
 */
const mediaMetaById = new Map<string, TrackerMediaMeta>();

export function rememberTrackerMedia(objectId: string, meta: TrackerMediaMeta): void {
  mediaMetaById.set(objectId, meta);
}

export function trackerMediaMeta(objectId: string): TrackerMediaMeta | undefined {
  return mediaMetaById.get(objectId);
}

/** Compact byte label used by media chips (`1.2 MB` style); nullish sizes render nothing. */
export function formatBytes(sizeBytes: number | undefined | null): string {
  if (sizeBytes === null || sizeBytes === undefined || !Number.isFinite(sizeBytes)) return '';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = sizeBytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Minutes/seconds duration label for video chips; empty when the duration is unknown. */
export function formatDuration(durationMs: number | undefined | null): string {
  if (!durationMs || durationMs <= 0) return '';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The media value a completed upload commits through the setCell pipeline. */
export function mediaFieldValue(
  kind: MediaKind,
  objectId: string,
): { type: MediaKind; storageObjectId: string } {
  return { type: kind, storageObjectId: objectId };
}
