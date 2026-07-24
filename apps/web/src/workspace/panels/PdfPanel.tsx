import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, uploadFile } from '../../api';
import { useRegisterPanelActions } from '../shell/panel-actions';
import type { PanelContentProps } from './types';
import { bookmarkEvent, useEffectiveDarkView, type Pdf } from './PdfPanelHeaderControls';
import { PdfPanelView } from './PdfPanelView';

export { PdfPanelHeaderControls } from './PdfPanelHeaderControls';

function usePdfPanelActions({
  panel,
  clampedPage,
  darkView,
  hasDocument,
  uploadInputRef,
  onPanelChange,
  commitPage,
  attach,
  setRangeStart,
  setRangeEnd,
}: {
  panel: Pdf;
  clampedPage: number;
  darkView: boolean;
  hasDocument: boolean;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onPanelChange: (panel: Pdf) => void;
  commitPage: (page: number) => void;
  attach: () => Promise<void>;
  setRangeStart: (page: number) => void;
  setRangeEnd: (page: number) => void;
}) {
  useRegisterPanelActions(panel.id, (action) => {
    switch (action) {
      case 'previous-page':
        commitPage(clampedPage - 1);
        break;
      case 'next-page':
        commitPage(clampedPage + 1);
        break;
      case 'toggle-dark':
        onPanelChange({ ...panel, config: { ...panel.config, darkView: !darkView } });
        break;
      case 'use-current-page-range':
        setRangeStart(clampedPage);
        setRangeEnd(clampedPage);
        break;
      case 'upload-document':
        if (!hasDocument) uploadInputRef.current?.click();
        break;
      case 'link-range':
        void attach();
        break;
      default:
        break;
    }
  });
}

export function PdfPanel({
  project,
  projectId,
  panel,
  activeEntity,
  currentUserId,
  onPanelChange,
}: PanelContentProps & { panel: Pdf }) {
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const selectedReference = activeEntity?.item.sourceReferences[0];
  const referencedDocument = project.sourceDocuments.find(
    (entry) => entry.id === selectedReference?.sourceDocumentId,
  );
  const configuredDocument = project.sourceDocuments.find(
    (entry) => entry.id === panel.config.sourceDocumentId,
  );
  const document = referencedDocument ?? configuredDocument ?? project.sourceDocuments[0];
  const documentId = document?.id ?? null;
  const [pageCount, setPageCount] = useState(document?.pageCount ?? 1);
  const [rangeStart, setRangeStart] = useState(selectedReference?.startPage ?? panel.config.page);
  const [rangeEnd, setRangeEnd] = useState(selectedReference?.endPage ?? panel.config.page);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const appliedSelectionRef = useRef<string | undefined>(undefined);
  const darkView = useEffectiveDarkView(panel.config.darkView);
  const hasDocument = project.sourceDocuments.length > 0;
  const canDeleteDocument = project.ownerUserId === currentUserId;

  useEffect(() => {
    if (!selectedReference || !referencedDocument) return;
    const selectionKey = `${selectedReference.sourceDocumentId}:${selectedReference.startPage}:${selectedReference.endPage}`;
    if (appliedSelectionRef.current === selectionKey) return;
    appliedSelectionRef.current = selectionKey;
    setRangeStart(selectedReference.startPage);
    setRangeEnd(selectedReference.endPage);
    onPanelChange({
      ...panel,
      config: {
        ...panel.config,
        sourceDocumentId: selectedReference.sourceDocumentId,
        page: selectedReference.startPage,
      },
    });
  }, [onPanelChange, panel, referencedDocument, selectedReference]);

  useEffect(() => {
    const useCurrentPage = (event: Event) => {
      const detail = (event as CustomEvent<{ panelId: string; page: number }>).detail;
      if (detail.panelId !== panel.id) return;
      setRangeStart(detail.page);
      setRangeEnd(detail.page);
    };
    window.addEventListener(bookmarkEvent, useCurrentPage);
    return () => window.removeEventListener(bookmarkEvent, useCurrentPage);
  }, [panel.id]);

  const content = useQuery({
    queryKey: ['storage-content', projectId, document?.storageObject.id],
    queryFn: () =>
      api<{ url: string }>(
        `/api/v1/projects/${projectId}/storage-objects/${document!.storageObject.id}/content`,
      ),
    enabled: Boolean(document),
    staleTime: 45_000,
  });
  const clampedPage = Math.max(1, Math.min(panel.config.page, pageCount));
  const label = useMemo(() => document?.title ?? 'No source document', [document?.title]);
  const selectDocument = (nextId: string) => {
    onPanelChange({
      ...panel,
      config: { ...panel.config, sourceDocumentId: nextId || null, page: 1 },
    });
    setRangeStart(1);
    setRangeEnd(1);
  };
  const commitPage = useCallback(
    (next: number) => {
      const value = Math.max(1, Math.min(next, pageCount));
      if (value === panel.config.page && documentId === panel.config.sourceDocumentId) return;
      onPanelChange({
        ...panel,
        config: { ...panel.config, sourceDocumentId: documentId, page: value },
      });
    },
    [documentId, onPanelChange, pageCount, panel],
  );
  const attach = useCallback(async () => {
    if (!activeEntity || !documentId) return;
    await api(`/api/v1/projects/${projectId}/items/${activeEntity.item.id}/source-references`, {
      method: 'POST',
      body: JSON.stringify({
        sourceDocumentId: documentId,
        startPage: Math.min(rangeStart, rangeEnd),
        endPage: Math.max(rangeStart, rangeEnd),
      }),
    });
    await queryClient.invalidateQueries({
      queryKey: ['items', projectId, activeEntity.entityType.id],
    });
  }, [activeEntity, documentId, projectId, queryClient, rangeEnd, rangeStart]);
  const upload = async (file: File) => {
    if (hasDocument) return;
    const pending = await api<{
      id: string;
      version: number;
      uploadUrl: string;
      directUpload: boolean;
    }>('/api/v1/uploads', {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        kind: 'source_document',
        filename: file.name,
        mimeType: file.type || 'application/pdf',
        sizeBytes: file.size,
      }),
    });
    await uploadFile(pending, file);
    await api(`/api/v1/projects/${projectId}/uploads/${pending.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ version: pending.version }),
    });
    await api(`/api/v1/projects/${projectId}/source-documents`, {
      method: 'POST',
      body: JSON.stringify({
        storageObjectId: pending.id,
        title: file.name.replace(/\.pdf$/i, ''),
      }),
    });
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };
  const deleteSourceDocument = async () => {
    if (!document || !canDeleteDocument || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await api(`/api/v1/projects/${projectId}/source-documents/${document.id}/trash`, {
        method: 'DELETE',
      });
      onPanelChange({
        ...panel,
        config: { ...panel.config, sourceDocumentId: null, page: 1 },
      });
      queryClient.removeQueries({
        queryKey: ['storage-content', projectId, document.storageObject.id],
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['items', projectId] }),
      ]);
      setDeleteConfirmationOpen(false);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'The source PDF could not be deleted.',
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  usePdfPanelActions({
    panel,
    clampedPage,
    darkView,
    hasDocument,
    uploadInputRef,
    onPanelChange,
    commitPage,
    attach,
    setRangeStart,
    setRangeEnd,
  });

  return (
    <PdfPanelView
      project={project}
      document={document}
      documentId={documentId}
      contentUrl={content.data?.url}
      contentLoading={content.isLoading}
      contentError={Boolean(content.error)}
      onRetryContent={() => void content.refetch()}
      page={clampedPage}
      darkView={darkView}
      zoom={panel.config.zoom}
      onPageCount={setPageCount}
      onPageChange={commitPage}
      label={label}
      onSelectDocument={selectDocument}
      uploadInputRef={uploadInputRef}
      hasDocument={hasDocument}
      onUpload={(file) => void upload(file)}
      canDeleteDocument={canDeleteDocument}
      onRequestDelete={() => {
        setDeleteError(undefined);
        setDeleteConfirmationOpen(true);
      }}
      pageCount={pageCount}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
      onRangeStartChange={setRangeStart}
      onRangeEndChange={setRangeEnd}
      canAttach={Boolean(activeEntity && documentId)}
      onAttach={() => void attach()}
      deleteConfirmationOpen={deleteConfirmationOpen}
      deleteBusy={deleteBusy}
      deleteError={deleteError}
      onCancelDelete={() => {
        setDeleteConfirmationOpen(false);
        setDeleteError(undefined);
      }}
      onConfirmDelete={() => void deleteSourceDocument()}
    />
  );
}
