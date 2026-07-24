// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoctorSection } from './DoctorSection';

function envelope(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function problem(status: number, detail: string) {
  return new Response(JSON.stringify({ title: 'Error', detail, status }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const report = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  instanceOrigin: 'https://coda.example.test',
  rows: [
    { id: 'app.version', label: 'Application version', status: 'ok', value: '1.2.3', hint: null },
    {
      id: 'database.reachability',
      label: 'Database',
      status: 'error',
      value: 'Unreachable',
      hint: 'Verify DATABASE_URL.',
    },
  ],
  reportText: 'Coda instance diagnostic report\nInstance: https://coda.example.test',
};

describe('DoctorSection', () => {
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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

  it('loads and renders each diagnostic row with its status, value, and hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(report)));
    render(<DoctorSection />);

    expect(screen.getByText('Running diagnostics…')).toBeInTheDocument();
    expect(await screen.findByText('Application version')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Unreachable')).toBeInTheDocument();
    expect(screen.getByText('Verify DATABASE_URL.')).toBeInTheDocument();
    expect(screen.getByText(/coda.example.test/)).toBeInTheDocument();
  });

  it('shows an error state when the report cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(problem(403, 'Only the instance administrator may view diagnostics')),
    );
    render(<DoctorSection />);

    expect(
      await screen.findByText('Only the instance administrator may view diagnostics'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('copies the sanitized report text to the clipboard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(report)));
    render(<DoctorSection />);

    await screen.findByText('Application version');
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic report' }));

    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith(report.reportText));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('shows a copy-failed state when the clipboard write rejects', async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(report)));
    render(<DoctorSection />);

    await screen.findByText('Application version');
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic report' }));

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('refreshes the report on demand', async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope(report));
    vi.stubGlobal('fetch', fetchMock);
    render(<DoctorSection />);

    await screen.findByText('Application version');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
