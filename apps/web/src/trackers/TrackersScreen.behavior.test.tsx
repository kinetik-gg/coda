// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allTrackerPermissions } from '@coda/contracts';
import { TrackersScreen, type TrackersScreenProps } from './TrackersScreen';

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/** A minimal `GET /trackers/:id/management` payload for the share-modal presentation tests. */
function managementPayload() {
  const iso = '2026-07-22T00:00:00.000Z';
  return {
    id: 'tracker-1',
    name: 'Old Ledger',
    description: null,
    ownerUserId: 'user',
    version: 1,
    createdAt: iso,
    updatedAt: iso,
    roles: [
      {
        id: 'owner-role',
        name: 'owner',
        isOwner: true,
        position: 0,
        version: 1,
        description: null,
        permissions: allTrackerPermissions.map((permission) => ({ permission })),
        _count: { memberships: 1 },
      },
      {
        id: 'viewer-role',
        name: 'viewer',
        isOwner: false,
        position: 1,
        version: 1,
        description: null,
        permissions: [{ permission: 'read_tracker' }],
        _count: { memberships: 0 },
      },
    ],
    memberships: [
      {
        id: 'm-owner',
        version: 1,
        createdAt: iso,
        role: { id: 'owner-role', name: 'owner', isOwner: true },
        user: {
          id: 'user',
          email: 'owner@example.test',
          displayName: 'Olwen Owner',
          status: 'ACTIVE',
        },
      },
    ],
    invitations: [],
    currentMembership: {
      id: 'm-owner',
      roleId: 'owner-role',
      permissions: [...allTrackerPermissions],
    },
  };
}

function trackerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tracker-1',
    ownerUserId: 'user',
    name: 'Old Ledger',
    description: null,
    version: 1,
    revision: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

function listResponse(...trackers: ReturnType<typeof trackerRow>[]) {
  return (input: RequestInfo | URL) => {
    const path = input instanceof Request ? input.url : input.toString();
    if (path === '/api/v1/trackers') return response(trackers);
    throw new Error(`Unexpected request ${path}`);
  };
}

function renderScreen(onOpen = vi.fn(), props: Partial<TrackersScreenProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onOpen,
    ...render(
      <QueryClientProvider client={client}>
        <TrackersScreen onOpen={onOpen} {...props} />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TrackersScreen', () => {
  it('creates a tracker from a required name and opens it', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/trackers' && !init?.method) return response([]);
      if (path === '/api/v1/trackers' && init?.method === 'POST') {
        return response(trackerRow({ id: 'new-tracker', name: 'Shot Log' }));
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onOpen } = renderScreen();
    await screen.findByText('No trackers yet');
    fireEvent.click(screen.getByRole('button', { name: 'New tracker' }));
    const createButton = screen.getByRole('button', { name: 'Create tracker' });
    expect(createButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Shot Log  ' } });
    fireEvent.click(createButton);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('new-tracker'));
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1];
    expect(JSON.parse(request?.body as string)).toEqual({ name: 'Shot Log' });
  });

  it('lists trackers and opens one by activation', async () => {
    vi.stubGlobal('fetch', vi.fn(listResponse(trackerRow({ name: 'Continuity Board' }))));
    const { onOpen } = renderScreen();
    fireEvent.doubleClick(await screen.findByRole('row', { name: 'Continuity Board' }));
    expect(onOpen).toHaveBeenCalledWith('tracker-1');
  });

  it('scopes the list to the active Space through the query parameter', async () => {
    const fetchMock = vi.fn(() => response([]));
    vi.stubGlobal('fetch', fetchMock);
    renderScreen(vi.fn(), { activeSpaceId: 'space-9' });
    await screen.findByText('No trackers yet');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trackers?spaceId=space-9',
        expect.any(Object),
      ),
    );
  });

  it('opens and renames a tracker from its row context menu', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/trackers/tracker-1' && init?.method === 'PATCH') {
        return response(trackerRow({ name: 'Dailies Ledger', version: 2 }));
      }
      if (!init?.method) return response([trackerRow()]);
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onOpen } = renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Old Ledger' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('tracker-1');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Old Ledger' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename…' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dailies Ledger' } });
    fireEvent.click(screen.getByRole('button', { name: /^Rename/u }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trackers/tracker-1',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1];
    expect(JSON.parse(request?.body as string)).toEqual({ name: 'Dailies Ledger', version: 1 });
  });

  it('confirms before moving a tracker to trash from its row context menu', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/trackers/trash-id' && init?.method === 'DELETE')
        return response({ ok: true });
      if (!init?.method) return response([trackerRow({ id: 'trash-id' })]);
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Old Ledger' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to trash' }));
    // Destructive actions are a confirmation, never a click-through.
    const confirmation = await screen.findByRole('dialog', { name: 'Move tracker to trash?' });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/trackers/trash-id',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('offers the failed read a way back', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('opens the share modal from the row menu through the share URL callback', async () => {
    vi.stubGlobal('fetch', vi.fn(listResponse(trackerRow())));
    const onShare = vi.fn();
    renderScreen(vi.fn(), { onShare });
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Old Ledger' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Share…' }));
    expect(onShare).toHaveBeenCalledWith('tracker-1');
  });

  it('presents the share modal over the library without tearing the list down', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/trackers' && !init?.method) return response([trackerRow()]);
      if (path.endsWith('/management')) return response(managementPayload());
      if (path.endsWith('/available-users')) return response([]);
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCloseShare = vi.fn();
    renderScreen(vi.fn(), { shareTrackerId: 'tracker-1', onCloseShare });

    // Both are up at once: the list keeps its rows underneath the route-presented modal.
    expect(await screen.findByRole('dialog', { name: 'Old Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Old Ledger' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseShare).toHaveBeenCalledTimes(1);
    // The library read ran exactly once: the modal presented over it without a remount.
    expect(
      fetchMock.mock.calls.filter(([path]) => (path as string) === '/api/v1/trackers'),
    ).toHaveLength(1);
  });
});
