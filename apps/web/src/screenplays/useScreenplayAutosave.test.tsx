// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createScreenplayRecoverySnapshot,
  type ScreenplayRecoverySnapshot,
  type ScreenplayRecoveryStore,
} from './screenplay-recovery-store';
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

class TestRecoveryStore implements ScreenplayRecoveryStore {
  readonly records = new Map<string, ScreenplayRecoverySnapshot>();
  readonly reads: string[] = [];
  failSave = false;
  purgedAccounts: string[] = [];
  purgeExpiredCalls = 0;

  read(accountId: string, screenplayId: string) {
    const key = `${accountId}:${screenplayId}`;
    this.reads.push(key);
    return Promise.resolve(this.records.get(key));
  }

  save(snapshot: ScreenplayRecoverySnapshot) {
    if (this.failSave) {
      return Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'));
    }
    this.records.set(`${snapshot.accountId}:${snapshot.screenplayId}`, snapshot);
    return Promise.resolve();
  }

  purgeExpired() {
    this.purgeExpiredCalls += 1;
    return Promise.resolve();
  }

  purgeAccount(accountId: string) {
    this.purgedAccounts.push(accountId);
    for (const [key, record] of this.records) {
      if (record.accountId === accountId) this.records.delete(key);
    }
    return Promise.resolve();
  }

  purgeAll() {
    this.records.clear();
    return Promise.resolve();
  }

  remove(
    accountId: string,
    screenplayId: string,
    expected?: Pick<ScreenplayRecoverySnapshot, 'contentHash' | 'paperSize' | 'sourceText'>,
  ) {
    const key = `${accountId}:${screenplayId}`;
    const record = this.records.get(key);
    if (
      !expected ||
      (record?.contentHash === expected.contentHash &&
        record.paperSize === expected.paperSize &&
        record.sourceText === expected.sourceText)
    ) {
      this.records.delete(key);
    }
    return Promise.resolve();
  }
}

function Harness({
  onLeave = () => undefined,
  onDownload = () => undefined,
  onInspect = () => undefined,
  recoveryStore,
  value = screenplay,
}: {
  onLeave?: () => void;
  onDownload?: (source: string) => void;
  onInspect?: (version: number, document: { sourceText: string; paperSize: string }) => void;
  recoveryStore?: ScreenplayRecoveryStore;
  value?: Screenplay;
}) {
  const state = useScreenplayAutosave(value.id, value, {
    recoveryStore,
    recoveryDebounceMs: 10,
  });
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
      <button
        type="button"
        onClick={() => onInspect(state.getCurrentVersion(), state.getCurrentDocument())}
      >
        Inspect current
      </button>
      <button type="button" onClick={() => void state.reloadLatest()}>
        Reload
      </button>
      {state.recovery && (
        <section aria-label="Recovery draft">
          <span>{`recovery-v${String(state.recovery.baseServerVersion)}`}</span>
          <button type="button" onClick={state.recoverDraft}>
            Recover
          </button>
          <button type="button" onClick={() => void state.discardRecovery()}>
            Discard
          </button>
        </section>
      )}
      {state.recoveryError && <span>{state.recoveryError}</span>}
      {(state.recovery || state.recoveryError) && (
        <button type="button" onClick={() => onDownload(state.recovery?.sourceText ?? state.draft)}>
          Download recovery
        </button>
      )}
      <button
        type="button"
        onClick={() => void state.persist().then((saved) => saved && onLeave())}
      >
        Back
      </button>
    </main>
  );
}

function renderHarness(
  onLeave?: () => void,
  options: {
    onDownload?: (source: string) => void;
    onInspect?: (version: number, document: { sourceText: string; paperSize: string }) => void;
    recoveryStore?: ScreenplayRecoveryStore;
    value?: Screenplay;
  } = {},
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness onLeave={onLeave} {...options} />
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
    const onInspect = vi.fn();
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
    renderHarness(undefined, { onInspect });
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
    fireEvent.click(screen.getByRole('button', { name: 'Inspect current' }));
    expect(onInspect).toHaveBeenCalledWith(4, {
      sourceText: 'FADE OUT.',
      paperSize: 'letter',
    });
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
    let resolveSecond!: (value: Response) => void;
    const recoveryStore = new TestRecoveryStore();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => {
        if (fetchMock.mock.calls.length === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Promise<Response>((resolve) => {
          resolveSecond = resolve;
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderHarness(undefined, { recoveryStore });
    const source = await screen.findByLabelText('Source');
    fireEvent.change(source, { target: { value: 'FIRST EDIT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('saving');
    fireEvent.change(source, { target: { value: 'SECOND EDIT' } });
    fireEvent(window, new Event('pagehide'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(recoveryStore.records.get('user-id:script-id')?.sourceText).toBe('SECOND EDIT'),
    );

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
    expect(recoveryStore.records.get('user-id:script-id')?.sourceText).toBe('SECOND EDIT');
    resolveSecond(
      new Response(
        JSON.stringify({ data: { ...screenplay, sourceText: 'SECOND EDIT', version: 5 } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    await screen.findByText('saved');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      sourceText: 'SECOND EDIT',
      paperSize: 'letter',
      version: 4,
    });
    await waitFor(() => expect(recoveryStore.records.has('user-id:script-id')).toBe(false));
  });

  it('preserves the local draft before installing the latest server version', async () => {
    const recoveryStore = new TestRecoveryStore();
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
    renderHarness(undefined, { recoveryStore });
    fireEvent.change(await screen.findByLabelText('Source'), { target: { value: 'LOCAL DRAFT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByLabelText('Source')).toHaveValue('SERVER DRAFT');
    expect(screen.getByText('saved')).toBeInTheDocument();
    expect(screen.getByText('recovery-v3')).toBeInTheDocument();
    expect(recoveryStore.records.get('user-id:script-id')?.sourceText).toBe('LOCAL DRAFT');
    fireEvent.click(screen.getByRole('button', { name: 'Recover' }));
    expect(screen.getByLabelText('Source')).toHaveValue('LOCAL DRAFT');
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

  it('recovers an offline edit after the editor is reloaded', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const recoveryStore = new TestRecoveryStore();
    const first = renderHarness(undefined, { recoveryStore });
    fireEvent.change(await screen.findByLabelText('Source'), {
      target: { value: 'DURABLE OFFLINE EDIT' },
    });
    fireEvent(window, new Event('pagehide'));
    await waitFor(() =>
      expect(recoveryStore.records.get('user-id:script-id')?.sourceText).toBe(
        'DURABLE OFFLINE EDIT',
      ),
    );

    first.unmount();
    renderHarness(undefined, { recoveryStore });
    expect(await screen.findByLabelText('Source')).toHaveValue('FADE IN:');
    expect(await screen.findByText('recovery-v3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recover' }));
    expect(screen.getByLabelText('Source')).toHaveValue('DURABLE OFFLINE EDIT');
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('does not overwrite a newer server version until recovery is explicitly chosen', async () => {
    const recoveryStore = new TestRecoveryStore();
    recoveryStore.records.set(
      'user-id:script-id',
      await createScreenplayRecoverySnapshot({
        accountId: 'user-id',
        screenplayId: 'script-id',
        baseServerVersion: 3,
        sourceText: 'OLDER LOCAL RECOVERY',
        paperSize: 'a4',
        updatedAt: Date.now(),
      }),
    );
    const newer = { ...screenplay, sourceText: 'NEWER SERVER DRAFT', version: 9 };
    renderHarness(undefined, { recoveryStore, value: newer });

    expect(await screen.findByLabelText('Source')).toHaveValue('NEWER SERVER DRAFT');
    expect(await screen.findByText('recovery-v3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recover' }));
    expect(screen.getByLabelText('Source')).toHaveValue('OLDER LOCAL RECOVERY');
  });

  it('keeps the in-memory draft downloadable when recovery storage rejects writes', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const recoveryStore = new TestRecoveryStore();
    recoveryStore.failSave = true;
    const onDownload = vi.fn();
    renderHarness(undefined, { onDownload, recoveryStore });
    fireEvent.change(await screen.findByLabelText('Source'), {
      target: { value: 'QUOTA-SAFE DRAFT' },
    });
    fireEvent(window, new Event('pagehide'));

    expect(await screen.findByText(/Browser recovery is unavailable/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download recovery' }));
    expect(onDownload).toHaveBeenCalledWith('QUOTA-SAFE DRAFT');
  });

  it('isolates recovery records by account as well as screenplay', async () => {
    const recoveryStore = new TestRecoveryStore();
    recoveryStore.records.set(
      'other-user:script-id',
      await createScreenplayRecoverySnapshot({
        accountId: 'other-user',
        screenplayId: 'script-id',
        baseServerVersion: 3,
        sourceText: 'OTHER ACCOUNT DRAFT',
        paperSize: 'letter',
      }),
    );
    renderHarness(undefined, { recoveryStore });
    await waitFor(() => expect(recoveryStore.reads).toContain('user-id:script-id'));

    expect(screen.queryByLabelText('Recovery draft')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Source')).toHaveValue('FADE IN:');
    expect(recoveryStore.records.get('other-user:script-id')?.sourceText).toBe(
      'OTHER ACCOUNT DRAFT',
    );
  });
});
