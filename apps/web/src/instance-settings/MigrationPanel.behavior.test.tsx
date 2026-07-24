// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageMigrationStatus } from '@coda/contracts';
import { MigrationPanel } from './MigrationPanel';

const MIGRATION = '/api/v1/instance/storage-migration';

const base: StorageMigrationStatus = {
  phase: 'copying',
  target: { provider: 'minio', endpoint: 'http://minio2:9000', bucket: 'coda-two' },
  copiedObjects: 1,
  totalObjects: 3,
  copiedBytes: 512,
  totalBytes: 1536,
  verifiedObjects: 0,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  error: null,
  report: null,
  canCutover: false,
};

const verifiedClean: StorageMigrationStatus = {
  ...base,
  phase: 'verified',
  copiedObjects: 3,
  verifiedObjects: 3,
  canCutover: true,
  report: {
    generatedAt: new Date().toISOString(),
    totalObjects: 3,
    verifiedObjects: 3,
    totalBytes: 1536,
    mismatches: [],
  },
};

const verifiedDirty: StorageMigrationStatus = {
  ...verifiedClean,
  canCutover: false,
  report: {
    generatedAt: new Date().toISOString(),
    totalObjects: 3,
    verifiedObjects: 3,
    totalBytes: 1536,
    mismatches: [
      { objectKey: 'project/key-1', kind: 'checksum', detail: 'Checksum differs from source' },
    ],
  },
};

type Handler = () => { ok?: boolean; body: unknown };

function installFetch(routes: Record<string, Handler>) {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url}`;
    const handler = routes[key];
    if (!handler) return Promise.reject(new Error(`unexpected ${key}`));
    const { ok = true, body } = handler();
    return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  return mock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MigrationPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows copy progress and the target', () => {
    installFetch({ [`GET ${MIGRATION}`]: () => ({ body: { data: base } }) });
    render(<MigrationPanel initialStatus={base} onFinished={vi.fn()} />);
    expect(screen.getByText('Copying objects to the target')).toBeInTheDocument();
    expect(screen.getByText('coda-two')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByText(/1 of 3 objects copied/)).toBeInTheDocument();
  });

  it('polls until verification completes and enables cutover', async () => {
    installFetch({ [`GET ${MIGRATION}`]: () => ({ body: { data: verifiedClean } }) });
    render(<MigrationPanel initialStatus={base} onFinished={vi.fn()} />);
    expect(
      await screen.findByText(
        /Every referenced object matched by count, size, and checksum/,
        undefined,
        {
          timeout: 3_000,
        },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm cutover' })).toBeEnabled();
  });

  it('confirms cutover and notifies the parent', async () => {
    const onFinished = vi.fn();
    installFetch({
      [`GET ${MIGRATION}`]: () => ({ body: { data: verifiedClean } }),
      [`POST ${MIGRATION}/cutover`]: () => ({
        body: { data: { ...verifiedClean, phase: 'cutover' } },
      }),
    });
    render(<MigrationPanel initialStatus={verifiedClean} onFinished={onFinished} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cutover' }));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(await screen.findByText(/The instance now reads and writes/)).toBeInTheDocument();
  });

  it('lists mismatches and blocks cutover', () => {
    installFetch({ [`GET ${MIGRATION}`]: () => ({ body: { data: verifiedDirty } }) });
    render(<MigrationPanel initialStatus={verifiedDirty} onFinished={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Confirm cutover' })).toBeDisabled();
    const list = screen.getByRole('list', { name: 'Verification mismatches' });
    expect(list).toHaveTextContent('project/key-1');
    expect(list).toHaveTextContent('checksum');
  });

  it('cancels a migration', async () => {
    const onFinished = vi.fn();
    installFetch({
      [`GET ${MIGRATION}`]: () => ({ body: { data: verifiedDirty } }),
      [`POST ${MIGRATION}/cancel`]: () => ({ body: { data: base } }),
    });
    render(<MigrationPanel initialStatus={verifiedDirty} onFinished={onFinished} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel migration' }));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
  });

  it('surfaces a failed migration and a cutover error', async () => {
    const failed: StorageMigrationStatus = { ...base, phase: 'failed', error: 'copy exploded' };
    installFetch({
      [`GET ${MIGRATION}`]: () => ({ body: { data: failed } }),
      [`POST ${MIGRATION}/cutover`]: () => ({
        ok: false,
        body: { title: 'Conflict', detail: 'not verified', status: 409 },
      }),
    });
    // A failed migration still exposes a (disabled) cutover button; force-enable is
    // impossible, so drive the error path through a verified-but-racing state.
    render(<MigrationPanel initialStatus={{ ...verifiedClean }} onFinished={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cutover' }));
    expect(await screen.findByText('not verified')).toBeInTheDocument();
  });

  it('renders a failure message for a failed phase', () => {
    const failed: StorageMigrationStatus = { ...base, phase: 'failed', error: 'copy exploded' };
    installFetch({ [`GET ${MIGRATION}`]: () => ({ body: { data: failed } }) });
    render(<MigrationPanel initialStatus={failed} onFinished={vi.fn()} />);
    expect(screen.getByText('copy exploded')).toBeInTheDocument();
    expect(screen.getByText('Migration failed')).toBeInTheDocument();
  });

  it('dismisses a completed cutover', () => {
    const onFinished = vi.fn();
    const done: StorageMigrationStatus = { ...verifiedClean, phase: 'cutover' };
    installFetch({ [`GET ${MIGRATION}`]: () => ({ body: { data: done } }) });
    render(<MigrationPanel initialStatus={done} onFinished={onFinished} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onFinished).toHaveBeenCalled();
  });
});
