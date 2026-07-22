// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveStatus, Screenplay } from './types';
import { downloadFountain } from './fountain-download';
import { useScreenplayAutosave } from './useScreenplayAutosave';
import { ScreenplayEditorScreen } from './ScreenplayEditorScreen';

vi.mock('./fountain-download', () => ({ downloadFountain: vi.fn() }));
vi.mock('./useScreenplayAutosave', () => ({ useScreenplayAutosave: vi.fn() }));
vi.mock('./FountainEditor', () => ({
  FountainEditor: ({
    value,
    onChange,
    onSave,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSave: () => void;
  }) => (
    <label>
      Screenplay editor
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" onClick={onSave}>
        Save shortcut
      </button>
    </label>
  ),
}));

const screenplay: Screenplay = {
  id: 'script-id',
  ownerUserId: 'user-id',
  title: 'Blue Hour',
  filename: 'blue-hour.txt',
  sourceText: 'FADE IN:',
  version: 3,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

const persist = vi.fn<() => Promise<boolean>>();
const reloadLatest = vi.fn<() => Promise<void>>();
const setDraft = vi.fn<(value: string) => void>();

function installAutosave(status: SaveStatus = 'saved', draft = 'CURRENT LOCAL DRAFT') {
  vi.mocked(useScreenplayAutosave).mockReturnValue({
    draft,
    status,
    persist,
    reloadLatest,
    setDraft,
  });
}

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderEditor(onBack = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onBack,
    ...render(
      <QueryClientProvider client={client}>
        <ScreenplayEditorScreen screenplayId="script-id" onBack={onBack} />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ScreenplayEditorScreen', () => {
  it('shows a loading state until the screenplay is ready', async () => {
    let resolveRequest!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveRequest = resolve;
          }),
      ),
    );
    installAutosave();
    renderEditor();
    expect(screen.getByText('Opening screenplay…')).toBeInTheDocument();
    resolveRequest(
      new Response(JSON.stringify({ data: screenplay }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await screen.findByText('Blue Hour')).toBeInTheDocument();
  });

  it('offers navigation when the screenplay cannot be opened', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ title: 'Missing', status: 404, detail: 'Not found' }, 404)),
    );
    installAutosave();
    const { onBack } = renderEditor();
    expect(await screen.findByRole('alert')).toHaveTextContent('Screenplay could not be opened.');
    fireEvent.click(screen.getByRole('button', { name: 'Back to screenplays' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('downloads the current local draft with the stored filename', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave('unsaved', 'INT. ROOM - NIGHT\nLOCAL CHANGE');
    renderEditor();
    expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download Fountain' }));
    expect(downloadFountain).toHaveBeenCalledWith(
      'blue-hour.txt',
      'INT. ROOM - NIGHT\nLOCAL CHANGE',
    );
    expect(screen.getByText('2 lines')).toBeInTheDocument();
  });

  it('persists before leaving and stays when persistence fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    persist.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    installAutosave();
    const { onBack } = renderEditor();
    await screen.findByText('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Back to screenplays' }));
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to screenplays' }));
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
  });

  it('lets the writer reload after a conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    reloadLatest.mockResolvedValue();
    installAutosave('conflict');
    renderEditor();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another session saved a newer version.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
    expect(reloadLatest).toHaveBeenCalledOnce();
  });

  it('lets the writer retry a failed save and forwards editor changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    persist.mockResolvedValue(true);
    installAutosave('failed');
    renderEditor();
    expect(await screen.findByRole('alert')).toHaveTextContent('Coda could not save this draft.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.change(screen.getByLabelText('Screenplay editor'), { target: { value: 'NEW TEXT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save shortcut' }));
    expect(persist).toHaveBeenCalledTimes(2);
    expect(setDraft).toHaveBeenCalledWith('NEW TEXT');
  });

  it.each([
    ['saving', 'Saving…'],
    ['offline', 'Offline — changes kept here'],
  ] as const)('announces the %s state', async (status, label) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave(status);
    renderEditor();
    expect(await screen.findByText(label)).toBeInTheDocument();
  });
});
