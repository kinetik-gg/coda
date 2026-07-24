// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdatesSection } from './UpdatesSection';

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

const basePolling = {
  envDefaultHours: 24,
  overrideHours: null,
  effectiveHours: 24,
  source: 'env' as const,
};

function status(overrides: Record<string, unknown> = {}) {
  return {
    current: '1.2.3',
    latest: null,
    updateAvailable: false,
    comparison: 'unknown',
    notesUrl: null,
    lastCheckedAt: null,
    lastSucceededAt: null,
    lastError: null,
    polling: basePolling,
    dismissedVersion: null,
    ...overrides,
  };
}

describe('UpdatesSection', () => {
  it('shows a loading state and then the running/latest version, last-checked time, and notes link', async () => {
    apiMock.mockResolvedValueOnce(
      status({
        latest: '1.2.3',
        comparison: 'current',
        notesUrl: 'https://github.com/kinetik-gg/coda/releases/tag/v1.2.3',
        lastCheckedAt: '2026-07-01T00:00:00.000Z',
      }),
    );
    render(<UpdatesSection />);

    expect(screen.getByText('Loading update status…')).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Version' });
    expect(screen.getAllByText((_, element) => element?.textContent === 'v1.2.3').length).toBe(2);
    expect(
      screen.getByText(new Date('2026-07-01T00:00:00.000Z').toLocaleString()),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/kinetik-gg/coda/releases/tag/v1.2.3',
    );
    expect(apiMock).toHaveBeenCalledWith('/api/v1/updates/status');
  });

  it('shows an honest "checks disabled" state when the effective interval is zero', async () => {
    apiMock.mockResolvedValueOnce(
      status({
        polling: { ...basePolling, overrideHours: 0, effectiveHours: 0, source: 'config' },
      }),
    );
    render(<UpdatesSection />);

    expect(
      await screen.findByText('Automatic checks are disabled.', { exact: false }),
    ).toBeInTheDocument();
  });

  it('renders a load failure with a working retry', async () => {
    apiMock.mockRejectedValueOnce(new Error('network down'));
    apiMock.mockResolvedValueOnce(status());
    render(<UpdatesSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Version' })).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  describe('update banner', () => {
    it('shows the banner when an update is available and not yet dismissed, and hides it after dismissal', async () => {
      apiMock.mockResolvedValueOnce(
        status({
          latest: '1.3.0',
          updateAvailable: true,
          comparison: 'behind',
          notesUrl: 'https://github.com/kinetik-gg/coda/releases/tag/v1.3.0',
        }),
      );
      render(<UpdatesSection />);

      expect(await screen.findByText('Version 1.3.0 is available.')).toBeInTheDocument();

      apiMock.mockResolvedValueOnce(
        status({
          latest: '1.3.0',
          updateAvailable: true,
          comparison: 'behind',
          dismissedVersion: '1.3.0',
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: /Dismiss the update notice/ }));

      await waitFor(() =>
        expect(screen.queryByText('Version 1.3.0 is available.')).not.toBeInTheDocument(),
      );
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/dismiss', {
        method: 'POST',
        body: JSON.stringify({ version: '1.3.0' }),
      });
    });

    it('does not show the banner once the available version matches the stored dismissal', async () => {
      apiMock.mockResolvedValueOnce(
        status({
          latest: '1.3.0',
          updateAvailable: true,
          comparison: 'behind',
          dismissedVersion: '1.3.0',
        }),
      );
      render(<UpdatesSection />);

      await screen.findByRole('heading', { name: 'Version' });
      expect(screen.queryByText('Version 1.3.0 is available.')).not.toBeInTheDocument();
    });

    it('re-shows the banner for a newer release even if an older version was dismissed', async () => {
      apiMock.mockResolvedValueOnce(
        status({
          latest: '1.4.0',
          updateAvailable: true,
          comparison: 'behind',
          dismissedVersion: '1.3.0',
        }),
      );
      render(<UpdatesSection />);

      expect(await screen.findByText('Version 1.4.0 is available.')).toBeInTheDocument();
    });
  });

  describe('check for updates', () => {
    it('shows an up-to-date result on success with no update', async () => {
      apiMock.mockResolvedValueOnce(status());
      render(<UpdatesSection />);
      await screen.findByRole('heading', { name: 'Version' });

      apiMock.mockResolvedValueOnce(status({ comparison: 'current' }));
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

      expect(await screen.findByText("You're running the latest version.")).toBeInTheDocument();
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/check', { method: 'POST' });
    });

    it('shows an update-available result on success', async () => {
      apiMock.mockResolvedValueOnce(status());
      render(<UpdatesSection />);
      await screen.findByRole('heading', { name: 'Version' });

      apiMock.mockResolvedValueOnce(
        status({ latest: '1.5.0', updateAvailable: true, comparison: 'behind' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

      expect(await screen.findByText('Update available: v1.5.0')).toBeInTheDocument();
    });

    it('shows the failure reason when the checker reports a last error', async () => {
      apiMock.mockResolvedValueOnce(status());
      render(<UpdatesSection />);
      await screen.findByRole('heading', { name: 'Version' });

      apiMock.mockResolvedValueOnce(status({ lastError: 'getaddrinfo ENOTFOUND api.github.com' }));
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

      expect(
        await screen.findByText('Check failed: getaddrinfo ENOTFOUND api.github.com'),
      ).toBeInTheDocument();
    });

    it('shows a request failure inline when the check call itself rejects', async () => {
      apiMock.mockResolvedValueOnce(status());
      render(<UpdatesSection />);
      await screen.findByRole('heading', { name: 'Version' });

      apiMock.mockRejectedValueOnce(new Error('too many requests'));
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

      expect(await screen.findByText('too many requests')).toBeInTheDocument();
    });

    it('disables the button while a check is in flight', async () => {
      apiMock.mockResolvedValueOnce(status());
      render(<UpdatesSection />);
      await screen.findByRole('heading', { name: 'Version' });

      let resolveCheck!: (value: unknown) => void;
      apiMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveCheck = resolve;
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

      expect(await screen.findByRole('button', { name: 'Checking…' })).toBeDisabled();
      resolveCheck(status());
      expect(await screen.findByRole('button', { name: 'Check for updates' })).not.toBeDisabled();
    });
  });

  describe('polling preference', () => {
    it('persists a custom interval and reflects the new effective cadence', async () => {
      apiMock.mockResolvedValueOnce(status());
      render(<UpdatesSection />);
      await screen.findByRole('heading', { name: 'Version' });

      apiMock.mockResolvedValueOnce(
        status({
          polling: { ...basePolling, overrideHours: 6, effectiveHours: 6, source: 'config' },
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Automatic update check interval' }));
      fireEvent.click(screen.getByRole('option', { name: 'Every 6h' }));

      expect(
        await screen.findByText('Checks run roughly every 6 hours.', { exact: false }),
      ).toBeInTheDocument();
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/polling-preference', {
        method: 'PUT',
        body: JSON.stringify({ intervalHours: 6 }),
      });
    });

    it('persists "off" as an explicit zero-hour override', async () => {
      apiMock.mockResolvedValueOnce(status());
      render(<UpdatesSection />);
      await screen.findByRole('heading', { name: 'Version' });

      apiMock.mockResolvedValueOnce(
        status({
          polling: { ...basePolling, overrideHours: 0, effectiveHours: 0, source: 'config' },
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Automatic update check interval' }));
      fireEvent.click(screen.getByRole('option', { name: 'Off' }));

      expect(
        await screen.findByText('Automatic checks are disabled.', { exact: false }),
      ).toBeInTheDocument();
      expect(apiMock).toHaveBeenLastCalledWith('/api/v1/updates/polling-preference', {
        method: 'PUT',
        body: JSON.stringify({ intervalHours: 0 }),
      });
    });

    it('shows a field error inline when saving the preference fails', async () => {
      apiMock.mockResolvedValueOnce(status());
      render(<UpdatesSection />);
      await screen.findByRole('heading', { name: 'Version' });

      apiMock.mockRejectedValueOnce(new Error('forbidden'));
      fireEvent.click(screen.getByRole('button', { name: 'Automatic update check interval' }));
      fireEvent.click(screen.getByRole('option', { name: 'Off' }));

      expect(await screen.findByText('forbidden')).toBeInTheDocument();
    });
  });
});
