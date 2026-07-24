import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/csr/ArrowSquareOut';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { api, ApiError } from '../api';
import { CustomSelect, type CustomSelectOption } from '../components/CustomSelect';
import { UpgradeCeremony } from './UpgradeCeremony';
import styles from './UpdatesSection.module.css';

interface UpdatesPollingInfo {
  envDefaultHours: number;
  overrideHours: number | null;
  effectiveHours: number;
  source: 'config' | 'env';
}

interface UpdatesStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  comparison: 'behind' | 'ahead' | 'current' | 'unknown';
  notesUrl: string | null;
  lastCheckedAt: string | null;
  lastSucceededAt: string | null;
  lastError: string | null;
  polling: UpdatesPollingInfo;
  dismissedVersion: string | null;
}

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; tone: 'success' | 'warning' | 'error'; message: string };

/** Common cadences offered alongside "Default" and "Off"; a stored custom value is folded in too. */
const POLL_PRESET_HOURS = [6, 12, 24, 72, 168];

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function pollingOptions(
  envDefaultHours: number,
  overrideHours: number | null,
): CustomSelectOption[] {
  const presets = new Set(POLL_PRESET_HOURS);
  if (overrideHours !== null && overrideHours !== 0) presets.add(overrideHours);
  return [
    { value: 'default', label: `Default (every ${envDefaultHours}h)` },
    { value: '0', label: 'Off' },
    ...[...presets]
      .sort((a, b) => a - b)
      .map((hours) => ({ value: String(hours), label: `Every ${hours}h` })),
  ];
}

function pollingValue(overrideHours: number | null): string {
  return overrideHours === null ? 'default' : String(overrideHours);
}

/**
 * Owner-only surface for the release checker: running/latest version, last-checked
 * time, a release-notes link, an on-demand check with inline result states, the
 * polling-interval preference, and a per-version dismissible update banner. All
 * state is server-persisted through `/api/v1/updates/*` so it survives reloads and
 * is shared across sessions.
 */
export function UpdatesSection() {
  const [data, setData] = useState<UpdatesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkState, setCheckState] = useState<CheckState>({ kind: 'idle' });
  const [pollingSaving, setPollingSaving] = useState(false);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api<UpdatesStatus>('/api/v1/updates/status');
      setData(status);
      setLoadError(null);
    } catch (error) {
      setLoadError(requestErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runCheck = async () => {
    setCheckState({ kind: 'checking' });
    try {
      const status = await api<UpdatesStatus>('/api/v1/updates/check', { method: 'POST' });
      setData(status);
      if (status.lastError) {
        setCheckState({
          kind: 'result',
          tone: 'error',
          message: `Check failed: ${status.lastError}`,
        });
      } else if (status.updateAvailable) {
        setCheckState({
          kind: 'result',
          tone: 'warning',
          message: `Update available: v${status.latest}`,
        });
      } else {
        setCheckState({
          kind: 'result',
          tone: 'success',
          message: "You're running the latest version.",
        });
      }
    } catch (error) {
      setCheckState({ kind: 'result', tone: 'error', message: requestErrorMessage(error) });
    }
  };

  const changePolling = async (value: string) => {
    const intervalHours = value === 'default' ? null : Number(value);
    setPollingSaving(true);
    setPollingError(null);
    try {
      const status = await api<UpdatesStatus>('/api/v1/updates/polling-preference', {
        method: 'PUT',
        body: JSON.stringify({ intervalHours }),
      });
      setData(status);
    } catch (error) {
      setPollingError(requestErrorMessage(error));
    } finally {
      setPollingSaving(false);
    }
  };

  const dismiss = async (version: string) => {
    setDismissing(true);
    try {
      const status = await api<UpdatesStatus>('/api/v1/updates/dismiss', {
        method: 'POST',
        body: JSON.stringify({ version }),
      });
      setData(status);
    } finally {
      setDismissing(false);
    }
  };

  const options = useMemo(
    () => (data ? pollingOptions(data.polling.envDefaultHours, data.polling.overrideHours) : []),
    [data],
  );

  if (loading) {
    return (
      <div className={styles.loading} role="status">
        Loading update status…
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className={styles.stateError} role="alert">
        <p>{loadError ?? 'Update status is unavailable.'}</p>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  const showBanner =
    data.updateAvailable && data.latest !== null && data.dismissedVersion !== data.latest;

  return (
    <div className={styles.stack}>
      {showBanner && (
        <div className={styles.banner} role="status">
          <ArrowsClockwiseIcon size={16} aria-hidden="true" />
          <div className={styles.bannerBody}>
            <strong>Version {data.latest} is available.</strong>
            {data.notesUrl && (
              <a href={data.notesUrl} target="_blank" rel="noreferrer">
                View release notes <ArrowSquareOutIcon size={11} aria-hidden="true" />
              </a>
            )}
          </div>
          <button
            type="button"
            className={styles.dismissButton}
            aria-label={`Dismiss the update notice for version ${data.latest}`}
            disabled={dismissing}
            onClick={() => void dismiss(data.latest!)}
          >
            <XIcon size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={styles.panel}>
        <div className={styles.panelHeading}>
          <h2>Version</h2>
        </div>
        <dl className={styles.factGrid}>
          <div>
            <dt>Running version</dt>
            <dd>v{data.current}</dd>
          </div>
          <div>
            <dt>Latest known version</dt>
            <dd>{data.latest ? `v${data.latest}` : 'Not checked yet'}</dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd>{formatTimestamp(data.lastCheckedAt)}</dd>
          </div>
          <div>
            <dt>Release notes</dt>
            <dd>
              {data.notesUrl ? (
                <a href={data.notesUrl} target="_blank" rel="noreferrer">
                  View on GitHub <ArrowSquareOutIcon size={11} aria-hidden="true" />
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <div className={styles.checkRow}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={checkState.kind === 'checking'}
            onClick={() => void runCheck()}
          >
            <ArrowsClockwiseIcon size={13} aria-hidden="true" />
            {checkState.kind === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {checkState.kind === 'result' && (
            <span className={`${styles.checkResult} ${styles[checkState.tone]}`} role="status">
              {checkState.message}
            </span>
          )}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeading}>
          <h2>Automatic checks</h2>
        </div>
        <div className={styles.preferenceRow}>
          <span>
            <strong>Polling interval</strong>
            <small>
              {data.polling.effectiveHours === 0
                ? 'Automatic checks are disabled.'
                : `Checks run roughly every ${data.polling.effectiveHours} hours.`}{' '}
              Changes take effect after the API service restarts.
            </small>
          </span>
          <CustomSelect
            value={pollingValue(data.polling.overrideHours)}
            options={options}
            onChange={(value) => void changePolling(value)}
            ariaLabel="Automatic update check interval"
            disabled={pollingSaving}
          />
        </div>
        {pollingError && (
          <p className={styles.fieldError} role="alert">
            {pollingError}
          </p>
        )}
      </div>

      <UpgradeCeremony />
    </div>
  );
}
