import type { RefObject } from 'react';
import { LinkSimpleIcon } from '@phosphor-icons/react/dist/csr/LinkSimple';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import { CustomSelect } from '../../components/CustomSelect';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import { Tooltip } from '../../components/Tooltip';
import { PdfViewer } from '../../PdfViewer';
import type { Project } from './types';
import styles from './PdfPanel.module.css';

type SourceDocument = Project['sourceDocuments'][number];

interface PdfPanelViewProps {
  project: Project;
  document: SourceDocument | undefined;
  documentId: string | null;
  contentUrl: string | undefined;
  contentLoading: boolean;
  contentError: boolean;
  onRetryContent: () => void;
  page: number;
  darkView: boolean;
  zoom: number;
  onPageCount: (count: number) => void;
  onPageChange: (page: number) => void;
  label: string;
  onSelectDocument: (documentId: string) => void;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  hasDocument: boolean;
  onUpload: (file: File) => void;
  canDeleteDocument: boolean;
  onRequestDelete: () => void;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  onRangeStartChange: (page: number) => void;
  onRangeEndChange: (page: number) => void;
  canAttach: boolean;
  onAttach: () => void;
  deleteConfirmationOpen: boolean;
  deleteBusy: boolean;
  deleteError: string | undefined;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function PdfCanvas({
  contentUrl,
  contentLoading,
  contentError,
  hasSelectedDocument,
  onRetryContent,
  page,
  darkView,
  zoom,
  onPageCount,
  onPageChange,
}: Pick<
  PdfPanelViewProps,
  | 'contentUrl'
  | 'contentLoading'
  | 'contentError'
  | 'onRetryContent'
  | 'page'
  | 'darkView'
  | 'zoom'
  | 'onPageCount'
  | 'onPageChange'
> & { hasSelectedDocument: boolean }) {
  if (contentUrl) {
    return (
      <PdfViewer
        url={contentUrl}
        page={page}
        darkView={darkView}
        zoom={zoom}
        onPageCount={onPageCount}
        onPageChange={onPageChange}
      />
    );
  }
  if (hasSelectedDocument && contentLoading) {
    return (
      <SkeletonGroup label="Opening PDF" className={styles.pdfOpening}>
        <Skeleton width="min(76%, 680px)" height="86%" radius={1} />
      </SkeletonGroup>
    );
  }
  if (hasSelectedDocument && contentError) {
    return (
      <div className={styles.pdfError} role="alert">
        <p>PDF access could not be prepared.</p>
        <button type="button" onClick={onRetryContent}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className={styles.empty}>
      <p>UPLOAD OR SELECT A PDF SOURCE DOCUMENT</p>
    </div>
  );
}

function SourceTools(props: PdfPanelViewProps) {
  return (
    <div className={styles.sourceTools}>
      <Tooltip content={`Currently displayed project source PDF: ${props.label}`}>
        <CustomSelect
          className={styles.sourceSelect}
          triggerClassName={styles.sourceSelectTrigger}
          ariaLabel="Source document"
          value={props.documentId ?? ''}
          onChange={props.onSelectDocument}
          placeholder="No source"
          options={props.project.sourceDocuments.map((entry) => ({
            value: entry.id,
            label: entry.title,
          }))}
        />
      </Tooltip>
      <Tooltip
        content={
          props.hasDocument
            ? 'Delete the current source PDF before uploading another'
            : 'Upload one source PDF for this project'
        }
      >
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Upload source PDF"
          disabled={props.hasDocument}
          onClick={() => props.uploadInputRef.current?.click()}
        >
          <UploadSimpleIcon size={12} aria-hidden="true" />
        </button>
      </Tooltip>
      <input
        ref={props.uploadInputRef}
        type="file"
        accept="application/pdf"
        disabled={props.hasDocument}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) props.onUpload(file);
        }}
      />
      {props.canDeleteDocument && props.document ? (
        <Tooltip content="Move this project source PDF into recoverable trash">
          <button type="button" aria-label="Delete source PDF" onClick={props.onRequestDelete}>
            <TrashIcon size={12} aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
      <span className={styles.rangeLabel}>SOURCE</span>
      <input
        aria-label="Source range start"
        type="number"
        min={1}
        max={props.pageCount}
        value={props.rangeStart}
        onChange={(event) => props.onRangeStartChange(Number(event.target.value))}
      />
      <span>—</span>
      <input
        aria-label="Source range end"
        type="number"
        min={1}
        max={props.pageCount}
        value={props.rangeEnd}
        onChange={(event) => props.onRangeEndChange(Number(event.target.value))}
      />
      <button
        type="button"
        className={styles.linkButton}
        disabled={!props.canAttach}
        onClick={props.onAttach}
      >
        <LinkSimpleIcon size={12} />
        <span>Link</span>
      </button>
    </div>
  );
}

export function PdfPanelView(props: PdfPanelViewProps) {
  return (
    <div className={styles.pdfPanel}>
      <div className={styles.pdfCanvas}>
        <PdfCanvas
          contentUrl={props.contentUrl}
          contentLoading={props.contentLoading}
          contentError={props.contentError}
          hasSelectedDocument={Boolean(props.document)}
          onRetryContent={props.onRetryContent}
          page={props.page}
          darkView={props.darkView}
          zoom={props.zoom}
          onPageCount={props.onPageCount}
          onPageChange={props.onPageChange}
        />
      </div>
      <SourceTools {...props} />
      {props.deleteConfirmationOpen && props.document ? (
        <ConfirmationDialog
          title="Delete source PDF?"
          description={
            <p>
              “{props.document.title}” will move to project trash. Uploading another source PDF
              becomes available after deletion.
            </p>
          }
          confirmLabel="Move to trash"
          busyLabel="Deleting…"
          busy={props.deleteBusy}
          error={props.deleteError}
          onCancel={props.onCancelDelete}
          onConfirm={props.onConfirmDelete}
        />
      ) : null}
    </div>
  );
}
