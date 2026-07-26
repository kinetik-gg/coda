// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModalShell } from './ModalShell';

afterEach(cleanup);

describe('ModalShell', () => {
  it('labels the dialog, describes it, and reports busy', () => {
    render(
      <ModalShell
        title="Share Night Bus"
        eyebrow="Share"
        description="Control who can read and edit this screenplay."
        busy
        onClose={vi.fn()}
      >
        <button type="button">Inside</button>
      </ModalShell>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Share Night Bus' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog).toHaveAccessibleDescription(
      'Control who can read and edit this screenplay. Inside',
    );
  });

  it('closes from Escape, the close button, and the backdrop while idle', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ModalShell title="Share" onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close Share' }));
    fireEvent.pointerDown(document.body.querySelector('[class*="backdrop"]')!);
    expect(onClose).toHaveBeenCalledTimes(3);

    rerender(<ModalShell title="Share" busy onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body.querySelector('[class*="backdrop"]')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('traps Tab inside the dialog and restores focus to the opener', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <ModalShell
        title="Share"
        dismissible={false}
        onClose={vi.fn()}
        footer={<button type="button">Done</button>}
      >
        <button type="button">First</button>
      </ModalShell>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const done = screen.getByRole('button', { name: 'Done' });
    expect(first).toBe(document.activeElement);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(done).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toBe(document.activeElement);

    unmount();
    expect(trigger).toBe(document.activeElement);
    trigger.remove();
  });

  it('binds Escape to the topmost shell only, so a stacked dialog does not close its host', () => {
    const closeHost = vi.fn();
    const closeStacked = vi.fn();
    render(
      <>
        <ModalShell title="Host" onClose={closeHost} />
        <ModalShell title="Stacked" onClose={closeStacked} />
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeStacked).toHaveBeenCalledTimes(1);
    expect(closeHost).not.toHaveBeenCalled();
  });

  it('submits through the shell form when a surface supplies onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <ModalShell
        title="Rename"
        onClose={vi.fn()}
        onSubmit={onSubmit}
        footer={<button type="submit">Rename</button>}
      >
        <input aria-label="Title" defaultValue="Night Bus" />
      </ModalShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
