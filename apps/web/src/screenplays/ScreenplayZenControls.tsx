import { useCallback, useEffect, useRef, useState } from 'react';
import { CustomSelect } from '../components/CustomSelect';
import styles from './ScreenplayEditorScreen.module.css';

const focusOptions = [
  { value: 'off', label: 'Focus Off' },
  { value: 'paragraph', label: 'Paragraph Focus' },
  { value: 'line', label: 'Line Focus' },
];

export function ScreenplayZenControls({
  typewriterScrolling,
  focusMode,
  focusScope,
  onTypewriterChange,
  onFocusChange,
  onExit,
}: {
  typewriterScrolling: boolean;
  focusMode: boolean;
  focusScope: 'paragraph' | 'line';
  onTypewriterChange: (enabled: boolean) => void;
  onFocusChange: (mode: 'off' | 'paragraph' | 'line') => void;
  onExit: () => void;
}) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dimmed, setDimmed] = useState(false);
  const wake = useCallback(() => {
    setDimmed(false);
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setDimmed(true), 5000);
  }, []);

  useEffect(() => {
    wake();
    const trackProximity = (event: PointerEvent) => {
      const bounds = controlsRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const proximity = 72;
      if (
        event.clientX >= bounds.left - proximity &&
        event.clientX <= bounds.right + proximity &&
        event.clientY >= bounds.top - proximity &&
        event.clientY <= bounds.bottom + proximity
      ) {
        wake();
      }
    };
    window.addEventListener('pointermove', trackProximity);
    return () => {
      clearTimeout(fadeTimer.current);
      window.removeEventListener('pointermove', trackProximity);
    };
  }, [wake]);

  const modifier = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
  return (
    <div
      ref={controlsRef}
      className={styles.zenControls}
      data-dimmed={dimmed ? 'true' : 'false'}
      onFocusCapture={wake}
      onPointerEnter={wake}
    >
      <div className={styles.zenControlRow} role="toolbar" aria-label="Zen writing controls">
        <button
          type="button"
          className={styles.zenToggle}
          aria-label="Typewriter Scrolling"
          aria-pressed={typewriterScrolling}
          onClick={() => onTypewriterChange(!typewriterScrolling)}
        >
          Typewriter
        </button>
        <CustomSelect
          ariaLabel="Focus mode"
          className={styles.zenFocusSelect}
          triggerClassName={styles.zenSelectTrigger}
          popupClassName={styles.zenFocusPopup}
          value={focusMode ? focusScope : 'off'}
          options={focusOptions}
          onChange={(value) => onFocusChange(value as 'off' | 'paragraph' | 'line')}
        />
        <button type="button" className={styles.exitZen} onClick={onExit}>
          Exit Zen
        </button>
      </div>
      <div className={styles.zenLegend} aria-label="Zen mode shortcuts">
        <kbd>{modifier}+Alt+T</kbd>
        <span>Typewriter</span>
        <i aria-hidden="true">·</i>
        <kbd>{modifier}+Alt+F</kbd>
        <span>Cycle focus</span>
        <i aria-hidden="true">·</i>
        <kbd>Esc</kbd>
        <span>Exit</span>
      </div>
    </div>
  );
}
