// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineValue, InspectorHeaderControls, inspectorMatchesSearch } from './InspectorPanel';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InlineValue', () => {
  it('keeps the same editor shell and reserved status region while editing', () => {
    const { container } = render(<InlineValue value="Opening title" onSave={vi.fn()} />);
    const display = screen.getByRole('button', { name: 'Opening title' });
    const shell = display.closest('[data-editor-kind]');
    const footer = shell?.querySelector('[aria-live="polite"]');

    expect(shell?.getAttribute('data-editor-kind')).toBe('text');
    expect(footer).toBeTruthy();

    fireEvent.click(display);

    const input = screen.getByRole('textbox');
    expect(input.closest('[data-editor-kind]')).toBe(shell);
    expect(shell?.getAttribute('data-editing')).toBe('true');
    expect(shell?.querySelector('[aria-live="polite"]')).toBe(footer);
    expect(container.querySelectorAll('[data-editor-kind]')).toHaveLength(1);
  });

  it('renders validation feedback and multiline actions inside the reserved footer', async () => {
    const error = new Error('The description is required.');
    const onSave = vi.fn().mockRejectedValue(error);
    render(<InlineValue kind="multiline" value="Description" onSave={onSave} />);

    const display = screen.getByRole('button', { name: 'Description' });
    const shell = display.closest('[data-editor-kind]');
    fireEvent.click(display);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(error.message);
    expect(alert.closest('[aria-live="polite"]')).toBeTruthy();
    expect(screen.getByRole('textbox').closest('[data-editor-kind]')).toBe(shell);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('saves trimmed editor interactions on Enter or blur and cancels on Escape', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<InlineValue value="Original" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Entered' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Entered'));

    rerender(<InlineValue value="Entered" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entered' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Blurred' } });
    fireEvent.blur(screen.getByRole('textbox'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Blurred'));

    rerender(<InlineValue value="Blurred" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Blurred' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Discarded' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Blurred' })).toBeTruthy();
    expect(onSave).not.toHaveBeenCalledWith('Discarded');
  });

  it('supports the multiline keyboard save shortcut and safe unknown-error fallback', async () => {
    const onSave = vi.fn().mockRejectedValue('unknown failure');
    render(<InlineValue kind="multiline" value="Original" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect((await screen.findByRole('alert')).textContent).toBe('Value could not be saved.');
    expect(onSave).toHaveBeenCalledWith('Updated');
  });
});

describe('InspectorHeaderControls', () => {
  it('opens, clears, and debounces inspector search updates', async () => {
    vi.useFakeTimers();
    const onPanelChange = vi.fn();
    const panel = {
      id: '30000000-0000-4000-8000-000000000001',
      type: 'inspector' as const,
      configVersion: 1 as const,
      config: { section: 'details' as const, search: '' },
    };
    render(<InspectorHeaderControls panel={panel} onPanelChange={onPanelChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search Inspector keys and values' }));
    const search = screen.getByRole('textbox', { name: 'Search Inspector keys and values' });
    fireEvent.change(search, { target: { value: 'camera' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(onPanelChange).toHaveBeenCalledWith({
      ...panel,
      config: { ...panel.config, search: 'camera' },
    });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Search Inspector keys and values' })).toBeTruthy();
    vi.useRealTimers();
  });

  it('does not render search outside the details section', () => {
    const panel = {
      id: '30000000-0000-4000-8000-000000000001',
      type: 'inspector' as const,
      configVersion: 1 as const,
      config: { section: 'comments' as const, search: '' },
    };
    const { container } = render(<InspectorHeaderControls panel={panel} onPanelChange={vi.fn()} />);
    expect(container.childElementCount).toBe(0);
  });
});

describe('inspectorMatchesSearch', () => {
  it('matches property keys and values without case sensitivity', () => {
    expect(inspectorMatchesSearch('continuity', 'Continuity Notes', 'Match previous item')).toBe(
      true,
    );
    expect(inspectorMatchesSearch('PREVIOUS', 'Continuity Notes', 'Match previous item')).toBe(
      true,
    );
    expect(inspectorMatchesSearch('camera', 'Continuity Notes', 'Match previous item')).toBe(false);
  });

  it('shows all properties for an empty query', () => {
    expect(inspectorMatchesSearch('   ', 'Title', 'Example')).toBe(true);
  });
});
