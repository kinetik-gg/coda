// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceSettingsDialog } from './SpaceSettingsDialog';

const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';

function problemResponse(status: number, detail: string): Response {
  return new Response(JSON.stringify({ status, title: 'Request failed', detail }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

function renderDialog(spaceId = DEFAULT_SPACE_ID) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SpaceSettingsDialog spaceId={spaceId} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('SpaceSettingsDialog failure reporting', () => {
  // The maintainer saw an authorization outcome dressed as a connectivity problem, with a Retry
  // button that could only ever produce the same refusal (#334).
  it('states an authorization refusal and offers no pointless Retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      problemResponse(403, 'The Default Space is administered by the instance administrator'),
    );

    renderDialog();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have permission to open settings for this Space.',
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/service connection/i)).not.toBeInTheDocument();
  });

  it('says a missing Space is missing, not unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(problemResponse(404, 'Space not found'));

    renderDialog('space-that-went-away');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This Space no longer exists, or it is not shared with you.',
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('keeps Retry for a failure that really might be the connection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    renderDialog();

    expect(await screen.findByRole('alert')).toHaveTextContent('Check your service connection');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('opens the settings sections once management resolves', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: DEFAULT_SPACE_ID,
            name: 'Default',
            description: null,
            ownerUserId: null,
            isDefault: true,
            version: 1,
            roles: [],
            memberships: [],
            invitations: [],
            // The membership-less Default Space administrator: authority, no row.
            currentMembership: {
              id: null,
              roleId: 'default-owner-role',
              permissions: ['manage_space_settings'],
            },
            _count: { resources: 0 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderDialog();

    expect(await screen.findByRole('heading', { name: 'Details' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
