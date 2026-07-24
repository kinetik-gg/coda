import { useCallback, useEffect, useState } from 'react';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { api, ApiError } from '../api';
import styles from './UpgradeCeremony.module.css';

type Phase = 'unavailable' | 'needs_encryption_key' | 'ready_to_backup' | 'ready_to_deploy';

interface UpgradeTarget {
  version: string;
  image: string;
  digest: string;
  taggedRef: string;
  digestRef: string;
}

interface CoolifyConfigView {
  configured: boolean;
  baseUrl: string | null;
  applicationUuid: string | null;
}

interface PendingBackup {
  backupRef: string;
  takenAt: string;
  toVersion: string;
}

interface HistoryEntry {
  id: string;
  tier: 'backup' | 'generic' | 'coolify';
  fromVersion: string;
  toVersion: string;
  backupRef: string | null;
  outcome: 'SUCCESS' | 'FAILURE';
  at: string;
  error: string | null;
}

interface CeremonyView {
  phase: Phase;
  currentVersion: string;
  target: UpgradeTarget | null;
  pendingBackup: PendingBackup | null;
  redeployWebhookConfigured: boolean;
  coolify: CoolifyConfigView;
  history: HistoryEntry[];
  lastCoolifyError: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard may be unavailable; the value is still shown for manual copy */
    }
  };
  return (
    <div className={styles.copyField}>
      <span className={styles.copyLabel}>{label}</span>
      <div className={styles.copyRow}>
        <code>{value}</code>
        <button type="button" className={styles.iconButton} onClick={() => void copy()}>
          <CopyIcon size={12} aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function HistoryPanel({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeading}>
        <h3>Upgrade history</h3>
      </div>
      <ul className={styles.history}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.historyRow}>
            <span className={`${styles.badge} ${styles[entry.outcome.toLowerCase()]}`}>
              {entry.outcome}
            </span>
            <div className={styles.historyBody}>
              <strong>
                {entry.tier === 'backup'
                  ? 'Backup'
                  : entry.tier === 'coolify'
                    ? 'Coolify'
                    : 'Redeploy'}
                {' · '}v{entry.fromVersion} → v{entry.toVersion}
              </strong>
              <small>
                {formatTimestamp(entry.at)}
                {entry.backupRef ? ` · backup ${entry.backupRef}` : ''}
                {entry.error ? ` · ${entry.error}` : ''}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WebhookSettings({
  configured,
  disabled,
  onSave,
  onClear,
}: {
  configured: boolean;
  disabled: boolean;
  onSave: (url: string) => void;
  onClear: () => void;
}) {
  const [url, setUrl] = useState('');
  return (
    <div className={styles.settingBlock}>
      <div className={styles.settingHeader}>
        <strong>Redeploy webhook</strong>
        <span className={configured ? styles.on : styles.off}>
          {configured ? 'Configured' : 'Not set'}
        </span>
      </div>
      <small>
        A platform webhook that redeploys the running service after you update its CODA_IMAGE env.
        Optional; enables the generic-tier one-button redeploy.
      </small>
      <div className={styles.settingRow}>
        <input
          type="url"
          className={styles.input}
          placeholder="https://platform.example/deploy/webhook"
          value={url}
          disabled={disabled}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={disabled || url.trim().length === 0}
          onClick={() => {
            onSave(url.trim());
            setUrl('');
          }}
        >
          Save
        </button>
        {configured && (
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={disabled}
            onClick={() => onClear()}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function CoolifySettings({
  coolify,
  disabled,
  onSave,
  onClear,
}: {
  coolify: CoolifyConfigView;
  disabled: boolean;
  onSave: (input: { baseUrl: string; apiToken: string; applicationUuid: string }) => void;
  onClear: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(coolify.baseUrl ?? '');
  const [apiToken, setApiToken] = useState('');
  const [applicationUuid, setApplicationUuid] = useState(coolify.applicationUuid ?? '');
  const canSave =
    baseUrl.trim().length > 0 && apiToken.trim().length > 0 && applicationUuid.trim().length > 0;
  return (
    <div className={styles.settingBlock}>
      <div className={styles.settingHeader}>
        <strong>Coolify adapter</strong>
        <span className={coolify.configured ? styles.on : styles.off}>
          {coolify.configured ? 'Configured' : 'Not set'}
        </span>
      </div>
      <small>
        With a Coolify API token and application UUID, the upgrade updates CODA_IMAGE and triggers
        the deployment in one click. The token is stored encrypted and never shown again.
      </small>
      <div className={styles.settingGrid}>
        <input
          type="url"
          className={styles.input}
          placeholder="https://coolify.example"
          value={baseUrl}
          disabled={disabled}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <input
          type="text"
          className={styles.input}
          placeholder="Application UUID"
          value={applicationUuid}
          disabled={disabled}
          onChange={(event) => setApplicationUuid(event.target.value)}
        />
        <input
          type="password"
          className={styles.input}
          placeholder={coolify.configured ? 'API token (leave to replace)' : 'API token'}
          value={apiToken}
          disabled={disabled}
          autoComplete="off"
          onChange={(event) => setApiToken(event.target.value)}
        />
      </div>
      <div className={styles.settingRow}>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={disabled || !canSave}
          onClick={() => {
            onSave({
              baseUrl: baseUrl.trim(),
              apiToken: apiToken.trim(),
              applicationUuid: applicationUuid.trim(),
            });
            setApiToken('');
          }}
        >
          Save
        </button>
        {coolify.configured && (
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={disabled}
            onClick={() => onClear()}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The opt-in upgrade ceremony inside the Updates section: a hard backup gate, then
 * the generic tier (image reference with copy plus an optional confirmed-redeploy
 * webhook) and, when configured, the one-click Coolify adapter. Configuration for
 * the deploy targets lives at the bottom; secrets are write-only.
 */
export function UpgradeCeremony() {
  const [data, setData] = useState<CeremonyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<CeremonyView>('/api/v1/updates/ceremony'));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const perform = useCallback(async (call: () => Promise<CeremonyView>) => {
    setBusy(true);
    setActionError(null);
    try {
      setData(await call());
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading) {
    return (
      <div className={styles.loading} role="status">
        Loading upgrade tools…
      </div>
    );
  }
  if (loadError || !data) {
    return (
      <div className={styles.stateError} role="alert">
        <p>{loadError ?? 'Upgrade tools are unavailable.'}</p>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      {data.target && (
        <div className={styles.panel}>
          <div className={styles.panelHeading}>
            <h3>Guided upgrade to v{data.target.version}</h3>
          </div>
          <div className={styles.body}>
            <p className={styles.warning}>
              <WarningIcon size={13} aria-hidden="true" />
              Upgrades apply database migrations and cannot be undone without restoring a backup.
              This flow always takes a fresh backup first.
            </p>

            {data.phase === 'needs_encryption_key' && (
              <p className={styles.notice}>
                Managed upgrades require <code>CONFIG_ENCRYPTION_KEY</code> so the pre-upgrade
                backup can be signed and stored. Set it in your platform environment and restart,
                then start the upgrade.
              </p>
            )}

            {data.phase === 'ready_to_backup' && (
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    api<CeremonyView>('/api/v1/updates/ceremony/backup', { method: 'POST' }),
                  )
                }
              >
                {busy ? 'Backing up…' : 'Back up and prepare upgrade'}
              </button>
            )}

            {data.phase === 'ready_to_deploy' && data.pendingBackup && (
              <>
                <p className={styles.backupNote}>
                  Fresh backup captured: <code>{data.pendingBackup.backupRef}</code> at{' '}
                  {formatTimestamp(data.pendingBackup.takenAt)}.
                </p>
                <CopyField label="Image (digest-pinned)" value={data.target.digestRef} />
                <CopyField label="Image (version tag)" value={data.target.taggedRef} />

                {data.coolify.configured && (
                  <div className={styles.tier}>
                    <strong>Coolify — one click</strong>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          api<CeremonyView>('/api/v1/updates/ceremony/coolify/deploy', {
                            method: 'POST',
                          }),
                        )
                      }
                    >
                      {busy ? 'Deploying…' : `Update CODA_IMAGE and deploy`}
                    </button>
                    {data.lastCoolifyError && (
                      <span className={styles.tierError}>
                        Coolify failed: {data.lastCoolifyError}. Use the generic redeploy below —
                        your backup is intact.
                      </span>
                    )}
                  </div>
                )}

                <div className={styles.tier}>
                  <strong>Generic — after you update the platform env</strong>
                  {data.redeployWebhookConfigured ? (
                    <>
                      <label className={styles.confirm}>
                        <input
                          type="checkbox"
                          checked={confirmed}
                          disabled={busy}
                          onChange={(event) => setConfirmed(event.target.checked)}
                        />
                        I have updated CODA_IMAGE to the reference above in my platform environment.
                      </label>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={busy || !confirmed}
                        onClick={() =>
                          void perform(() =>
                            api<CeremonyView>('/api/v1/updates/ceremony/redeploy', {
                              method: 'POST',
                              body: JSON.stringify({ confirmedEnvUpdated: true }),
                            }),
                          )
                        }
                      >
                        Trigger redeploy
                      </button>
                    </>
                  ) : (
                    <small>
                      Update CODA_IMAGE to the reference above, then redeploy the service on your
                      platform. Configure a redeploy webhook below to do this from here.
                    </small>
                  )}
                </div>
              </>
            )}

            {actionError && (
              <p className={styles.fieldError} role="alert">
                {actionError}
              </p>
            )}
          </div>
        </div>
      )}

      <div className={styles.panel}>
        <div className={styles.panelHeading}>
          <h3>Deploy targets</h3>
        </div>
        <div className={styles.body}>
          <WebhookSettings
            configured={data.redeployWebhookConfigured}
            disabled={busy}
            onSave={(url) =>
              void perform(() =>
                api<CeremonyView>('/api/v1/updates/ceremony/webhook', {
                  method: 'PUT',
                  body: JSON.stringify({ url }),
                }),
              )
            }
            onClear={() =>
              void perform(() =>
                api<CeremonyView>('/api/v1/updates/ceremony/webhook', { method: 'DELETE' }),
              )
            }
          />
          <CoolifySettings
            coolify={data.coolify}
            disabled={busy}
            onSave={(input) =>
              void perform(() =>
                api<CeremonyView>('/api/v1/updates/ceremony/coolify', {
                  method: 'PUT',
                  body: JSON.stringify(input),
                }),
              )
            }
            onClear={() =>
              void perform(() =>
                api<CeremonyView>('/api/v1/updates/ceremony/coolify', { method: 'DELETE' }),
              )
            }
          />
        </div>
      </div>

      <HistoryPanel entries={data.history} />
    </div>
  );
}
