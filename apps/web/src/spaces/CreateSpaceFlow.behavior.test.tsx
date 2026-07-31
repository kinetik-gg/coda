// @vitest-environment jsdom

/**
 * The Spaces feature has to be reachable from the shipped UI, not merely implemented (#335).
 *
 * Every instance boots with a single seeded Default Space that holds no memberships, and before
 * this flow existed the web client offered no way to make another one — so roles, invitations, and
 * resource moves shipped behind a door with no handle. Unit tests on the individual dialogs all
 * passed while that was true, which is exactly why this test drives the whole path through the real
 * `DashboardShell`: open the sidebar's Space switcher, create a Space, land in it, open its
 * settings from the switcher's gear, and send an invitation.
 */

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardShell } from '../app-shell/DashboardShell';
import { HostWindowCapabilitiesProvider } from '../app-shell/host-window-capabilities';
import type { ManagedSpace, SpaceRole } from './space-settings-model';

interface SpaceRow {
  id: string;
  name: string;
}

const ownerRole: SpaceRole = {
  id: 'owner-role',
  name: 'Owner',
  description: null,
  isOwner: true,
  version: 1,
  resourceTier: 'manager',
  permissions: [{ permission: 'invite_members' }],
  _count: { memberships: 1 },
};

const contributorRole: SpaceRole = {
  ...ownerRole,
  id: 'contributor-role',
  name: 'Contributor',
  isOwner: false,
  resourceTier: 'contributor',
  permissions: [{ permission: 'read_space' }],
  _count: { memberships: 0 },
};

function managementPayload(space: SpaceRow): ManagedSpace {
  return {
    id: space.id,
    name: space.name,
    description: null,
    ownerUserId: 'me',
    isDefault: false,
    version: 1,
    roles: [ownerRole, contributorRole],
    memberships: [
      {
        id: 'my-membership',
        version: 1,
        user: { id: 'me', displayName: 'Me', email: 'me@example.com' },
        role: ownerRole,
      },
    ],
    invitations: [],
    // The API enrols the creator as owner in the same transaction that provisions the Space, so
    // settings open for the person who just made it — unlike the memberless Default Space.
    currentMembership: {
      id: 'my-membership',
      roleId: ownerRole.id,
      permissions: ['invite_members'],
    },
    _count: { resources: 0 },
  };
}

function envelope(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

interface FakeApi {
  fetch: ReturnType<typeof vi.fn>;
  spaces: SpaceRow[];
  created: unknown[];
  invitations: unknown[];
}

function stubApi(): FakeApi {
  const state: FakeApi = {
    fetch: vi.fn(),
    spaces: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Default' }],
    created: [],
    invitations: [],
  };
  state.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const path = (input instanceof Request ? input.url : input.toString()).split('?')[0]!;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body: Record<string, unknown> =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (path === '/api/v1/spaces' && method === 'POST') {
      state.created.push(body);
      const space = { id: '11111111-1111-4111-8111-111111111111', name: String(body.name) };
      state.spaces = [...state.spaces, space];
      return envelope(space);
    }
    if (path === '/api/v1/spaces') return envelope(state.spaces);
    if (path === '/api/v1/instance/doctor') return envelope({ rows: [{ status: 'ok' }] });
    if (path === '/api/v1/instance/management') return envelope({ counts: { storageBytes: 0 } });
    const management = /^\/api\/v1\/spaces\/([^/]+)\/management$/u.exec(path);
    if (management) {
      const space = state.spaces.find((entry) => entry.id === management[1]);
      return space
        ? envelope(managementPayload(space))
        : Promise.resolve(new Response('{}', { status: 404 }));
    }
    const invitation = /^\/api\/v1\/spaces\/([^/]+)\/invitations$/u.exec(path);
    if (invitation && method === 'POST') {
      state.invitations.push({ spaceId: invitation[1], ...body });
      return envelope({ invitationUrl: '/accept-invitation?token=t' });
    }
    return envelope([]);
  });
  vi.stubGlobal('fetch', state.fetch);
  return state;
}

function Harness() {
  const [route, setRoute] = useState('/breakdowns');
  return (
    <HostWindowCapabilitiesProvider>
      <DashboardShell
        route={route}
        isAdministrator
        theme="coda-dark"
        isFullscreen={false}
        onNavigate={setRoute}
        chooseTheme={vi.fn()}
        toggleFullscreen={vi.fn()}
        logout={vi.fn()}
        onOpenProject={vi.fn()}
        onCreateProject={vi.fn()}
        onOpenScreenplay={vi.fn()}
      />
    </HostWindowCapabilitiesProvider>
  );
}

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('creating a Space from the switcher', () => {
  it('creates it, switches to it, then opens its settings and invites a member', async () => {
    const api = stubApi();
    renderApp();

    // The switcher is the only create affordance, so the flow starts by opening it.
    const trigger = await screen.findByRole('button', { name: 'Default' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create Space' }));

    const dialog = await screen.findByRole('dialog', { name: 'Create Space' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: '  Second Unit  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Space' }));

    await waitFor(() => expect(api.created).toEqual([{ name: 'Second Unit' }]));
    // The new Space becomes the active scope, so the rail names it and the gear manages it.
    expect(await screen.findByRole('button', { name: 'Second Unit' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Manage Second Unit Space' }));
    const settings = await screen.findByRole('dialog', { name: 'Second Unit' });

    fireEvent.click(within(settings).getByRole('button', { name: 'Invitations' }));
    fireEvent.change(within(settings).getByRole('textbox'), {
      target: { value: 'crew@example.com' },
    });
    fireEvent.click(within(settings).getByRole('button', { name: 'Create invitation' }));

    await waitFor(() =>
      expect(api.invitations).toEqual([
        {
          spaceId: '11111111-1111-4111-8111-111111111111',
          email: 'crew@example.com',
          roleId: 'contributor-role',
        },
      ]),
    );
  });
});
