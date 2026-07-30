// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ api }));

import { ScreenplayLinkControl, screenplayLinkQueryKey } from './ScreenplayLinkControl';

const projectId = '40000000-0000-4000-8000-000000000001';
const screenplayId = '40000000-0000-4000-8000-000000000002';

const linkPath = `/api/v1/projects/${projectId}/screenplay-link`;

function linkView(screenplay: unknown) {
  return {
    projectId,
    screenplayId,
    createdById: 'user',
    updatedById: 'user',
    createdAt: '2026-07-30T10:00:00.000Z',
    updatedAt: '2026-07-30T10:00:00.000Z',
    screenplay,
  };
}

const screenplaySummary = {
  id: screenplayId,
  ownerUserId: 'user',
  title: 'Nightfall',
  filename: 'nightfall.fountain',
  paperSize: 'A4',
  version: 7,
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
};

/** Routes every mocked request by path so a test only states the responses it cares about. */
function respond(routes: {
  state?: unknown;
  put?: unknown;
  del?: unknown;
  screenplays?: unknown;
  failWith?: Error;
}) {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/api/v1/screenplays') return Promise.resolve(routes.screenplays ?? []);
    if (path !== linkPath) throw new Error(`Unexpected request: ${path}`);
    const method = init?.method ?? 'GET';
    if (method === 'GET') return Promise.resolve(routes.state);
    if (routes.failWith) return Promise.reject(routes.failWith);
    return Promise.resolve(method === 'DELETE' ? routes.del : routes.put);
  });
}

function renderControl() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ScreenplayLinkControl projectId={projectId} />
      </QueryClientProvider>,
    ),
  };
}

describe('ScreenplayLinkControl', () => {
  beforeEach(() => {
    api.mockReset();
  });
  afterEach(cleanup);

  it('keys its cache entry per breakdown so two workspaces never share a link', () => {
    expect(screenplayLinkQueryKey(projectId)).toEqual(['breakdown-screenplay-link', projectId]);
  });

  it('offers a link affordance for an unlinked breakdown the caller may configure', async () => {
    respond({ state: { link: null, canLink: true } });
    renderControl();

    expect(await screen.findByText('None')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Unlink/ })).not.toBeInTheDocument();
  });

  it('offers no affordance at all to a read-only breakdown member', async () => {
    respond({ state: { link: null, canLink: false } });
    renderControl();

    expect(await screen.findByText('None')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('names the followed screenplay and offers change and unlink', async () => {
    respond({ state: { link: linkView(screenplaySummary), canLink: true } });
    renderControl();

    expect(await screen.findByText('Nightfall')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument();
  });

  it('reports an unreadable, trashed, or purged screenplay as unavailable but still clearable', async () => {
    respond({ state: { link: linkView(null), canLink: true } });
    renderControl();

    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeEnabled();
  });

  it('lists screenplays only after the picker opens, then links the chosen one', async () => {
    respond({
      state: { link: null, canLink: true },
      screenplays: [screenplaySummary],
      put: { link: linkView(screenplaySummary), canLink: true },
    });
    renderControl();

    const open = await screen.findByRole('button', { name: 'Link' });
    // The screenplay list stays unrequested while the breakdown is merely displayed.
    expect(api).not.toHaveBeenCalledWith('/api/v1/screenplays');

    fireEvent.click(open);
    const picker = await screen.findByLabelText('Screenplay to follow');
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/v1/screenplays'));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Nightfall' })).toBeInTheDocument(),
    );
    fireEvent.change(picker, { target: { value: screenplayId } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(linkPath, {
        method: 'PUT',
        body: JSON.stringify({ screenplayId }),
      }),
    );
  });

  it('cannot submit an empty choice', async () => {
    respond({ state: { link: null, canLink: true }, screenplays: [screenplaySummary] });
    renderControl();

    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
    await screen.findByLabelText('Screenplay to follow');

    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled();
  });

  it('abandons the picker without a request when cancelled', async () => {
    respond({ state: { link: null, canLink: true }, screenplays: [screenplaySummary] });
    renderControl();

    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('None')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(linkPath, expect.objectContaining({ method: 'PUT' }));
  });

  it('unlinks through the dedicated endpoint and touches no source-reference route', async () => {
    respond({
      state: { link: linkView(screenplaySummary), canLink: true },
      del: { link: null, canLink: true },
    });
    renderControl();

    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith(linkPath, { method: 'DELETE' }));
    const paths = api.mock.calls.map((call) => call[0] as string);
    expect(paths.some((path) => path.includes('source-references'))).toBe(false);
    expect(paths.some((path) => path.includes('source-documents'))).toBe(false);
  });

  it('surfaces a rejected link without leaving the picker', async () => {
    respond({
      state: { link: null, canLink: true },
      screenplays: [screenplaySummary],
      failWith: new Error('Missing permission: manage_source_documents'),
    });
    renderControl();

    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
    const picker = await screen.findByLabelText('Screenplay to follow');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Nightfall' })).toBeInTheDocument(),
    );
    fireEvent.change(picker, { target: { value: screenplayId } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Missing permission: manage_source_documents',
    );
    expect(screen.getByLabelText('Screenplay to follow')).toBeInTheDocument();
  });

  it('renders nothing until the breakdown link state has loaded', () => {
    respond({ state: { link: null, canLink: true } });
    const { container } = renderControl();

    expect(container).toBeEmptyDOMElement();
  });
});
