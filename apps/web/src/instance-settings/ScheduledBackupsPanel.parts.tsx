import { useId } from 'react';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { ClockCountdownIcon } from '@phosphor-icons/react/dist/csr/ClockCountdown';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type {
  ScheduledBackupHistoryEntry,
  ScheduledBackupSettings,
  ScheduledBackupView,
  StorageConnectionInput,
  StorageProbeCheck,
  StorageProbeResult,
  StorageProviderPreset,
} from '@coda/contracts';
import styles from './ScheduledBackupsPanel.module.css';

export const PRESET_ORDER: StorageProviderPreset[] = ['minio', 'r2', 's3', 'spaces', 'generic'];
const PRESET_LABELS: Record<StorageProviderPreset, string> = {
  minio: 'MinIO',
  r2: 'Cloudflare R2',
  s3: 'AWS S3',
  spaces: 'DigitalOcean Spaces',
  generic: 'Generic S3',
};
const CHECK_LABELS: Record<StorageProbeCheck['name'], string> = {
  write: 'Write probe object',
  read: 'Read probe object',
  delete: 'Delete probe object',
  presign: 'Presigned URL',
  cors: 'CORS (browser access)',
};

export interface DestinationForm {
  provider: StorageProviderPreset;
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function emptyDestination(): DestinationForm {
  return {
    provider: 'minio',
    endpoint: '',
    publicEndpoint: '',
    region: 'us-east-1',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: true,
  };
}

export function toConnection(form: DestinationForm): StorageConnectionInput {
  return {
    provider: form.provider,
    endpoint: form.endpoint.trim(),
    publicEndpoint: form.publicEndpoint.trim(),
    region: form.region.trim(),
    bucket: form.bucket.trim(),
    accessKeyId: form.accessKeyId.trim(),
    secretAccessKey: form.secretAccessKey,
    forcePathStyle: form.forcePathStyle,
  };
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

export function PanelHeading({ headingId }: { headingId: string }) {
  return (
    <div className={styles.head}>
      <ClockCountdownIcon size={20} aria-hidden="true" />
      <div>
        <h2 id={headingId} className={styles.heading}>
          Scheduled backups
        </h2>
        <p className={styles.intro}>
          Continuously protect this instance with signed backups on a schedule you define. Archives
          land in object storage under <code>backups/scheduled/</code> and are pruned by a rolling
          retention policy — the newest archives are never deleted.
        </p>
      </div>
    </div>
  );
}

export function StatusCard({
  view,
  onRunNow,
  running,
  disabled,
}: {
  view: ScheduledBackupView;
  onRunNow: () => void;
  running: boolean;
  disabled: boolean;
}) {
  const { status, verificationKeyFingerprint } = view;
  return (
    <div className={styles.statusCard}>
      <dl className={styles.statusGrid}>
        <StatusItem label="Schedule" value={status.enabled ? 'Enabled' : 'Disabled'} />
        <StatusItem
          label="Last run"
          value={`${formatTimestamp(status.lastRunAt)}${
            status.lastOutcome ? ` · ${status.lastOutcome}` : ''
          }`}
        />
        <StatusItem label="Next due" value={formatTimestamp(status.nextDueAt)} />
        <StatusItem
          label="Runs recorded"
          value={`${status.runCount} (${status.failureCount} failed)`}
        />
      </dl>
      {status.lastError ? (
        <p className={styles.statusError} role="alert">
          Last error: {status.lastError}
        </p>
      ) : null}
      {verificationKeyFingerprint ? (
        <p className={styles.fingerprint}>
          Verification key <code>{verificationKeyFingerprint}</code>
        </p>
      ) : null}
      <button type="button" className={styles.secondary} onClick={onRunNow} disabled={disabled}>
        {running ? 'Backing up…' : 'Back up now'}
      </button>
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statusItem}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function SettingsForm({
  settings,
  disabled,
  onChange,
  onSave,
  saving,
}: {
  settings: ScheduledBackupSettings;
  disabled: boolean;
  onChange: (settings: ScheduledBackupSettings) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const setRetention = (key: keyof ScheduledBackupSettings['retention'], value: number) =>
    onChange({ ...settings, retention: { ...settings.retention, [key]: value } });

  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>Schedule and retention</legend>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => onChange({ ...settings, enabled: event.target.checked })}
        />
        Run scheduled backups
      </label>
      <div className={styles.grid}>
        <NumberField
          label="Interval (hours)"
          value={settings.intervalHours}
          min={1}
          max={8760}
          onChange={(value) => onChange({ ...settings, intervalHours: value })}
        />
        <NumberField
          label="Keep last (N)"
          value={settings.retention.keepLast}
          min={1}
          max={3650}
          onChange={(value) => setRetention('keepLast', value)}
        />
        <NumberField
          label="Daily tier (days, 0 = off)"
          value={settings.retention.dailyForDays}
          min={0}
          max={3650}
          onChange={(value) => setRetention('dailyForDays', value)}
        />
        <NumberField
          label="Weekly tier (weeks, 0 = off)"
          value={settings.retention.weeklyForWeeks}
          min={0}
          max={520}
          onChange={(value) => setRetention('weeklyForWeeks', value)}
        />
        <NumberField
          label="Max age (days, 0 = off)"
          value={settings.retention.maxAgeDays}
          min={0}
          max={3650}
          onChange={(value) => setRetention('maxAgeDays', value)}
        />
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onSave} disabled={disabled}>
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </fieldset>
  );
}

export function DestinationCard({
  view,
  show,
  form,
  probe,
  busy,
  onToggle,
  onUpdate,
  onTest,
  onSave,
  onClear,
}: {
  view: ScheduledBackupView;
  show: boolean;
  form: DestinationForm;
  probe: StorageProbeResult | null;
  busy: 'idle' | 'testing' | 'saving' | 'clearing';
  onToggle: () => void;
  onUpdate: <K extends keyof DestinationForm>(key: K, value: DestinationForm[K]) => void;
  onTest: () => void;
  onSave: () => void;
  onClear: () => void;
}) {
  const { destination } = view;
  const isOverride = destination.source === 'override';
  const disabled = busy !== 'idle';
  return (
    <div className={styles.destinationCard}>
      <div className={styles.destinationHead}>
        <span className={styles.badge} data-source={destination.source}>
          {isOverride ? 'Dedicated destination' : 'Active storage'}
        </span>
        <span className={styles.destinationDetail}>
          Bucket <strong>{destination.bucket}</strong>
          {destination.endpoint ? ` · ${destination.endpoint}` : ''} · prefix {destination.prefix}
        </span>
      </div>
      <div className={styles.destinationActions}>
        <button type="button" className={styles.linkButton} onClick={onToggle} disabled={disabled}>
          {show ? 'Cancel' : 'Use a dedicated destination'}
        </button>
        {isOverride ? (
          <button type="button" className={styles.linkButton} onClick={onClear} disabled={disabled}>
            {busy === 'clearing' ? 'Clearing…' : 'Revert to active storage'}
          </button>
        ) : null}
      </div>

      {show ? (
        <DestinationForm
          form={form}
          probe={probe}
          busy={busy}
          disabled={disabled}
          onUpdate={onUpdate}
          onTest={onTest}
          onSave={onSave}
        />
      ) : null}
    </div>
  );
}

function DestinationForm({
  form,
  probe,
  busy,
  disabled,
  onUpdate,
  onTest,
  onSave,
}: {
  form: DestinationForm;
  probe: StorageProbeResult | null;
  busy: 'idle' | 'testing' | 'saving' | 'clearing';
  disabled: boolean;
  onUpdate: <K extends keyof DestinationForm>(key: K, value: DestinationForm[K]) => void;
  onTest: () => void;
  onSave: () => void;
}) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>Dedicated backup destination</legend>
      <p className={styles.hint}>
        Separate the backup failure domain from primary storage. The connection is validated with
        the same probe as the storage wizard before it is saved.
      </p>
      <div className={styles.presets} role="radiogroup" aria-label="Provider preset">
        {PRESET_ORDER.map((provider) => (
          <button
            key={provider}
            type="button"
            role="radio"
            aria-checked={form.provider === provider}
            className={styles.preset}
            data-active={form.provider === provider}
            onClick={() => onUpdate('provider', provider)}
          >
            {PRESET_LABELS[provider]}
          </button>
        ))}
      </div>
      <div className={styles.grid}>
        <TextField
          label="Internal endpoint"
          value={form.endpoint}
          onChange={(value) => onUpdate('endpoint', value)}
        />
        <TextField
          label="Public endpoint"
          value={form.publicEndpoint}
          onChange={(value) => onUpdate('publicEndpoint', value)}
        />
        <TextField
          label="Region"
          value={form.region}
          onChange={(value) => onUpdate('region', value)}
        />
        <TextField
          label="Bucket"
          value={form.bucket}
          onChange={(value) => onUpdate('bucket', value)}
        />
        <TextField
          label="Access key ID"
          value={form.accessKeyId}
          onChange={(value) => onUpdate('accessKeyId', value)}
        />
        <TextField
          label="Secret access key"
          type="password"
          value={form.secretAccessKey}
          onChange={(value) => onUpdate('secretAccessKey', value)}
        />
      </div>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={form.forcePathStyle}
          onChange={(event) => onUpdate('forcePathStyle', event.target.checked)}
        />
        Force path-style addressing
      </label>
      {probe ? <ProbeResults probe={probe} /> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onTest} disabled={disabled}>
          {busy === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        <button type="button" className={styles.primary} onClick={onSave} disabled={disabled}>
          {busy === 'saving' ? 'Saving…' : 'Save destination'}
        </button>
      </div>
    </fieldset>
  );
}

function ProbeResults({ probe }: { probe: StorageProbeResult }) {
  return (
    <ul className={styles.checks} aria-label="Validation results">
      {probe.checks.map((check) => (
        <li key={check.name} className={styles.check} data-ok={check.ok}>
          {check.ok ? (
            <CheckCircleIcon size={16} weight="fill" aria-hidden="true" />
          ) : (
            <WarningCircleIcon size={16} weight="fill" aria-hidden="true" />
          )}
          <span className={styles.checkLabel}>{CHECK_LABELS[check.name]}</span>
          <span className={styles.checkDetail}>{check.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function HistoryList({ history }: { history: ScheduledBackupHistoryEntry[] }) {
  if (history.length === 0) {
    return <p className={styles.muted}>No scheduled backups have run yet.</p>;
  }
  return (
    <div className={styles.historyWrap}>
      <h3 className={styles.historyHeading}>Recent runs</h3>
      <table className={styles.historyTable}>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Trigger</th>
            <th scope="col">Result</th>
            <th scope="col">Pruned</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => (
            <tr key={entry.id} data-outcome={entry.outcome}>
              <td>{formatTimestamp(entry.finishedAt)}</td>
              <td>{entry.reason}</td>
              <td>
                {entry.outcome === 'SUCCESS' ? 'Success' : `Failed: ${entry.error ?? 'error'}`}
              </td>
              <td>{entry.prunedCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        className={styles.input}
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  type = 'text',
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
