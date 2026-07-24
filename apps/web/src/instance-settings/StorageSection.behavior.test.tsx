// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageApplyResult, StorageConfigView, StorageProbeResult } from '@coda/contracts';
import { StorageSection } from './StorageSection';

const envView: StorageConfigView = {
  source: 'env',
  provider: null,
  endpoint: 'http://minio:9000',
  publicEndpoint: 'http://localhost:59000',
  region: 'us-east-1',
  bucket: 'coda',
  accessKeyId: 'env-access',
  forcePathStyle: true,
  existingObjectCount: 0,
  appOrigin: 'http://app.test',
};

const configView: StorageConfigView = {
  ...envView,
  source: 'config',
  provider: 'r2',
  bucket: 'coda-two',
  existingObjectCount: 2,
};

const passProbe: StorageProbeResult = {
  ok: true,
  checks: [
    { name: 'write', ok: true, detail: 'wrote' },
    { name: 'read', ok: true, detail: 'read' },
    { name: 'cors', ok: true, detail: 'allowed' },
  ],
};

const failProbe: StorageProbeResult = {
  ok: false,
  checks: [{ name: 'cors', ok: false, detail: 'origin not allowed' }],
};

type Handler = (init: RequestInit | undefined) => { ok?: boolean; body: unknown };

function installFetch(routes: Record<string, Handler>) {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const handler = routes[key];
    if (!handler) return Promise.reject(new Error(`unexpected ${key}`));
    const { ok = true, body } = handler(init);
    return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  return mock;
}

const CONFIG = '/api/v1/instance/storage-config';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StorageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the active configuration and shows environment provenance without a revert action', async () => {
    installFetch({ [`GET ${CONFIG}`]: () => ({ body: { data: envView } }) });
    render(<StorageSection />);
    expect(await screen.findByText('Environment')).toBeInTheDocument();
    expect(screen.getByLabelText('Bucket')).toHaveValue('coda');
    expect(
      screen.queryByRole('button', { name: 'Revert to environment configuration' }),
    ).not.toBeInTheDocument();
  });

  it('shows a revert action for a settings-sourced backend and reverts to the environment', async () => {
    const mock = installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: configView } }),
      [`POST ${CONFIG}/revert`]: () => ({ body: { data: envView } }),
    });
    render(<StorageSection />);
    const revert = await screen.findByRole('button', {
      name: 'Revert to environment configuration',
    });
    fireEvent.click(revert);
    expect(
      await screen.findByText('Reverted to the environment configuration.'),
    ).toBeInTheDocument();
    expect(mock).toHaveBeenCalledWith(
      `${CONFIG}/revert`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByText('Environment')).toBeInTheDocument();
  });

  it('applies a provider preset, adjusting region and path style', async () => {
    installFetch({ [`GET ${CONFIG}`]: () => ({ body: { data: envView } }) });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('radio', { name: 'Cloudflare R2' }));
    expect(screen.getByLabelText('Region')).toHaveValue('us-east-1');
    expect(screen.getByLabelText('Force path-style addressing')).not.toBeChecked();
  });

  it('runs the probe and renders per-check results', async () => {
    installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: envView } }),
      [`POST ${CONFIG}/validate`]: () => ({ body: { data: passProbe } }),
    });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    const results = await screen.findByRole('list', { name: 'Validation results' });
    expect(within(results).getByText('CORS (browser access)')).toBeInTheDocument();
    expect(within(results).getByText('allowed')).toBeInTheDocument();
  });

  it('surfaces a validation start failure', async () => {
    installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: envView } }),
      [`POST ${CONFIG}/validate`]: () => ({
        ok: false,
        body: { title: 'Forbidden', detail: 'not allowed', status: 403 },
      }),
    });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('not allowed')).toBeInTheDocument();
  });

  it('saves and hot-swaps on a clean apply', async () => {
    const mock = installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: envView } }),
      [`POST ${CONFIG}/apply`]: () => ({
        body: { data: { status: 'applied', probe: passProbe, config: configView } },
      }),
    });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    expect(
      await screen.findByText('Storage backend validated, saved, and hot-swapped.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Instance settings')).toBeInTheDocument();
    const applyCall = mock.mock.calls.find(([url]) => url === `${CONFIG}/apply`);
    expect(JSON.parse((applyCall?.[1] as RequestInit).body as string)).not.toHaveProperty(
      'existingObjects',
      expect.anything(),
    );
  });

  it('does not persist when the probe fails on apply', async () => {
    installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: envView } }),
      [`POST ${CONFIG}/apply`]: () => ({
        body: { data: { status: 'invalid', probe: failProbe } as StorageApplyResult },
      }),
    });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    expect(
      await screen.findByText('Validation failed. Fix the checks below and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByText('origin not allowed')).toBeInTheDocument();
  });

  it('gates cutover when live objects exist and confirms starting empty', async () => {
    const mock = installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: envView } }),
      [`POST ${CONFIG}/apply`]: (init) => {
        const payload = JSON.parse((init?.body as string) ?? '{}') as {
          existingObjects?: string;
        };
        if (payload.existingObjects === 'start_empty') {
          return { body: { data: { status: 'applied', probe: passProbe, config: configView } } };
        }
        return {
          body: { data: { status: 'needs_choice', probe: passProbe, existingObjectCount: 4 } },
        };
      },
    });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      '4 objects already exist in the current backend.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cutover' }));
    expect(
      await screen.findByText('Storage backend validated, saved, and hot-swapped.'),
    ).toBeInTheDocument();
    const cutover = mock.mock.calls
      .filter(([url]) => url === `${CONFIG}/apply`)
      .map(
        ([, init]) =>
          JSON.parse((init as RequestInit).body as string) as { existingObjects?: string },
      );
    expect(cutover.some((body) => body.existingObjects === 'start_empty')).toBe(true);
  });

  it('reports a blocked migration cutover', async () => {
    installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: envView } }),
      [`POST ${CONFIG}/apply`]: () => ({
        body: { data: { status: 'migration_pending', probe: passProbe, existingObjectCount: 4 } },
      }),
    });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    expect(await screen.findByText(/Migration of existing objects is coming/)).toBeInTheDocument();
  });

  it('shows a load error when the configuration cannot be fetched', async () => {
    installFetch({
      [`GET ${CONFIG}`]: () => ({
        ok: false,
        body: { title: 'Error', detail: 'boom', status: 500 },
      }),
    });
    render(<StorageSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('surfaces an apply transport failure', async () => {
    installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: envView } }),
      [`POST ${CONFIG}/apply`]: () => ({
        ok: false,
        body: { title: 'Conflict', detail: 'stale', status: 409 },
      }),
    });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    expect(await screen.findByText('stale')).toBeInTheDocument();
  });

  it('surfaces a revert failure', async () => {
    installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: configView } }),
      [`POST ${CONFIG}/revert`]: () => ({
        ok: false,
        body: { title: 'Error', detail: 'nope', status: 500 },
      }),
    });
    render(<StorageSection />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Revert to environment configuration' }),
    );
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument());
  });

  it('clears stale probe results when a field is edited', async () => {
    installFetch({
      [`GET ${CONFIG}`]: () => ({ body: { data: envView } }),
      [`POST ${CONFIG}/validate`]: () => ({ body: { data: passProbe } }),
    });
    render(<StorageSection />);
    await screen.findByText('Environment');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByRole('list', { name: 'Validation results' });
    fireEvent.change(screen.getByLabelText('Bucket'), { target: { value: 'renamed' } });
    expect(screen.queryByRole('list', { name: 'Validation results' })).not.toBeInTheDocument();
  });
});
