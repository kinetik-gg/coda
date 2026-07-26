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

export type ModalSize = 'compact' | 'wide' | 'large';

export interface ModalHeaderRegion {
  /** Accessible name for the dialog; rendered as the heading. */
  title: string;
  /** Small uppercase kicker above the title. */
  eyebrow?: string;
}

export interface ModalBodyRegion {
  /** Introduces the body and is the dialog's accessible description. */
  description?: ReactNode;
  content?: ReactNode;
}

export interface ModalRegions {
  header: ModalHeaderRegion;
  body?: ModalBodyRegion;
  footer?: ReactNode;
}

export type ModalContentLayout =
  | { type: 'stacked' }
  | {
      type: 'sections';
      /** Accessible name for the shell-owned section navigation landmark. */
      navigationLabel: string;
      navigation: ReactNode;
    };

export interface ModalDismissal {
  onDismiss: () => void;
  /** Suppresses every configured dismissal path while a mutation is in flight. */
  busy?: boolean;
  /** Shows the header close button. Confirmations opt out because Cancel is their dismissal. */
  closeButton?: boolean;
  /** Enables dismissal from Escape. */
  escape?: boolean;
  /** Enables dismissal from a direct backdrop press. */
  backdrop?: boolean;
}

export interface ModalFocus {
  /** Receives initial focus. Defaults to the first focusable control in the dialog. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Stable control that receives focus when the shell unmounts. */
  restoreFocus?: RefObject<HTMLElement | null>;
}

export interface ModalForm {
  /**
   * When supplied the body and footer are wrapped in a form and this runs on submit. The shell
   * calls `preventDefault()` first and forwards the event, so a caller that already owns a
   * `FormEvent` handler can be passed straight through.
   */
  onSubmit: (event: FormEvent) => void;
}

/**
 * Complete configuration for the application's modal primitive.
 *
 * Layout owns scrolling: stacked dialogs scroll the body, while sectioned dialogs keep the header,
 * navigation, and footer fixed and scroll only the active section content. Widths are deliberately
 * unavailable to callers; every surface chooses one step from the shared size scale.
 */
export interface ModalShellConfig {
  size?: ModalSize;
  layout?: ModalContentLayout;
  regions: ModalRegions;
  dismissal: ModalDismissal;
  focus?: ModalFocus;
  form?: ModalForm;
}

interface ConfiguredModalShellProps {
  config: ModalShellConfig;
}

/**
 * Temporary compatibility shape while existing callers migrate to `ModalShellConfig`.
 * Delete this interface once the migration is complete.
 */
interface LegacyModalShellProps {
  config?: never;
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  size?: Exclude<ModalSize, 'large'>;
  busy?: boolean;
  dismissible?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  restoreFocus?: RefObject<HTMLElement | null>;
  onSubmit?: (event: FormEvent) => void;
  footer?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
}

export type ModalShellProps = ConfiguredModalShellProps | LegacyModalShellProps;

interface ResolvedModalShellConfig {
  size: ModalSize;
  layout: ModalContentLayout;
  regions: ModalRegions;
  dismissal: Required<Omit<ModalDismissal, 'onDismiss'>> & Pick<ModalDismissal, 'onDismiss'>;
  focus?: ModalFocus;
  form?: ModalForm;
}

function resolveConfiguration(props: ModalShellProps): ResolvedModalShellConfig {
  if ('config' in props && props.config) {
    const { config } = props;
    return {
      size: config.size ?? 'compact',
      layout: config.layout ?? { type: 'stacked' },
      regions: config.regions,
      dismissal: {
        onDismiss: config.dismissal.onDismiss,
        busy: config.dismissal.busy ?? false,
        closeButton: config.dismissal.closeButton ?? true,
        escape: config.dismissal.escape ?? true,
        backdrop: config.dismissal.backdrop ?? true,
      },
      focus: config.focus,
      form: config.form,
    };
  }
  return {
    size: props.size ?? 'compact',
    layout: { type: 'stacked' },
    regions: {
      header: { title: props.title, eyebrow: props.eyebrow },
      body: { description: props.description, content: props.children },
      footer: props.footer,
    },
    dismissal: {
      onDismiss: props.onClose,
      busy: props.busy ?? false,
      closeButton: props.dismissible ?? true,
      escape: true,
      backdrop: true,
    },
    focus:
      props.initialFocus || props.restoreFocus
        ? { initialFocus: props.initialFocus, restoreFocus: props.restoreFocus }
        : undefined,
    form: props.onSubmit ? { onSubmit: props.onSubmit } : undefined,
  };
}

function focusableControls(root: HTMLElement | null): HTMLElement[] {
  return Array.from(root?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
}

let scrollLockCount = 0;
let previousBodyOverflow = '';

/**
 * Locks the document once for any number of stacked modals, then restores the exact inline value
 * that preceded the first modal. Scroll remains inside the shell-owned body region.
 */
function useDocumentScrollLock() {
  useEffect(() => {
    if (scrollLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scrollLockCount += 1;
    return () => {
      scrollLockCount -= 1;
      if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow;
    };
  }, []);
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
  escapeRef: RefObject<boolean>,
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
      if (event.key === 'Escape' && escapeRef.current && !busyRef.current) {
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

export function ModalShell(props: ModalShellProps) {
  const configuration = resolveConfiguration(props);
  const {
    size,
    layout,
    regions: { header, body, footer },
    dismissal,
    focus,
    form,
  } = configuration;
  const { title, eyebrow } = header;
  const { description, content } = body ?? {};
  const { busy, closeButton, escape, backdrop, onDismiss } = dismissal;
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onDismiss);
  const busyRef = useRef(busy);
  const escapeRef = useRef(escape);

  onCloseRef.current = onDismiss;
  busyRef.current = busy;
  escapeRef.current = escape;

  useDocumentScrollLock();
  useModalFocus(
    dialogRef,
    focus?.initialFocus,
    focus?.restoreFocus,
    onCloseRef,
    busyRef,
    escapeRef,
  );

  const bodyRegion = (
    <>
      {layout.type === 'sections' ? (
        <div className={styles.sectionLayout}>
          <nav className={styles.sectionNavigation} aria-label={layout.navigationLabel}>
            {layout.navigation}
          </nav>
          <div className={styles.sectionBody}>
            {description && (
              <div className={styles.description} id={descriptionId}>
                {description}
              </div>
            )}
            {content}
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          {description && (
            <div className={styles.description} id={descriptionId}>
              {description}
            </div>
          )}
          {content}
        </div>
      )}
      {footer && <footer className={styles.actions}>{footer}</footer>}
    </>
  );

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && backdrop && !busy) onDismiss();
      }}
    >
      <section
        ref={dialogRef}
        className={`${styles.dialog} ${styles[size]}`}
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
          {closeButton && (
            <button
              type="button"
              className={styles.close}
              aria-label={`Close ${title}`}
              disabled={busy}
              onClick={onDismiss}
            >
              <XIcon size={12} aria-hidden="true" />
            </button>
          )}
        </header>
        {form ? (
          <form
            className={styles.form}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              form.onSubmit(event);
            }}
          >
            {bodyRegion}
          </form>
        ) : (
          bodyRegion
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
