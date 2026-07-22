// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Screenplay } from './types';
import { useScreenplayAutosave } from './useScreenplayAutosave';

const screenplay: Screenplay = {
  id: 'script-id',
  ownerUserId: 'user-id',
  title: 'Test',
  filename: 'test.fountain',
  paperSize: 'letter',
  sourceText: 'FADE IN:',
  version: 3,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

function Harness({ onLeave = () => undefined }: { onLeave?: () => void }) {
  const state = useScreenplayAutosave(screenplay.id, screenplay);
  return (
    <main>
      <label>
        Source
        <textarea value={state.draft} onChange={(event) => state.setDraft(event.target.value)} />
      </label>
      <span>{state.status}</span>
      <button type="button" onClick={() => void state.persist()}>
        Save
      </button>
      <button type="button" onClick={() => void state.reloadLatest()}>
        Reload
      </button>
      <button
        type="button"
        onClick={() => void state.persist().then((saved) => saved && onLeave())}
      >
        Back
      </button>
    </main>
  );
}

function renderHarness(onLeave?: () => void) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness onLeave={onLeave} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('screenplay autosave', () => {
  it('saves the exact Fountain source with its optimistic version', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { ...screenplay, sourceText: 'FADE OUT.', version: 4 } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderHarness();
    fireEvent.change(await screen.findByLabelText('Source'), { target: { value: 'FADE OUT.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('saved');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/screenplays/script-id',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ sourceText: 'FADE OUT.', paperSize: 'letter', version: 3 }),
      }),
    );
  });

  it('keeps the local draft and exposes a version conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ type: 'conflict', title: 'Conflict', status: 409 }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    renderHarness();
    const source = await screen.findByLabelText('Source');
    fireEvent.change(source, { target: { value: 'LOCAL DRAFT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('conflict')).toBeInTheDocument());
    expect(source).toHaveValue('LOCAL DRAFT');
  });

  it('does not leave when saving the only local draft fails', async () => {
    const onLeave = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    renderHarness(onLeave);
    fireEvent.change(await screen.findByLabelText('Source'), { target: { value: 'UNSAVED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('failed');
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Source')).toHaveValue('UNSAVED');
  });

  it('does not send a request when the draft is already saved', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderHarness();
    await screen.findByDisplayValue('FADE IN:');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('saved')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps edits offline and retries when connectivity returns', async () => {
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { ...screenplay, sourceText: 'OFFLINE EDIT', version: 4 } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderHarness();
    fireEvent.change(await screen.findByLabelText('Source'), { target: { value: 'OFFLINE EDIT' } });
    expect(screen.getByText('offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(fetchMock).not.toHaveBeenCalled();

    online = true;
    fireEvent(window, new Event('online'));
    await screen.findByText('saved');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('serializes a newer draft behind an in-flight save', async () => {
    let resolveFirst!: (value: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const sent = JSON.parse(init?.body as string) as { sourceText: string };
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { ...screenplay, sourceText: sent.sourceText, version: 5 } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderHarness();
    const source = await screen.findByLabelText('Source');
    fireEvent.change(source, { target: { value: 'FIRST EDIT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('saving');
    fireEvent.change(source, { target: { value: 'SECOND EDIT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    resolveFirst(
      new Response(
        JSON.stringify({ data: { ...screenplay, sourceText: 'FIRST EDIT', version: 4 } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText('saved');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      sourceText: 'SECOND EDIT',
      paperSize: 'letter',
      version: 4,
    });
  });

  it('reloads and installs the latest server version after a conflict', async () => {
    const latest = { ...screenplay, sourceText: 'SERVER DRAFT', version: 9 };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: latest }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    renderHarness();
    fireEvent.change(await screen.findByLabelText('Source'), { target: { value: 'LOCAL DRAFT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByLabelText('Source')).toHaveValue('SERVER DRAFT');
    expect(screen.getByText('saved')).toBeInTheDocument();
  });

  it('guards navigation only while local changes are unsaved', async () => {
    renderHarness();
    await screen.findByDisplayValue('FADE IN:');
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'LOCAL DRAFT' } });
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it('autosaves an online draft after the debounce interval', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { ...screenplay, sourceText: 'DEBOUNCED', version: 4 } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderHarness();
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'DEBOUNCED' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByText('saved')).toBeInTheDocument();
  });
});
