// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModalShell, useDialogStackEntry } from './ModalShell';

afterEach(cleanup);

describe('ModalShell', () => {
  it('renders declared regions through the configured stacked layout', () => {
    render(
      <ModalShell
        config={{
          size: 'wide',
          regions: {
            header: { eyebrow: 'Edit', title: 'Breakdown details' },
            body: {
              description: <p>Shown wherever this breakdown is listed.</p>,
              content: <input aria-label="Name" defaultValue="Night Bus" />,
            },
            footer: <button type="button">Save changes</button>,
          },
          dismissal: { onDismiss: vi.fn() },
        }}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Breakdown details' });
    expect(dialog.className).toContain('wide');
    expect(dialog).toHaveAccessibleDescription('Shown wherever this breakdown is listed.');
    expect(screen.getByRole('contentinfo')).toContainElement(
      screen.getByRole('button', { name: 'Save changes' }),
    );
  });

  it('owns the section-navigation layout and active content scrolling region', () => {
    render(
      <ModalShell
        config={{
          size: 'large',
          layout: {
            type: 'sections',
            navigationLabel: 'Breakdown management sections',
            navigation: <button type="button">Entities & fields</button>,
          },
          regions: {
            header: { title: 'Manage Night Bus' },
            body: { content: <section aria-label="Entity schema">Schema editor</section> },
          },
          dismissal: { onDismiss: vi.fn() },
        }}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Manage Night Bus' });
    expect(dialog.className).toContain('large');
    expect(
      screen.getByRole('navigation', { name: 'Breakdown management sections' }),
    ).toContainElement(screen.getByRole('button', { name: 'Entities & fields' }));
    expect(
      screen.getByRole('region', { name: 'Entity schema' }).parentElement?.className,
    ).toContain('sectionBody');
  });

  it('locks document scrolling until the last stacked shell unmounts', () => {
    document.body.style.overflow = 'scroll';
    const { rerender, unmount } = render(
      <ModalShell
        config={{
          regions: { header: { title: 'Host' } },
          dismissal: { onDismiss: vi.fn() },
        }}
      />,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <ModalShell
          config={{
            regions: { header: { title: 'Host' } },
            dismissal: { onDismiss: vi.fn() },
          }}
        />
        <ModalShell
          config={{
            regions: { header: { title: 'Confirmation' } },
            dismissal: { onDismiss: vi.fn() },
          }}
        />
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.removeProperty('overflow');
  });

  it('honours independently configured dismissal paths and busy-gates all of them', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ModalShell
        config={{
          regions: { header: { title: 'Managed surface' } },
          dismissal: {
            onDismiss,
            closeButton: false,
            escape: false,
            backdrop: false,
          },
        }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Close Managed surface' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body.querySelector('[class*="backdrop"]')!);
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(
      <ModalShell
        config={{
          regions: { header: { title: 'Managed surface' } },
          dismissal: { onDismiss, busy: true },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Close Managed surface' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body.querySelector('[class*="backdrop"]')!);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('labels the dialog, describes it, and reports busy', () => {
    render(
      <ModalShell
        config={{
          regions: {
            header: { title: 'Share Night Bus', eyebrow: 'Share' },
            body: {
              description: 'Control who can read and edit this screenplay.',
              content: <button type="button">Inside</button>,
            },
          },
          dismissal: { onDismiss: vi.fn(), busy: true },
        }}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Share Night Bus' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog).toHaveAccessibleDescription('Control who can read and edit this screenplay.');
  });

  it('closes from Escape, the close button, and the backdrop while idle', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalShell
        config={{
          regions: { header: { title: 'Share' } },
          dismissal: { onDismiss: onClose },
        }}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close Share' }));
    fireEvent.pointerDown(document.body.querySelector('[class*="backdrop"]')!);
    expect(onClose).toHaveBeenCalledTimes(3);

    rerender(
      <ModalShell
        config={{
          regions: { header: { title: 'Share' } },
          dismissal: { onDismiss: onClose, busy: true },
        }}
      />,
    );
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
        config={{
          regions: {
            header: { title: 'Share' },
            body: { content: <button type="button">First</button> },
            footer: <button type="button">Done</button>,
          },
          dismissal: { onDismiss: vi.fn(), closeButton: false },
        }}
      />,
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
        <ModalShell
          config={{
            regions: { header: { title: 'Host' } },
            dismissal: { onDismiss: closeHost },
          }}
        />
        <ModalShell
          config={{
            regions: { header: { title: 'Stacked' } },
            dismissal: { onDismiss: closeStacked },
          }}
        />
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeStacked).toHaveBeenCalledTimes(1);
    expect(closeHost).not.toHaveBeenCalled();
  });

  it('lets a non-shell overlay join the stack and take Escape from the modal beneath it', () => {
    const closeModal = vi.fn();
    function Palette() {
      useDialogStackEntry();
      return <div data-testid="palette" />;
    }
    render(
      <>
        <ModalShell
          config={{
            regions: { header: { title: 'Share' } },
            dismissal: { onDismiss: closeModal },
          }}
        />
        <Palette />
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeModal).not.toHaveBeenCalled();
  });

  it('lets a child popup consume Escape without dismissing its host shell', () => {
    const closeModal = vi.fn();
    render(
      <ModalShell
        config={{
          regions: {
            header: { title: 'Share' },
            body: {
              content: (
                <button
                  type="button"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') event.preventDefault();
                  }}
                >
                  Popup option
                </button>
              ),
            },
          },
          dismissal: { onDismiss: closeModal },
        }}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Popup option' }), { key: 'Escape' });
    expect(closeModal).not.toHaveBeenCalled();
  });

  it('submits through the shell form when a surface supplies onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <ModalShell
        config={{
          regions: {
            header: { title: 'Rename' },
            body: { content: <input aria-label="Title" defaultValue="Night Bus" /> },
            footer: <button type="submit">Rename</button>,
          },
          dismissal: { onDismiss: vi.fn() },
          form: { onSubmit },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
