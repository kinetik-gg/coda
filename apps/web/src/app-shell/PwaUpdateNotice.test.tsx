// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateNotice } from './PwaUpdateNotice';

const serviceWorker = vi.hoisted(() => ({
  register:
    vi.fn<
      (options: {
        immediate?: boolean;
        onNeedRefresh?: () => void;
      }) => (reloadPage?: boolean) => Promise<void>
    >(),
  update: vi.fn<(reloadPage?: boolean) => Promise<void>>(),
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: serviceWorker.register,
}));

afterEach(() => {
  cleanup();
  serviceWorker.register.mockReset();
  serviceWorker.update.mockReset();
});

function offerUpdate() {
  let onNeedRefresh: (() => void) | undefined;
  serviceWorker.register.mockImplementation((options: { onNeedRefresh?: () => void }) => {
    onNeedRefresh = options.onNeedRefresh;
    return serviceWorker.update;
  });
  render(<PwaUpdateNotice />);
  act(() => onNeedRefresh?.());
}

describe('PwaUpdateNotice', () => {
  it('registers immediately and stays hidden until a worker update is ready', () => {
    serviceWorker.register.mockReturnValue(serviceWorker.update);
    render(<PwaUpdateNotice />);

    const options = serviceWorker.register.mock.calls[0]?.[0];
    expect(options?.immediate).toBe(true);
    expect(options?.onNeedRefresh).toBeTypeOf('function');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('dismisses an available update without activating it', () => {
    offerUpdate();
    expect(screen.getByRole('status')).toHaveTextContent('A new version of Coda is ready.');

    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(serviceWorker.update).not.toHaveBeenCalled();
  });

  it('activates the waiting worker and reloads only after confirmation', () => {
    serviceWorker.update.mockResolvedValue();
    offerUpdate();

    fireEvent.click(screen.getByRole('button', { name: 'Reload now' }));

    expect(serviceWorker.update).toHaveBeenCalledWith(true);
  });
});
