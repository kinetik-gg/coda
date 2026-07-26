import { useEffect, useId, useRef, type ReactNode, type RefObject, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import styles from './ModalShell.module.css';

/**
 * The application's single modal mechanism (#169).
 *
 * Every dialog, sheet, and confirmation in the web app renders through this shell so focus,
 * dismissal, labelling, and chrome are decided once. Surfaces supply content and a footer; they
 * never re-implement a backdrop or a focus trap. `ConfirmationDialog` and the screenplay
 * rename/create dialogs are built on it, so there is one behaviour to verify and one to fix.
 */

const focusableSelector = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Open shells, oldest first. A confirmation raised from inside a share modal must be the only one
 * that answers `Escape`, and only the topmost shell may trap focus — otherwise dismissing the
 * confirmation would tear down the surface that raised it.
 */
const shellStack: symbol[] = [];

export type ModalSize = 'compact' | 'wide';

export interface ModalShellProps {
  /** Accessible name for the dialog; rendered as the heading. */
  title: string;
  /** Small uppercase kicker above the title. */
  eyebrow?: string;
  /** Rendered under the heading and referenced by `aria-describedby`. */
  description?: ReactNode;
  size?: ModalSize;
  /** Suppresses `Escape`, backdrop dismissal, and the close button while a mutation is in flight. */
  busy?: boolean;
  /** Renders the header's close button. Confirmations opt out: Cancel is their dismissal. */
  dismissible?: boolean;
  /** Receives initial focus. Defaults to the first focusable control in the dialog. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** When supplied the body is wrapped in a form and this runs on submit. */
  onSubmit?: () => void;
  footer?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
}

function focusableControls(root: HTMLElement | null): HTMLElement[] {
  return Array.from(root?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
}

/**
 * Focus trap, restore, and `Escape` handling for the topmost shell. Runs once per mount: the
 * mutable refs let the effect read current props without resubscribing, so a busy transition never
 * moves focus.
 */
function useModalFocus(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocus: RefObject<HTMLElement | null> | undefined,
  onCloseRef: RefObject<() => void>,
  busyRef: RefObject<boolean>,
) {
  useEffect(() => {
    const id = Symbol('coda-modal');
    shellStack.push(id);
    const isTopmost = () => shellStack.at(-1) === id;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const target = initialFocus?.current ?? focusableControls(dialogRef.current)[0];
    target?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = focusableControls(dialogRef.current);
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      const active = document.activeElement;
      if (!dialogRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const index = shellStack.indexOf(id);
      if (index >= 0) shellStack.splice(index, 1);
      previouslyFocused?.focus({ preventScroll: true });
    };
    // The refs are stable; the shell deliberately establishes focus exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function ModalShell({
  title,
  eyebrow,
  description,
  size = 'compact',
  busy = false,
  dismissible = true,
  initialFocus,
  onSubmit,
  footer,
  children,
  onClose,
}: ModalShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  onCloseRef.current = onClose;
  busyRef.current = busy;

  useModalFocus(dialogRef, initialFocus, onCloseRef, busyRef);

  const body = (
    <>
      <div className={styles.body} id={descriptionId}>
        {description}
        {children}
      </div>
      {footer && <footer className={styles.actions}>{footer}</footer>}
    </>
  );

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`${styles.dialog} ${size === 'wide' ? styles.wide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          {dismissible && (
            <button
              type="button"
              className={styles.close}
              aria-label={`Close ${title}`}
              disabled={busy}
              onClick={onClose}
            >
              <XIcon size={12} aria-hidden="true" />
            </button>
          )}
        </header>
        {onSubmit ? (
          <form
            className={styles.form}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </section>
    </div>,
    document.body,
  );
}

/** The shell's shared button classes, so callers style actions without a second vocabulary. */
export const modalButtonStyles = {
  secondary: styles.secondaryButton,
  primary: styles.primaryButton,
  destructive: styles.destructiveButton,
};

/** The shell's shared form classes, so a dialog's fields never grow a private stylesheet. */
export const modalFormStyles = {
  field: styles.field,
  error: styles.error,
  hint: styles.hint,
};
