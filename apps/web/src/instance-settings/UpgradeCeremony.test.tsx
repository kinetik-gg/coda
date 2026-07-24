// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpgradeCeremony } from './UpgradeCeremony';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  api: apiMock,
  ApiError: class MockApiError extends Error {
    constructor(readonly problem: { title: string; detail?: string }) {
      super(problem.detail ?? problem.title);
    }
  },
}));

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

function view(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'ready_to_backup',
    currentVersion: '1.2.3',
    target: {
      version: '1.3.0',
      image: 'ghcr.io/kinetik-gg/coda',
      digest: 'sha256:abc',
      taggedRef: 'ghcr.io/kinetik-gg/coda:1.3.0',
      digestRef: 'ghcr.io/kinetik-gg/coda@sha256:abc',
    },
    pendingBackup: null,
    redeployWebhookConfigured: false,
    coolify: { configured: false, baseUrl: null, applicationUuid: null },
    history: [],
    lastCoolifyError: null,
    ...overrides,
  };
}

const readyToDeploy = (overrides: Record<string, unknown> = {}) =>
  view({
    phase: 'ready_to_deploy',
    pendingBackup: {
      backupRef: 'backups/scheduled/fresh.codabackup',
      takenAt: '2026-07-01T00:00:00.000Z',
      toVersion: '1.3.0',
    },
    ...overrides,
  });

describe('UpgradeCeremony', () => {
  it('shows the encryption-key requirement and offers no backup action', async () => {
    apiMock.mockResolvedValueOnce(view({ phase: 'needs_encryption_key' }));
    render(<UpgradeCeremony />);

    expect(await screen.findByText(/Managed upgrades require/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back up and prepare/ })).not.toBeInTheDocument();
  });

  it('runs the backup gate and moves to the deploy step', async () => {
    apiMock.mockResolvedValueOnce(view());
    render(<UpgradeCeremony />);

    const backupButton = await screen.findByRole('button', { name: 'Back up and prepare upgrade' });
    apiMock.mockResolvedValueOnce(readyToDeploy());
    fireEvent.click(backupButton);

    expect(await screen.findByText(/Fresh backup captured/)).toBeInTheDocument();
    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/ceremony/backup', { method: 'POST' });
  });

  it('gates the generic redeploy behind the env-update confirmation', async () => {
    apiMock.mockResolvedValueOnce(readyToDeploy({ redeployWebhookConfigured: true }));
    render(<UpgradeCeremony />);

    const trigger = await screen.findByRole('button', { name: 'Trigger redeploy' });
    expect(trigger).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(trigger).toBeEnabled();

    apiMock.mockResolvedValueOnce(view({ phase: 'ready_to_backup' }));
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/ceremony/redeploy', {
        method: 'POST',
        body: JSON.stringify({ confirmedEnvUpdated: true }),
      }),
    );
  });

  it('shows the target image references for the generic tier when no webhook is set', async () => {
    apiMock.mockResolvedValueOnce(readyToDeploy());
    render(<UpgradeCeremony />);

    expect(await screen.findByText('ghcr.io/kinetik-gg/coda@sha256:abc')).toBeInTheDocument();
    expect(screen.getByText('ghcr.io/kinetik-gg/coda:1.3.0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trigger redeploy' })).not.toBeInTheDocument();
    expect(screen.getByText(/Configure a redeploy webhook below/)).toBeInTheDocument();
  });

  it('runs the Coolify one-click deploy and surfaces a fallback error', async () => {
    apiMock.mockResolvedValueOnce(
      readyToDeploy({
        coolify: { configured: true, baseUrl: 'https://c.example', applicationUuid: 'u' },
      }),
    );
    render(<UpgradeCeremony />);

    const deploy = await screen.findByRole('button', { name: 'Update CODA_IMAGE and deploy' });
    apiMock.mockResolvedValueOnce(
      readyToDeploy({
        coolify: { configured: true, baseUrl: 'https://c.example', applicationUuid: 'u' },
        lastCoolifyError: 'Coolify API returned 403',
      }),
    );
    fireEvent.click(deploy);

    expect(await screen.findByText(/Coolify failed: Coolify API returned 403/)).toBeInTheDocument();
    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/ceremony/coolify/deploy', {
      method: 'POST',
    });
  });

  it('saves a redeploy webhook', async () => {
    apiMock.mockResolvedValueOnce(view());
    render(<UpgradeCeremony />);
    await screen.findByRole('heading', { name: 'Deploy targets' });

    fireEvent.change(screen.getByPlaceholderText(/platform.example\/deploy/), {
      target: { value: 'https://platform.example/hook' },
    });
    apiMock.mockResolvedValueOnce(view({ redeployWebhookConfigured: true }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/ceremony/webhook', {
        method: 'PUT',
        body: JSON.stringify({ url: 'https://platform.example/hook' }),
      }),
    );
  });

  it('removes a configured redeploy webhook', async () => {
    apiMock.mockResolvedValueOnce(view({ redeployWebhookConfigured: true }));
    render(<UpgradeCeremony />);
    await screen.findByRole('heading', { name: 'Deploy targets' });

    apiMock.mockResolvedValueOnce(view({ redeployWebhookConfigured: false }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);

    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/ceremony/webhook', {
        method: 'DELETE',
      }),
    );
  });

  it('saves the Coolify adapter with all three fields and clears the token input', async () => {
    apiMock.mockResolvedValueOnce(view());
    render(<UpgradeCeremony />);
    await screen.findByRole('heading', { name: 'Deploy targets' });

    fireEvent.change(screen.getByPlaceholderText('https://coolify.example'), {
      target: { value: 'https://coolify.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('Application UUID'), {
      target: { value: 'app-uuid-1234' },
    });
    fireEvent.change(screen.getByPlaceholderText('API token'), {
      target: { value: 'fixture-token-not-a-secret' },
    });
    apiMock.mockResolvedValueOnce(
      view({
        coolify: {
          configured: true,
          baseUrl: 'https://coolify.example',
          applicationUuid: 'app-uuid-1234',
        },
      }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]!);

    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/ceremony/coolify', {
        method: 'PUT',
        body: JSON.stringify({
          baseUrl: 'https://coolify.example',
          apiToken: 'fixture-token-not-a-secret',
          applicationUuid: 'app-uuid-1234',
        }),
      }),
    );
  });

  it('clears the Coolify adapter', async () => {
    apiMock.mockResolvedValueOnce(
      view({ coolify: { configured: true, baseUrl: 'https://c.example', applicationUuid: 'u' } }),
    );
    render(<UpgradeCeremony />);
    await screen.findByRole('heading', { name: 'Deploy targets' });

    apiMock.mockResolvedValueOnce(view());
    // The Coolify block's Remove button is the last one on the page.
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[removeButtons.length - 1]!);

    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/ceremony/coolify', {
        method: 'DELETE',
      }),
    );
  });

  it('copies the digest-pinned image reference to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    apiMock.mockResolvedValueOnce(readyToDeploy());
    render(<UpgradeCeremony />);

    const copyButtons = await screen.findAllByRole('button', { name: /Copy/ });
    fireEvent.click(copyButtons[0]!);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('ghcr.io/kinetik-gg/coda@sha256:abc'),
    );
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('surfaces an action error inline without losing the panel', async () => {
    apiMock.mockResolvedValueOnce(view());
    render(<UpgradeCeremony />);
    const backupButton = await screen.findByRole('button', { name: 'Back up and prepare upgrade' });

    apiMock.mockRejectedValueOnce(new Error('backup engine unavailable'));
    fireEvent.click(backupButton);

    expect(await screen.findByText('backup engine unavailable')).toBeInTheDocument();
  });

  it('renders the upgrade history with outcomes and backup references', async () => {
    apiMock.mockResolvedValueOnce(
      view({
        history: [
          {
            id: 'h1',
            tier: 'coolify',
            fromVersion: '1.2.3',
            toVersion: '1.3.0',
            backupRef: 'backups/scheduled/fresh.codabackup',
            outcome: 'SUCCESS',
            at: '2026-07-01T00:00:00.000Z',
            error: null,
          },
        ],
      }),
    );
    render(<UpgradeCeremony />);

    expect(await screen.findByText('SUCCESS')).toBeInTheDocument();
    expect(screen.getByText(/backups\/scheduled\/fresh.codabackup/)).toBeInTheDocument();
  });

  it('renders a load failure with a working retry', async () => {
    apiMock.mockRejectedValueOnce(new Error('forbidden'));
    apiMock.mockResolvedValueOnce(view());
    render(<UpgradeCeremony />);

    expect(await screen.findByRole('alert')).toHaveTextContent('forbidden');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Deploy targets' })).toBeInTheDocument();
  });
});
