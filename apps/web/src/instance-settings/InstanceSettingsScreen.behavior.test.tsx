// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceSettingsScreen } from './InstanceSettingsScreen';

beforeEach(() => {
  // The Doctor section fetches its report on mount; stub a pending request so
  // rendering it in these tests never issues a real network call.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

// UpdatesSection and DoctorSection fetch on mount through the shared API
// helper; stub it so this suite never touches the network. The doctor request
// stays pending (its "Running diagnostics…" state is asserted); every other
// call resolves with the updates status.
vi.mock('../api', () => ({
  api: vi.fn((path: string) => {
    if (typeof path === 'string' && path.includes('doctor')) return new Promise(() => undefined);
    if (typeof path === 'string' && path.includes('ceremony')) {
      return Promise.resolve({
        phase: 'unavailable',
        currentVersion: '1.0.0',
        target: null,
        pendingBackup: null,
        redeployWebhookConfigured: false,
        coolify: { configured: false, baseUrl: null, applicationUuid: null },
        history: [],
        lastCoolifyError: null,
      });
    }
    return Promise.resolve({
      current: '1.0.0',
      latest: null,
      updateAvailable: false,
      comparison: 'unknown',
      notesUrl: null,
      lastCheckedAt: null,
      lastSucceededAt: null,
      lastError: null,
      polling: { envDefaultHours: 24, overrideHours: null, effectiveHours: 24, source: 'env' },
      dismissedVersion: null,
    });
  }),
  ApiError: class MockApiError extends Error {},
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InstanceSettingsScreen', () => {
  it('rejects non-administrators with an owner-only guard and no section navigation', () => {
    render(<InstanceSettingsScreen isAdministrator={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Instance settings are unavailable.');
    // There is exactly one sidebar in the dashboard — the rail — never an
    // internal settings sidebar.
    expect(screen.queryByLabelText('Instance settings sections')).not.toBeInTheDocument();
  });

  it('has no internal sidebar; navigation is owned by the dashboard rail', () => {
    render(<InstanceSettingsScreen isAdministrator section="general" />);
    expect(screen.queryByLabelText('Instance settings sections')).not.toBeInTheDocument();
    // The section switch buttons that once lived in the internal sidebar are gone.
    expect(screen.queryByRole('button', { name: 'Storage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Doctor' })).not.toBeInTheDocument();
  });

  it('renders the section named by the route through a panel-frame header', async () => {
    const { rerender } = render(<InstanceSettingsScreen isAdministrator section="general" />);
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
    expect(await screen.findByText('General settings are coming soon.')).toBeInTheDocument();

    rerender(<InstanceSettingsScreen isAdministrator section="storage" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Object storage backend' }),
    ).toBeInTheDocument();

    rerender(<InstanceSettingsScreen isAdministrator section="backups" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Backups' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Download a backup' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Scheduled backups' }),
    ).toBeInTheDocument();

    rerender(<InstanceSettingsScreen isAdministrator section="updates" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Updates' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Version' })).toBeInTheDocument();

    rerender(<InstanceSettingsScreen isAdministrator section="doctor" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Doctor' })).toBeInTheDocument();
    expect(await screen.findByText('Running diagnostics…')).toBeInTheDocument();
  });

  it('defaults to the General section when no route section is given', async () => {
    render(<InstanceSettingsScreen isAdministrator />);
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
    expect(await screen.findByText('General settings are coming soon.')).toBeInTheDocument();
  });
});
