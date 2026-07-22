// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationDialog } from './ConfirmationDialog';

afterEach(cleanup);

describe('ConfirmationDialog', () => {
  it('labels the dialog, focuses Cancel, and restores focus after closing', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <ConfirmationDialog
        title="Move scene to trash?"
        description="The scene and its descendants will move to trash."
        confirmLabel="Move to trash"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Move scene to trash?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBe(document.activeElement);
    unmount();
    expect(trigger).toBe(document.activeElement);
    trigger.remove();
  });

  it('closes from Escape and the backdrop only while idle', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmationDialog
        title="Move scene to trash?"
        description="This scene will move to trash."
        confirmLabel="Move to trash"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    const backdrop = document.body.querySelector('[class*="backdrop"]')!;
    fireEvent.pointerDown(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(2);

    rerender(
      <ConfirmationDialog
        title="Move scene to trash?"
        description="This scene will move to trash."
        confirmLabel="Move to trash"
        busyLabel="Moving…"
        busy
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Moving…' }).hasAttribute('disabled')).toBe(true);
  });

  it('traps keyboard focus between the dialog actions', () => {
    render(
      <ConfirmationDialog
        title="Move scene to trash?"
        description="This scene will move to trash."
        confirmLabel="Move to trash"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Move to trash' });

    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirm).toBe(document.activeElement);
  });
});
