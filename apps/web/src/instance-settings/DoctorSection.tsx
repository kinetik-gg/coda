import { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { MinusCircleIcon } from '@phosphor-icons/react/dist/csr/MinusCircle';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { XCircleIcon } from '@phosphor-icons/react/dist/csr/XCircle';
import { api } from '../api';
import { errorText } from '../admin/utils';
import styles from './DoctorSection.module.css';

type DoctorRowStatus = 'ok' | 'warn' | 'error' | 'unknown';

interface DoctorRow {
  id: string;
  label: string;
  status: DoctorRowStatus;
  value: string;
  hint: string | null;
}

interface DoctorReport {
  generatedAt: string;
  instanceOrigin: string;
  rows: DoctorRow[];
  reportText: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; report: DoctorReport };

const STATUS_ICON: Record<DoctorRowStatus, typeof CheckCircleIcon> = {
  ok: CheckCircleIcon,
  warn: WarningCircleIcon,
  error: XCircleIcon,
  unknown: MinusCircleIcon,
};

const STATUS_LABEL: Record<DoctorRowStatus, string> = {
  ok: 'Healthy',
  warn: 'Needs attention',
  error: 'Unhealthy',
  unknown: 'Not available',
};

function StatusIcon({ status }: { status: DoctorRowStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`${styles.statusIcon} ${styles[`status_${status}`]}`}>
      <Icon size={16} weight="fill" aria-hidden="true" />
      <span className={styles.srOnly}>{STATUS_LABEL[status]}</span>
    </span>
  );
}

function DoctorRowItem({ row }: { row: DoctorRow }) {
  return (
    <li className={styles.row}>
      <StatusIcon status={row.status} />
      <div className={styles.rowBody}>
        <div className={styles.rowHeadline}>
          <span className={styles.rowLabel}>{row.label}</span>
          <span className={styles.rowValue}>{row.value}</span>
        </div>
        {row.hint ? <p className={styles.rowHint}>{row.hint}</p> : null}
      </div>
    </li>
  );
}

export function DoctorSection() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const load = useCallback(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    api<DoctorReport>('/api/v1/instance/doctor')
      .then((report) => {
        if (!cancelled) setState({ kind: 'ready', report });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: 'error', message: errorText(error, 'Unable to load diagnostics') });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load, refreshToken]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), 2_500);
    return () => clearTimeout(timer);
  }, [copyState]);

  const handleCopy = useCallback(async () => {
    if (state.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(state.report.reportText);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }, [state]);

  return (
    <div className={styles.doctor}>
      <div className={styles.toolbar}>
        <p className={styles.toolbarHint}>
          A live snapshot of this instance's health, safe to paste into a bug report as-is.
        </p>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setRefreshToken((token) => token + 1)}
            disabled={state.kind === 'loading'}
          >
            <ArrowsClockwiseIcon size={14} aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleCopy()}
            disabled={state.kind !== 'ready'}
          >
            <ClipboardTextIcon size={14} aria-hidden="true" />
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy diagnostic report'}
          </button>
        </div>
      </div>

      {state.kind === 'loading' && (
        <p className={styles.status} role="status">
          Running diagnostics…
        </p>
      )}

      {state.kind === 'error' && (
        <p className={styles.status} role="alert">
          {state.message}
        </p>
      )}

      {state.kind === 'ready' && (
        <>
          <ul className={styles.rows} aria-label="Diagnostic checks">
            {state.report.rows.map((row) => (
              <DoctorRowItem key={row.id} row={row} />
            ))}
          </ul>
          <p className={styles.generatedAt}>
            Generated {new Date(state.report.generatedAt).toLocaleString()} for{' '}
            {state.report.instanceOrigin}
          </p>
        </>
      )}
    </div>
  );
}
