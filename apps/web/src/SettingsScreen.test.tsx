// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsScreen } from './SettingsScreen';

/**
 * Every route that used to be a flat rail row before #163. The list — and the expected heading and
 * sub-nav group each one resolves to — is lifted directly from the pre-#163 rail declarations
 * (`git show` on `nav-model.ts`), so this is a literal regression guard: if any of these stops
 * resolving to the same page, this test fails.
 */
const PRESERVED_ROUTES: readonly {
  route: string;
  heading: string;
  group: 'account' | 'administration' | 'instance-settings';
  requiresAdministrator?: boolean;
  /** The sub-nav item's own label, when it differs from the page heading (the rail's "Instance"
   * row has always headed the "Overview" page — unchanged by #163). Defaults to `heading`. */
  sidebarLabel?: string;
}[] = [
  { route: '/account', heading: 'Profile', group: 'account' },
  { route: '/account/preferences', heading: 'Preferences', group: 'account' },
  { route: '/account/security', heading: 'Security', group: 'account' },
  { route: '/account/sessions', heading: 'Sessions', group: 'account' },
  { route: '/account/developer', heading: 'Developer', group: 'account' },
  {
    route: '/admin',
    heading: 'Overview',
    group: 'administration',
    requiresAdministrator: true,
    sidebarLabel: 'Instance',
  },
  {
    route: '/admin/projects',
    heading: 'Breakdowns',
    group: 'administration',
    requiresAdministrator: true,
  },
  { route: '/admin/users', heading: 'Users', group: 'administration', requiresAdministrator: true },
  {
    route: '/admin/storage',
    heading: 'Storage',
    group: 'administration',
    requiresAdministrator: true,
  },
  { route: '/admin/jobs', heading: 'Jobs', group: 'administration', requiresAdministrator: true },
  { route: '/admin/audit', heading: 'Audit', group: 'administration', requiresAdministrator: true },
  {
    route: '/admin/invitations',
    heading: 'Invitations',
    group: 'administration',
    requiresAdministrator: true,
  },
  {
    route: '/admin/settings',
    heading: 'General',
    group: 'instance-settings',
    requiresAdministrator: true,
  },
  {
    route: '/admin/settings/storage',
    heading: 'Storage',
    group: 'instance-settings',
    requiresAdministrator: true,
  },
  {
    route: '/admin/settings/backups',
    heading: 'Backups',
    group: 'instance-settings',
    requiresAdministrator: true,
  },
  {
    route: '/admin/settings/updates',
    heading: 'Updates',
    group: 'instance-settings',
    requiresAdministrator: true,
  },
  {
    route: '/admin/settings/doctor',
    heading: 'Doctor',
    group: 'instance-settings',
    requiresAdministrator: true,
  },
];

function renderAt(route: string, isAdministrator = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsScreen route={route} isAdministrator={isAdministrator} onNavigate={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Route resolution and the panel-frame heading render synchronously from props; no fixture is
  // needed for any query the mounted page issues once past that (mirrors AdminScreen.test.tsx).
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsScreen route preservation', () => {
  for (const { route, heading, group, sidebarLabel } of PRESERVED_ROUTES) {
    it(`resolves ${route} to its pre-#163 page, in the ${group} sub-nav group`, () => {
      renderAt(route);

      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();

      const sidebar = screen.getByRole('navigation', { name: 'Settings pages' });
      const current = within(sidebar).getByRole('button', { current: 'page' });
      expect(current).toHaveTextContent(sidebarLabel ?? heading);
      expect(current.closest(`[data-settings-group="${group}"]`)).not.toBeNull();

      // Exactly one sub-nav entry is current — the two "Storage" pages (Administration's usage
      // page and Instance Settings' backend config) must never both light up just because they
      // share a label now that the `Settings:` prefix is gone.
      expect(within(sidebar).getAllByRole('button', { current: 'page' })).toHaveLength(1);
    });
  }

  it('hides Administration and Instance Settings from a non-administrator', () => {
    renderAt('/account', false);
    const sidebar = screen.getByRole('navigation', { name: 'Settings pages' });
    expect(within(sidebar).queryByText('Administration')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('Instance Settings')).not.toBeInTheDocument();
    expect(within(sidebar).getByText('Account')).toBeInTheDocument();
  });

  it('renders the unavailable notice for a non-administrator on an admin-only route, without losing the Account sub-nav', () => {
    renderAt('/admin/users', false);
    expect(screen.getByRole('heading', { name: 'Instance management is unavailable.' })).toBeVisible();
    const sidebar = screen.getByRole('navigation', { name: 'Settings pages' });
    expect(within(sidebar).getByText('Account')).toBeInTheDocument();
  });

  for (const { route, heading, requiresAdministrator } of PRESERVED_ROUTES) {
    if (!requiresAdministrator) continue;
    it(`still gates ${route} behind the instance administrator`, () => {
      renderAt(route, false);
      expect(screen.queryByRole('heading', { level: 1, name: heading })).not.toBeInTheDocument();
    });
  }
});
