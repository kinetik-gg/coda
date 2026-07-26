import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
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
 * Open modal overlays, oldest first. A confirmation raised from inside a share modal must be the
 * only one that answers `Escape`, and only the topmost overlay may trap focus — otherwise
 * dismissing the confirmation would tear down the surface that raised it.
 */
const dialogStack: symbol[] = [];

/**
 * Joins the application's modal-overlay stack for as long as the caller is mounted, and reports
 * whether the caller is the topmost overlay.
 *
 * `ModalShell` uses this for its own `Escape` and focus trap. Any overlay that is `aria-modal` but
 * legitimately does not fit the shell's header/body/footer anatomy — the ⌘K command palette, whose
 * chrome is a top-anchored combobox and whose `Tab` model is a single input — must still join, or
 * `Escape` over a stack would dismiss the surface underneath instead of the one on top.
 */
export function useDialogStackEntry(): { isTopmost: () => boolean } {
  const idRef = useRef<symbol>(undefined as unknown as symbol);
  idRef.current ??= Symbol('coda-dialog');
  useEffect(() => {
    const id = idRef.current;
    dialogStack.push(id);
    return () => {
      const index = dialogStack.indexOf(id);
      if (index >= 0) dialogStack.splice(index, 1);
    };
  }, []);
  return useMemo(() => ({ isTopmost: () => dialogStack.at(-1) === idRef.current }), []);
}

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
  /** Stable control that receives focus when the shell unmounts. */
  restoreFocus?: RefObject<HTMLElement | null>;
  /**
   * When supplied the body and footer are wrapped in a form and this runs on submit. The shell
   * calls `preventDefault()` first and forwards the event, so a caller that already owns a
   * `FormEvent` handler can be passed straight through.
   */
  onSubmit?: (event: FormEvent) => void;
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
  restoreFocus: RefObject<HTMLElement | null> | undefined,
  onCloseRef: RefObject<() => void>,
  busyRef: RefObject<boolean>,
) {
  const { isTopmost } = useDialogStackEntry();
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusRestoreTarget = restoreFocus?.current ?? previouslyFocused;
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
      if (focusRestoreTarget?.isConnected) focusRestoreTarget.focus({ preventScroll: true });
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
  restoreFocus,
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

  useModalFocus(dialogRef, initialFocus, restoreFocus, onCloseRef, busyRef);

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
              onSubmit(event);
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
  fields: styles.fields,
  grid: styles.grid,
  error: styles.error,
  hint: styles.hint,
};
