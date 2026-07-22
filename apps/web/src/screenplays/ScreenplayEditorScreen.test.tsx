// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveStatus, Screenplay } from './types';
import { downloadFountain } from './fountain-download';
import { downloadScreenplayPdf } from './screenplay-pdf-export';
import { useScreenplayAutosave } from './useScreenplayAutosave';
import { ScreenplayEditorScreen } from './ScreenplayEditorScreen';

vi.mock('./fountain-download', () => ({ downloadFountain: vi.fn() }));
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

function installAutosave(status: SaveStatus = 'saved', draft = 'CURRENT LOCAL DRAFT') {
  vi.mocked(useScreenplayAutosave).mockReturnValue({
    draft,
    paperSize: 'letter',
    status,
    persist,
    reloadLatest,
    setDraft,
    setPaperSize,
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
  localStorage.clear();
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
    expect(await screen.findByRole('status')).toHaveTextContent('UNSAVED');
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Save Fountain Copy/u }));
    expect(downloadFountain).toHaveBeenCalledWith(
      'blue-hour.txt',
      'INT. ROOM - NIGHT\nLOCAL CHANGE',
    );
    expect(screen.getByText(/6 WORDS/u)).toBeInTheDocument();
  });

  it('exports a real screenplay PDF from the current preview model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response(screenplay)),
    );
    installAutosave('saved', 'INT. ROOM - NIGHT\nAction.');
    renderEditor();
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^PDF/u }));
    await waitFor(() => expect(downloadScreenplayPdf).toHaveBeenCalledOnce());
    const [filename] = vi.mocked(downloadScreenplayPdf).mock.calls[0]!;
    expect(filename).toBe('blue-hour.txt');
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
    expect(screen.getByRole('button', { name: /INT\. APARTMENT - DAY/u })).toBeInTheDocument();
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
    expect(within(inventory).getByRole('button', { name: /ALICE/u })).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole('button', { name: /INT\. STUDIO - DAY/u }));

    fireEvent.click(screen.getByRole('button', { name: 'Choose Inventory panel function' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Statistics' }));
    const statistics = await screen.findByRole('region', { name: 'Statistics' });
    fireEvent.click(within(statistics).getByRole('button', { name: 'Statistics view' }));
    fireEvent.click(screen.getByRole('option', { name: 'Characters' }));
    expect(
      await within(statistics).findByRole('button', { name: /ALICE/u }),
    ).toBeInTheDocument();
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
    expect(within(outline).getByRole('button', { name: /INT\. STUDIO - DAY/u })).toHaveTextContent(
      /PAGES/u,
    );
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
