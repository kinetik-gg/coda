import { useCallback, useEffect, useId, useState } from 'react';
import type {
  ScheduledBackupDestinationResult,
  ScheduledBackupRunResult,
  ScheduledBackupSettings,
  ScheduledBackupView,
  StorageProbeResult,
} from '@coda/contracts';
import { api, ApiError } from '../api';
import styles from './ScheduledBackupsPanel.module.css';
import {
  DestinationCard,
  HistoryList,
  PanelHeading,
  SettingsForm,
  StatusCard,
  emptyDestination,
  toConnection,
  type DestinationForm,
} from './ScheduledBackupsPanel.parts';

const PATH = '/api/v1/instance/scheduled-backups';

type Notice = { tone: 'ok' | 'error'; text: string };

export function ScheduledBackupsPanel() {
  const [view, setView] = useState<ScheduledBackupView | null>(null);
  const [settings, setSettings] = useState<ScheduledBackupSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<'idle' | 'loading' | 'saving' | 'running'>('loading');
  const [showDestination, setShowDestination] = useState(false);
  const [destinationForm, setDestinationForm] = useState<DestinationForm>(emptyDestination);
  const [probe, setProbe] = useState<StorageProbeResult | null>(null);
  const [destinationBusy, setDestinationBusy] = useState<
    'idle' | 'testing' | 'saving' | 'clearing'
  >('idle');
  const headingId = useId();

  const load = useCallback(async () => {
    setBusy('loading');
    setLoadError(null);
    try {
      const next = await api<ScheduledBackupView>(PATH);
      setView(next);
      setSettings(next.settings);
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error.message : 'Could not load scheduled-backup settings.',
      );
    } finally {
      setBusy('idle');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyView = (next: ScheduledBackupView) => {
    setView(next);
    setSettings(next.settings);
  };

  const saveSettings = async () => {
    if (!settings) return;
    setBusy('saving');
    setNotice(null);
    try {
      const next = await api<ScheduledBackupView>(`${PATH}/settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      applyView(next);
      setNotice({ tone: 'ok', text: 'Schedule and retention saved.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Could not save the schedule.',
      });
    } finally {
      setBusy('idle');
    }
  };

  const runNow = async () => {
    setBusy('running');
    setNotice(null);
    try {
      const result = await api<ScheduledBackupRunResult>(`${PATH}/run`, { method: 'POST' });
      setNotice(
        result.outcome === 'SUCCESS'
          ? { tone: 'ok', text: `Backup written (${result.entry.archiveKey ?? 'archive'}).` }
          : { tone: 'error', text: `Backup failed: ${result.entry.error ?? 'unknown error'}.` },
      );
      await load();
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Could not start a backup.',
      });
    } finally {
      setBusy('idle');
    }
  };

  const testDestination = async () => {
    setDestinationBusy('testing');
    setNotice(null);
    try {
      const result = await api<StorageProbeResult>(`${PATH}/destination/validate`, {
        method: 'POST',
        body: JSON.stringify(toConnection(destinationForm)),
      });
      setProbe(result);
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Validation could not be started.',
      });
    } finally {
      setDestinationBusy('idle');
    }
  };

  const saveDestination = async () => {
    setDestinationBusy('saving');
    setNotice(null);
    try {
      const result = await api<ScheduledBackupDestinationResult>(`${PATH}/destination`, {
        method: 'PUT',
        body: JSON.stringify(toConnection(destinationForm)),
      });
      setProbe(result.probe);
      if (result.status === 'applied' && result.view) {
        applyView(result.view);
        setShowDestination(false);
        setDestinationForm(emptyDestination());
        setNotice({ tone: 'ok', text: 'Dedicated destination validated and saved.' });
      } else {
        setNotice({
          tone: 'error',
          text: 'Validation failed. Fix the checks below and try again.',
        });
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Could not save the destination.',
      });
    } finally {
      setDestinationBusy('idle');
    }
  };

  const clearDestination = async () => {
    setDestinationBusy('clearing');
    setNotice(null);
    try {
      const next = await api<ScheduledBackupView>(`${PATH}/destination`, { method: 'DELETE' });
      applyView(next);
      setProbe(null);
      setNotice({ tone: 'ok', text: 'Reverted to the active storage backend.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Could not clear the destination.',
      });
    } finally {
      setDestinationBusy('idle');
    }
  };

  if (loadError) {
    return (
      <section className={styles.section} aria-labelledby={headingId}>
        <PanelHeading headingId={headingId} />
        <p className={styles.noticeError} role="alert">
          {loadError}
        </p>
      </section>
    );
  }

  if (!view || !settings) {
    return (
      <section className={styles.section} aria-labelledby={headingId}>
        <PanelHeading headingId={headingId} />
        <p className={styles.muted}>Loading…</p>
      </section>
    );
  }

  const disabled = busy !== 'idle';

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <PanelHeading headingId={headingId} />

      <StatusCard view={view} onRunNow={runNow} running={busy === 'running'} disabled={disabled} />

      <SettingsForm
        settings={settings}
        disabled={disabled}
        onChange={setSettings}
        onSave={saveSettings}
        saving={busy === 'saving'}
      />

      <DestinationCard
        view={view}
        show={showDestination}
        form={destinationForm}
        probe={probe}
        busy={destinationBusy}
        onToggle={() => setShowDestination((value) => !value)}
        onUpdate={(key, value) => {
          setDestinationForm((current) => ({ ...current, [key]: value }));
          setProbe(null);
        }}
        onTest={testDestination}
        onSave={saveDestination}
        onClear={clearDestination}
      />

      {notice ? (
        <p
          className={notice.tone === 'ok' ? styles.noticeOk : styles.noticeError}
          role={notice.tone === 'ok' ? 'status' : 'alert'}
        >
          {notice.text}
        </p>
      ) : null}

      <HistoryList history={view.history} />
    </section>
  );
}
