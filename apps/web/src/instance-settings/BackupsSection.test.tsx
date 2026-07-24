// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupsSection } from './BackupsSection';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BackupsSection', () => {
  it('renders the download, restore, and pre-upgrade safety guidance', () => {
    render(<BackupsSection />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Download a backup' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Restore a backup' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Automatic pre-upgrade backups' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/PRE_UPGRADE_BACKUP=off/)).toBeInTheDocument();
  });

  it('triggers a same-origin anchor download to the owner-gated endpoint', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<BackupsSection />);
    fireEvent.click(screen.getByRole('button', { name: /Download backup archive/ }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Your download should begin shortly');
  });
});
