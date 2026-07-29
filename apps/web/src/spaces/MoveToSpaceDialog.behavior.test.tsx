// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveToSpaceDialog } from './MoveToSpaceDialog';

function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(status < 400 ? { data } : data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const spaces = [
  {
    id: 'source',
    name: 'Source Space',
    currentMembership: {
      id: 'source-member',
      roleId: 'source-role',
      role: { permissions: [{ permission: 'move_resources' }] },
    },
    resourceCounts: { breakdown: 1, screenplay: 0 },
  },
  {
    id: 'target',
    name: 'Production',
    currentMembership: {
      id: 'target-member',
      roleId: 'target-role',
      role: { permissions: [{ permission: 'move_resources' }] },
    },
    resourceCounts: { breakdown: 0, screenplay: 0 },
  },
  {
    id: 'read-only',
    name: 'Read only',
    currentMembership: {
      id: 'reader',
      roleId: 'reader-role',
      role: { permissions: [{ permission: 'read_space' }] },
    },
    resourceCounts: { breakdown: 0, screenplay: 0 },
  },
];

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MoveToSpaceDialog
        resourceType="breakdown"
        resourceId="breakdown-1"
        resourceName="Night shoot"
        sourceSpaceId="source"
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return onClose;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MoveToSpaceDialog', () => {
  it('shows the preflight and direct-membership note before commit, with only eligible targets', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/spaces') return response(spaces);
      if (path.includes('move-preflight')) {
        return response({
          gainsAccess: ['new-collaborator'],
          losesAccess: ['former-collaborator'],
        });
      }
      if (path === '/api/v1/spaces/source/resources/move' && init?.method === 'POST') {
        return response({ resourceId: 'breakdown-1' });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = renderDialog();

    expect(await screen.findByText('new-collaborator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Destination Space' })).toHaveTextContent(
      'Production',
    );
    expect(screen.queryByText('Read only')).not.toBeInTheDocument();
    expect(screen.getByText('former-collaborator')).toBeInTheDocument();
    expect(screen.getByText(/direct membership.*unaffected/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Move to Space' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/spaces/source/resources/move',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('explains a source-side refusal instead of surfacing a bare error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = input instanceof Request ? input.url : input.toString();
        if (path === '/api/v1/spaces') return response(spaces);
        return response({ title: 'Forbidden', detail: 'Missing permission', status: 403 }, 403);
      }),
    );
    renderDialog();

    await screen.findByRole('button', { name: 'Destination Space' });
    expect(
      await screen.findByText(/permission in both the source and destination Spaces/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to Space' })).toBeDisabled();
  });
});
