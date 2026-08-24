// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTrackerStorageObjectContent } from '../../api';
import { rememberTrackerMedia } from './tracker-media-model';
import { ImageThumbnail, TrackerMediaCell, TrackerMediaIndicator } from './TrackerMediaReadonly';

vi.mock('../../api', () => ({
  getTrackerStorageObjectContent: vi.fn(),
}));

const mockedContent = vi.mocked(getTrackerStorageObjectContent);

afterEach(cleanup);

function withClient(node: React.ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>
  );
}

describe('tracker media read-only renders (#382)', () => {
  it('renders empty media cells as a dash for every kind', () => {
    render(
      withClient(
        <div>
          <TrackerMediaCell trackerId="t1" kind="image" objectId={null} />
          <TrackerMediaCell trackerId="t1" kind="file" objectId={null} />
          <TrackerMediaCell trackerId="t1" kind="video" objectId={null} />
        </div>,
      ),
    );
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(mockedContent).not.toHaveBeenCalled();
  });

  it('renders a lazy cover-cropped thumbnail for image values', async () => {
    mockedContent.mockResolvedValue({ url: 'https://objects.test/signed-art' });
    render(withClient(<TrackerMediaCell trackerId="t1" kind="image" objectId="obj-1" />));
    const image = await screen.findByRole('img', { name: 'Attachment' });
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('src')).toBe('https://objects.test/signed-art');
    expect(mockedContent).toHaveBeenCalledWith('t1', 'obj-1', expect.anything());
  });

  it('labels file chips with remembered metadata including size', async () => {
    rememberTrackerMedia('obj-2', {
      filename: 'call-sheet.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
    render(withClient(<TrackerMediaCell trackerId="t1" kind="file" objectId="obj-2" />));
    expect(await screen.findByText('call-sheet.pdf')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
  });

  it('appends durations to video chips when known and falls back to generic labels', async () => {
    rememberTrackerMedia('obj-3', {
      filename: 'take-one.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 3_145_728,
      durationMs: 65_000,
    });
    render(withClient(<TrackerMediaCell trackerId="t1" kind="video" objectId="obj-3" />));
    expect(await screen.findByText('take-one.mp4')).toBeTruthy();
    expect(screen.getByText('3.0 MB · 1:05')).toBeTruthy();
    // Unknown objects degrade to the generic attachment label.
    render(withClient(<TrackerMediaCell trackerId="t1" kind="video" objectId="obj-unknown" />));
    expect(screen.getAllByText('Attachment').length).toBeGreaterThan(0);
  });

  it('shows a compact icon-plus-name indicator on board cards', () => {
    rememberTrackerMedia('obj-4', {
      filename: 'moodboard.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    });
    const { container } = render(
      <div>
        <div data-testid="filled">
          <TrackerMediaIndicator kind="image" objectId="obj-4" />
        </div>
        <div data-testid="empty">
          <TrackerMediaIndicator kind="video" objectId={null} />
        </div>
      </div>,
    );
    expect(container.querySelector('[data-testid="filled"]')!.textContent).toBe('moodboard.jpg');
    expect(container.querySelector('[data-testid="empty"]')!.textContent).toBe('—');
  });

  it('fetches the signed URL through ImageThumbnail directly for the editor preview', async () => {
    mockedContent.mockResolvedValue({ url: 'https://objects.test/editor-preview' });
    render(withClient(<ImageThumbnail trackerId="t1" objectId="obj-5" alt="preview" />));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'preview' }).getAttribute('src')).toBe(
        'https://objects.test/editor-preview',
      ),
    );
  });
});
