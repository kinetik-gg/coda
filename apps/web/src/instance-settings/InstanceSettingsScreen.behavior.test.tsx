// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceSettingsScreen } from './InstanceSettingsScreen';

beforeEach(() => {
  // The Doctor section fetches its report on mount; stub a pending request so
  // navigating to it in these section-switching tests never issues a real
  // network call.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InstanceSettingsScreen', () => {
  it('rejects non-administrators with an owner-only guard and no section navigation', () => {
    render(<InstanceSettingsScreen isAdministrator={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Instance settings are unavailable.');
    expect(screen.queryByLabelText('Instance settings sections')).not.toBeInTheDocument();
  });

  it('lazily mounts the default General section for an administrator', async () => {
    render(<InstanceSettingsScreen isAdministrator />);
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
    expect(await screen.findByText('General settings are coming soon.')).toBeInTheDocument();
  });

  it('navigates between sections, calling onSectionChange and lazily mounting each panel', async () => {
    const onSectionChange = vi.fn();
    const { rerender } = render(
      <InstanceSettingsScreen
        section="general"
        isAdministrator
        onSectionChange={onSectionChange}
      />,
    );
    await screen.findByText('General settings are coming soon.');

    fireEvent.click(screen.getByRole('button', { name: 'Storage' }));
    expect(onSectionChange).toHaveBeenCalledWith('storage');

    rerender(
      <InstanceSettingsScreen
        section="storage"
        isAdministrator
        onSectionChange={onSectionChange}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Storage' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Object storage backend' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Storage' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'General' })).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByRole('button', { name: 'Backups' }));
    rerender(
      <InstanceSettingsScreen
        section="backups"
        isAdministrator
        onSectionChange={onSectionChange}
      />,
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Download a backup' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
    rerender(
      <InstanceSettingsScreen
        section="updates"
        isAdministrator
        onSectionChange={onSectionChange}
      />,
    );
    expect(await screen.findByText('Updates are coming soon.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }));
    rerender(
      <InstanceSettingsScreen section="doctor" isAdministrator onSectionChange={onSectionChange} />,
    );
    expect(await screen.findByText('Running diagnostics…')).toBeInTheDocument();
  });

  it('falls back to local section state when unmounted from a route (no section prop)', async () => {
    render(<InstanceSettingsScreen isAdministrator embedded />);
    await screen.findByText('General settings are coming soon.');
    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }));
    expect(await screen.findByText('Running diagnostics…')).toBeInTheDocument();
  });
});
