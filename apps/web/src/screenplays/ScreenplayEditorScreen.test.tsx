// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveState } from '../workspace/shell';
import type { Screenplay } from './types';
import type { ScreenplayRecoverySnapshot } from './screenplay-recovery-store';
import { downloadFountain } from './fountain-download';
import { downloadFinalDraft } from './screenplay-interchange-download';
import { downloadScreenplayPdf } from './screenplay-pdf-export';
import { useScreenplayAutosave } from './useScreenplayAutosave';
import { ScreenplayEditorScreen } from './ScreenplayEditorScreen';

vi.mock('./fountain-download', () => ({ downloadFountain: vi.fn() }));
vi.mock('./screenplay-interchange-download', () => ({ downloadFinalDraft: vi.fn() }));
vi.mock('./screenplay-pdf-export', () => ({
  downloadScreenplayPdf: vi.fn(() => Promise.resolve()),
}));
vi.mock('./useScreenplayAutosave', () => ({ useScreenplayAutosave: vi.fn() }));
vi.mock('./FountainEditor', () => ({
  FountainEditor: ({
    value,
    onChange,
    onSave,
    onSelectionChange,
    onSourceSelectionChange,
    onViewportChange,
    showLineNumbers,
    showPageBreaks,
    typewriterScrollingEnabled,
    focusModeEnabled,
    focusModeScope,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSave: () => void;
    onSelectionChange?: (offset: number) => void;
    onSourceSelectionChange?: (selection: {
      anchor: number;
      head: number;
      from: number;
      to: number;
    }) => void;
    onViewportChange?: (offset: number) => void;
    showLineNumbers?: boolean;
    showPageBreaks?: boolean;
    typewriterScrollingEnabled?: boolean;
    focusModeEnabled?: boolean;
    focusModeScope?: 'paragraph' | 'line';
  }) => (
    <div
      data-testid="mock-fountain-editor"
      data-show-line-numbers={String(showLineNumbers)}
      data-show-page-breaks={String(showPageBreaks)}
      data-typewriter-scrolling={String(typewriterScrollingEnabled)}
      data-focus-mode={String(focusModeEnabled)}
      data-focus-scope={focusModeScope}
    >
      <label>
        Screenplay editor
        <textarea value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
      <button type="button" onClick={onSave}>
        Save shortcut
      </button>
      <button
        type="button"
        onClick={() => {
          onSelectionChange?.(5);
          onSourceSelectionChange?.({ anchor: 5, head: 5, from: 5, to: 5 });
        }}
      >
        Move editor cursor
      </button>
      <button type="button" onClick={() => onViewportChange?.(3)}>
        Scroll editor
      </button>
    </div>
  ),
}));

const screenplay: Screenplay = {
  id: 'script-id',
  ownerUserId: 'user-id',
  title: 'Blue Hour',
  filename: 'blue-hour.txt',
  paperSize: 'letter',
  sourceText: 'FADE IN:',
  version: 3,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

const persist = vi.fn<() => Promise<boolean>>();
const reloadLatest = vi.fn<() => Promise<void>>();
const setDraft = vi.fn<(value: string) => void>();
const setPaperSize = vi.fn();
const recoverDraft = vi.fn();
const discardRecovery = vi.fn<() => Promise<void>>();
const dismissRecoveryError = vi.fn();
const getCurrentDocument = vi.fn();
const getCurrentVersion = vi.fn();

function installAutosave(
  status: SaveState = 'saved',
  draft = 'CURRENT LOCAL DRAFT',
  recoveryState: {
    recovery?: ScreenplayRecoverySnapshot;
    recoveryError?: string;
    recoveryServerVersion?: number;
  } = {},
) {
  persist.mockResolvedValue(true);
  getCurrentDocument.mockReturnValue({ sourceText: draft, paperSize: 'letter' });
  getCurrentVersion.mockReturnValue(recoveryState.recoveryServerVersion ?? screenplay.version);
  vi.mocked(useScreenplayAutosave).mockReturnValue({
    draft,
    paperSize: 'letter',
    status,
    persist,
    reloadLatest,
    recovery: recoveryState.recovery,
    recoveryError: recoveryState.recoveryError,
    recoveryServerVersion: recoveryState.recoveryServerVersion ?? screenplay.version,
    recoverDraft,
    discardRecovery,
    dismissRecoveryError,
    setDraft,
    setPaperSize,
    getCurrentDocument,
    getCurrentVersion,
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

function checkpointFetch(sourceText: string, version = screenplay.version) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (path.endsWith('/checkpoints') && init?.method === 'POST') {
      return response({
        id: 'checkpoint-id',
        screenplayId: screenplay.id,
        screenplayVersion: version,
        filename: screenplay.filename,
        paperSize: screenplay.paperSize,
        sourceByteLength: new TextEncoder().encode(sourceText).byteLength,
        createdAt: '2026-07-23T00:00:00.000Z',
      });
    }
    if (path.endsWith('/checkpoints/checkpoint-id/export.fountain')) {
      return Promise.resolve(
        new Response(sourceText, { status: 200, headers: { 'content-type': 'text/plain' } }),
      );
    }
    return response(screenplay);
  });
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
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ScreenplayEditorScreen', () => {
  it('offers explicit recovery, download, and discard actions without replacing the server draft', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response({ ...screenplay, sourceText: 'NEWER SERVER', version: 9 })),
    );
    installAutosave('saved', 'NEWER SERVER', {
      recovery: {
        schemaVersion: 1,
        accountId: 'user-id',
        screenplayId: 'script-id',
        baseServerVersion: 3,
        sourceText: 'RECOVERABLE LOCAL DRAFT',
        paperSize: 'letter',
        updatedAt: new Date('2026-07-23T00:00:00.000Z').valueOf(),
        contentHash: 'sha256:test',
      },
      recoveryServerVersion: 9,
    });
    renderEditor();

    const notice = await screen.findByRole('region', { name: 'Screenplay recovery' });
    expect(notice).toHaveTextContent('Coda will not replace it unless you choose Recover');
    expect(screen.getByLabelText('Screenplay editor')).toHaveValue('NEWER SERVER');
    fireEvent.click(within(notice).getByRole('button', { name: 'Download .fountain' }));
    expect(downloadFountain).toHaveBeenCalledWith('blue-hour.txt', 'RECOVERABLE LOCAL DRAFT');
    fireEvent.click(within(notice).getByRole('button', { name: 'Recover' }));
    fireEvent.click(within(notice).getByRole('button', { name: 'Discard' }));
    expect(recoverDraft).toHaveBeenCalledOnce();
    expect(discardRecovery).toHaveBeenCalledOnce();
  });

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
    const sourceText = 'INT. ROOM - NIGHT\nLOCAL CHANGE';
    const fetchMock = checkpointFetch(sourceText);
    vi.stubGlobal('fetch', fetchMock);
    installAutosave('unsaved', sourceText);
    renderEditor();
    expect(await screen.findByRole('status')).toHaveTextContent('UNSAVED');
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Save Fountain Copy/u }));
    await waitFor(() => expect(downloadFountain).toHaveBeenCalledWith('blue-hour.txt', sourceText));
    expect(persist).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({ version: 3 });
    expect(await screen.findByText(/6 WORDS/u)).toBeInTheDocument();
  });

  it('exports a real screenplay PDF from the current preview model', async () => {
    const sourceText = 'INT. ROOM - NIGHT\nAction.';
    vi.stubGlobal('fetch', checkpointFetch(sourceText));
    installAutosave('saved', sourceText);
    renderEditor();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^PDF/u }));
    await waitFor(() => expect(downloadScreenplayPdf).toHaveBeenCalledOnce());
    expect(downloadScreenplayPdf).toHaveBeenCalledWith('blue-hour.txt', sourceText, 'letter');
    expect(persist).toHaveBeenCalledOnce();
  });

  it('exports Final Draft from the immutable Fountain checkpoint', async () => {
    const sourceText = 'EXT. PARK - DAY\n\nALICE\nReady.';
    vi.stubGlobal('fetch', checkpointFetch(sourceText));
    installAutosave('saved', sourceText);
    renderEditor();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Final Draft/u }));

    await waitFor(() =>
      expect(downloadFinalDraft).toHaveBeenCalledWith('blue-hour.txt', sourceText),
    );
    expect(persist).toHaveBeenCalledOnce();
  });

  it('reports unsupported PDF glyphs without replacing screenplay text', async () => {
    const sourceText = 'INT. ROOM - NIGHT\n😀';
    vi.stubGlobal('fetch', checkpointFetch(sourceText));
    const glyphError = Object.assign(
      new Error('PDF export cannot render 😀 (U+1F600) with the embedded screenplay font.'),
      { name: 'ScreenplayPdfUnsupportedGlyphError' },
    );
    vi.mocked(downloadScreenplayPdf).mockRejectedValueOnce(glyphError);
    installAutosave('saved', sourceText);
    renderEditor();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^PDF/u }));
    expect(await screen.findByRole('alert')).toHaveTextContent(glyphError.message);
  });

  it('persists before leaving and stays when persistence fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    persist.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    installAutosave();
    const { onBack } = renderEditor();
    expect(await screen.findByRole('status')).toHaveTextContent('SAVED');
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
    ['saving', 'SAVING'],
    ['offline', 'OFFLINE · LOCAL CHANGES KEPT'],
  ] as const)('announces the %s state', async (status, label) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave(status);
    renderEditor();
    expect(await screen.findByRole('status')).toHaveTextContent(label);
  });

  it('filters the outline and reports when no scenes match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave(
      'saved',
      'INT. APARTMENT - DAY #1#\n\nMAYA\nHello.\n\nEXT. PARK - NIGHT #2#\n\nMAYA walks.',
    );
    renderEditor();

    expect(await screen.findByRole('region', { name: 'Outline' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /INT\. APARTMENT - DAY/u }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /EXT\. PARK - NIGHT/u })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Filter scenes'), { target: { value: 'park' } });
    expect(
      screen.queryByRole('button', { name: /INT\. APARTMENT - DAY/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /EXT\. PARK - NIGHT/u })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Filter scenes'), {
      target: { value: 'missing scene' },
    });
    expect(screen.getByText('No matching scenes.')).toBeInTheDocument();
  });

  it('navigates screenplay inventories and persists editor line-number visibility', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave(
      'saved',
      '# Act One\n\nINT. STUDIO - DAY\n\nALICE\nHello.\n\n[[Check continuity]]\n\nEXT. PARK - NIGHT\n\nA quiet path.',
    );
    renderEditor();

    const inventory = await screen.findByRole('region', { name: 'Inventory' });
    const inventoryType = within(inventory).getByRole('button', { name: 'Inventory type' });
    expect(await within(inventory).findByRole('button', { name: /ALICE/u })).toBeInTheDocument();

    fireEvent.click(inventoryType);
    fireEvent.click(screen.getByRole('option', { name: 'Locations' }));
    expect(within(inventory).getByRole('button', { name: /STUDIO/u })).toBeInTheDocument();
    fireEvent.click(inventoryType);
    fireEvent.click(screen.getByRole('option', { name: 'Time of day' }));
    expect(within(inventory).getByRole('button', { name: /NIGHT/u })).toBeInTheDocument();
    fireEvent.click(inventoryType);
    fireEvent.click(screen.getByRole('option', { name: 'Sections' }));
    expect(within(inventory).getByRole('button', { name: /Act One/u })).toBeInTheDocument();
    fireEvent.click(inventoryType);
    fireEvent.click(screen.getByRole('option', { name: 'Notes' }));
    fireEvent.click(within(inventory).getByRole('button', { name: /Check continuity/u }));

    fireEvent.change(within(inventory).getByRole('textbox', { name: 'Filter inventory' }), {
      target: { value: 'missing' },
    });
    expect(within(inventory).getByText('No matching inventory items.')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole('region', { name: 'Editor' }), {
      clientX: 200,
      clientY: 100,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split top / bottom' }));
    expect(screen.getAllByTestId('mock-fountain-editor')).toHaveLength(2);
    for (const editor of screen.getAllByTestId('mock-fountain-editor')) {
      expect(editor).toHaveAttribute('data-show-line-numbers', 'true');
      expect(editor).toHaveAttribute('data-show-page-breaks', 'true');
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Line Numbers' }));
    for (const editor of screen.getAllByTestId('mock-fountain-editor')) {
      expect(editor).toHaveAttribute('data-show-line-numbers', 'false');
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Estimated Page Breaks' }));
    for (const editor of screen.getAllByTestId('mock-fountain-editor')) {
      expect(editor).toHaveAttribute('data-show-page-breaks', 'false');
    }
  });

  it('routes cursor, viewport, outline, and statistics panel interactions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave('saved', 'INT. STUDIO - DAY\n\nALICE\nHello.');
    renderEditor();

    expect(await screen.findByRole('region', { name: 'Editor' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move editor cursor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scroll editor' }));
    fireEvent.click(await screen.findByRole('button', { name: /INT\. STUDIO - DAY/u }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose Inventory panel function' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Statistics' }));
    const statistics = await screen.findByRole('region', { name: 'Statistics' });
    fireEvent.click(within(statistics).getByRole('button', { name: 'Statistics view' }));
    fireEvent.click(screen.getByRole('option', { name: 'Characters' }));
    expect(await within(statistics).findByRole('button', { name: /ALICE/u })).toBeInTheDocument();
  });

  it('keeps editor, preview, and outline view controls in their panel headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave('saved', 'INT. STUDIO - DAY\n\nALICE\nA short line.');
    renderEditor();

    const editor = await screen.findByRole('region', { name: 'Editor' });
    fireEvent.click(within(editor).getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Estimated Page Breaks' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Typewriter Scrolling' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Paragraph Focus' }));
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute(
      'data-typewriter-scrolling',
      'true',
    );
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute(
      'data-show-page-breaks',
      'false',
    );
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute('data-focus-mode', 'true');
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute(
      'data-focus-scope',
      'paragraph',
    );

    const preview = screen.getByRole('region', { name: 'Preview' });
    fireEvent.click(within(preview).getByRole('button', { name: 'Preview zoom' }));
    fireEvent.click(screen.getByRole('option', { name: '150%' }));
    fireEvent.click(within(preview).getByRole('button', { name: 'Two-page view' }));
    expect(within(preview).getByRole('region', { name: 'Screenplay preview' })).toHaveAttribute(
      'data-preview-zoom',
      '150',
    );
    expect(within(preview).getByRole('region', { name: 'Screenplay preview' })).toHaveAttribute(
      'data-page-view',
      'two-page',
    );

    const outline = screen.getByRole('region', { name: 'Outline' });
    fireEvent.click(within(outline).getByRole('button', { name: 'Metadata' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Page count' }));
    expect(
      await within(outline).findByRole('button', { name: /INT\. STUDIO - DAY/u }),
    ).toHaveTextContent(/PAGES/u);
  });

  it('restores the standard workspace layout from the View menu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave();
    renderEditor();
    expect(await screen.findByRole('region', { name: 'Outline' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Preview' })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole('region', { name: 'Outline' }), {
      clientX: 200,
      clientY: 100,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close panel' }));
    expect(screen.queryByRole('region', { name: 'Outline' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset Workspace Layout' }));
    expect(screen.getByRole('region', { name: 'Outline' })).toBeInTheDocument();
  });

  it('enters Zen from the editor header and exposes Zen writing shortcuts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave();
    renderEditor();
    expect(await screen.findByRole('status')).toBeInTheDocument();

    const zenButton = within(screen.getByRole('region', { name: 'Editor' })).getByRole('button', {
      name: 'Enter Zen mode',
    });
    expect(zenButton.querySelector('svg')).toBeInTheDocument();
    fireEvent.click(zenButton);
    expect(screen.getByRole('button', { name: /Exit Zen/u })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Typewriter Scrolling' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus mode' })).toBeInTheDocument();
    expect(screen.getByLabelText('Zen mode shortcuts')).toHaveTextContent(/Cycle focus/u);
    expect(screen.queryByRole('menubar')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Outline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute(
      'data-typewriter-scrolling',
      'true',
    );
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, altKey: true });
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute('data-focus-mode', 'true');
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute(
      'data-focus-scope',
      'paragraph',
    );
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, altKey: true });
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute('data-focus-scope', 'line');
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true, altKey: true });
    expect(screen.getByTestId('mock-fountain-editor')).toHaveAttribute('data-focus-mode', 'false');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /Exit Zen/u })).not.toBeInTheDocument();
    expect(
      screen.getByRole('menubar', { name: 'Screenplay application menu' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menubar', { name: 'Editor actions' })).not.toBeInTheDocument();
  });

  it('enters Zen with the settings of the editor panel that invoked it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave();
    renderEditor();
    const firstEditor = await screen.findByRole('region', { name: 'Editor' });
    fireEvent.contextMenu(firstEditor, { clientX: 200, clientY: 100 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split top / bottom' }));

    const editors = screen.getAllByRole('region', { name: 'Editor' });
    const secondEditor = editors[1];
    if (!secondEditor) throw new Error('Expected the split editor panel');
    fireEvent.click(within(secondEditor).getByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Typewriter Scrolling' }));
    fireEvent.click(within(secondEditor).getByRole('button', { name: 'Enter Zen mode' }));

    const visibleEditor = screen.getByRole('region', { name: 'Editor' });
    const zenEditor = within(visibleEditor).getByTestId('mock-fountain-editor');
    expect(zenEditor).toHaveAttribute('data-typewriter-scrolling', 'true');
    expect(screen.getAllByRole('region', { name: 'Editor' })).toHaveLength(1);
  });

  it('shows and dismisses an unsupported editing-command notice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave();
    renderEditor();
    expect(await screen.findByRole('status')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Undo/u }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This browser did not grant access to that editing command.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
