// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomMultiSelect, CustomSelect } from './CustomSelect';
import { ModalShell } from './ModalShell';

afterEach(cleanup);

const options = [
  { value: 'owner', label: 'Owner' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

describe('CustomSelect', () => {
  it('exposes a listbox, selects a value, and restores trigger focus', async () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        ariaLabel="Project role"
        value="editor"
        options={options}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Project role' });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole('listbox', { name: 'Project role' });
    expect(listbox).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Editor' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('option', { name: 'Viewer' }));
    expect(onChange).toHaveBeenCalledWith('viewer');
    expect(screen.queryByRole('listbox', { name: 'Project role' })).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('supports arrow navigation, typeahead, Escape, and disabled state', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CustomSelect ariaLabel="Role" value="" options={options} onChange={onChange} />,
    );
    const trigger = screen.getByRole('button', { name: 'Role' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await screen.findByRole('listbox', { name: 'Role' });
    fireEvent.keyDown(screen.getByRole('option', { name: 'Owner' }), { key: 'v' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Viewer' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Role' })).toBeNull();

    rerender(
      <CustomSelect ariaLabel="Role" value="" options={options} onChange={onChange} disabled />,
    );
    expect(screen.getByRole('button', { name: 'Role' }).hasAttribute('disabled')).toBe(true);
  });

  it('owns Escape while portalled above a modal shell', async () => {
    const onDismiss = vi.fn();
    render(
      <ModalShell
        config={{
          regions: {
            header: { title: 'Share breakdown' },
            body: {
              content: (
                <CustomSelect
                  ariaLabel="Breakdown role"
                  value="editor"
                  options={options}
                  onChange={vi.fn()}
                />
              ),
            },
          },
          dismissal: { onDismiss },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Breakdown role' }));
    await screen.findByRole('listbox', { name: 'Breakdown role' });
    fireEvent.keyDown(screen.getByRole('option', { name: 'Editor' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Breakdown role' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Share breakdown' })).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('keeps a multi-select open while toggling checked options', async () => {
    const onChange = vi.fn();
    render(
      <CustomMultiSelect
        ariaLabel="Visible fields"
        value={['editor']}
        options={options}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Visible fields' }));
    await screen.findByRole('listbox', { name: 'Visible fields' });
    fireEvent.click(screen.getByRole('option', { name: 'Viewer' }));
    expect(onChange).toHaveBeenCalledWith(['editor', 'viewer']);
    expect(screen.getByRole('listbox', { name: 'Visible fields' })).toBeTruthy();
  });
});
