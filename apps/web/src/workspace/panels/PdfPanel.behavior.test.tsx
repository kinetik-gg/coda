// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
const uploadFile = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ api, uploadFile }));
vi.mock('./PdfPanelView', () => ({
  PdfPanelView: (props: Record<string, unknown>) => (
    <div>
      <span>View {String(props.label)}</span>
      <button onClick={() => (props.onPageCount as (value: number) => void)(12)}>
        Count pages
      </button>
      <button onClick={() => (props.onPageChange as (value: number) => void)(4)}>
        Change page
      </button>
      <button onClick={() => (props.onSelectDocument as (value: string) => void)('document-2')}>
        Select document
      </button>
      <button onClick={() => (props.onRangeStartChange as (value: number) => void)(5)}>
        Start range
      </button>
      <button onClick={() => (props.onRangeEndChange as (value: number) => void)(3)}>
        End range
      </button>
      <button onClick={() => (props.onAttach as () => void)()}>Attach range</button>
      <button onClick={() => (props.onRequestDelete as () => void)()}>Request delete</button>
      {props.deleteConfirmationOpen ? (
        <button onClick={() => (props.onConfirmDelete as () => void)()}>Confirm delete</button>
      ) : null}
      <input
        ref={props.uploadInputRef as React.RefObject<HTMLInputElement>}
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) (props.onUpload as (file: File) => void)(file);
        }}
      />
    </div>
  ),
}));

import { PdfPanel, PdfPanelHeaderControls } from './PdfPanel';

const panel = {
  id: '30000000-0000-4000-8000-000000000001',
  type: 'pdf' as const,
  configVersion: 1 as const,
  config: { sourceDocumentId: 'document-1', page: 2, zoom: 1 },
};
const project = {
  id: 'project',
  name: 'Film',
  description: null,
  ownerUserId: 'user',
  version: 1,
  revision: 1,
  entityTypes: [{ id: 'type', singularName: 'Shot', pluralName: 'Shots', level: 1, version: 1 }],
  roles: [],
  memberships: [],
  sourceDocuments: [
    {
      id: 'document-1',
      title: 'Script',
      pageCount: 10,
      storageObject: { id: 'storage-1', originalFilename: 'script.pdf' },
    },
    {
      id: 'document-2',
      title: 'Notes',
      pageCount: 5,
      storageObject: { id: 'storage-2', originalFilename: 'notes.pdf' },
    },
  ],
};
const activeEntity = {
  entityType: project.entityTypes[0]!,
  item: {
    id: 'item',
    entityTypeId: 'type',
    title: 'Shot',
    displayCode: null,
    description: null,
    version: 1,
    values: [],
    sourceReferences: [{ id: 'ref', sourceDocumentId: 'document-1', startPage: 2, endPage: 3 }],
  },
};

function renderPanel(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {element}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'coda-dark';
  api.mockImplementation((path: string) => {
    if (path.includes('/content'))
      return Promise.resolve({ url: 'https://objects.test/script.pdf' });
    if (path === '/api/v1/uploads')
      return Promise.resolve({
        id: 'upload',
        version: 1,
        uploadUrl: 'https://objects.test/upload',
        directUpload: true,
      });
    return Promise.resolve({ ok: true });
  });
  uploadFile.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('PdfPanel controllers', () => {
  it('clamps header page and zoom controls and emits bookmark/dark-view actions', () => {
    const change = vi.fn();
    const bookmark = vi.fn();
    window.addEventListener('coda:pdf-bookmark', bookmark);
    render(
      <PdfPanelHeaderControls
        project={project}
        panel={panel}
        onPanelChange={change}
        pageCount={3}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zoom PDF in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom PDF out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset PDF zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use light PDF view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use current page as source range' }));
    expect(change).toHaveBeenCalledTimes(6);
    expect(bookmark).toHaveBeenCalled();
    window.removeEventListener('coda:pdf-bookmark', bookmark);
  });

  it('coordinates selection, ranges, panel commands, attachment, and owner deletion', async () => {
    const change = vi.fn();
    renderPanel(
      <PdfPanel
        project={project}
        projectId="project"
        panel={panel}
        activeEntity={activeEntity}
        currentUserId="user"
        onPanelChange={change}
        onSelectEntity={vi.fn()}
      />,
    );
    await screen.findByText('View Script');
    fireEvent.click(screen.getByRole('button', { name: 'Count pages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start range' }));
    fireEvent.click(screen.getByRole('button', { name: 'End range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Attach range' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/api/v1/projects/project/items/item/source-references',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"startPage":3') as string,
        }),
      ),
    );
    for (const action of [
      'previous-page',
      'next-page',
      'toggle-dark',
      'use-current-page-range',
      'link-range',
    ]) {
      fireEvent(
        window,
        new CustomEvent('coda:panel-action', { detail: { panelId: panel.id, action } }),
      );
    }
    fireEvent.click(screen.getByRole('button', { name: 'Request delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/api/v1/projects/project/source-documents/document-1/trash',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('uploads the first PDF through signed storage and document creation', async () => {
    renderPanel(
      <PdfPanel
        project={{ ...project, sourceDocuments: [] }}
        projectId="project"
        panel={{ ...panel, config: { ...panel.config, sourceDocumentId: null } }}
        currentUserId="user"
        onPanelChange={vi.fn()}
        onSelectEntity={vi.fn()}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['pdf'], 'source.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ uploadUrl: 'https://objects.test/upload' }),
        file,
      ),
    );
    expect(api).toHaveBeenCalledWith(
      '/api/v1/projects/project/source-documents',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
