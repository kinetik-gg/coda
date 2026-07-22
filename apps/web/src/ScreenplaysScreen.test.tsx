// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenplaysScreen } from './ScreenplaysScreen';

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderScreen(onOpen = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onOpen,
    ...render(
      <QueryClientProvider client={client}>
        <ScreenplaysScreen onOpen={onOpen} />
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
    await screen.findByText('Your first page is waiting.');
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
    fireEvent.click(await screen.findByRole('button', { name: /Night Bus/ }));
    expect(onOpen).toHaveBeenCalledWith('existing-id');
    expect(screen.getByText('night-bus.fountain')).toBeInTheDocument();
  });

  it('validates imported files before uploading them', async () => {
    const fetchMock = vi.fn(() => response([]));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderScreen();
    await screen.findByText('Your first page is waiting.');
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
    await screen.findByText('Your first page is waiting.');
    const file = new File(['ignored'], 'draft.FOUNTAIN', { type: 'text/plain' });
    Object.defineProperty(file, 'text', {
      value: vi.fn().mockResolvedValue('INT. ROOM - DAY\r\n'),
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('imported-id'));
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1];
    expect(JSON.parse(request?.body as string)).toEqual({
      filename: 'draft.FOUNTAIN',
      sourceText: 'INT. ROOM - DAY\r\n',
    });
  });

  it('converts Final Draft XML to canonical Fountain before import', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? response({ id: 'fdx-id', title: 'Imported FDX', filename: 'draft.fountain' })
        : response([]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container, onOpen } = renderScreen();
    await screen.findByText('Your first page is waiting.');
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
    await screen.findByText('Your first page is waiting.');
    const file = new File(['x'], 'draft.txt');
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('x') });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unreadable Fountain.');
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
    expect(await screen.findByText('Your first page is waiting.')).toBeInTheDocument();
  });

  it('dismisses the new-screenplay dialog from cancel and its backdrop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response([])),
    );
    renderScreen();
    await screen.findByText('Your first page is waiting.');
    fireEvent.click(screen.getByRole('button', { name: 'New screenplay' }));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New screenplay' }));
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
