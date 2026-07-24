// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledBackupView } from '@coda/contracts';
import { ScheduledBackupsPanel } from './ScheduledBackupsPanel';

const PATH = '/api/v1/instance/scheduled-backups';

const baseView: ScheduledBackupView = {
  settings: {
    enabled: false,
    intervalHours: 24,
    retention: { keepLast: 7, dailyForDays: 0, weeklyForWeeks: 0, maxAgeDays: 0 },
  },
  destination: {
    source: 'active',
    provider: 'minio',
    endpoint: 'http://minio:9000',
    bucket: 'coda',
    prefix: 'backups/scheduled/',
    forcePathStyle: true,
  },
  status: {
    enabled: false,
    lastRunAt: null,
    lastOutcome: null,
    lastError: null,
    nextDueAt: null,
    runCount: 0,
    failureCount: 0,
  },
  verificationKeyFingerprint: null,
  history: [],
};

const overrideView: ScheduledBackupView = {
  ...baseView,
  settings: { ...baseView.settings, enabled: true },
  destination: {
    source: 'override',
    provider: 'minio',
    endpoint: 'http://backup-minio:9000',
    bucket: 'dedicated-backup',
    prefix: 'backups/scheduled/',
    forcePathStyle: true,
  },
  status: { ...baseView.status, enabled: true },
};

type Handler = (init: RequestInit | undefined) => { ok?: boolean; body: unknown };

function installFetch(routes: Record<string, Handler>) {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = routes[`${method} ${url}`];
    if (!handler) return Promise.reject(new Error(`unexpected ${method} ${url}`));
    const { ok = true, body } = handler(init);
    return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  return mock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ScheduledBackupsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the current schedule, destination and status', async () => {
    installFetch({ [`GET ${PATH}`]: () => ({ body: { data: baseView } }) });
    render(<ScheduledBackupsPanel />);

    expect(await screen.findByText('Active storage')).toBeInTheDocument();
    expect(screen.getByLabelText('Interval (hours)')).toHaveValue(24);
    expect(screen.getByLabelText('Keep last (N)')).toHaveValue(7);
    expect(screen.getByText('No scheduled backups have run yet.')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    installFetch({
      [`GET ${PATH}`]: () => ({
        ok: false,
        body: { title: 'Forbidden', detail: 'nope', status: 403 },
      }),
    });
    render(<ScheduledBackupsPanel />);
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });

  it('saves an edited schedule', async () => {
    const mock = installFetch({
      [`GET ${PATH}`]: () => ({ body: { data: baseView } }),
      [`PUT ${PATH}/settings`]: () => ({
        body: { data: { ...baseView, settings: { ...baseView.settings, enabled: true } } },
      }),
    });
    render(<ScheduledBackupsPanel />);
    await screen.findByText('Active storage');

    fireEvent.click(screen.getByLabelText('Run scheduled backups'));
    fireEvent.change(screen.getByLabelText('Keep last (N)'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(await screen.findByText('Schedule and retention saved.')).toBeInTheDocument();
    const call = mock.mock.calls.find(
      ([url, init]) => url === `${PATH}/settings` && init?.method === 'PUT',
    );
    expect(call).toBeDefined();
    expect(JSON.parse((call![1] as RequestInit).body as string)).toMatchObject({
      enabled: true,
      retention: { keepLast: 14 },
    });
  });

  it('runs a backup on demand and reports the outcome', async () => {
    installFetch({
      [`GET ${PATH}`]: () => ({ body: { data: baseView } }),
      [`POST ${PATH}/run`]: () => ({
        body: {
          data: {
            outcome: 'SUCCESS',
            entry: { archiveKey: 'backups/scheduled/x.codabackup' },
          },
        },
      }),
    });
    render(<ScheduledBackupsPanel />);
    await screen.findByText('Active storage');

    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(
      await screen.findByText('Backup written (backups/scheduled/x.codabackup).'),
    ).toBeInTheDocument();
  });

  it('validates and saves a dedicated destination override', async () => {
    installFetch({
      [`GET ${PATH}`]: () => ({ body: { data: baseView } }),
      [`POST ${PATH}/destination/validate`]: () => ({
        body: { data: { ok: true, checks: [{ name: 'write', ok: true, detail: 'wrote it' }] } },
      }),
      [`PUT ${PATH}/destination`]: () => ({
        body: {
          data: {
            status: 'applied',
            probe: { ok: true, checks: [] },
            view: overrideView,
          },
        },
      }),
    });
    render(<ScheduledBackupsPanel />);
    await screen.findByText('Active storage');

    fireEvent.click(screen.getByRole('button', { name: 'Use a dedicated destination' }));
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'dedicated-backup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    const results = await screen.findByRole('list', { name: 'Validation results' });
    expect(within(results).getByText('wrote it')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save destination' }));
    expect(
      await screen.findByText('Dedicated destination validated and saved.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Dedicated destination')).toBeInTheDocument();
  });

  it('clears a dedicated destination override', async () => {
    const mock = installFetch({
      [`GET ${PATH}`]: () => ({ body: { data: overrideView } }),
      [`DELETE ${PATH}/destination`]: () => ({ body: { data: baseView } }),
    });
    render(<ScheduledBackupsPanel />);
    await screen.findByText('Dedicated destination');

    fireEvent.click(screen.getByRole('button', { name: 'Revert to active storage' }));
    expect(await screen.findByText('Reverted to the active storage backend.')).toBeInTheDocument();
    expect(mock).toHaveBeenCalledWith(
      `${PATH}/destination`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('renders run history when present', async () => {
    const withHistory: ScheduledBackupView = {
      ...baseView,
      history: [
        {
          id: 'h1',
          reason: 'scheduled',
          startedAt: '2026-07-24T00:00:00.000Z',
          finishedAt: '2026-07-24T00:01:00.000Z',
          outcome: 'SUCCESS',
          archiveKey: 'backups/scheduled/x.codabackup',
          sizeBytes: 1234,
          prunedCount: 2,
          error: null,
        },
      ],
    };
    installFetch({ [`GET ${PATH}`]: () => ({ body: { data: withHistory } }) });
    render(<ScheduledBackupsPanel />);

    expect(await screen.findByText('Recent runs')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
  });
});
