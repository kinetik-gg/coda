// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreens';
import { messages } from '../messages';
import * as setupRestore from './setup-restore';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithClient(node: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('AuthScreen restore mode', () => {
  it('offers a restore switch only during first-run setup', () => {
    const { rerender } = renderWithClient(
      <AuthScreen initialized={false} setupTokenRequired={false} onAuthenticated={() => {}} />,
    );
    expect(screen.getByRole('button', { name: messages.setupRestoreSwitch })).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AuthScreen initialized setupTokenRequired={false} onAuthenticated={() => {}} />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByRole('button', { name: messages.setupRestoreSwitch }),
    ).not.toBeInTheDocument();
  });

  it('toggles into the restore panel and back to owner creation', () => {
    renderWithClient(
      <AuthScreen initialized={false} setupTokenRequired={false} onAuthenticated={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: messages.setupRestoreSwitch }));
    expect(screen.getByRole('heading', { name: messages.setupRestoreTitle })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: messages.setupRestoreBack }));
    expect(screen.getByRole('button', { name: 'Create owner account' })).toBeInTheDocument();
  });

  it('validates that an archive is chosen before restoring', () => {
    const stream = vi.spyOn(setupRestore, 'streamSetupRestore');
    renderWithClient(
      <AuthScreen initialized={false} setupTokenRequired={false} onAuthenticated={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: messages.setupRestoreSwitch }));
    fireEvent.click(screen.getByRole('button', { name: messages.setupRestoreSubmit }));
    expect(screen.getByText('Choose a backup archive to restore.')).toBeInTheDocument();
    expect(stream).not.toHaveBeenCalled();
  });

  it('runs the restore and surfaces onRestored on completion', async () => {
    const onRestored = vi.fn();
    vi.spyOn(setupRestore, 'streamSetupRestore').mockResolvedValue({ appVersion: '0.0.4' });
    renderWithClient(
      <AuthScreen
        initialized={false}
        setupTokenRequired={false}
        onAuthenticated={() => {}}
        onRestored={onRestored}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: messages.setupRestoreSwitch }));
    const file = new File([Buffer.from('archive')], 'coda.codabk', {
      type: 'application/octet-stream',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: messages.setupRestoreSubmit }));

    await waitFor(() => expect(screen.getByText(messages.setupRestoreSuccess)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('reveals the second-factor step after a password that requires 2FA', async () => {
    const onAuthenticated = vi.fn();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = input instanceof Request ? input.url : input.toString();
      const body =
        path === '/api/v1/auth/login'
          ? { twoFactorRequired: true, challenge: 'challenge-token' }
          : { id: 'user', email: 'user@example.com', displayName: 'User' };
      return Promise.resolve(
        new Response(JSON.stringify({ data: body }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(
      <AuthScreen initialized setupTokenRequired={false} onAuthenticated={onAuthenticated} />,
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument(),
    );
    expect(onAuthenticated).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login/2fa',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('challenge-token') as string,
      }),
    );
    vi.unstubAllGlobals();
  });

  it('lets a member switch to entering a recovery code at the second step', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { twoFactorRequired: true, challenge: 'c' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(
      <AuthScreen initialized setupTokenRequired={false} onAuthenticated={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('heading', { name: 'Two-step verification' });
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows a terminal error when the restore fails', async () => {
    vi.spyOn(setupRestore, 'streamSetupRestore').mockRejectedValue(
      new Error('Backup manifest signature is invalid'),
    );
    renderWithClient(
      <AuthScreen
        initialized={false}
        setupTokenRequired
        setupTokenAutoGenerated
        onAuthenticated={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: messages.setupRestoreSwitch }));
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'token' },
    });
    const file = new File([Buffer.from('archive')], 'coda.codabk');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: messages.setupRestoreSubmit }));

    await waitFor(() =>
      expect(screen.getByText('Backup manifest signature is invalid')).toBeInTheDocument(),
    );
  });
});
