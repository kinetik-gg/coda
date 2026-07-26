// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenplaysScreen, type ScreenplaysScreenProps } from './ScreenplaysScreen';

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderScreen(onOpen = vi.fn(), props: Partial<ScreenplaysScreenProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onShare = vi.fn();
  const onCloseShare = vi.fn();
  return {
    onOpen,
    onShare,
    onCloseShare,
    ...render(
      <QueryClientProvider client={client}>
        <ScreenplaysScreen
          onOpen={onOpen}
          onShare={onShare}
          onCloseShare={onCloseShare}
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ScreenplaysScreen', () => {
  it('creates a Fountain screenplay and opens it', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/screenplays' && !init?.method) return response([]);
      if (path === '/api/v1/screenplays' && init?.method === 'POST') {
        return response({ id: 'new-id', title: 'Blue Hour', filename: 'blue-hour.fountain' });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onOpen } = renderScreen();
    await screen.findByText(/Your first page is waiting/);
    fireEvent.click(screen.getByRole('button', { name: 'New screenplay' }));
    const createButton = screen.getByRole('button', { name: 'Create screenplay' });
    expect(createButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Blue Hour  ' } });
    fireEvent.click(createButton);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('new-id'));
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1];
    const body = JSON.parse(request?.body as string) as { title: string; sourceText: string };
    expect(body.title).toBe('Blue Hour');
    expect(body.sourceText).toContain('Title: Blue Hour');
  });

  it('lists existing screenplays and opens the selected document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        response([
          {
            id: 'existing-id',
            title: 'Night Bus',
            filename: 'night-bus.fountain',
            updatedAt: '2026-07-22T00:00:00.000Z',
          },
        ]),
      ),
    );
    const { onOpen } = renderScreen();
    fireEvent.doubleClick(await screen.findByRole('row', { name: 'Night Bus' }));
    expect(onOpen).toHaveBeenCalledWith('existing-id');
    expect(screen.getByText('night-bus.fountain')).toBeInTheDocument();
  });

  it('opens a screenplay from its row context menu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        response([
          {
            id: 'menu-id',
            title: 'Night Bus',
            filename: 'night-bus.fountain',
            updatedAt: '2026-07-22T00:00:00.000Z',
          },
        ]),
      ),
    );
    const { onOpen } = renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Night Bus' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('menu-id');
  });

  it('confirms before moving a screenplay to trash from its row context menu', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/screenplays' && init?.method === 'DELETE')
        return response({ ok: true });
      if (path === '/api/v1/screenplays/trash-id' && init?.method === 'DELETE')
        return response({ ok: true });
      return response([
        {
          id: 'trash-id',
          title: 'Night Bus',
          filename: 'night-bus.fountain',
          updatedAt: '2026-07-22T00:00:00.000Z',
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Night Bus' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to trash' }));
    // Destructive actions are a confirmation, never a click-through (#169).
    const confirmation = await screen.findByRole('dialog', { name: 'Move screenplay to trash?' });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/screenplays/trash-id',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('renames a screenplay from its row context menu', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/screenplays/rename-id' && init?.method === 'PATCH') {
        return response({ id: 'rename-id', title: 'Dawn Chorus', version: 2 });
      }
      return response([
        {
          id: 'rename-id',
          title: 'Night Bus',
          filename: 'night-bus.fountain',
          version: 1,
          updatedAt: '2026-07-22T00:00:00.000Z',
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Night Bus' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }));
    const input = await screen.findByLabelText('Title');
    fireEvent.change(input, { target: { value: 'Dawn Chorus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch?.[1]?.body as string) ?? '{}') as {
        title: string;
        version: number;
      };
      expect(body).toEqual({ title: 'Dawn Chorus', version: 1 });
    });
  });

  it('opens the addressable share route from the row context menu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        response([
          {
            id: 'manage-id',
            title: 'Night Bus',
            filename: 'night-bus.fountain',
            version: 1,
            updatedAt: '2026-07-22T00:00:00.000Z',
          },
        ]),
      ),
    );
    const { onShare } = renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Night Bus' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Share…' }));
    expect(onShare).toHaveBeenCalledWith('manage-id');
  });

  it('filters the library by the header search field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        response([
          {
            id: 'a',
            title: 'Night Bus',
            filename: 'night-bus.fountain',
            updatedAt: '2026-07-22T00:00:00.000Z',
          },
          {
            id: 'b',
            title: 'Blue Hour',
            filename: 'blue-hour.fountain',
            updatedAt: '2026-07-22T00:00:00.000Z',
          },
        ]),
      ),
    );
    renderScreen();
    expect(await screen.findByRole('row', { name: 'Night Bus' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search screenplays' }), {
      target: { value: 'blue' },
    });
    expect(screen.queryByRole('row', { name: 'Night Bus' })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Blue Hour' })).toBeInTheDocument();
  });

  it('validates imported files before uploading them', async () => {
    const fetchMock = vi.fn(() => response([]));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderScreen();
    await screen.findByText(/Your first page is waiting/);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(['x'], 'draft.pdf')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a Fountain, Final Draft, or supported screenplay file.',
    );

    const oversized = new File(['x'], 'large.fountain');
    Object.defineProperty(oversized, 'size', { value: 5_000_001 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The screenplay file must be smaller than 5 MB.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('imports exact Fountain source and opens the imported screenplay', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? response({ id: 'imported-id', title: 'Imported', filename: 'draft.fountain' })
        : response([]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container, onOpen } = renderScreen();
    await screen.findByText(/Your first page is waiting/);
    const source = '\uFEFFINT. ROOM - DAY\r\n';
    const file = new File(['ignored'], 'draft.FOUNTAIN', { type: 'text/plain' });
    const text = vi.fn();
    Object.defineProperty(file, 'text', { value: text });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new TextEncoder().encode(source).buffer),
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('imported-id'));
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1];
    expect(JSON.parse(request?.body as string)).toEqual({
      filename: 'draft.FOUNTAIN',
      sourceText: source,
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('converts Final Draft XML to canonical Fountain before import', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? response({ id: 'fdx-id', title: 'Imported FDX', filename: 'draft.fountain' })
        : response([]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container, onOpen } = renderScreen();
    await screen.findByText(/Your first page is waiting/);
    const xml =
      '<FinalDraft><Content><Paragraph Type="Scene Heading"><Text>EXT. CAFE - NIGHT</Text></Paragraph><Paragraph Type="Action"><Text>Rain.</Text></Paragraph></Content></FinalDraft>';
    const file = new File([xml], 'draft.fdx', { type: 'application/xml' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new TextEncoder().encode(xml).buffer),
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('fdx-id'));
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1];
    const requestBody = JSON.parse(request?.body as string) as {
      filename: string;
      sourceText: string;
    };
    expect(requestBody.filename).toBe('draft.fountain');
    expect(requestBody.sourceText).toContain('EXT. CAFE - NIGHT');
  });

  it('surfaces an import failure while preserving the library', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? response({ title: 'Import failed', status: 422, detail: 'Unreadable Fountain.' }, 422)
        : response([]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderScreen();
    await screen.findByText(/Your first page is waiting/);
    const file = new File(['x'], 'draft.txt');
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new TextEncoder().encode('x').buffer),
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unreadable Fountain.');
  });

  it('rejects malformed UTF-8 before uploading a Fountain file', async () => {
    const fetchMock = vi.fn(() => response([]));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderScreen();
    await screen.findByText(/Your first page is waiting/);
    const file = new File(['ignored'], 'broken.fountain');
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new Uint8Array([0xc3, 0x28]).buffer),
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The screenplay text encoding is invalid.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a recoverable library loading failure', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        response({ title: 'Unavailable', status: 503, detail: 'Try later' }, 503),
      )
      .mockImplementationOnce(() => response([]));
    vi.stubGlobal('fetch', fetchMock);
    renderScreen();
    expect(await screen.findByRole('alert')).toHaveTextContent('Screenplays could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Your first page is waiting/)).toBeInTheDocument();
  });

  it('dismisses the new-screenplay dialog from cancel and its backdrop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response([])),
    );
    renderScreen();
    await screen.findByText(/Your first page is waiting/);
    fireEvent.click(screen.getByRole('button', { name: 'New screenplay' }));
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New screenplay' }));
    fireEvent.pointerDown(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
