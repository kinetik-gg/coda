import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

const TOOLTIP_GAP = 6;
const VIEWPORT_MARGIN = 8;
const EXIT_DURATION_MS = 100;

interface TooltipTriggerProps {
  'aria-describedby'?: string;
}

export interface TooltipProps {
  children: ReactElement<TooltipTriggerProps>;
  content: ReactNode;
  delay?: number;
  className?: string;
}

export function Tooltip({ children, content, delay = 350, className }: TooltipProps) {
  const generatedId = useId();
  const tooltipId = `tooltip-${generatedId}`;
  const trigger = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const [rendered, setRendered] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const clearOpenTimer = () => {
    if (openTimer.current !== undefined) window.clearTimeout(openTimer.current);
    openTimer.current = undefined;
  };

  const clearCloseTimer = () => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };

  const show = (immediate = false) => {
    clearCloseTimer();
    if (rendered) {
      setOpen(true);
      return;
    }
    clearOpenTimer();
    openTimer.current = window.setTimeout(
      () => {
        setRendered(true);
        setOpen(true);
        openTimer.current = undefined;
      },
      immediate ? 0 : delay,
    );
  };

  const hide = () => {
    clearOpenTimer();
    if (!rendered) return;
    setOpen(false);
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setRendered(false);
      closeTimer.current = undefined;
    }, EXIT_DURATION_MS);
  };

  useLayoutEffect(() => {
    if (!rendered) return;
    const updatePosition = () => {
      const triggerBounds = trigger.current?.getBoundingClientRect();
      const tooltipBounds = tooltip.current?.getBoundingClientRect();
      if (!triggerBounds || !tooltipBounds) return;

      const centeredLeft = triggerBounds.left + (triggerBounds.width - tooltipBounds.width) / 2;
      const left = Math.min(
        window.innerWidth - tooltipBounds.width - VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, centeredLeft),
      );
      const fitsAbove = triggerBounds.top - tooltipBounds.height - TOOLTIP_GAP >= VIEWPORT_MARGIN;
      const top = fitsAbove
        ? triggerBounds.top - tooltipBounds.height - TOOLTIP_GAP
        : triggerBounds.bottom + TOOLTIP_GAP;
      setPosition({ left, top });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [content, rendered]);

  useEffect(() => {
    if (!rendered) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  });

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [],
  );

  const describedBy = [children.props['aria-describedby'], rendered ? tooltipId : undefined]
    .filter(Boolean)
    .join(' ');
  const child = cloneElement(children, {
    'aria-describedby': describedBy || undefined,
  });
  const leaveFocus = (event: FocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) hide();
  };

  return (
    <>
      <span
        ref={trigger}
        className={`${styles.trigger} ${className ?? ''}`}
        onMouseEnter={() => show()}
        onMouseLeave={hide}
        onFocusCapture={() => show(true)}
        onBlurCapture={leaveFocus}
      >
        {child}
      </span>
      {rendered &&
        createPortal(
          <div
            ref={tooltip}
            id={tooltipId}
            role="tooltip"
            className={styles.tooltip}
            data-state={open ? 'open' : 'closing'}
            style={position}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
