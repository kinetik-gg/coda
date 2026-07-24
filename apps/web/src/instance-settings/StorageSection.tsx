import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { HardDrivesIcon } from '@phosphor-icons/react/dist/csr/HardDrives';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import type {
  ApplyStorageConfig,
  StorageApplyResult,
  StorageConfigView,
  StorageConnectionInput,
  StorageExistingObjectsChoice,
  StorageProbeCheck,
  StorageProbeResult,
  StorageProviderPreset,
} from '@coda/contracts';
import { api, ApiError } from '../api';
import styles from './StorageSection.module.css';

const CONFIG_PATH = '/api/v1/instance/storage-config';

interface PresetMeta {
  label: string;
  region: string;
  forcePathStyle: boolean;
  hint: string;
}

const PRESETS: Record<StorageProviderPreset, PresetMeta> = {
  minio: {
    label: 'MinIO',
    region: 'us-east-1',
    forcePathStyle: true,
    hint: 'Self-hosted, path-style addressing. Point the endpoint at the MinIO S3 API.',
  },
  r2: {
    label: 'Cloudflare R2',
    region: 'auto',
    forcePathStyle: false,
    hint: 'Use https://<account>.r2.cloudflarestorage.com and region "auto".',
  },
  s3: {
    label: 'AWS S3',
    region: 'us-east-1',
    forcePathStyle: false,
    hint: 'Use https://s3.<region>.amazonaws.com and virtual-hosted addressing.',
  },
  spaces: {
    label: 'DigitalOcean Spaces',
    region: 'nyc3',
    forcePathStyle: false,
    hint: 'Use https://<region>.digitaloceanspaces.com with the matching region.',
  },
  generic: {
    label: 'Generic S3',
    region: 'us-east-1',
    forcePathStyle: true,
    hint: 'Any S3-compatible endpoint. Adjust region and path-style to match the provider.',
  },
};

const PRESET_ORDER: StorageProviderPreset[] = ['minio', 'r2', 's3', 'spaces', 'generic'];

const CHECK_LABELS: Record<StorageProbeCheck['name'], string> = {
  write: 'Write probe object',
  read: 'Read probe object',
  delete: 'Delete probe object',
  presign: 'Presigned URL',
  cors: 'CORS (browser access)',
};

interface FormState {
  provider: StorageProviderPreset;
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function emptyForm(): FormState {
  return {
    provider: 'minio',
    endpoint: '',
    publicEndpoint: '',
    region: PRESETS.minio.region,
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: PRESETS.minio.forcePathStyle,
  };
}

function formFromView(view: StorageConfigView): FormState {
  const provider = view.provider ?? 'generic';
  return {
    provider,
    endpoint: view.endpoint,
    publicEndpoint: view.publicEndpoint,
    region: view.region,
    bucket: view.bucket,
    accessKeyId: view.accessKeyId,
    secretAccessKey: '',
    forcePathStyle: view.forcePathStyle,
  };
}

function toConnection(form: FormState): StorageConnectionInput {
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

export function StorageSection() {
  const [view, setView] = useState<StorageConfigView | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [probe, setProbe] = useState<StorageProbeResult | null>(null);
  const [gate, setGate] = useState<{ count: number } | null>(null);
  const [choice, setChoice] = useState<StorageExistingObjectsChoice>('start_empty');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<'idle' | 'loading' | 'testing' | 'saving' | 'reverting'>(
    'loading',
  );
  const headingId = useId();

  const load = useCallback(async () => {
    setBusy('loading');
    setLoadError(null);
    try {
      const next = await api<StorageConfigView>(CONFIG_PATH);
      setView(next);
      setForm(formFromView(next));
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'Could not load storage settings.');
    } finally {
      setBusy('idle');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setProbe(null);
    setGate(null);
  };

  const selectPreset = (provider: StorageProviderPreset) => {
    setForm((current) => ({
      ...current,
      provider,
      region: current.region || PRESETS[provider].region,
      forcePathStyle: PRESETS[provider].forcePathStyle,
    }));
    setProbe(null);
    setGate(null);
  };

  const runProbe = async () => {
    setBusy('testing');
    setNotice(null);
    setGate(null);
    try {
      const result = await api<StorageProbeResult>(`${CONFIG_PATH}/validate`, {
        method: 'POST',
        body: JSON.stringify(toConnection(form)),
      });
      setProbe(result);
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Validation could not be started.',
      });
    } finally {
      setBusy('idle');
    }
  };

  const apply = async (existingObjects?: StorageExistingObjectsChoice) => {
    setBusy('saving');
    setNotice(null);
    try {
      const payload: ApplyStorageConfig = { ...toConnection(form), existingObjects };
      const result = await api<StorageApplyResult>(`${CONFIG_PATH}/apply`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      handleApplyResult(result);
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'The configuration could not be applied.',
      });
    } finally {
      setBusy('idle');
    }
  };

  const handleApplyResult = (result: StorageApplyResult) => {
    setProbe(result.probe);
    if (result.status === 'applied' && result.config) {
      setView(result.config);
      setForm(formFromView(result.config));
      setGate(null);
      setNotice({ tone: 'ok', text: 'Storage backend validated, saved, and hot-swapped.' });
      return;
    }
    if (result.status === 'needs_choice') {
      setGate({ count: result.existingObjectCount ?? 0 });
      setNotice(null);
      return;
    }
    if (result.status === 'migration_pending') {
      setNotice({
        tone: 'error',
        text: 'Migration of existing objects is coming in a later release; cutover was blocked.',
      });
      return;
    }
    setNotice({ tone: 'error', text: 'Validation failed. Fix the checks below and try again.' });
  };

  const revert = async () => {
    setBusy('reverting');
    setNotice(null);
    try {
      const next = await api<StorageConfigView>(`${CONFIG_PATH}/revert`, { method: 'POST' });
      setView(next);
      setForm(formFromView(next));
      setProbe(null);
      setGate(null);
      setNotice({ tone: 'ok', text: 'Reverted to the environment configuration.' });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Could not revert to the environment.',
      });
    } finally {
      setBusy('idle');
    }
  };

  const disabled = busy !== 'idle';
  const presetHint = useMemo(() => PRESETS[form.provider].hint, [form.provider]);

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.head}>
        <HardDrivesIcon size={20} aria-hidden="true" />
        <div>
          <h2 id={headingId} className={styles.heading}>
            Object storage backend
          </h2>
          <p className={styles.intro}>
            Choose, validate, and hot-swap the object storage backend without a restart. Credentials
            are encrypted at rest and never returned to the browser.
          </p>
        </div>
      </div>

      {view ? <Provenance view={view} onRevert={revert} disabled={disabled} /> : null}
      {loadError ? (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      ) : null}

      <ConnectionForm
        form={form}
        hint={presetHint}
        disabled={busy === 'loading'}
        onSelectPreset={selectPreset}
        onUpdate={update}
      />

      {probe ? <ProbeResults probe={probe} /> : null}
      {gate ? (
        <ExistingObjectsGate
          count={gate.count}
          choice={choice}
          onChoice={setChoice}
          onConfirm={() => apply(choice)}
          disabled={disabled}
        />
      ) : null}

      {notice ? (
        <p
          className={notice.tone === 'ok' ? styles.noticeOk : styles.noticeError}
          role={notice.tone === 'ok' ? 'status' : 'alert'}
        >
          {notice.text}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={runProbe} disabled={disabled}>
          {busy === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={() => apply()}
          disabled={disabled}
        >
          {busy === 'saving' ? 'Applying…' : 'Save and activate'}
        </button>
      </div>
    </section>
  );
}

function ConnectionForm({
  form,
  hint,
  disabled,
  onSelectPreset,
  onUpdate,
}: {
  form: FormState;
  hint: string;
  disabled: boolean;
  onSelectPreset: (provider: StorageProviderPreset) => void;
  onUpdate: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>Provider preset</legend>
      <div className={styles.presets} role="radiogroup" aria-label="Provider preset">
        {PRESET_ORDER.map((provider) => (
          <button
            key={provider}
            type="button"
            role="radio"
            aria-checked={form.provider === provider}
            className={styles.preset}
            data-active={form.provider === provider}
            onClick={() => onSelectPreset(provider)}
          >
            {PRESETS[provider].label}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{hint}</p>

      <div className={styles.grid}>
        <Field label="Internal endpoint" htmlName="endpoint">
          <input
            id="endpoint"
            className={styles.input}
            value={form.endpoint}
            placeholder="http://minio:9000"
            onChange={(event) => onUpdate('endpoint', event.target.value)}
          />
        </Field>
        <Field label="Public (browser) endpoint" htmlName="publicEndpoint">
          <input
            id="publicEndpoint"
            className={styles.input}
            value={form.publicEndpoint}
            placeholder="https://objects.example.com"
            onChange={(event) => onUpdate('publicEndpoint', event.target.value)}
          />
        </Field>
        <Field label="Region" htmlName="region">
          <input
            id="region"
            className={styles.input}
            value={form.region}
            onChange={(event) => onUpdate('region', event.target.value)}
          />
        </Field>
        <Field label="Bucket" htmlName="bucket">
          <input
            id="bucket"
            className={styles.input}
            value={form.bucket}
            onChange={(event) => onUpdate('bucket', event.target.value)}
          />
        </Field>
        <Field label="Access key ID" htmlName="accessKeyId">
          <input
            id="accessKeyId"
            className={styles.input}
            value={form.accessKeyId}
            onChange={(event) => onUpdate('accessKeyId', event.target.value)}
          />
        </Field>
        <Field label="Secret access key" htmlName="secretAccessKey">
          <input
            id="secretAccessKey"
            className={styles.input}
            type="password"
            value={form.secretAccessKey}
            placeholder="Enter to set or change"
            onChange={(event) => onUpdate('secretAccessKey', event.target.value)}
          />
        </Field>
      </div>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={form.forcePathStyle}
          onChange={(event) => onUpdate('forcePathStyle', event.target.checked)}
        />
        Force path-style addressing
      </label>
    </fieldset>
  );
}

function Provenance({
  view,
  onRevert,
  disabled,
}: {
  view: StorageConfigView;
  onRevert: () => void;
  disabled: boolean;
}) {
  const fromConfig = view.source === 'config';
  return (
    <div className={styles.provenance}>
      <div>
        <span className={styles.badge} data-source={view.source}>
          {fromConfig ? 'Instance settings' : 'Environment'}
        </span>
        <span className={styles.provenanceDetail}>
          Active bucket <strong>{view.bucket}</strong> · {view.existingObjectCount} stored object
          {view.existingObjectCount === 1 ? '' : 's'} · CORS origin {view.appOrigin}
        </span>
      </div>
      {fromConfig ? (
        <button type="button" className={styles.linkButton} onClick={onRevert} disabled={disabled}>
          Revert to environment configuration
        </button>
      ) : null}
    </div>
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

function ExistingObjectsGate({
  count,
  choice,
  onChoice,
  onConfirm,
  disabled,
}: {
  count: number;
  choice: StorageExistingObjectsChoice;
  onChoice: (choice: StorageExistingObjectsChoice) => void;
  onConfirm: () => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.gate} role="alertdialog" aria-label="Existing objects detected">
      <p className={styles.gateTitle}>
        {count} object{count === 1 ? '' : 's'} already exist in the current backend.
      </p>
      <p className={styles.gateBody}>
        Switching backends will not move them automatically. Choose how to proceed — silent cutover
        is not allowed.
      </p>
      <label className={styles.gateChoice}>
        <input
          type="radio"
          name="existing-objects"
          checked={choice === 'start_empty'}
          onChange={() => onChoice('start_empty')}
        />
        Start empty on the new backend (existing objects stay on the old one)
      </label>
      <label className={styles.gateChoice} data-disabled="true">
        <input type="radio" name="existing-objects" disabled checked={false} readOnly />
        Migrate existing objects <em>(coming in a later release)</em>
      </label>
      <button
        type="button"
        className={styles.primary}
        onClick={onConfirm}
        disabled={disabled || choice !== 'start_empty'}
      >
        Confirm cutover
      </button>
    </div>
  );
}

function Field({
  label,
  htmlName,
  children,
}: {
  label: string;
  htmlName: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlName} className={styles.label}>
        {label}
      </label>
      {children}
    </div>
  );
}
