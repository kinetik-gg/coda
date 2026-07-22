// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountScreen, type AccountPage } from './AccountScreen';

const account = {
  id: 'user',
  displayName: 'Original User',
  email: 'user@example.com',
  company: null,
  department: 'Production',
  theme: 'coda-dark',
  fontSize: 'default',
  motionPreference: 'system',
  pdfAppearance: 'theme',
};

const project = {
  id: 'project',
  name: 'Feature Film',
  currentMembership: {
    role: {
      permissions: [
        { permission: 'read_project' },
        { permission: 'manage_items' },
        { permission: 'manage_fields' },
      ],
    },
  },
};

const credential = {
  id: 'credential',
  projectId: 'project',
  kind: 'API_KEY',
  name: 'Build agent',
  tokenPrefix: 'coda_api_',
  tokenLastFour: '1234',
  permissions: ['read_project'],
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  project: { id: 'project', name: 'Feature Film', deletedAt: null },
};

function envelope(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderPage(page: AccountPage) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccountScreen page={page} embedded />
    </QueryClientProvider>,
  );
}

describe('AccountScreen behavior', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path === '/api/v1/account/profile')
        return envelope({ ...account, displayName: 'Updated' });
      if (path === '/api/v1/account/preferences')
        return envelope({
          theme: 'coda-light',
          fontSize: 'default',
          motionPreference: 'system',
          pdfAppearance: 'theme',
        });
      if (path === '/api/v1/account/password') return envelope({ changed: true });
      if (path === '/api/v1/account/credentials' && init?.method === 'POST')
        return envelope({ ...credential, token: 'secret-token' });
      if (path === '/api/v1/account/credentials') return envelope([credential]);
      if (path === '/api/v1/account/credentials/credential')
        return envelope({ ...credential, revokedAt: '2026-07-22T00:00:00.000Z' });
      if (path === '/api/v1/projects') return envelope([project]);
      if (path === '/api/v1/account') return envelope(account);
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads, edits, and saves the profile allowlisted fields', async () => {
    renderPage('profile');
    const name = await screen.findByLabelText(/Display name/);
    expect(name).toHaveValue('Original User');
    fireEvent.change(name, { target: { value: ' Updated ' } });
    fireEvent.change(screen.getByLabelText(/Company/), { target: { value: 'Studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/account/profile',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('Updated') as string,
      }),
    );
  });

  it('validates password mismatch and submits a valid replacement', async () => {
    renderPage('security');
    await screen.findByRole('heading', { name: 'Change password' });
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: 'current' } });
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'password-one' } });
    fireEvent.change(screen.getByLabelText(/Confirm new password/), {
      target: { value: 'password-two' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('New passwords do not match.');
    fireEvent.change(screen.getByLabelText(/Confirm new password/), {
      target: { value: 'password-one' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
  });

  it('updates an interface preference through its accessible listbox', async () => {
    renderPage('preferences');
    await screen.findByRole('heading', { name: 'Interface preferences' });
    fireEvent.click(screen.getByRole('button', { name: 'Interface theme' }));
    fireEvent.click(screen.getByRole('option', { name: 'Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Preferences saved.')).toBeInTheDocument();
  });

  it('creates, copies, and confirms revocation of a scoped credential', async () => {
    renderPage('developer');
    await screen.findByText('Build agent');
    fireEvent.change(screen.getByPlaceholderText('Development integration'), {
      target: { value: 'Editor integration' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create credential' }));
    expect(await screen.findByText('secret-token')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    expect(clipboardWriteText).toHaveBeenCalledWith('secret-token');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(screen.getByRole('heading', { name: 'Revoke credential?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke credential' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/account/credentials/credential',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
