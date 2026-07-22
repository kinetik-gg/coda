// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScreen } from './AdminScreen';

describe('AdminScreen navigation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('changes local pages and resets the page-specific header', () => {
    const onPageChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AdminScreen onPageChange={onPageChange} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search users' })).toBeInTheDocument();
    expect(onPageChange).toHaveBeenCalledWith('users');
    queryClient.clear();
  });
});
