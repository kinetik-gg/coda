// @vitest-environment jsdom

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from './types';
import { PdfPanelView } from './PdfPanelView';

vi.mock('../../PdfViewer', () => ({
  PdfViewer: () => <div>Rendered PDF page</div>,
}));

afterEach(cleanup);

const sourceDocument: Project['sourceDocuments'][number] = {
  id: crypto.randomUUID(),
  title: 'Reference',
  pageCount: 12,
  storageObject: { id: crypto.randomUUID(), originalFilename: 'reference.pdf' },
};

const project: Project = {
  id: crypto.randomUUID(),
  name: 'Example',
  description: null,
  ownerUserId: crypto.randomUUID(),
  version: 1,
  revision: 1,
  entityTypes: [],
  roles: [],
  sourceDocuments: [sourceDocument],
  memberships: [],
};

function viewProps(overrides: Partial<Parameters<typeof PdfPanelView>[0]> = {}) {
  return {
    project,
    document: sourceDocument,
    documentId: sourceDocument.id,
    contentUrl: undefined,
    contentLoading: false,
    contentError: false,
    onRetryContent: vi.fn(),
    page: 1,
    darkView: true,
    zoom: 1,
    onPageCount: vi.fn(),
    onPageChange: vi.fn(),
    label: sourceDocument.title,
    onSelectDocument: vi.fn(),
    uploadInputRef: createRef<HTMLInputElement>(),
    hasDocument: true,
    onUpload: vi.fn(),
    canDeleteDocument: true,
    onRequestDelete: vi.fn(),
    pageCount: 12,
    rangeStart: 1,
    rangeEnd: 2,
    onRangeStartChange: vi.fn(),
    onRangeEndChange: vi.fn(),
    canAttach: true,
    onAttach: vi.fn(),
    deleteConfirmationOpen: false,
    deleteBusy: false,
    deleteError: undefined,
    onCancelDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    ...overrides,
  };
}

describe('PdfPanelView', () => {
  it('renders the PDF canvas and dispatches source actions', () => {
    const props = viewProps({ contentUrl: '/source.pdf' });
    render(<PdfPanelView {...props} />);

    expect(screen.getByText('Rendered PDF page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete source PDF' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(props.onRequestDelete).toHaveBeenCalledOnce();
    expect(props.onAttach).toHaveBeenCalledOnce();
  });

  it('shows recoverable loading, error, and empty states', () => {
    const { rerender } = render(<PdfPanelView {...viewProps({ contentLoading: true })} />);
    expect(screen.getByRole('status').textContent).toContain('Opening PDF');

    const onRetryContent = vi.fn();
    rerender(
      <PdfPanelView
        {...viewProps({ contentError: true, onRetryContent, contentLoading: false })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryContent).toHaveBeenCalledOnce();

    rerender(
      <PdfPanelView
        {...viewProps({
          document: undefined,
          documentId: null,
          hasDocument: false,
          canDeleteDocument: false,
        })}
      />,
    );
    expect(screen.getByText('UPLOAD OR SELECT A PDF SOURCE DOCUMENT')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload source PDF' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('confirms source deletion without hiding server errors', () => {
    const onCancelDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    render(
      <PdfPanelView
        {...viewProps({
          deleteConfirmationOpen: true,
          deleteError: 'Deletion was rejected.',
          onCancelDelete,
          onConfirmDelete,
        })}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Deletion was rejected.');
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(onConfirmDelete).toHaveBeenCalledOnce();
  });
});
