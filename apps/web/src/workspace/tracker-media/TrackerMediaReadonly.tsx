import { useQuery } from '@tanstack/react-query';
import { FileIcon } from '@phosphor-icons/react/dist/csr/File';
import { ImageIcon } from '@phosphor-icons/react/dist/csr/Image';
import { VideoCameraIcon } from '@phosphor-icons/react/dist/csr/VideoCamera';
import { getTrackerStorageObjectContent } from '../../api';
import {
  formatBytes,
  formatDuration,
  trackerMediaMeta,
  type MediaKind,
} from './tracker-media-model';
import styles from './TrackerMedia.module.css';

/**
 * Read-only tracker media renders (#382): grid image thumbnails (lazy, cover-cropped, token
 * sized), file/video chips with icon + name plus size/duration when this client knows the object
 * metadata, and the board card's compact indicator. Objects uploaded by another session render
 * with generic labels — record values carry only the storage-object id.
 */

export function useTrackerStorageUrl(
  trackerId: string | undefined,
  objectId: string | null,
): { url?: string; isLoading: boolean } {
  const query = useQuery({
    queryKey: ['tracker-storage-content', trackerId, objectId],
    queryFn: ({ signal }) => getTrackerStorageObjectContent(trackerId!, objectId!, signal),
    enabled: Boolean(trackerId && objectId),
    staleTime: 45_000,
  });
  return { url: query.data?.url, isLoading: query.isLoading };
}

function KindIcon({ kind }: { kind: MediaKind }) {
  const size = 12;
  if (kind === 'image') return <ImageIcon size={size} weight="bold" aria-hidden="true" />;
  if (kind === 'video') return <VideoCameraIcon size={size} weight="bold" aria-hidden="true" />;
  return <FileIcon size={size} weight="bold" aria-hidden="true" />;
}

function metaLabel(objectId: string, kind: MediaKind): { name: string; detail: string } {
  const meta = trackerMediaMeta(objectId);
  const details = [formatBytes(meta?.sizeBytes), kind === 'video' ? formatDuration(meta?.durationMs) : '']
    .filter(Boolean)
    .join(' · ');
  return { name: meta?.filename ?? 'Attachment', detail: details };
}

/** The grid cell body of a media field with a stored value; empty cells fall back to `—`. */
export function TrackerMediaCell({
  trackerId,
  kind,
  objectId,
}: {
  trackerId: string;
  kind: MediaKind;
  objectId: string | null;
}) {
  if (!objectId) return <span title="">—</span>;
  const label = metaLabel(objectId, kind);
  return (
    <span className={styles.metaChip} data-media-kind={kind}>
      <KindIcon kind={kind} />
      {kind === 'image' ? (
        <ImageThumbnail trackerId={trackerId} objectId={objectId} alt={label.name} />
      ) : (
        <>
          <span className={styles.metaName}>{label.name}</span>
          {label.detail && <span className={styles.metaDetail}>{label.detail}</span>}
        </>
      )}
    </span>
  );
}

/** A lazy, cover-cropped thumbnail fetched through the tracker content endpoint. */
export function ImageThumbnail({
  trackerId,
  objectId,
  alt,
}: {
  trackerId: string;
  objectId: string;
  alt: string;
}) {
  const { url, isLoading } = useTrackerStorageUrl(trackerId, objectId);
  return (
    <span className={styles.thumbBox}>
      {url ? (
        <img className={styles.thumbImage} src={url} alt={alt} loading="lazy" />
      ) : (
        !isLoading && <ImageIcon size={12} weight="bold" aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * The compact board-card form: one icon and the object name, no chip chrome and no content fetch
 * — cards never load bytes, so no read URL is requested.
 */
export function TrackerMediaIndicator({
  kind,
  objectId,
}: {
  kind: MediaKind;
  objectId: string | null;
}) {
  if (!objectId) return <>—</>;
  const { name } = metaLabel(objectId, kind);
  return (
    <span className={styles.indicator} data-media-kind={kind}>
      <KindIcon kind={kind} />
      <span className={styles.indicatorName}>{name}</span>
    </span>
  );
}
